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
  proc = spawn('npx', ['wrangler', 'dev', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', persistDir, '--log-level', 'warn'], {
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

async function newUser(name: string) {
  const { status, data } = await api('POST', '/users', undefined, { name, color: '#3e63dd', avatar: '🦊' });
  assert.equal(status, 201, JSON.stringify(data));
  return data as { user: { id: string; name: string }; token: string };
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

describe('계정', () => {
  it('토큰으로 내 정보를 확인하고 한글 이름을 바꿀 수 있다', async () => {
    const me = await api('GET', '/me', owner.token);
    assert.equal(me.status, 200);
    assert.equal(me.data.user.name, '김소유');
    assert.equal((await api('GET', '/me', 'x'.repeat(40))).status, 401);
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

  it('멤버가 아니면 볼 수 없다', async () => {
    assert.equal((await api('GET', `/templates/${templateId}`, editor.token)).status, 403);
    assert.equal((await api('GET', `/templates/${templateId}/timeline`, editor.token)).status, 403);
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
    assert.equal((await api('GET', `/templates/${templateId}`, guest.token)).status, 403);

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
    assert.equal((await api('GET', `/templates/${templateId}`, guest.token)).status, 403);
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

describe('영속성', () => {
  it('서버를 다시 시작해도 문서·타임라인·멤버가 남아 있다', async () => {
    await stopWorker();
    await startWorker();
    const list = await api('GET', '/templates', editor.token);
    assert.equal(list.data.templates[0].id, templateId);
    const a = new Client(templateId, owner.token);
    await a.ready();
    const { doc } = await syncDoc(a);
    assert.equal(doc.getMap('files').get('style.css'), 'body{}');
    assert.equal(doc.getText('big').length, bigText.length);
    const tl = await api('GET', `/timeline?limit=200`, owner.token);
    assert.ok(tl.data.events.some((e: any) => e.type === 'notes.password'));

    // 삭제하면 접속 중인 사람도 내보내지고 모든 데이터가 지워진다
    assert.equal((await api('DELETE', `/templates/${templateId}`, editor.token)).status, 403);
    assert.equal((await api('DELETE', `/templates/${templateId}`, owner.token)).status, 200);
    assert.equal((await a.waitType('kicked')).reason, 'deleted');
    assert.equal((await api('GET', `/templates/${templateId}`, owner.token)).status, 404);
    assert.equal((await api('GET', `/invites/${editorInvite.token}`)).data.valid, false);
    a.close();
  });
});
