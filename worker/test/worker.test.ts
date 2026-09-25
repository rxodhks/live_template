/*
 * 클라우드플레어 로컬 런타임(wrangler dev = workerd)에서 실제로 Worker와 Durable Object를 띄워 검증한다.
 * 실행: npm test -w worker
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';

const workerDir = path.resolve(import.meta.dirname, '..');
const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lt-worker-'));
const port = 18_700 + Math.floor(Math.random() * 200);
const base = `http://127.0.0.1:${port}`;
let proc: ChildProcess | null = null;
const sockets: Client[] = [];

async function startWorker() {
  // AUTH_DEV_MODE: 메일 대신 응답으로 인증 코드를 받는다 (localhost에서만 동작)
  // GIT_*: 깃허브 외부 로그인 시작 · 되돌아오기 검증용 가짜 설정 (실제 깃허브와는 통신이 실패한다)
  const vars = ['AUTH_DEV_MODE:1', 'GIT_CLIENT_ID:test-client', 'GIT_CLIENT_SECRET:test-secret'].flatMap((v) => ['--var', v]);
  proc = spawn('npx', ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persistDir, '--log-level', 'warn', ...vars], {
    cwd: workerDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' },
    detached: true,
  });
  let log = '';
  proc.stdout?.on('data', (d) => (log += d));
  proc.stderr?.on('data', (d) => (log += d));
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return;
    } catch {
      /* 아직 시작 중 */
    }
    await sleep(500);
  }
  throw new Error(`wrangler dev가 시작되지 않았습니다\n${log}`);
}

