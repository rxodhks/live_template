#!/usr/bin/env node
/*
 * 실시간 방 부하 시험: 한 방(또는 여러 방)에 N명이 동시에 접속해 문서를 고치고 커서를 움직일 때
 * 전파 지연(p50/p95/p99) · 메시지 손실 · 최종 수렴(모든 사람과 서버 문서가 같은지)을 잰다.
 *
 * 준비: AUTH_DEV_MODE로 띄운 로컬 서버 (가입 코드를 응답으로 받는다)
 *   cd worker && npx wrangler dev --port 8850 --ip 127.0.0.1 --persist-to /tmp/lt-load --var AUTH_DEV_MODE:1
 * 실행 (저장소 루트에서):
 *   BASE=http://127.0.0.1:8850 N=30 RATE=5 DUR=10 node scripts/load-room.mjs
 *
 * 환경 변수
 *   N      방마다 접속자 수 (기본 10)          RATE  사람마다 초당 문서 변경 수 (기본 5)
 *   AW     사람마다 초당 커서 메시지 (기본 0, 실제 화면은 최대 10)
 *   DUR    시험 시간(초, 기본 10)              ROOMS 동시에 시험할 방 수 (기본 1)
 *   T      클라이언트를 나눠 돌릴 스레드 수 (기본 4) — 한 스레드에 몰면 클라이언트 쪽이 먼저 밀려 지연이 부풀려진다
 *
 * 주의: 로컬 workerd는 배포 환경과 성능이 다르다. 숫자는 비교용(변경 전/후)으로 쓴다.
 */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import crypto from 'node:crypto';
import * as Y from 'yjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:8850';
const b64 = (u8) => Buffer.from(u8).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rid = (n) => crypto.randomBytes(n).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x').slice(0, n);
const pct = (arr, p) => (arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))] : null);

async function call(method, path, { token, cookie, body } = {}) {
  const headers = { 'content-type': 'application/json', 'x-lt-client': '2' };
  const c = [token && `__Host-madang_sid=${token}`, cookie].filter(Boolean).join('; ');
  if (c) headers.cookie = c;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, setCookie: res.headers.getSetCookie() };
}
const cookieOf = (list, name) => list.map((s) => s.match(new RegExp(`${name}=([^;]+)`))?.[1]).find(Boolean) ?? null;

async function signup(tag) {
  const email = `load-${tag}-${rid(8)}@example.com`.toLowerCase();
  const s = await call('POST', '/api/auth/email/start', { body: { email } });
  if (!s.data.devCode) throw new Error(`가입 코드를 받지 못했습니다 (AUTH_DEV_MODE로 띄웠나요?) ${s.status}`);
  const v = await call('POST', '/api/auth/email/verify', { body: { email, code: s.data.devCode } });
  const r = await call('POST', '/api/auth/signup', { cookie: `__Host-madang_signup=${cookieOf(v.setCookie, '__Host-madang_signup')}`, body: { name: tag.slice(0, 20) } });
  if (r.status !== 201) throw new Error(`가입 실패 ${r.status}`);
  return { token: cookieOf(r.setCookie, '__Host-madang_sid'), user: r.data.user };
}

async function createRoom(owner, members) {
  const id = rid(16);
  const doc = new Y.Doc();
  doc.getText('t').insert(0, 'hello');
  const upload = { id, name: '부하 시험', description: '', emoji: '📄', features: ['docs'], createdAt: Date.now(), state: b64(Y.encodeStateAsUpdate(doc)), timeline: [], notes: [] };
  const r = await call('POST', `/api/templates/${id}/share`, { token: owner.token, body: JSON.stringify(upload) });
  if (r.status !== 201) throw new Error(`템플릿 올리기 실패 ${r.status}`);
  const inv = await call('POST', `/api/templates/${id}/invites`, { token: owner.token, body: { role: 'editor', expiresInDays: null, maxUses: null, requireApproval: false } });
  for (const m of members) await call('POST', `/api/invites/${inv.data.invite.token}/accept`, { token: m.token });
  return id;
}

