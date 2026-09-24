import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as Y from 'yjs';
import { io as ioc, type Socket } from 'socket.io-client';
import type { RunningServer } from '../src/app.js';
import type { TemplateSummary, TimelineEvent, ToastPayload } from '../../shared/types.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-template-test-'));
process.env.DATA_DIR = dataDir;
process.env.SAVE_DEBOUNCE_MS = '20';

let server: RunningServer;
let base = '';
const sockets: Socket[] = [];

async function api<T = any>(method: string, url: string, token?: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${base}/api${url}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json()) as T };
}

async function newUser(name: string) {
  const { data } = await api('POST', '/users', undefined, { name, color: '#3e63dd', avatar: '🦊' });
  return data as { user: { id: string; name: string }; token: string };
}

function connect(token: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioc(base, { auth: { token }, transports: ['websocket'], forceNew: true });
    sockets.push(s);
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

const emit = <T = any>(s: Socket, event: string, payload: unknown): Promise<T> =>
  new Promise((resolve) => s.emit(event, payload, resolve));

const waitFor = <T = any>(s: Socket, event: string, pred: (p: T) => boolean = () => true, ms = 3000): Promise<T> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    const handler = (p: T) => {
      if (!pred(p)) return;
      clearTimeout(timer);
      s.off(event, handler);
      resolve(p);
    };
    s.on(event, handler);
  });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 클라이언트 쪽 Y.Doc을 서버 문서에 연결 (프로덕션 프로바이더의 핵심 흐름과 동일) */
async function joinDoc(s: Socket, name: string, extra: Record<string, unknown> = {}) {
  const doc = new Y.Doc();
  const res = await emit(s, 'doc:join', { name, sv: Y.encodeStateVector(doc), ...extra });
  if (!res.ok) return { doc, res };
  Y.applyUpdate(doc, new Uint8Array(res.update), 'remote');
  s.on('doc:update', (p: { name: string; update: ArrayBuffer }) => {
    if (p.name === name) Y.applyUpdate(doc, new Uint8Array(p.update), 'remote');
  });
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') s.emit('doc:update', { name, update }, () => {});
  });
  return { doc, res };
}

before(async () => {
  const { startServer } = await import('../src/app.js');
  server = await startServer(0);
  base = `http://localhost:${server.port}`;
});

