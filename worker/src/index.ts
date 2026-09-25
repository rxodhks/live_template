import type { AuthConfig, InviteOptions, OAuthProvider, PublicUser, Role, ShareUpload, TemplateVisibility } from '../../shared/types';
import { type AuthOutcome, Directory, SESSION_TTL_MS, TRASH_TTL_MS, hasRole } from './directory';
import { TemplateRoom } from './room';
import type { Env } from './env';
import {
  COOKIE,
  OAUTH_PROVIDERS,
  authorizeUrl,
  clearCookie,
  cookie,
  fetchProfile,
  normalizeEmail,
  providerEnabled,
  readCookie,
  redirect,
  safeNext,
  withCookies,
} from './auth';
import { sendLoginCode } from './mail';
import { HttpError, isId, json, newId, safeEqual, unwrap } from './util';

export { Directory, TemplateRoom };

/*
 * 클라우드플레어 Worker 진입점.
 *  · /api/*    : 협업 서버 API (로그인, 협업 템플릿, 초대 링크, 비밀 노트, 실시간 연결)
 *  · /join/*   : 초대 링크 — 앱 화면을 그대로 주되, 메신저 미리보기 카드에 템플릿 이름이 보이도록 메타 태그를 채운다
 *  · 그 밖의 경로는 정적 파일(client/dist)이 Worker를 거치지 않고 바로 응답한다 (무료 사용량 절약)
 */

const MAX_BODY = 2 * 1024 * 1024;
const MAX_UPLOAD = 24 * 1024 * 1024;

interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  exec: ExecutionContext;
}

const directory = (env: Env) => env.DIRECTORY.get(env.DIRECTORY.idFromName('main'));
const room = (env: Env, templateId: string) => env.ROOM.get(env.ROOM.idFromName(templateId));

/* ───────────── 요청 도우미 ───────────── */

const SESSION_TTL_S = SESSION_TTL_MS / 1000;

/**
 * 세션 토큰: 브라우저는 로그인 쿠키(HttpOnly)로, 앱 · 테스트 같은 다른 클라이언트는 Authorization 헤더나
 * WebSocket 하위 프로토콜(['lt', token])로 보낸다.
 */
function tokenOf(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  const proto = req.headers.get('sec-websocket-protocol');
  if (proto) {
    const [name, token] = proto.split(',').map((s) => s.trim());
    if (name === 'lt' && token) return token;
  }
  return readCookie(req, COOKIE.session);
}

const clientIp = (req: Request) => req.headers.get('cf-connecting-ip') ?? 'local';
const agentOf = (req: Request) => req.headers.get('user-agent') ?? '';

/**
 * 내 컴퓨터의 개발 서버(wrangler dev)로 들어온 요청.
 * 배포된 곳에서는 클라우드플레어가 실제 접속 IP를 채우므로(바꿀 수 없음) 루프백 주소가 오지 않는다.
 * (개발 서버는 요청 주소를 배포 주소 madang.party로 바꿔 전달하므로 주소로는 구분할 수 없다)
 */
const isLocal = (req: Request) => ['127.0.0.1', '::1'].includes(req.headers.get('cf-connecting-ip') ?? '');

/** 로컬 개발 모드: 메일 대신 응답으로 인증 코드를 준다. 배포된 곳에서는 설정이 있어도 켜지지 않는다 */
const devMode = (c: Ctx) => c.env.AUTH_DEV_MODE === '1' && isLocal(c.req);

/** 다른 사이트에서 로그인 쿠키를 싣고 보낸 요청 차단 (SameSite=Lax 쿠키와 함께 이중으로 막는다) */
function crossSite(req: Request): boolean {
  // 최신 브라우저는 요청을 보낸 곳을 알려 준다
  const site = req.headers.get('sec-fetch-site');
  if (site) return site !== 'same-origin' && site !== 'none';
  const origin = req.headers.get('origin');
  if (!origin) return false;
  try {
    const from = new URL(origin);
    if (from.host === req.headers.get('host')) return false;
    // 개발 서버: Vite(localhost:5173)를 거쳐 온 요청
    return !(isLocal(req) && ['localhost', '127.0.0.1', '[::1]'].includes(from.hostname));
  } catch {
    return true;
  }
}