async function stopWorker() {
  if (!proc?.pid) return;
  const p = proc;
  proc = null;
  try {
    process.kill(-p.pid!, 'SIGTERM');
  } catch {
    /* 이미 종료 */
  }
  await new Promise((r) => {
    p.once('exit', r);
    setTimeout(r, 5000);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

async function api<T = any>(method: string, url: string, token?: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${base}/api${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

/** 쿠키까지 다루는 요청 (브라우저와 같은 방식) */
async function raw(method: string, url: string, opts: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${base}${url}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...opts.headers,
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const setCookies = res.headers.getSetCookie();
  const cookies = Object.fromEntries(setCookies.map((c) => c.split(';')[0].split('=')).map(([k, ...v]) => [k, v.join('=')]));
  const data = (await res.json().catch(() => null)) as any;
  return { status: res.status, data, cookies, setCookies, location: res.headers.get('location') };
}

const SID = '__Host-madang_sid';
const SIGNUP = '__Host-madang_signup';
let emailSeq = 0;

/** 이메일 인증 코드로 가입하고 세션 토큰을 받는다 */
async function newUser(name: string, email = `user${++emailSeq}.${crypto.randomBytes(3).toString('hex')}@example.com`) {
  const start = await raw('POST', '/api/auth/email/start', { body: { email } });
  assert.equal(start.status, 200, JSON.stringify(start.data));
  const verify = await raw('POST', '/api/auth/email/verify', { body: { email, code: start.data.devCode } });
  assert.equal(verify.data.status, 'needs_name', JSON.stringify(verify.data));
  const signup = await raw('POST', '/api/auth/signup', { cookie: `${SIGNUP}=${verify.cookies[SIGNUP]}`, body: { name, color: '#3e63dd', avatar: '🦊' } });
  assert.equal(signup.status, 201, JSON.stringify(signup.data));
  return { user: signup.data.user as { id: string; name: string }, token: signup.cookies[SID], email };
}

/** 실제 브라우저 클라이언트와 같은 방식의 WebSocket 연결 */
class Client {
  ws: WebSocket;
  messages: any[] = [];
  closed: { code: number } | null = null;
  private waiters: { pred: (m: any) => boolean; resolve: (m: any) => void }[] = [];
  private seq = 0;

  constructor(templateId: string, token: string) {
    this.ws = new WebSocket(`${base.replace('http', 'ws')}/api/templates/${templateId}/ws`, ['lt', token]);
    this.ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      this.messages.push(m);
      this.waiters = this.waiters.filter((w) => {
        if (!w.pred(m)) return true;
        w.resolve(m);
        return false;
      });
    };
    this.ws.onclose = (e) => (this.closed = { code: e.code });
    sockets.push(this);
  }

  wait<T = any>(pred: (m: any) => boolean, ms = 5000, label = 'message'): Promise<T> {
    const found = this.messages.find(pred);
    if (found) {
      this.messages.splice(this.messages.indexOf(found), 1);
      return Promise.resolve(found);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout: ${label}`)), ms);
      this.waiters.push({
        pred,
        resolve: (m) => {
          clearTimeout(timer);
          this.messages.splice(this.messages.indexOf(m), 1);
          resolve(m);
        },
      });
    });
  }

  waitType<T = any>(t: string, pred: (m: any) => boolean = () => true, ms = 5000) {
    return this.wait<T>((m) => m.t === t && pred(m), ms, t);
  }

  send(msg: object) {
    this.ws.send(JSON.stringify(msg));
  }

  async request<T = any>(msg: object): Promise<{ ok: boolean; data: T; error?: string; status?: number }> {
    const id = ++this.seq;
    this.send({ ...msg, id });
    return this.waitType('ack', (m) => m.id === id);
  }

  async ready() {
    return this.waitType('welcome');
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* 무시 */
    }
  }
}

/** 실시간 연결이 거절되는지 (환영 메시지 없이 닫힘) */
function wsRejected(id: string, token: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/api/templates/${id}/ws`, ['lt', token]);
    const timer = setTimeout(() => {
      ws.close();
      resolve(false);
    }, 5000);
    ws.onmessage = () => {
      clearTimeout(timer);
      ws.close();
      resolve(false);
    };
    ws.onerror = ws.onclose = () => {
      clearTimeout(timer);
      resolve(true);
    };
  });
}

/** 브라우저에서 만든 개인 템플릿을 클라우드에 백업하는 것과 같은 요청 */
async function backup(user: { token: string }, id: string, files: Record<string, string>, name = '내 개인 템플릿') {
  const doc = new Y.Doc();
  for (const [k, v] of Object.entries(files)) doc.getMap('files').set(k, v);
  return api('POST', `/templates/${id}/backup`, user.token, {
    id,
    name,
    description: '',
    emoji: '📁',
    features: ['code'],
    createdAt: Date.now(),
    state: b64(Y.encodeStateAsUpdate(doc)),
    timeline: [],
    notes: [],
  });
}

const newTemplateId = () => `tpl${crypto.randomBytes(7).toString('hex')}`;

/** 서버 문서와 동기화된 클라이언트 Y.Doc */
async function syncDoc(c: Client, doc = new Y.Doc()) {
  const res = await c.request<{ update: string; sv: string; readOnly: boolean }>({ t: 'sync', sv: b64(Y.encodeStateVector(doc)) });
  assert.ok(res.ok);
  Y.applyUpdate(doc, unb64(res.data.update), 'remote');
  return { doc, readOnly: res.data.readOnly };
}

let owner: Awaited<ReturnType<typeof newUser>>;
let editor: Awaited<ReturnType<typeof newUser>>;
const templateId = `tpl${crypto.randomBytes(6).toString('hex')}`;
const noteId = `note${crypto.randomBytes(5).toString('hex')}`;
const noteVerifier = 'v'.repeat(43);
const bigText = 'LiveTemplate '.repeat(120_000); // ≈1.5MB — SQLite 값 한도(2MB)에 가까운 큰 문서를 나눠 저장하는지 확인

before(async () => {
  await startWorker();
  owner = await newUser('김소유');
  editor = await newUser('이편집');
});

after(async () => {
  for (const s of sockets) s.close();
  await stopWorker();
  fs.rmSync(persistDir, { recursive: true, force: true });
});

describe('로그인', () => {
  it('로그인 화면 설정: 설정된 방법만 켜진다', async () => {
    const config = await raw('GET', '/api/auth/config');
    assert.deepEqual(config.data, { email: true, providers: { google: false, github: true }, devMode: true });
    // 설정되지 않은 외부 로그인은 로그인 화면으로 돌려보낸다
    const google = await raw('GET', '/api/auth/oauth/google?next=/t/abc');
    assert.equal(google.status, 302);
    assert.equal(google.location, '/login?error=unavailable');
  });

  it('외부 로그인: 이 브라우저에서 시작한 요청만, 한 번만 받는다', async () => {
    const start = await raw('GET', '/api/auth/oauth/github?next=%2Fjoin%2Fabc');
    assert.equal(start.status, 302);
    const to = new URL(start.location!);
    assert.equal(`${to.origin}${to.pathname}`, 'https://github.com/login/oauth/authorize');
    assert.equal(to.searchParams.get('client_id'), 'test-client');
    assert.match(to.searchParams.get('redirect_uri')!, /\/api\/auth\/callback\/github$/);
    assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
    const state = to.searchParams.get('state')!;
    const bound = start.setCookies.find((c) => c.startsWith('__Host-madang_oauth='))!;
    assert.equal(start.cookies['__Host-madang_oauth'], state);
    assert.match(bound, /SameSite=Lax/);
    assert.match(bound, /HttpOnly/);

    const cb = (q: string, cookie?: string) => raw('GET', `/api/auth/callback/github?${q}`, { cookie });
    // 쿠키가 없거나(다른 브라우저) state가 다르면 거절
    assert.equal((await cb(`state=${state}&code=abc`)).location, '/login?error=expired');
    assert.equal((await cb(`state=wrong${state}&code=abc`, `__Host-madang_oauth=wrong${state}`)).location, '/login?error=expired');
    assert.equal((await cb('error=access_denied&state=x')).location, '/login?error=cancelled');
    // 올바른 요청이면 깃허브에 코드를 확인하러 간다 (가짜 설정이라 실패)
    const tried = await cb(`state=${state}&code=abc`, `__Host-madang_oauth=${state}`);
    assert.equal(tried.location, '/login?error=failed');
    assert.equal(tried.cookies[SID], undefined);
    // 한 번 쓴 state는 다시 쓸 수 없다
    assert.equal((await cb(`state=${state}&code=abc`, `__Host-madang_oauth=${state}`)).location, '/login?error=expired');
  });

  it('이메일 인증 → 이름 입력 → 가입 완료, 다음부터는 코드만으로 로그인', async () => {
    const email = `New.User+${crypto.randomBytes(3).toString('hex')}@Example.com`;
    const start = await raw('POST', '/api/auth/email/start', { body: { email: `  ${email} ` } });
    assert.equal(start.status, 200);
    assert.equal(start.data.email, email.toLowerCase(), '이메일은 소문자로 맞춘다');
    assert.match(start.data.devCode, /^\d{6}$/);

    // 30초 안에 다시 요청하면 기다리라고 한다
    const again = await raw('POST', '/api/auth/email/start', { body: { email } });
    assert.equal(again.status, 429);
    assert.ok(again.data.retryAfter > 0);

    const wrongCode = start.data.devCode === '000000' ? '111111' : '000000';
    const wrong = await raw('POST', '/api/auth/email/verify', { body: { email, code: wrongCode } });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.data.remaining, 4);

    const ok = await raw('POST', '/api/auth/email/verify', { body: { email, code: start.data.devCode } });
    assert.equal(ok.data.status, 'needs_name');
    assert.equal(ok.cookies[SID], undefined, '이름을 정하기 전에는 로그인되지 않는다');
    const ticket = `${SIGNUP}=${ok.cookies[SIGNUP]}`;
    assert.ok(ok.setCookies.some((c) => c.startsWith(SIGNUP) && c.includes('HttpOnly') && c.includes('Secure')));

    // 한 번 쓴 코드는 다시 쓸 수 없다
    assert.equal((await raw('POST', '/api/auth/email/verify', { body: { email, code: start.data.devCode } })).status, 400);

    const info = await raw('GET', '/api/auth/signup', { cookie: ticket });
    assert.deepEqual(info.data, { email: email.toLowerCase(), provider: 'email', suggestedName: '' });
    assert.equal((await raw('POST', '/api/auth/signup', { cookie: ticket, body: { name: '   ' } })).status, 400);

    const signup = await raw('POST', '/api/auth/signup', { cookie: ticket, body: { name: '새 사용자', color: '#e5484d', avatar: '🐯' } });
    assert.equal(signup.status, 201);
    assert.equal(signup.data.user.name, '새 사용자');
    const session = `${SID}=${signup.cookies[SID]}`;
    const sessionCookie = signup.setCookies.find((c) => c.startsWith(SID))!;
    assert.match(sessionCookie, /HttpOnly/);
    assert.match(sessionCookie, /SameSite=Lax/);
    assert.match(sessionCookie, /Max-Age=2592000/);
    // 가입 티켓은 한 번만
    assert.equal((await raw('POST', '/api/auth/signup', { cookie: ticket, body: { name: '두번째' } })).status, 401);

    const me = await raw('GET', '/api/me', { cookie: session });
    assert.equal(me.status, 200);
    assert.equal(me.data.user.id, signup.data.user.id);
    assert.deepEqual(me.data.account, { email: email.toLowerCase(), providers: [] });

    // 다시 로그인: 같은 이메일이면 이름 입력 없이 같은 계정
    await raw('POST', '/api/auth/logout', { cookie: session });
    const retry = await raw('POST', '/api/auth/email/start', { body: { email } });
    if (retry.status === 429) await sleep(retry.data.retryAfter * 1000 + 100);
    const code = retry.status === 429 ? (await raw('POST', '/api/auth/email/start', { body: { email } })).data.devCode : retry.data.devCode;
    const login = await raw('POST', '/api/auth/email/verify', { body: { email, code } });
    assert.equal(login.data.status, 'signed_in');
    assert.equal(login.data.user.id, signup.data.user.id);
    assert.ok(login.cookies[SID]);
  });

  it('로그아웃하면 그 세션은 더 이상 쓸 수 없다', async () => {
    const u = await newUser('로그아웃');
    const session = `${SID}=${u.token}`;
    assert.equal((await raw('GET', '/api/me', { cookie: session })).status, 200);
    const out = await raw('POST', '/api/auth/logout', { cookie: session });
    assert.equal(out.status, 200);
    assert.ok(out.setCookies.some((c) => c.startsWith(`${SID}=;`) && c.includes('Max-Age=0')));
    assert.equal((await raw('GET', '/api/me', { cookie: session })).status, 401);
    assert.equal((await api('GET', '/me', u.token)).status, 401);
  });

  it('인증 코드를 5번 틀리면 새 코드를 받아야 한다', async () => {
    const email = `brute${crypto.randomBytes(3).toString('hex')}@example.com`;
    const start = await raw('POST', '/api/auth/email/start', { body: { email } });
    const wrongCode = start.data.devCode === '999999' ? '888888' : '999999';
    for (let i = 0; i < 4; i++) assert.equal((await raw('POST', '/api/auth/email/verify', { body: { email, code: wrongCode } })).data.reason, 'mismatch');
    assert.equal((await raw('POST', '/api/auth/email/verify', { body: { email, code: wrongCode } })).data.reason, 'expired');
    const late = await raw('POST', '/api/auth/email/verify', { body: { email, code: start.data.devCode } });
    assert.equal(late.status, 400, '맞는 코드도 더는 통하지 않는다');
  });

  it('다른 사이트에서 보낸 쓰기 요청은 막는다', async () => {
    const session = `${SID}=${owner.token}`;
    const evil = await raw('PATCH', '/api/me', { cookie: session, body: { name: '해킹' }, headers: { origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
    const fetchMeta = await raw('POST', '/api/auth/logout', { cookie: session, headers: { 'sec-fetch-site': 'cross-site' } });
    assert.equal(fetchMeta.status, 403);
    assert.equal((await raw('GET', '/api/me', { cookie: session })).status, 200, '막힌 요청은 아무 효과가 없다');
    const same = await raw('PATCH', '/api/me', { cookie: session, body: { name: '김소유' }, headers: { origin: base } });
    assert.equal(same.status, 200);
  });

  it('잘못된 입력', async () => {
    assert.equal((await raw('POST', '/api/auth/email/start', { body: { email: 'not-an-email' } })).status, 400);
    assert.equal((await raw('POST', '/api/auth/email/verify', { body: { email: 'a@b.co', code: '12' } })).status, 400);
    assert.equal((await raw('GET', '/api/auth/signup')).status, 404);
    assert.equal((await raw('POST', '/api/auth/signup', { body: { name: '티켓없음' } })).status, 401);
    const anon = await api('GET', '/me', 'x'.repeat(40));
    assert.equal(anon.status, 401);
    assert.equal(anon.data.reason, 'login_required', '로그인이 풀린 경우를 화면이 구분할 수 있다');
    // 예전 방식(가입 없이 계정 만들기)은 더 이상 없다
    assert.equal((await api('POST', '/users', undefined, { name: '익명' })).status, 404);
  });

  it('토큰으로 내 정보를 확인하고 한글 이름을 바꿀 수 있다', async () => {
    const me = await api('GET', '/me', owner.token);
    assert.equal(me.status, 200);
    assert.equal(me.data.user.name, '김소유');
    const patched = await api('PATCH', '/me', editor.token, { name: '이편집자' });
    assert.equal(patched.data.user.name, '이편집자');
  });
});

describe('개인 공간 → 협업 공간 전환', () => {
  it('브라우저의 문서·타임라인·암호화된 노트를 같은 ID로 올린다', async () => {
    const doc = new Y.Doc();
    doc.getMap('files').set('main.js', 'console.log(1)');
    doc.getText('big').insert(0, bigText);
    const upload = {
      id: templateId,
      name: '우리 팀 랜딩',
      description: '개인 공간에서 시작',
      emoji: '🚀',
      features: ['code', 'docs'],
      createdAt: Date.now() - 86_400_000,
      state: b64(Y.encodeStateAsUpdate(doc)),
      timeline: [
        {
          id: 'local1abc',
          templateId,
          templateName: '우리 팀 랜딩',
          user: { id: 'local', name: '나', color: '#000000', avatar: '🙂' },
          type: 'code.create',
          module: 'code',
          targetName: 'main.js',
          text: '‘main.js’ 파일을 만들었습니다',
          at: Date.now() - 3_600_000,
          count: 1,
          important: true,
        },
      ],
      notes: [
        {
          id: noteId,
          title: '서버 계정',
          hint: '팀 이름',
          createdBy: { id: 'local', name: '나', color: '#000000', avatar: '🙂' },
          createdAt: Date.now() - 1000,
          updatedAt: Date.now() - 1000,
          kdf: { salt: 'c2FsdHNhbHQ=', iterations: 600_000 },
          verifierHash: sha256(noteVerifier),
          snapshot: 'ENCRYPTED-SNAPSHOT',
        },
      ],
    };
    const res = await api('POST', `/templates/${templateId}/share`, owner.token, upload);
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.template.id, templateId);
    assert.equal(res.data.template.myRole, 'owner');

    // 재시도해도 안전 (같은 소유자)
    assert.equal((await api('POST', `/templates/${templateId}/share`, owner.token, upload)).status, 201);
    // 다른 사람이 같은 ID를 가로챌 수 없다
    assert.equal((await api('POST', `/templates/${templateId}/share`, editor.token, upload)).status, 409);

    const list = await api('GET', '/templates', owner.token);
    assert.equal(list.data.templates.length, 1);

    const tl = await api('GET', `/templates/${templateId}/timeline`, owner.token);
    const types = tl.data.events.map((e: any) => e.type);
    assert.ok(types.includes('template.share'));
    const imported = tl.data.events.find((e: any) => e.id === 'local1abc');
    assert.equal(imported.user.id, owner.user.id, '개인 기록은 올린 사람의 계정으로 옮겨진다');

    const notes = await api('GET', `/templates/${templateId}/notes`, owner.token);
    assert.equal(notes.data.notes.length, 1);
    assert.equal(notes.data.notes[0].verifierHash, undefined, '확인값 해시는 내려주지 않는다');
    assert.equal(notes.data.notes[0].snapshot, undefined);
  });

  it('멤버가 아니면 볼 수 없다 (있는지조차 알려 주지 않는다)', async () => {
    assert.equal((await api('GET', `/templates/${templateId}`, editor.token)).status, 404);
    assert.equal((await api('GET', `/templates/${templateId}/timeline`, editor.token)).status, 404);
  });
});

let editorInvite: any;

describe('초대 링크', () => {
  it('로그인 없이 미리보기, 수락하면 바로 참여', async () => {
    const created = await api('POST', `/templates/${templateId}/invites`, owner.token, { role: 'editor', expiresInDays: 7, maxUses: null, requireApproval: false });
    assert.equal(created.status, 201);
    editorInvite = created.data.invite;
    assert.ok(editorInvite.token.length >= 20);
    assert.ok(editorInvite.expiresAt > Date.now() + 6 * 86_400_000);

    const preview = await api('GET', `/invites/${editorInvite.token}`);
    assert.equal(preview.data.valid, true);
    assert.equal(preview.data.template.name, '우리 팀 랜딩');
    assert.equal(preview.data.inviter.name, '김소유');
    assert.equal(preview.data.role, 'editor');

    const accepted = await api('POST', `/invites/${editorInvite.token}/accept`, editor.token);
    assert.equal(accepted.data.status, 'joined');
    assert.equal(accepted.data.template.myRole, 'editor');
    const again = await api('POST', `/invites/${editorInvite.token}/accept`, editor.token);
    assert.equal(again.data.status, 'member');

    const tl = await api('GET', `/templates/${templateId}/timeline`, owner.token);
    assert.ok(tl.data.events.some((e: any) => e.type === 'member.join' && e.user.id === editor.user.id));
    assert.ok(tl.data.events.some((e: any) => e.type === 'invite.create'));
  });

  it('메신저 미리보기 카드에 템플릿 이름이 들어간다', async () => {
    const res = await fetch(`${base}/join/${editorInvite.token}`);
    const html = await res.text();
    assert.equal(res.status, 200);
    assert.match(html, /<div id="root">/);
    assert.match(html, /og:title" content="🚀 우리 팀 랜딩 — Madang 초대장"/);
  });

  it('사용 횟수 제한과 취소', async () => {
    const once = (await api('POST', `/templates/${templateId}/invites`, owner.token, { role: 'viewer', expiresInDays: 1, maxUses: 1, requireApproval: false })).data.invite;
    const u1 = await newUser('박하나');
    const u2 = await newUser('최둘');
    assert.equal((await api('POST', `/invites/${once.token}/accept`, u1.token)).data.status, 'joined');
    const second = await api('POST', `/invites/${once.token}/accept`, u2.token);
    assert.equal(second.status, 410);
    assert.equal((await api('GET', `/invites/${once.token}`)).data.valid, false);

    const revoked = (await api('POST', `/templates/${templateId}/invites`, owner.token, { role: 'editor', expiresInDays: null, maxUses: null, requireApproval: false })).data.invite;
    assert.equal((await api('DELETE', `/templates/${templateId}/invites/${revoked.id}`, owner.token)).status, 200);
    assert.equal((await api('POST', `/invites/${revoked.token}/accept`, u2.token)).status, 410);
    const list = await api('GET', `/templates/${templateId}/invites`, owner.token);
    assert.deepEqual(
      list.data.invites.map((i: any) => i.id),
      [editorInvite.id],
      '소진·취소된 링크는 목록에서 빠진다',
    );
    // 뷰어는 초대 링크를 만들 수 없다
    assert.equal((await api('POST', `/templates/${templateId}/invites`, u1.token, { role: 'editor' })).status, 403);
  });
});

describe('실시간 협업', () => {
  it('문서 동기화 · 접속 알림 · 커서 · 활동 토스트', async () => {
    const a = new Client(templateId, owner.token);
    const welcomeA = await a.ready();
    assert.equal(welcomeA.role, 'owner');
    assert.equal(welcomeA.notes.length, 1);
    const { doc: docA } = await syncDoc(a);
    assert.equal(docA.getMap('files').get('main.js'), 'console.log(1)');
    assert.equal(docA.getText('big').length, bigText.length, '나눠 저장한 큰 문서를 다시 이어 붙인다');

    const b = new Client(templateId, editor.token);
    const welcomeB = await b.ready();
    assert.equal(welcomeB.presence.length, 1);
    const joinToast = await a.waitType('toast', (m) => m.toast.title === '이편집자');
    assert.match(joinToast.toast.message, /접속/);
    const { doc: docB, readOnly } = await syncDoc(b);
    assert.equal(readOnly, false);

    // B의 편집이 A에게 전달된다
    docB.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') b.send({ t: 'update', id: 999, u: b64(u) });
    });
    docB.getMap('files').set('style.css', 'body{}');
    const upd = await a.waitType('update');
    Y.applyUpdate(docA, unb64(upd.u), 'remote');
    assert.equal(docA.getMap('files').get('style.css'), 'body{}');

    // 프레즌스와 커서
    b.send({ t: 'presence', patch: { view: { module: 'code', itemId: 'style.css' } } });
    const pres = await a.waitType('presence', (m) => m.state.view.module === 'code');
    assert.equal(pres.state.user.name, '이편집자');
    b.send({ t: 'cursor', c: { x: 0.5, y: 120 } });
    const cur = await a.waitType('cursor');
    assert.deepEqual(cur.c, { x: 0.5, y: 120 });

    // 중요한 활동은 다른 사람에게 토스트 + 커서 옆 라벨
    b.send({ t: 'activity', input: { type: 'code.create', targetId: 'style.css', targetName: 'style.css' } });
    const act = await a.waitType('action', (m) => m.label.includes('파일 생성'));
    assert.equal(act.sid, welcomeB.sid);
    const toast = await a.waitType('toast', (m) => m.toast.message.includes('style.css'));
    assert.equal(toast.toast.kind, 'success');
    const tl = await a.waitType('timeline', (m) => m.event.type === 'code.create');
    assert.equal(tl.event.user.id, editor.user.id);

    // 텍스트 커서(awareness)를 문서 변경과 한 메시지로
    const awState = new Uint8Array([1, 7, 1, 2, 123, 125]); // clientID 7, clock 1, state "{}"
    b.send({ t: 'update', id: 1000, u: b64(Y.encodeStateAsUpdate(docB, Y.encodeStateVector(docA))), aw: b64(awState) });
    const withAw = await a.waitType('update', (m) => typeof m.aw === 'string');
    assert.equal(withAw.aw, b64(awState));

    // 저장하지 않는 순간 정보(그리는 중인 펜 선)는 보낸 사람 ID와 함께 그대로 중계
    b.send({ t: 'live', k: 'pen', d: { id: 'pen1', board: 'b1', pts: [1, 2, 3, 4] } });
    const live = await a.waitType('live');
    assert.equal(live.sid, welcomeB.sid);
    assert.deepEqual(live.d.pts, [1, 2, 3, 4]);
    b.send({ t: 'live', k: 'pen', d: { pts: 'x'.repeat(20_000) } }); // 너무 크면 버림
    await sleep(300);
    assert.ok(!a.messages.some((m) => m.t === 'live'), '큰 순간 정보는 중계하지 않는다');

    // 채팅
    const sent = await b.request({ t: 'chat', text: '안녕하세요' });
    assert.ok(sent.ok);
    assert.equal((await a.waitType('chat')).message.text, '안녕하세요');

    // 권한 변경이 즉시 반영된다
    await api('PATCH', `/templates/${templateId}/members/${editor.user.id}`, owner.token, { role: 'viewer' });
    assert.equal((await b.waitType('role')).role, 'viewer');
    const denied = await b.request({ t: 'update', u: b64(Y.encodeStateAsUpdate(docB)) });
    assert.equal(denied.ok, false);
    assert.equal(denied.status, 403);
    await api('PATCH', `/templates/${templateId}/members/${editor.user.id}`, owner.token, { role: 'editor' });
    await b.waitType('role', (m) => m.role === 'editor');

    // 나가면 다른 사람 화면에서 사라진다
    b.close();
    await a.waitType('presence:leave', (m) => m.sid === welcomeB.sid);
    a.close();
    await sleep(2500); // 저장 알람(2초) 이후
  });

  it('승인이 필요한 초대: 요청 → 실시간 알림 → 승인 → 뷰어로 참여', async () => {
    const a = new Client(templateId, owner.token);
    await a.ready();
    const inv = (await api('POST', `/templates/${templateId}/invites`, owner.token, { role: 'viewer', expiresInDays: 3, maxUses: 10, requireApproval: true })).data.invite;
    const guest = await newUser('정손님');
    const preview = await api('GET', `/invites/${inv.token}`, guest.token);
    assert.equal(preview.data.requireApproval, true);
    const req = await api('POST', `/invites/${inv.token}/accept`, guest.token);
    assert.equal(req.data.status, 'pending');
    assert.equal((await api('GET', `/templates/${templateId}/join-status`, guest.token)).data.status, 'pending');
    assert.equal((await api('GET', `/templates/${templateId}`, guest.token)).status, 404, '대기 중에는 볼 수 없다');

    const pushed = await a.waitType('requests', (m) => m.requests.length === 1);
    assert.equal(pushed.requests[0].user.name, '정손님');
    await a.waitType('toast', (m) => m.toast.message.includes('참여를 요청'));

    const decided = await api('POST', `/templates/${templateId}/requests/${pushed.requests[0].id}`, owner.token, { approve: true });
    assert.equal(decided.data.request.status, 'approved');
    await a.waitType('requests', (m) => m.requests.length === 0);
    assert.equal((await api('GET', `/templates/${templateId}/join-status`, guest.token)).data.status, 'approved');

    const g = new Client(templateId, guest.token);
    assert.equal((await g.ready()).role, 'viewer');
    const { doc, readOnly } = await syncDoc(g);
    assert.equal(readOnly, true);
    assert.equal(doc.getMap('files').get('style.css'), 'body{}', '저장된 편집 내용이 보인다');

    // 내보내기
    await api('DELETE', `/templates/${templateId}/members/${guest.user.id}`, owner.token);
    const kicked = await g.waitType('kicked');
    assert.equal(kicked.reason, 'removed');
    assert.equal((await api('GET', `/templates/${templateId}`, guest.token)).status, 404, '내보내진 뒤에는 볼 수 없다');
    a.close();
    g.close();
  });
});

describe('비밀 노트 (종단 간 암호화)', () => {
  it('확인값 검증 · 잠금 해제 티켓 · 암호문 중계 · 비밀번호 변경 시 모두 잠금', async () => {
    const wrong = await api('POST', `/templates/${templateId}/notes/${noteId}/unlock`, editor.token, { verifier: 'x'.repeat(43) });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.data.remaining, 4);

    const okA = await api('POST', `/templates/${templateId}/notes/${noteId}/unlock`, owner.token, { verifier: noteVerifier });
    const okB = await api('POST', `/templates/${templateId}/notes/${noteId}/unlock`, editor.token, { verifier: noteVerifier });
    assert.equal(okA.status, 200);
    assert.ok(okA.data.ticket);

    const a = new Client(templateId, owner.token);
    const b = new Client(templateId, editor.token);
    await Promise.all([a.ready(), b.ready()]);

    // 티켓 없이는 열 수 없다
    const noTicket = await b.request({ t: 'note:join', noteId, ticket: 'nope' });
    assert.equal(noTicket.ok, false);
    const joinA = await a.request({ t: 'note:join', noteId, ticket: okA.data.ticket });
    assert.equal(joinA.data.snapshot, 'ENCRYPTED-SNAPSHOT');
    await b.request({ t: 'note:join', noteId, ticket: okB.data.ticket });

    const up = await a.request({ t: 'note:update', noteId, data: 'CIPHERTEXT-1' });
    assert.ok(up.ok);
    const relayed = await b.waitType('note:update');
    assert.equal(relayed.data, 'CIPHERTEXT-1');

    // 다시 열면 스냅샷 + 이후 변경분
    const rejoin = await b.request({ t: 'note:join', noteId, ticket: okB.data.ticket });
    assert.deepEqual(
      rejoin.data.updates.map((u: any) => u.data),
      ['CIPHERTEXT-1'],
    );
    // 스냅샷으로 합치면 변경분 정리
    await a.request({ t: 'note:snapshot', noteId, data: 'ENCRYPTED-SNAPSHOT-2', upto: up.data.uid });
    const rejoin2 = await b.request({ t: 'note:join', noteId, ticket: okB.data.ticket });
    assert.equal(rejoin2.data.snapshot, 'ENCRYPTED-SNAPSHOT-2');
    assert.equal(rejoin2.data.updates.length, 0);

    // 비밀번호 변경 → 열려 있던 모든 사람의 노트가 잠긴다
    const nextVerifier = 'n'.repeat(43);
    const changed = await api('POST', `/templates/${templateId}/notes/${noteId}/password`, owner.token, {
      verifier: noteVerifier,
      next: { kdf: { salt: 'bmV3c2FsdA==', iterations: 600_000 }, verifierHash: sha256(nextVerifier), snapshot: 'RE-ENCRYPTED' },
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    assert.equal((await b.waitType('note:locked')).reason, 'password');
    assert.equal((await api('POST', `/templates/${templateId}/notes/${noteId}/unlock`, editor.token, { verifier: noteVerifier })).status, 401);
    assert.equal((await api('POST', `/templates/${templateId}/notes/${noteId}/unlock`, editor.token, { verifier: nextVerifier })).status, 200);
    a.close();
    b.close();
  });

  it('5번 틀리면 잠시 잠긴다', async () => {
    let last = 0;
    for (let i = 0; i < 5; i++) last = (await api('POST', `/templates/${templateId}/notes/${noteId}/unlock`, editor.token, { verifier: `bad${i}`.padEnd(20, 'x') })).status;
    assert.equal(last, 429);
    const locked = await api('POST', `/templates/${templateId}/notes/${noteId}/unlock`, editor.token, { verifier: 'n'.repeat(43) });
    assert.equal(locked.status, 429, '맞는 비밀번호도 잠금 시간 동안은 거절');
    assert.ok(locked.data.retryAfter > 0);
  });
});

describe('계정 분리 (이름이 같아도 완전히 다른 계정)', () => {
  let a: Awaited<ReturnType<typeof newUser>>;
  let b: Awaited<ReturnType<typeof newUser>>;
  let c: Awaited<ReturnType<typeof newUser>>;
  const privateId = newTemplateId();

  before(async () => {
    a = await newUser('홍길동');
    b = await newUser('홍길동');
    c = await newUser('홍길동');
  });

  it('같은 이름으로 가입해도 서로 다른 계정이다', async () => {
    assert.notEqual(a.user.id, b.user.id);
    const meA = await api('GET', '/me', a.token);
    const meB = await api('GET', '/me', b.token);
    assert.equal(meA.data.user.id, a.user.id);
    assert.equal(meB.data.user.id, b.user.id);
    assert.notEqual(meA.data.account.email, meB.data.account.email);
  });

  it('개인 공간은 클라우드에 백업돼도 나만 볼 수 있다', async () => {
    const res = await backup(a, privateId, { 'secret.txt': 'A의 개인 메모' });
    assert.equal(res.status, 201, JSON.stringify(res.data));
    assert.equal(res.data.template.visibility, 'private');
    assert.equal(res.data.template.members.length, 1);
    assert.equal((await backup(a, privateId, { 'secret.txt': '재시도' })).status, 201, '재시도해도 안전');

    assert.ok((await api('GET', '/templates', a.token)).data.templates.some((t: any) => t.id === privateId));
    assert.ok(!(await api('GET', '/templates', b.token)).data.templates.some((t: any) => t.id === privateId));

    // 이름이 같은 다른 계정은 어떤 경로로도 볼 수 없다
    for (const [method, path] of [
      ['GET', `/templates/${privateId}`],
      ['GET', `/templates/${privateId}/timeline`],
      ['GET', `/templates/${privateId}/notes`],
      ['GET', `/templates/${privateId}/versions`],
      ['GET', `/templates/${privateId}/invites`],
      ['GET', `/templates/${privateId}/requests`],
      ['PATCH', `/templates/${privateId}`],
      ['DELETE', `/templates/${privateId}`],
      ['POST', `/templates/${privateId}/invites`],
    ] as const) {
      const r = await api(method, path, b.token, method === 'GET' ? undefined : {});
      assert.equal(r.status, 404, `${method} ${path} → ${r.status}`);
    }
    assert.equal((await backup(b, privateId, { 'secret.txt': '가로채기' })).status, 409, '다른 사람의 템플릿 ID는 쓸 수 없다');
    assert.equal(await wsRejected(privateId, b.token), true, '실시간 연결도 거절');
    const tl = await api('GET', '/timeline?limit=200', b.token);
    assert.ok(!tl.data.events.some((e: any) => e.templateId === privateId), '전체 타임라인에도 없다');

    // 본인은 그대로
    const ws = new Client(privateId, a.token);
    await ws.ready();
    const { doc } = await syncDoc(ws);
    assert.equal(doc.getMap('files').get('secret.txt'), 'A의 개인 메모');
    ws.close();
  });

  it('초대하면 협업 공간이 되고, 초대받은 사람만 들어온다', async () => {
    const inv = await api('POST', `/templates/${privateId}/invites`, a.token, { role: 'editor', expiresInDays: 1, maxUses: 1, requireApproval: false });
    assert.equal(inv.status, 201);
    assert.equal(inv.data.template.visibility, 'shared');
    assert.equal((await api('POST', `/invites/${inv.data.invite.token}/accept`, c.token)).data.status, 'joined');
    const shared = await api('GET', `/templates/${privateId}`, c.token);
    assert.equal(shared.status, 200);
    const ids = shared.data.template.members.map((m: any) => m.user.id);
    assert.deepEqual(ids.sort(), [a.user.id, c.user.id].sort(), '같은 이름이어도 ID로 구분');
    assert.equal((await api('GET', `/templates/${privateId}`, b.token)).status, 404, '초대받지 않은 사람은 여전히 못 본다');
    const tl = await api('GET', `/templates/${privateId}/timeline`, a.token);
    assert.ok(tl.data.events.some((e: any) => e.type === 'template.share'));
  });

  it('내가 보낸 참여 요청은 내 계정에서만 보인다', async () => {
    const id = newTemplateId();
    await backup(a, id, { 'x.txt': 'x' }, '승인 필요한 템플릿');
    const inv = await api('POST', `/templates/${id}/invites`, a.token, { role: 'viewer', expiresInDays: 1, maxUses: null, requireApproval: true });
    assert.equal((await api('POST', `/invites/${inv.data.invite.token}/accept`, b.token)).data.status, 'pending');
    const mine = await api('GET', '/me/requests', b.token);
    assert.equal(mine.data.requests[0].templateId, id);
    assert.equal(mine.data.requests[0].status, 'pending');
    assert.equal(mine.data.requests[0].name, '승인 필요한 템플릿');
    assert.ok(!(await api('GET', '/me/requests', c.token)).data.requests.some((r: any) => r.templateId === id));
  });
});

describe('데이터 보호', () => {
  let a: Awaited<ReturnType<typeof newUser>>;
  let m: Awaited<ReturnType<typeof newUser>>;
  const id = newTemplateId();

  before(async () => {
    a = await newUser('보호소유');
    m = await newUser('보호멤버');
    await backup(a, id, { 'keep.txt': '지키고 싶은 내용' }, '중요한 템플릿');
    const inv = await api('POST', `/templates/${id}/invites`, a.token, { role: 'editor', expiresInDays: 1, maxUses: null, requireApproval: false });
    await api('POST', `/invites/${inv.data.invite.token}/accept`, m.token);
  });

  it('삭제하면 휴지통으로 가고, 소유자는 30일 안에 그대로 복원할 수 있다', async () => {
    const ws = new Client(id, m.token);
    await ws.ready();
    assert.equal((await api('DELETE', `/templates/${id}`, m.token)).status, 403, '소유자만 삭제');
    const del = await api('DELETE', `/templates/${id}`, a.token);
    assert.equal(del.data.trashed, true);
    assert.equal((await ws.waitType('kicked')).reason, 'deleted');
    for (const u of [a, m]) {
      assert.equal((await api('GET', `/templates/${id}`, u.token)).status, 404);
      assert.ok(!(await api('GET', '/templates', u.token)).data.templates.some((t: any) => t.id === id));
      assert.equal(await wsRejected(id, u.token), true);
    }
    const trash = await api('GET', '/trash', a.token);
    const entry = trash.data.trash.find((t: any) => t.template.id === id);
    assert.ok(entry);
    assert.equal(entry.purgeAt - entry.deletedAt, 30 * 86_400_000);
    assert.equal(trash.data.ttlDays, 30);
    assert.ok(!(await api('GET', '/trash', m.token)).data.trash.some((t: any) => t.template.id === id), '휴지통은 소유자만');
    assert.equal((await api('POST', `/trash/${id}/restore`, m.token)).status, 403);

    const restored = await api('POST', `/trash/${id}/restore`, a.token);
    assert.equal(restored.status, 200);
    assert.equal(restored.data.template.members.length, 2, '멤버도 그대로');
    const back = new Client(id, m.token);
    await back.ready();
    const { doc } = await syncDoc(back);
    assert.equal(doc.getMap('files').get('keep.txt'), '지키고 싶은 내용', '내용도 그대로');
    back.close();
    const types = (await api('GET', `/templates/${id}/timeline`, a.token)).data.events.map((e: any) => e.type);
    assert.ok(types.includes('template.trash') && types.includes('template.restore'));
  });

  it('버전 기록: 이전 버전으로 나만 보는 사본을 만든다 (지금 문서는 그대로)', async () => {
    const live = new Client(id, a.token);
    await live.ready();
    const { doc } = await syncDoc(live);
    const before = Y.encodeStateVector(doc);
    doc.getMap('files').set('keep.txt', '실수로 지운 뒤');
    const ack = await live.request({ t: 'update', u: b64(Y.encodeStateAsUpdate(doc, before)) });
    assert.equal(ack.ok, true);
    live.close();

    const versions = await api('GET', `/templates/${id}/versions`, a.token);
    assert.ok(versions.data.versions.length >= 1);
    const first = versions.data.versions[versions.data.versions.length - 1];
    assert.equal((await api('GET', `/templates/${id}/versions`, (await newUser('외부인')).token)).status, 404);

    const copy = await api('POST', `/templates/${id}/versions/${first.id}/copy`, m.token, { name: '중요한 템플릿 (복원본)', label: '처음 버전' });
    assert.equal(copy.status, 201, JSON.stringify(copy.data));
    assert.equal(copy.data.template.visibility, 'private');
    assert.equal(copy.data.template.ownerId, m.user.id, '복원한 사람의 개인 공간에');
    const cw = new Client(copy.data.template.id, m.token);
    await cw.ready();
    const restored = (await syncDoc(cw)).doc;
    assert.equal(restored.getMap('files').get('keep.txt'), '지키고 싶은 내용');
    cw.close();
    assert.equal((await api('GET', `/templates/${copy.data.template.id}`, a.token)).status, 404, '사본은 만든 사람만');
    // 원래 문서는 바뀌지 않았다
    const again = new Client(id, a.token);
    await again.ready();
    assert.equal((await syncDoc(again)).doc.getMap('files').get('keep.txt'), '실수로 지운 뒤');
    again.close();
  });

  it('휴지통에서 영구 삭제하면 되돌릴 수 없다', async () => {
    const gone = newTemplateId();
    await backup(a, gone, { 'bye.txt': 'bye' });
    await api('DELETE', `/templates/${gone}`, a.token);
    assert.equal((await api('DELETE', `/trash/${gone}`, m.token)).status, 404, '다른 사람은 비울 수 없다');
    assert.equal((await api('DELETE', `/trash/${gone}`, a.token)).status, 200);
    assert.equal((await api('POST', `/trash/${gone}/restore`, a.token)).status, 404);
    assert.ok(!(await api('GET', '/trash', a.token)).data.trash.some((t: any) => t.template.id === gone));
  });
});

describe('영속성', () => {
  it('서버를 다시 시작해도 문서·타임라인·멤버가 남아 있다', async () => {
    // "저장됨" 확인을 받은 변경은 바로 서버가 꺼져도 남아 있어야 한다
    const w = new Client(templateId, owner.token);
    await w.ready();
    const wd = (await syncDoc(w)).doc;
    const sv = Y.encodeStateVector(wd);
    wd.getMap('files').set('saved-right-before-restart.txt', '확인 받은 변경');
    assert.equal((await w.request({ t: 'update', u: b64(Y.encodeStateAsUpdate(wd, sv)) })).ok, true);
    w.close();
    await stopWorker();
    await startWorker();
    const list = await api('GET', '/templates', editor.token);
    assert.equal(list.data.templates[0].id, templateId);
    const a = new Client(templateId, owner.token);
    await a.ready();
    const { doc } = await syncDoc(a);
    assert.equal(doc.getMap('files').get('style.css'), 'body{}');
    assert.equal(doc.getMap('files').get('saved-right-before-restart.txt'), '확인 받은 변경');
    assert.equal(doc.getText('big').length, bigText.length);
    const tl = await api('GET', `/timeline?limit=200`, owner.token);
    assert.ok(tl.data.events.some((e: any) => e.type === 'notes.password'));

    // 삭제하면 접속 중인 사람도 내보내지고 휴지통으로 간다
    assert.equal((await api('DELETE', `/templates/${templateId}`, editor.token)).status, 403);
    assert.equal((await api('DELETE', `/templates/${templateId}`, owner.token)).status, 200);
    assert.equal((await a.waitType('kicked')).reason, 'deleted');
    assert.equal((await api('GET', `/templates/${templateId}`, owner.token)).status, 404);
    assert.equal((await api('GET', `/invites/${editorInvite.token}`)).data.valid, false);
    a.close();
  });
});