after(async () => {
  for (const s of sockets) s.disconnect();
  await server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('사용자와 템플릿', () => {
  it('프리셋과 선택한 기능으로 템플릿 내용을 시드한다', async () => {
    const alice = await newUser('앨리스');
    const { status, data } = await api<{ template: TemplateSummary }>('POST', '/templates', alice.token, {
      name: '해커톤',
      features: ['design', 'code', 'docs'],
      preset: 'hackathon',
    });
    assert.equal(status, 201);
    assert.deepEqual(data.template.features, ['design', 'code', 'docs']);
    assert.equal(data.template.myRole, 'owner');

    const s = await connect(alice.token);
    const enter = await emit(s, 'template:enter', { templateId: data.template.id, view: { module: 'overview' } });
    assert.equal(enter.ok, true);
    const { doc } = await joinDoc(s, `tpl:${data.template.id}`);
    const files = Array.from(doc.getMap<Y.Map<unknown>>('files').values()).map((f) => f.get('name'));
    assert.deepEqual(files.sort(), ['app.py', 'vote.js']);
    const docTitles = Array.from(doc.getMap<Y.Map<unknown>>('docs').values()).map((d) => d.get('title'));
    assert.deepEqual(docTitles, ['회의록']);
    const board = Array.from(doc.getMap<Y.Map<unknown>>('boards').values())[0];
    assert.ok((board.get('shapes') as Y.Map<unknown>).size > 3);
    s.disconnect();
  });

  it('기능을 하나도 고르지 않으면 거절한다', async () => {
    const u = await newUser('밥');
    const { status, data } = await api('POST', '/templates', u.token, { name: 'x', features: [] });
    assert.equal(status, 400);
    assert.match(data.error, /기능/);
  });
});

describe('실시간 협업', () => {
  it('문서 동기화, 접속 토스트, 뷰어 쓰기 차단', async () => {
    const owner = await newUser('소유자');
    const guest = await newUser('게스트');
    const { data } = await api<{ template: TemplateSummary }>('POST', '/templates', owner.token, {
      name: '동기화 테스트',
      features: ['code'],
    });
    const t = data.template;
    const joined = await api('POST', `/invite/${t.inviteCode}/join`, guest.token);
    assert.equal(joined.status, 200);

    const a = await connect(owner.token);
    const b = await connect(guest.token);
    await emit(a, 'template:enter', { templateId: t.id, view: { module: 'code' } });

    const toast = waitFor<ToastPayload>(a, 'toast', (p) => p.title === '게스트');
    const enterB = await emit(b, 'template:enter', { templateId: t.id, view: { module: 'code' } });
    assert.equal(enterB.ok, true);
    assert.match((await toast).message ?? '', /접속/);

    const docA = await joinDoc(a, `tpl:${t.id}`);
    const docB = await joinDoc(b, `tpl:${t.id}`);
    const fileA = Array.from(docA.doc.getMap<Y.Map<unknown>>('files').values())[0];
    const textA = fileA.get('content') as Y.Text;
    textA.insert(0, '// 앨리스가 씀\n');
    await sleep(150);
    const fileB = docB.doc.getMap<Y.Map<unknown>>('files').get(fileA.get('id') as string)!;
    assert.match((fileB.get('content') as Y.Text).toString(), /앨리스가 씀/);

    // 커서 이벤트는 같은 방의 다른 사람에게만 전달된다
    const cursor = waitFor(b, 'presence:cursor');
    a.emit('presence:cursor', { cursor: { x: 0.5, y: 120 } });
    assert.deepEqual((await cursor).cursor, { x: 0.5, y: 120 });

    // 활동 보고 → 타임라인 + 커서 옆 라벨 + 중요 행동 토스트
    const label = waitFor(b, 'presence:action');
    const langToast = waitFor<ToastPayload>(b, 'toast', (p) => /언어/.test(p.message ?? ''));
    const res = await emit(a, 'activity', { type: 'code.language', targetId: 'f1', targetName: 'main.py', detail: 'Python' });
    assert.equal(res.ok, true);
    assert.match((await label).label, /언어 변경/);
    await langToast;

    // 뷰어로 바꾸면 문서 쓰기가 거절된다
    await api('PATCH', `/templates/${t.id}/members/${guest.user.id}`, owner.token, { role: 'viewer' });
    const denied = await emit(b, 'doc:update', { name: `tpl:${t.id}`, update: Y.encodeStateAsUpdate(new Y.Doc()) });
    assert.equal(denied.ok, false);
    assert.equal(denied.status, 403);

    // 자동 저장: 디스크에 기록되었는지 확인
    await sleep(200);
    const bin = fs.readFileSync(path.join(dataDir, 'docs', `${t.id}.ybin`));
    const restored = new Y.Doc();
    Y.applyUpdate(restored, new Uint8Array(bin));
    const restoredFile = Array.from(restored.getMap<Y.Map<unknown>>('files').values())[0];
    assert.match((restoredFile.get('content') as Y.Text).toString(), /앨리스가 씀/);

    a.disconnect();
    b.disconnect();
  });

  it('반복 편집은 타임라인에서 하나로 합쳐진다', async () => {
    const u = await newUser('편집자');
    const { data } = await api<{ template: TemplateSummary }>('POST', '/templates', u.token, { name: '타임라인', features: ['docs'] });
    const s = await connect(u.token);
    await emit(s, 'template:enter', { templateId: data.template.id, view: { module: 'docs' } });
    for (let i = 0; i < 3; i++) await emit(s, 'activity', { type: 'docs.edit', targetId: 'd1', targetName: '회의록' });
    await emit(s, 'activity', { type: 'docs.create', targetId: 'd2', targetName: '새 문서' });
    const { data: tl } = await api<{ events: TimelineEvent[] }>('GET', `/timeline?templateId=${data.template.id}`, u.token);
    const edit = tl.events.find((e) => e.type === 'docs.edit')!;
    assert.equal(edit.count, 3);
    assert.equal(tl.events.filter((e) => e.type === 'docs.edit').length, 1);
    assert.ok(tl.events.some((e) => e.type === 'docs.create' && e.text.includes('새 문서')));
    assert.ok(tl.events.some((e) => e.type === 'template.create'));

    const bad = await emit(s, 'activity', { type: 'member.remove' });
    assert.equal(bad.ok, false, '서버 전용 활동은 클라이언트가 보고할 수 없다');
    s.disconnect();
  });
});

describe('비밀 노트', () => {
  it('비밀번호로 잠금 해제하고, 내용은 암호화되어 저장된다', async () => {
    const owner = await newUser('노트주인');
    const outsider = await newUser('외부인');
    const { data } = await api<{ template: TemplateSummary }>('POST', '/templates', owner.token, { name: '비밀', features: ['docs'] });
    const tid = data.template.id;

    const weak = await api('POST', `/templates/${tid}/notes`, owner.token, { title: 'API 키', password: '12' });
    assert.equal(weak.status, 400);

    const created = await api('POST', `/templates/${tid}/notes`, owner.token, { title: 'API 키', password: 'hunter22', hint: '게임 캐릭터' });
    assert.equal(created.status, 201);
    const noteId = created.data.note.id as string;

    // 멤버가 아니면 목록조차 볼 수 없다
    assert.equal((await api('GET', `/templates/${tid}/notes`, outsider.token)).status, 403);

    const wrong = await api('POST', `/templates/${tid}/notes/${noteId}/unlock`, owner.token, { password: 'nope' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.data.remaining, 4);

    const ok = await api('POST', `/templates/${tid}/notes/${noteId}/unlock`, owner.token, { password: 'hunter22' });
    assert.equal(ok.status, 200);
    const ticket = ok.data.ticket as string;

    const s = await connect(owner.token);
    await emit(s, 'template:enter', { templateId: tid, view: { module: 'notes', itemId: noteId } });
    const noTicket = await joinDoc(s, `note:${tid}:${noteId}`);
    assert.equal(noTicket.res.ok, false, '티켓 없이는 노트 문서에 참여할 수 없다');

    const { doc, res } = await joinDoc(s, `note:${tid}:${noteId}`, { ticket });
    assert.equal(res.ok, true);
    doc.getText('secret-test').insert(0, 'sk-super-secret-value');
    await sleep(200);

    const raw = fs.readFileSync(path.join(dataDir, 'notes', `${tid}.json`), 'utf8');
    assert.ok(!raw.includes('sk-super-secret-value'), '평문이 디스크에 남으면 안 된다');
    assert.ok(!raw.includes('hunter22'), '비밀번호가 디스크에 남으면 안 된다');

    // 비밀번호 변경 → 열람 중인 사람은 강제로 잠긴다
    const kicked = waitFor(s, 'doc:kicked');
    const changed = await api('POST', `/templates/${tid}/notes/${noteId}/password`, owner.token, { current: 'hunter22', next: 'newpass99' });
    assert.equal(changed.status, 200);
    assert.equal((await kicked).reason, 'password');
    await sleep(100);

    // 새 비밀번호로 다시 열면 기존 내용이 그대로 복호화된다
    const again = await api('POST', `/templates/${tid}/notes/${noteId}/unlock`, owner.token, { password: 'newpass99' });
    const reopened = await joinDoc(s, `note:${tid}:${noteId}`, { ticket: again.data.ticket });
    assert.equal(reopened.doc.getText('secret-test').toString(), 'sk-super-secret-value');
    s.disconnect();
  });

  it('연속 실패 시 일정 시간 잠긴다', async () => {
    const u = await newUser('무차별');
    const { data } = await api<{ template: TemplateSummary }>('POST', '/templates', u.token, { name: '잠금', features: ['docs'] });
    const tid = data.template.id;
    const created = await api('POST', `/templates/${tid}/notes`, u.token, { title: 'n', password: 'correct-horse' });
    const noteId = created.data.note.id;
    let last = 0;
    for (let i = 0; i < 5; i++) last = (await api('POST', `/templates/${tid}/notes/${noteId}/unlock`, u.token, { password: `x${i}` })).status;
    assert.equal(last, 429);
    const locked = await api('POST', `/templates/${tid}/notes/${noteId}/unlock`, u.token, { password: 'correct-horse' });
    assert.equal(locked.status, 429, '잠금 중에는 올바른 비밀번호도 거절');
    assert.ok(locked.data.retryAfter > 0);
  });
});

describe('다른 주소의 화면 (GitHub Pages)', () => {
  it('GitHub 도메인은 허용하고 그 외 출처는 막는다', async () => {
    const allowed = await fetch(`${base}/api/health`, { headers: { origin: 'https://rxodhks.github.io' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://rxodhks.github.io');

    const codespace = await fetch(`${base}/api/users`, {
      method: 'OPTIONS',
      headers: { origin: 'https://fuzzy-space-3001.app.github.dev', 'access-control-request-method': 'POST' },
    });
    assert.equal(codespace.status, 204);
    assert.match(codespace.headers.get('access-control-allow-headers') ?? '', /authorization/);

    const evil = await fetch(`${base}/api/health`, { headers: { origin: 'https://evil.example.com' } });
    assert.equal(evil.headers.get('access-control-allow-origin'), null);
    const evilPreflight = await fetch(`${base}/api/users`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example.com', 'access-control-request-method': 'POST' },
    });
    assert.equal(evilPreflight.status, 403);

    // http로 흉내 낸 github.io는 허용하지 않는다
    const insecure = await fetch(`${base}/api/health`, { headers: { origin: 'http://rxodhks.github.io' } });
    assert.equal(insecure.headers.get('access-control-allow-origin'), null);
  });
});