async function currentUser(c: Ctx): Promise<PublicUser | null> {
  return directory(c.env).authenticate(tokenOf(c.req));
}

async function requireUser(c: Ctx): Promise<PublicUser> {
  const user = await currentUser(c);
  // reason: 비밀 노트 비밀번호 오류 같은 다른 401과 구분해서, 화면이 로그인 화면으로 보내도록
  if (!user) throw new HttpError(401, '로그인이 필요합니다.', { reason: 'login_required' });
  return user;
}

async function body<T = Record<string, unknown>>(req: Request, max = MAX_BODY): Promise<T> {
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > max) throw new HttpError(413, '요청이 너무 큽니다.');
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, '요청이 너무 큽니다.');
  if (!text) return {} as T;
  try {
    const data = JSON.parse(text) as unknown;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
    return data as T;
  } catch {
    throw new HttpError(400, '잘못된 요청 형식입니다.');
  }
}

function templateParam(c: Ctx): string {
  const id = c.params.id;
  if (!isId(id, 8, 40)) throw new HttpError(404, '템플릿을 찾을 수 없습니다.');
  return id;
}

async function access(c: Ctx, min: Role = 'viewer') {
  const user = await requireUser(c);
  const templateId = templateParam(c);
  const a = unwrap(await directory(c.env).access(templateId, user.id, min));
  return { user, templateId, ...a };
}

/* ───────────── 라우트 ───────────── */

type Handler = (c: Ctx) => Promise<Response>;
const routes: { method: string; pattern: RegExp; keys: string[]; handler: Handler }[] = [];

