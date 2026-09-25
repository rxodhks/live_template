import type { InviteOptions, PublicUser, Role } from '../../shared/types';
import { Directory, hasRole } from './directory';
import { TemplateRoom } from './room';
import type { Env } from './env';
import { HttpError, isId, json, unwrap } from './util';

export { Directory, TemplateRoom };

/*
 * 클라우드플레어 Worker 진입점.
 *  · /api/*    : 협업 서버 API (계정, 협업 템플릿, 초대 링크, 비밀 노트, 실시간 연결)
 *  · /join/*   : 초대 링크 — 앱 화면을 그대로 주되, 메신저 미리보기 카드에 템플릿 이름이 보이도록 메타 태그를 채운다
 *  · 그 밖의 경로는 정적 파일(client/dist)이 Worker를 거치지 않고 바로 응답한다 (무료 사용량 절약)
 */

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};

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

function tokenOf(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  // 브라우저 WebSocket은 헤더를 못 붙이므로 하위 프로토콜 목록에 토큰을 실어 보낸다: ['lt', token]
  const proto = req.headers.get('sec-websocket-protocol');
  if (proto) {
    const [name, token] = proto.split(',').map((s) => s.trim());
    if (name === 'lt' && token) return token;
  }
  return null;
}

async function currentUser(c: Ctx): Promise<PublicUser | null> {
  return directory(c.env).authenticate(tokenOf(c.req));
}

async function requireUser(c: Ctx): Promise<PublicUser> {
  const user = await currentUser(c);
  if (!user) throw new HttpError(401, '로그인이 필요합니다.');
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

/* 계정: 처음 협업을 시작할 때(초대하거나 초대를 받을 때) 개인 공간의 프로필로 만든다 */
route('POST', '/api/users', async (c) => {
  const input = await body<Partial<PublicUser>>(c.req);
  const ip = c.req.headers.get('cf-connecting-ip') ?? 'local';
  return json(unwrap(await directory(c.env).createUser(input, ip)), 201);
});

route('GET', '/api/me', async (c) => json({ user: await requireUser(c) }));

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
route('POST', '/api/templates/:id/share', async (c) => {
  const user = await requireUser(c);
  const templateId = templateParam(c);
  const length = Number(c.req.headers.get('content-length') ?? 0);
  if (length > MAX_UPLOAD) throw new HttpError(413, '템플릿이 너무 큽니다.');
  const text = await c.req.text();
  if (text.length > MAX_UPLOAD) throw new HttpError(413, '템플릿이 너무 큽니다.');
  return json({ template: unwrap(await room(c.env, templateId).share(user, templateId, text)) }, 201);
});

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

route('DELETE', '/api/templates/:id', async (c) => {
  const user = await requireUser(c);
  const templateId = templateParam(c);
  unwrap(await directory(c.env).deleteTemplate(templateId, user.id));
  await room(c.env, templateId).destroy(user.name);
  return json({ ok: true });
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
  const invite = unwrap(await directory(c.env).createInvite(templateId, user.id, await body<Partial<InviteOptions>>(c.req)));
  await room(c.env, templateId).recordEvent(user, { type: 'invite.create', detail: describeInvite(invite) });
  return json({ invite }, 201);
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
  let title = 'LiveTemplate 초대';
  let description = '디자인 · 코딩 · 문서를 한 화면에서 함께 만드는 실시간 협업 템플릿';
  try {
    const p = await directory(env).previewInvite(token, null);
    if (p.valid && p.template) {
      title = `${p.template.emoji} ${p.template.name} — 초대장`;
      description = `${p.inviter?.name ?? '멤버'} 님이 ${p.role === 'viewer' ? '뷰어' : '편집자'}로 초대했습니다.${p.template.description ? ` ${p.template.description}` : ''}`;
    }
  } catch {
    /* 미리보기 정보가 없어도 페이지는 연다 */
  }
  const meta = [
    ['og:type', 'website'],
    ['og:site_name', 'LiveTemplate'],
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

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const res = await handleApi(req, env, url, exec);
    // WebSocket 응답(101)은 헤더를 바꿀 수 없으므로 그대로 돌려준다
    if (res.status === 101) return res;
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
    return new Response(res.body, { status: res.status, headers });
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