/** 실제 화면(RoomProvider)처럼 sync → update(ack) 하는 최소 클라이언트 */
class Client {
  constructor(user, tid) {
    this.user = user;
    this.tid = tid;
    this.doc = new Y.Doc();
    this.seq = 0;
    this.acks = new Map();
    this.cursors = 0;
  }
  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/api/templates/${this.tid}/ws?cv=2`, ['lt', this.user.token]);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error('접속 시간 초과')), 30_000);
      ws.onmessage = (e) => {
        if (e.data === 'pong') return;
        const m = JSON.parse(e.data);
        if (m.t === 'welcome') {
          clearTimeout(timer);
          resolve();
        } else if (m.t === 'ack') this.acks.get(m.id)?.(m);
        else if (m.t === 'update') Y.applyUpdate(this.doc, unb64(m.u), 'remote');
        else if (m.t === 'cursor') this.cursors++;
      };
      ws.onerror = () => reject(new Error('접속 실패'));
      ws.onclose = (e) => (this.closeCode = e.code);
    });
  }
  request(msg) {
    const id = ++this.seq;
    this.ws.send(JSON.stringify({ ...msg, id }));
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve({ ok: false, status: -1 }), 60_000);
      this.acks.set(id, (m) => {
        clearTimeout(t);
        this.acks.delete(id);
        resolve(m);
      });
    });
  }
  async sync() {
    const r = await this.request({ t: 'sync', sv: b64(Y.encodeStateVector(this.doc)) });
    Y.applyUpdate(this.doc, unb64(r.data.update), 'remote');
  }
  hash() {
    const m = Object.entries(this.doc.getMap('m').toJSON()).sort(([a], [b]) => (a < b ? -1 : 1));
    return crypto.createHash('sha256').update(this.doc.getText('t').toString() + JSON.stringify(m)).digest('hex').slice(0, 16);
  }
}

if (isMainThread) {
  const N = Number(process.env.N ?? 10), RATE = Number(process.env.RATE ?? 5), DUR = Number(process.env.DUR ?? 10);
  const ROOMS = Number(process.env.ROOMS ?? 1), T = Number(process.env.T ?? 4), AW = Number(process.env.AW ?? 0);
  const rooms = [];
  for (let r = 0; r < ROOMS; r++) {
    const users = await Promise.all(Array.from({ length: N }, (_, i) => signup(`r${r}u${i}`)));
    rooms.push({ tid: await createRoom(users[0], users.slice(1)), users });
  }
  const jobs = rooms.flatMap((rm, ri) => rm.users.map((user, ui) => ({ ri, tid: rm.tid, user, name: `r${ri}c${ui}` })));
  const parts = Array.from({ length: T }, () => []);
  jobs.forEach((j, i) => parts[i % T].push(j));
  const startAt = Date.now() + 3000 + jobs.length * 30;
  const results = await Promise.all(
    parts.map((p) => new Promise((resolve, reject) => new Worker(new URL(import.meta.url), { workerData: { jobs: p, RATE, DUR, AW, startAt } }).on('message', resolve).on('error', reject))),
  );
  const rows = [];
  for (const [ri, rm] of rooms.entries()) {
    const mine = results.flatMap((r) => r.clients.filter((c) => c.ri === ri));
    const ok = mine.filter((c) => c.ok);
    const lat = results.flatMap((r) => r.lat[ri] ?? []);
    const ackLat = results.flatMap((r) => r.ackLat[ri] ?? []);
    const sent = ok.reduce((n, c) => n + c.sent, 0);
    const expected = sent * (ok.length - 1);
    const recv = ok.reduce((n, c) => n + c.recv, 0);
    const fresh = new Client(rm.users[0], rm.tid);
    await fresh.connect();
    await fresh.sync();
    fresh.ws.close();
    const hashes = new Set(ok.map((c) => c.hash));
    rows.push({
      방: ri, 접속: `${ok.length}/${N}`, 보낸변경: sent, 손실: expected - recv,
      'p50(ms)': pct(lat, 50), 'p95(ms)': pct(lat, 95), 'p99(ms)': pct(lat, 99),
      '저장확인p50(ms)': pct(ackLat, 50), 커서수신: ok.reduce((n, c) => n + c.cursors, 0),
      수렴: hashes.size === 1 && hashes.has(fresh.hash()) ? '같음' : `다름(${hashes.size})`,
    });
  }
  console.table(rows);
  process.exit(0);
} else {
  const { jobs, RATE, DUR, AW, startAt } = workerData;
  const lat = {}, ackLat = {};
  const cs = jobs.map((j) => ({ j, c: new Client(j.user, j.tid), sent: 0, recv: 0, ok: false }));
  await Promise.all(
    cs.map(async (x) => {
      try {
        await x.c.connect();
        await x.c.sync();
        x.ok = true;
      } catch (e) {
        x.err = String(e);
      }
    }),
  );
  for (const x of cs.filter((x) => x.ok)) {
    const m = x.c.doc.getMap('m');
    m.observe((ev) => {
      if (ev.transaction.origin !== 'remote') return;
      const now = Date.now();
      for (const k of ev.keysChanged) {
        (lat[x.j.ri] ??= []).push(now - m.get(k));
        x.recv++;
      }
    });
  }
  await sleep(Math.max(0, startAt - Date.now()));
  const end = Date.now() + DUR * 1000;
  const timers = AW ? cs.filter((x) => x.ok).map((x) => setInterval(() => x.c.ws.send(JSON.stringify({ t: 'cursor', c: { x: Math.random(), y: Math.random() * 1000 } })), 1000 / AW)) : [];
  await Promise.all(
    cs.filter((x) => x.ok).map(async (x) => {
      const doc = x.c.doc;
      let k = 0;
      while (Date.now() < end) {
        const ts = Date.now();
        const sv = Y.encodeStateVector(doc);
        doc.transact(() => {
          doc.getMap('m').set(`${x.j.name}:${k++}`, ts);
          const t = doc.getText('t');
          t.insert(Math.floor(Math.random() * (t.length + 1)), 'x');
        });
        x.sent++;
        void x.c.request({ t: 'update', u: b64(Y.encodeStateAsUpdate(doc, sv)) }).then((r) => r.ok && (ackLat[x.j.ri] ??= []).push(Date.now() - ts));
        await sleep((1000 / RATE) * (0.5 + Math.random()));
      }
    }),
  );
  for (const t of timers) clearInterval(t);
  // 수신 수가 3초 동안 늘지 않을 때까지 기다린다 (다른 스레드의 전송 포함)
  let last = -1, still = 0;
  const t0 = Date.now();
  while (still < 30 && Date.now() - t0 < 60_000) {
    const n = cs.reduce((a, x) => a + x.recv, 0);
    still = n === last ? still + 1 : 0;
    last = n;
    await sleep(100);
  }
  await sleep(2500); // 저장 확인(ack)은 저장소에 기록된 뒤(최대 2초) 온다
  parentPort.postMessage({ clients: cs.map((x) => ({ ri: x.j.ri, ok: x.ok, sent: x.sent, recv: x.recv, cursors: x.c.cursors, hash: x.ok ? x.c.hash() : null })), lat, ackLat });
  for (const x of cs) x.c.ws?.close();
}