function route(method: string, path: string, handler: Handler) {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${path.replace(/:(\w+)/g, (_m, key: string) => {
      keys.push(key);
      return '([^/]+)';
    })}$`,
  );
  routes.push({ method, pattern, keys, handler });
}

route('GET', '/api/health', async () => json({ ok: true, at: Date.now() }));

/* ───────────── 로그인 ───────────── */

route('GET', '/api/auth/config', async (c) =>
  json({
    email: Boolean(c.env.RESEND_API_KEY) || devMode(c),
    providers: Object.fromEntries(OAUTH_PROVIDERS.map((p) => [p, providerEnabled(c.env, p)])) as AuthConfig['providers'],
    devMode: devMode(c),
  } satisfies AuthConfig),
);

/** 로그인 성공 → 세션 쿠키, 처음이면 → 이름 입력 단계로 (가입 티켓 쿠키) */
function signedIn(outcome: AuthOutcome): Response {
  if (outcome.status === 'signed_in') {
    return withCookies(json({ status: 'signed_in', user: outcome.user }), [cookie(COOKIE.session, outcome.session, SESSION_TTL_S), clearCookie(COOKIE.signup)]);
  }
  return withCookies(json({ status: 'needs_name' }), [cookie(COOKIE.signup, outcome.ticket, 1800)]);
}

/* 이메일: 6자리 인증 코드 (가입과 로그인이 같은 흐름) */
route('POST', '/api/auth/email/start', async (c) => {
  const { email } = await body<{ email?: unknown }>(c.req);
  const addr = normalizeEmail(email);
  if (!addr) throw new HttpError(400, '올바른 이메일 주소를 입력해 주세요.');
  const dev = devMode(c);
  if (!c.env.RESEND_API_KEY && !dev) throw new HttpError(503, '이메일 로그인이 아직 준비되지 않았습니다. 다른 로그인 방법을 이용해 주세요.');
  const dir = directory(c.env);
  // 개발 모드(내 컴퓨터)에서는 IP 제한을 두지 않는다 — 테스트가 한 주소에서 여러 계정을 만든다
  const { code, expiresAt } = unwrap(await dir.startEmailCode(addr, dev ? null : clientIp(c.req)));
  if (c.env.RESEND_API_KEY) {
    try {
      await sendLoginCode(c.env, addr, code);
    } catch (err) {
      await dir.dropEmailCode(addr);
      console.error('인증 메일 발송 실패', err);
      throw new HttpError(502, '인증 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
  } else {
    console.log(`[개발 모드] ${addr} 로그인 코드: ${code}`);
  }
  return json({ ok: true, email: addr, expiresAt, resendAfter: 30, ...(dev ? { devCode: code } : {}) });
});

route('POST', '/api/auth/email/verify', async (c) => {
  const { email, code } = await body<{ email?: unknown; code?: unknown }>(c.req);
  const addr = normalizeEmail(email);
  const digits = typeof code === 'string' ? code.replace(/\D/g, '') : '';
  if (!addr || digits.length !== 6) throw new HttpError(400, '6자리 인증 코드를 입력해 주세요.');
  return signedIn(unwrap(await directory(c.env).verifyEmailCode(addr, digits, agentOf(c.req))));
});

/* 외부 계정: 구글 · 깃허브 */
const redirectUri = (c: Ctx, p: OAuthProvider) => `${c.url.origin}/api/auth/callback/${p}`;
const loginError = (reason: string, cookies: string[] = []) => redirect(`/login?error=${reason}`, cookies);

route('GET', '/api/auth/oauth/:provider', async (c) => {
  const p = c.params.provider as OAuthProvider;
  if (!OAUTH_PROVIDERS.includes(p) || !providerEnabled(c.env, p)) return loginError('unavailable');
  const flow = await directory(c.env).startOAuth(p, safeNext(c.url.searchParams.get('next')));
  return redirect(await authorizeUrl(c.env, p, redirectUri(c, p), flow), [cookie(COOKIE.oauth, flow.state, 600)]);
});

route('GET', '/api/auth/callback/:provider', async (c) => {
  const p = c.params.provider as OAuthProvider;
  const cleared = [clearCookie(COOKIE.oauth)];
  if (!OAUTH_PROVIDERS.includes(p) || !providerEnabled(c.env, p)) return loginError('unavailable', cleared);
  const param = (k: string) => c.url.searchParams.get(k) || null;
  const error = param('error');
  if (error) return loginError(error === 'access_denied' ? 'cancelled' : 'failed', cleared);
  const state = param('state');
  const code = param('code');
  const bound = readCookie(c.req, COOKIE.oauth);
  // 이 브라우저에서 시작한 로그인인지 확인 (다른 사람의 로그인 결과를 심는 공격 방지)
  if (!state || !code || !bound || !safeEqual(state, bound)) return loginError('expired', cleared);
  const dir = directory(c.env);
  const flow = await dir.consumeOAuth(state, p);
  if (!flow.ok) return loginError('expired', cleared);
  let outcome: AuthOutcome;
  try {
    const profile = await fetchProfile(c.env, p, redirectUri(c, p), code, flow.data);
    outcome = await dir.oauthSignIn({ provider: p, ...profile }, agentOf(c.req));
  } catch (err) {
    console.error('외부 로그인 실패', p, err);
    return loginError('failed', cleared);
  }
  const next = flow.data.next;
  if (outcome.status === 'signed_in') {
    return redirect(next, [...cleared, cookie(COOKIE.session, outcome.session, SESSION_TTL_S), clearCookie(COOKIE.signup)]);
  }
  return redirect(`/signup${next === '/' ? '' : `?next=${encodeURIComponent(next)}`}`, [...cleared, cookie(COOKIE.signup, outcome.ticket, 1800)]);
});

/* 가입 마무리: 사이트에서 표시될 이름 정하기 */
route('GET', '/api/auth/signup', async (c) => {
  const info = await directory(c.env).signupInfo(readCookie(c.req, COOKIE.signup));
  if (!info) throw new HttpError(404, '진행 중인 가입이 없습니다. 다시 로그인해 주세요.');
  return json(info);
});

route('POST', '/api/auth/signup', async (c) => {
  const input = await body<Partial<PublicUser>>(c.req);
  const r = unwrap(await directory(c.env).completeSignup(readCookie(c.req, COOKIE.signup), input, agentOf(c.req)));
  return withCookies(json({ user: r.user }, 201), [cookie(COOKIE.session, r.session, SESSION_TTL_S), clearCookie(COOKIE.signup)]);
});

route('POST', '/api/auth/logout', async (c) => {
  await directory(c.env).logout(tokenOf(c.req));
  return withCookies(json({ ok: true }), [clearCookie(COOKIE.session), clearCookie(COOKIE.signup)]);
});

/** 로그인 이전(가입 없이 쓰던 때)에 이 브라우저로 참여한 협업 템플릿을 로그인한 계정으로 옮긴다 */
route('POST', '/api/auth/claim', async (c) => {
  const user = await requireUser(c);
  const { token } = await body<{ token?: unknown }>(c.req);
  const r = await directory(c.env).claimLegacy(token, user.id);
  c.exec.waitUntil(Promise.allSettled(r.broadcasts.map((b) => room(c.env, b.id).templateChanged(b))));
  return json({ merged: r.merged, templates: r.broadcasts.length });
});

route('GET', '/api/me', async (c) => {
  const user = await requireUser(c);
  const res = json({ user, account: await directory(c.env).account(user.id) });
  // 쓰는 동안은 로그인 쿠키도 계속 연장
  const session = readCookie(c.req, COOKIE.session);
  return session ? withCookies(res, [cookie(COOKIE.session, session, SESSION_TTL_S)]) : res;
});

route('PATCH', '/api/me', async (c) => {
  const me = await requireUser(c);
  const { user, templateIds } = unwrap(await directory(c.env).updateUser(me.id, await body<Partial<PublicUser>>(c.req)));
  // 접속 중인 방의 커서·아바타도 바로 바뀌도록 알림
  c.exec.waitUntil(Promise.allSettled(templateIds.map((id) => room(c.env, id).userUpdated(user))));
  return json({ user });
});

/* 협업 템플릿 */
route('GET', '/api/templates', async (c) => {
  const user = await requireUser(c);
  return json(await directory(c.env).listTemplates(user.id));
});

/**
 * 개인 공간 → 협업 공간 전환: 브라우저에 있던 내용(문서·타임라인·암호화된 노트)을 그대로 올린다.
 * 무료 요금제 Worker는 요청당 CPU 10ms라서, 큰 본문은 여기서 해석하지 않고 방(Durable Object, 30초)으로 그대로 넘긴다.
 */
async function upload(c: Ctx, visibility: TemplateVisibility): Promise<Response> {
  const user = await requireUser(c);
  const templateId = templateParam(c);
  const length = Number(c.req.headers.get('content-length') ?? 0);
  if (length > MAX_UPLOAD) throw new HttpError(413, '템플릿이 너무 큽니다.');
  const text = await c.req.text();
  if (text.length > MAX_UPLOAD) throw new HttpError(413, '템플릿이 너무 큽니다.');
  return json({ template: unwrap(await room(c.env, templateId).share(user, templateId, text, visibility)) }, 201);
}
route('POST', '/api/templates/:id/share', (c) => upload(c, 'shared'));

/** 개인 공간 백업: 브라우저에서 만든 개인 템플릿을 나만 볼 수 있게 클라우드에 올린다 (이후 실시간으로 저장) */
route('POST', '/api/templates/:id/backup', (c) => upload(c, 'private'));

route('GET', '/api/templates/:id', async (c) => {
  const { template } = await access(c);
  return json({ template });
});

route('PATCH', '/api/templates/:id', async (c) => {
  const user = await requireUser(c);
  const templateId = templateParam(c);
  const r = unwrap(await directory(c.env).updateTemplate(templateId, user.id, await body(c.req)));
  if (r.changes.length) {
    const rm = room(c.env, templateId);
    await rm.templateChanged(r.broadcast);
    await rm.recordEvent(user, { type: 'template.update', detail: r.changes.join(', ') });
  }
  return json({ template: r.template });
});

/** 삭제 = 휴지통으로 이동 (30일 뒤 영구 삭제, 그 전에는 소유자가 복원 가능) */
route('DELETE', '/api/templates/:id', async (c) => {
  const user = await requireUser(c);
  const templateId = templateParam(c);
  unwrap(await directory(c.env).trashTemplate(templateId, user.id));
  const rm = room(c.env, templateId);
  await rm.recordEvent(user, { type: 'template.trash' });
  await rm.evict(user.name);
  return json({ ok: true, trashed: true });
});

/* 휴지통 (소유자만) */
route('GET', '/api/trash', async (c) => {
  const user = await requireUser(c);
  return json({ trash: await directory(c.env).listTrash(user.id), ttlDays: TRASH_TTL_MS / 86_400_000 });
});

route('POST', '/api/trash/:id/restore', async (c) => {
  const user = await requireUser(c);
  const templateId = templateParam(c);
  const r = unwrap(await directory(c.env).restoreTemplate(templateId, user.id));
  const rm = room(c.env, templateId);
  await rm.recordEvent(user, { type: 'template.restore' });
  await rm.templateChanged(r.broadcast);
  return json({ template: r.template });
});

route('DELETE', '/api/trash/:id', async (c) => {
  const user = await requireUser(c);
  const templateId = templateParam(c);
  unwrap(await directory(c.env).purgeFromTrash(templateId, user.id));
  await room(c.env, templateId).destroy(user.name);
  return json({ ok: true });
});

/* 버전 기록: 문서 전체를 1시간마다 저장 (48시간은 모두, 그 뒤로는 하루 하나씩 30일) */
route('GET', '/api/templates/:id/versions', async (c) => {
  const { templateId } = await access(c, 'editor');
  return json({ versions: await room(c.env, templateId).listVersions() });
});

/** 이전 버전으로 되돌리기: 지금 문서를 덮어쓰지 않고, 그 버전 내용으로 나만 보는 사본을 만든다 */
route('POST', '/api/templates/:id/versions/:versionId/copy', async (c) => {
  const { user, templateId, template } = await access(c, 'editor');
  const versionId = Number(c.params.versionId);
  if (!Number.isInteger(versionId) || versionId <= 0) throw new HttpError(404, '버전을 찾을 수 없습니다.');
  const { name, label } = await body<{ name?: unknown; label?: unknown }>(c.req);
  const version = unwrap(await room(c.env, templateId).readVersion(versionId));
  const copyId = newId(16);
  const copyName = (typeof name === 'string' && name.trim() ? name.trim() : `${template.name} (복원본)`).slice(0, 60);
  const upload: ShareUpload = {
    id: copyId,
    name: copyName,
    description: template.description,
    emoji: template.emoji,
    features: template.features,
    createdAt: Date.now(),
    state: version.state,
    timeline: [],
    notes: [],
  };
  const copy = unwrap(await room(c.env, copyId).share(user, copyId, JSON.stringify(upload), 'private'));
  await room(c.env, copyId).recordEvent(user, { type: 'template.copy', targetName: template.name, detail: typeof label === 'string' ? label.slice(0, 40) : '' });
  return json({ template: copy }, 201);
});

/** 내가 보낸 참여 요청 (다른 기기에서도 같은 목록) */
route('GET', '/api/me/requests', async (c) => {
  const user = await requireUser(c);
  return json({ requests: await directory(c.env).myRequests(user.id) });
});

/* 실시간 연결 */
route('GET', '/api/templates/:id/ws', async (c) => {
  if (c.req.headers.get('upgrade')?.toLowerCase() !== 'websocket') throw new HttpError(426, 'WebSocket 연결이 필요합니다.');
  const { user, role, templateId } = await access(c);
  const headers = new Headers(c.req.headers);
  headers.set('x-lt-user', encodeURIComponent(JSON.stringify(user)));
  headers.set('x-lt-role', role);
  headers.set('x-lt-template', templateId);
  headers.delete('authorization');
  headers.delete('cookie');
  return room(c.env, templateId).fetch(new Request(c.req.url, { method: 'GET', headers }));
});

/* 타임라인 */
function timelineQuery(url: URL) {
  const p = url.searchParams;
  return {
    before: Number(p.get('before')) || undefined,
    limit: Number(p.get('limit')) || undefined,
    userId: p.get('userId') || undefined,
    module: p.get('module') || undefined,
    q: p.get('q') || undefined,
  };
}

route('GET', '/api/templates/:id/timeline', async (c) => {
  const { templateId } = await access(c);
  return json(await room(c.env, templateId).getTimeline(timelineQuery(c.url)));
});

/** 전체 타임라인: 내가 속한 협업 템플릿들의 기록을 모아 시간순으로 */
route('GET', '/api/timeline', async (c) => {
  const user = await requireUser(c);
  const q = timelineQuery(c.url);
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
  const { templates } = await directory(c.env).listTemplates(user.id);
  const results = await Promise.all(templates.slice(0, 50).map((t) => room(c.env, t.id).getTimeline({ ...q, limit })));
  const events = results.flatMap((r) => r.events).sort((a, b) => b.at - a.at);
  return json({ events: events.slice(0, limit), hasMore: events.length > limit || results.some((r) => r.hasMore) });
});

/* 초대 링크 */
route('GET', '/api/templates/:id/invites', async (c) => {
  const user = await requireUser(c);
  return json({ invites: unwrap(await directory(c.env).listInvites(templateParam(c), user.id)) });
});

function describeInvite(i: { role: string; expiresAt: number | null; maxUses: number | null; requireApproval: boolean; label: string }) {
  const parts = [i.role === 'viewer' ? '뷰어' : '편집자'];
  if (i.label) parts.unshift(i.label);
  if (i.expiresAt) parts.push(`${Math.max(1, Math.round((i.expiresAt - Date.now()) / 86_400_000))}일간`);
  if (i.maxUses) parts.push(`${i.maxUses}회`);
  if (i.requireApproval) parts.push('승인 필요');
  return parts.join(' · ');
}

route('POST', '/api/templates/:id/invites', async (c) => {
  const user = await requireUser(c);
  const templateId = templateParam(c);
  const r = unwrap(await directory(c.env).createInvite(templateId, user.id, await body<Partial<InviteOptions>>(c.req)));
  const rm = room(c.env, templateId);
  // 개인 공간에서 처음 초대하면 협업 공간으로 바뀐다
  if (r.becameShared) {
    await rm.recordEvent(user, { type: 'template.share' });
    await rm.templateChanged(r.broadcast);
  }
  await rm.recordEvent(user, { type: 'invite.create', detail: describeInvite(r.invite) });
  return json({ invite: r.invite, template: r.becameShared ? { ...r.broadcast, myRole: 'owner' } : null }, 201);
});

route('DELETE', '/api/templates/:id/invites/:inviteId', async (c) => {
  const user = await requireUser(c);
  const templateId = templateParam(c);
  const invite = unwrap(await directory(c.env).revokeInvite(templateId, user.id, c.params.inviteId));
  await room(c.env, templateId).recordEvent(user, { type: 'invite.revoke', detail: describeInvite(invite) });
  return json({ ok: true });
});

/** 초대 링크 미리보기: 로그인하지 않아도 볼 수 있다 (어느 템플릿에, 누가, 어떤 권한으로) */
route('GET', '/api/invites/:token', async (c) => {
  const user = await currentUser(c);
  return json(await directory(c.env).previewInvite(c.params.token, user?.id ?? null));
});

route('POST', '/api/invites/:token/accept', async (c) => {
  const user = await requireUser(c);
  const dir = directory(c.env);
  const r = unwrap(await dir.acceptInvite(c.params.token, user.id));
  const rm = room(c.env, r.templateId);
  if (r.status === 'joined' && r.broadcast) {
    await rm.templateChanged(r.broadcast);
    await rm.recordEvent(r.user, { type: 'member.join' });
  } else if (r.status === 'pending' && r.created) {
    await rm.requestsChanged(await dir.pendingRequestsFor(r.templateId));
    await rm.recordEvent(r.user, { type: 'member.request' });
  }
  return json({ status: r.status, templateId: r.templateId, template: r.template ?? null, request: r.request ?? null });
});

route('GET', '/api/templates/:id/join-status', async (c) => {
  const user = await requireUser(c);
  return json(unwrap(await directory(c.env).joinStatus(templateParam(c), user.id)));
});

/* 참여 요청 (승인이 필요한 초대 링크) */
route('GET', '/api/templates/:id/requests', async (c) => {
  const user = await requireUser(c);
  return json({ requests: unwrap(await directory(c.env).listRequests(templateParam(c), user.id)) });
});

route('POST', '/api/templates/:id/requests/:requestId', async (c) => {
  const user = await requireUser(c);
  const templateId = templateParam(c);
  const { approve } = await body<{ approve?: unknown }>(c.req);
  const r = unwrap(await directory(c.env).decideRequest(templateId, user.id, c.params.requestId, approve === true));
  const rm = room(c.env, templateId);
  await rm.requestsChanged(r.pending);
  if (r.request.status === 'approved') {
    await rm.templateChanged(r.broadcast);
    await rm.recordEvent(r.request.user, { type: 'member.join', detail: `${user.name} 님이 승인` });
  }
  return json({ request: r.request, pending: r.pending });
});

/* 멤버 */
route('PATCH', '/api/templates/:id/members/:userId', async (c) => {
  const user = await requireUser(c);
  const templateId = templateParam(c);
  const { role } = await body<{ role?: unknown }>(c.req);
  const r = unwrap(await directory(c.env).setRole(templateId, user.id, c.params.userId, role));
  const rm = room(c.env, templateId);
  await rm.setRole(r.target.id, r.role);
  await rm.templateChanged(r.broadcast);
  await rm.recordEvent(user, { type: 'member.role', targetId: r.target.id, targetName: r.target.name, detail: r.label });
  return json({ ok: true });
});

route('DELETE', '/api/templates/:id/members/:userId', async (c) => {
  const user = await requireUser(c);
  const templateId = templateParam(c);
  const r = unwrap(await directory(c.env).removeMember(templateId, user.id, c.params.userId));
  const rm = room(c.env, templateId);
  await rm.kick(r.target.id, r.self ? 'left' : 'removed');
  await rm.templateChanged(r.broadcast);
  if (r.self) await rm.recordEvent(user, { type: 'member.leave' });
  else await rm.recordEvent(user, { type: 'member.remove', targetId: r.target.id, targetName: r.target.name });
  return json({ ok: true });
});

/* 비밀 노트 — 서버는 암호문과 비밀번호 확인값만 다룬다 */
route('GET', '/api/templates/:id/notes', async (c) => {
  const { templateId } = await access(c);
  return json({ notes: await room(c.env, templateId).listNotes() });
});

route('POST', '/api/templates/:id/notes', async (c) => {
  const { user, templateId } = await access(c, 'editor');
  return json({ note: unwrap(await room(c.env, templateId).createNote(user, await body(c.req))) }, 201);
});

route('POST', '/api/templates/:id/notes/:noteId/unlock', async (c) => {
  const { user, templateId } = await access(c);
  const { verifier } = await body<{ verifier?: unknown }>(c.req);
  return json(unwrap(await room(c.env, templateId).unlockNote(user, c.params.noteId, verifier)));
});

route('POST', '/api/templates/:id/notes/:noteId/password', async (c) => {
  const { user, role, templateId } = await access(c, 'editor');
  const { verifier, next } = await body<{ verifier?: unknown; next?: Record<string, unknown> }>(c.req);
  return json({ note: unwrap(await room(c.env, templateId).changeNotePassword(user, role, c.params.noteId, verifier, next ?? {})) });
});

route('POST', '/api/templates/:id/notes/:noteId/delete', async (c) => {
  const { user, role, templateId } = await access(c, 'editor');
  const { verifier, force } = await body<{ verifier?: unknown; force?: unknown }>(c.req);
  const forced = force === true && hasRole(role, 'owner');
  return json(unwrap(await room(c.env, templateId).deleteNote(user, role, c.params.noteId, verifier, forced)));
});

/* ───────────── 초대 링크 미리보기 카드 ───────────── */

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

async function invitePage(req: Request, env: Env, token: string): Promise<Response> {
  const page = await env.ASSETS.fetch(new Request(new URL('/', req.url), { headers: { accept: 'text/html' } }));
  let title = 'Madang 초대장';
  let description = '디자인 · 코딩 · 문서를 한 마당에서 함께 만드는 실시간 협업 템플릿';
  try {
    const p = await directory(env).previewInvite(token, null);
    if (p.valid && p.template) {
      title = `${p.template.emoji} ${p.template.name} — Madang 초대장`;
      description = `${p.inviter?.name ?? '멤버'} 님이 ${p.role === 'viewer' ? '뷰어' : '편집자'}로 초대했습니다.${p.template.description ? ` ${p.template.description}` : ''}`;
    }
  } catch {
    /* 미리보기 정보가 없어도 페이지는 연다 */
  }
  const meta = [
    ['og:type', 'website'],
    ['og:site_name', 'Madang'],
    ['og:title', title],
    ['og:description', description],
  ]
    .map(([k, v]) => `<meta property="${k}" content="${escapeHtml(v)}" />`)
    .join('');
  const res = new HTMLRewriter()
    .on('title', { element: (el) => void el.setInnerContent(title) })
    .on('meta[name="description"]', { element: (el) => void el.setAttribute('content', description) })
    .on('head', { element: (el) => void el.append(meta, { html: true }) })
    .transform(page);
  const headers = new Headers(res.headers);
  headers.set('cache-control', 'no-store');
  headers.set('referrer-policy', 'no-referrer');
  return new Response(res.body, { status: 200, headers });
}

/* ───────────── 진입점 ───────────── */

export default {
  async fetch(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    const join = url.pathname.match(/^\/join\/([^/]+)\/?$/);
    if (join && req.method === 'GET') return invitePage(req, env, decodeURIComponent(join[1]));
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);

    // 쓰기 요청과 실시간 연결은 이 사이트에서 보낸 것만 받는다
    const writes = req.method !== 'GET' && req.method !== 'HEAD';
    const upgrade = req.headers.get('upgrade')?.toLowerCase() === 'websocket';
    if ((writes || upgrade) && crossSite(req)) {
      return json({ error: '다른 사이트에서 보낸 요청은 받을 수 없습니다.', dbg: Object.fromEntries(req.headers) }, 403);
    }
    return handleApi(req, env, url, exec);
  },
} satisfies ExportedHandler<Env>;

async function handleApi(req: Request, env: Env, url: URL, exec: ExecutionContext): Promise<Response> {
  let methodMismatch = false;
  for (const r of routes) {
    const m = url.pathname.match(r.pattern);
    if (!m) continue;
    if (r.method !== req.method) {
      methodMismatch = true;
      continue;
    }
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
    try {
      return await r.handler({ req, env, url, params, exec });
    } catch (err) {
      if (err instanceof HttpError) {
        const headers: Record<string, string> = {};
        if (typeof err.extra.retryAfter === 'number') headers['retry-after'] = String(err.extra.retryAfter);
        return json({ error: err.message, ...err.extra }, err.status, headers);
      }
      console.error('API 오류', req.method, url.pathname, err);
      return json({ error: '서버에서 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' }, 500);
    }
  }
  return json({ error: methodMismatch ? '허용되지 않는 요청 방식입니다.' : '찾을 수 없는 API입니다.' }, methodMismatch ? 405 : 404);
}
