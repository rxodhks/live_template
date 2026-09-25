import { DurableObject } from 'cloudflare:workers';
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import type {
  ActivityInput,
  ActivityType,
  ChatMessage,
  CursorPoint,
  EncryptedNote,
  JoinRequest,
  PresenceState,
  PresenceView,
  PublicUser,
  Role,
  SecretNoteMeta,
  ShareUpload,
  TemplateSummary,
  TimelineEvent,
  UnlockResult,
  ViewModule,
  Viewport,
} from '../../shared/types';
import type { ClientMessage, NoteJoinData, ServerMessage, TemplateBroadcast } from '../../shared/protocol';
import { ACTIVITY, CLIENT_REPORTABLE, COALESCE_WINDOW_MS } from '../../shared/activity';
import type { Env } from './env';
import { type Result, clampText, fail, fromB64, isId, newId, ok, safeEqual, sha256Hex, toB64 } from './util';

/*
 * TemplateRoom — 협업 템플릿 하나 = Durable Object 하나.
 *
 *  · WebSocket Hibernation API: 메시지가 없을 때는 잠들어 실행 시간 요금(무료 한도)을 거의 쓰지 않는다.
 *  · Yjs 문서: 메모리에서 병합하고, 2초마다 묶어서 SQLite에 저장 (쓰기 횟수 절약). 일정 개수가 쌓이면 하나로 압축.
 *  · 비밀 노트: 브라우저에서 암호화된 데이터만 보관·중계한다. 서버는 내용을 볼 수 없다.
 */

const FLUSH_DELAY_MS = 2000;
const COMPACT_AFTER = 60;
const TIMELINE_LIMIT = 3000;
const CHAT_LIMIT = 500;
const LEAVE_GRACE_MS = 4000;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const NOTE_TICKET_TTL_MS = 30 * 60 * 1000;
const NOTE_MAX_ATTEMPTS = 5;
const NOTE_LOCKOUT_MS = 5 * 60 * 1000;
const MAX_BLOB_CHARS = 1_500_000;
/** SQLite 값 하나는 2MB까지라서 큰 문서 상태는 나눠 저장한다 */
const CHUNK_BYTES = 1_000_000;

const VIEW_MODULES: ReadonlySet<ViewModule> = new Set(['overview', 'design', 'code', 'docs', 'notes', 'timeline', 'members', 'settings']);

interface Attachment {
  sid: string;
  user: PublicUser;
  role: Role;
  view: PresenceView;
  viewport: Viewport | null;
  selection: string[];
  idle: boolean;
  /** 문서 동기화에 참여 중인지 */
  synced: boolean;
  /** 이 연결이 가진 awareness clientID들 (연결이 끊기면 다른 사람 화면에서 지움) */
  aw: number[];
  /** 잠금 해제한 비밀 노트 → 만료 시각 */
  notes: Record<string, number>;
}

type NoteRow = {
  id: string;
  json: string;
  verifier_hash: string;
  snapshot: string;
};

function sanitizeView(v: unknown): PresenceView {
  const obj = (v ?? {}) as Partial<PresenceView>;
  const module = VIEW_MODULES.has(obj.module as ViewModule) ? (obj.module as ViewModule) : 'overview';
  return { module, itemId: typeof obj.itemId === 'string' ? obj.itemId.slice(0, 64) : null };
}

function sanitizeCursor(c: unknown): CursorPoint | null {
  const o = c as CursorPoint | null;
  if (!o || !Number.isFinite(o.x) || !Number.isFinite(o.y)) return null;
  return { x: Math.round(o.x * 1000) / 1000, y: Math.round(o.y * 10) / 10 };
}

function sanitizeViewport(v: unknown): Viewport | null {
  const o = v as Viewport | null;
  if (!o || !Number.isFinite(o.x) || !Number.isFinite(o.y) || !Number.isFinite(o.zoom)) return null;
  return { x: o.x, y: o.y, zoom: Math.min(Math.max(o.zoom, 0.05), 20) };
}

/** awareness 업데이트에서 clientID와 삭제 여부를 읽는다 (y-protocols 형식) */
function readAwareness(update: Uint8Array): { id: number; removed: boolean }[] {
  const out: { id: number; removed: boolean }[] = [];
  try {
    const d = decoding.createDecoder(update);
    const len = decoding.readVarUint(d);
    for (let i = 0; i < len; i++) {
      const id = decoding.readVarUint(d);
      decoding.readVarUint(d); // clock
      const state = decoding.readVarString(d);
      out.push({ id, removed: state === 'null' });
    }
  } catch {
    /* 잘못된 형식은 무시 */
  }
  return out;
}

export class TemplateRoom extends DurableObject<Env> {
  private sql: SqlStorage;
  private doc: Y.Doc | null = null;
  private pending: Uint8Array[] = [];
  private flushScheduled = false;
  private cursors = new Map<string, CursorPoint | null>();
  private actions = new Map<string, { label: string; at: number }>();
  private leaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastTouch = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS doc_updates (id INTEGER PRIMARY KEY AUTOINCREMENT, grp INTEGER NOT NULL, data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS timeline (id TEXT PRIMARY KEY, at INTEGER NOT NULL, user_id TEXT NOT NULL, module TEXT NOT NULL,
        type TEXT NOT NULL, target_id TEXT, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS timeline_at ON timeline(at);
      CREATE TABLE IF NOT EXISTS chat (id TEXT PRIMARY KEY, at INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS chat_at ON chat(at);
      CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, json TEXT NOT NULL, verifier_hash TEXT NOT NULL, snapshot TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS note_updates (uid INTEGER PRIMARY KEY AUTOINCREMENT, note_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS note_updates_by_note ON note_updates(note_id, uid);
      CREATE TABLE IF NOT EXISTS note_attempts (k TEXT PRIMARY KEY, fails INTEGER NOT NULL, locked_until INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS note_tickets (ticket TEXT PRIMARY KEY, note_id TEXT NOT NULL, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
    `);
    // "ping"에는 깨어나지 않고 자동으로 "pong" 응답 (연결 유지 비용 0)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /* ───────────── 공통 ───────────── */

  private get directory() {
    return this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('main'));
  }

  private meta(k: string): string | null {
    return this.sql.exec<{ v: string }>('SELECT v FROM meta WHERE k = ?', k).toArray()[0]?.v ?? null;
  }

  private setMetaValue(k: string, v: string): void {
    this.sql.exec('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, v);
  }

  private get templateId(): string {
    return this.meta('templateId') ?? '';
  }

  private att(ws: WebSocket): Attachment {
    return ws.deserializeAttachment() as Attachment;
  }

  private sockets(): { ws: WebSocket; a: Attachment }[] {
    return this.ctx.getWebSockets().flatMap((ws) => {
      const a = ws.deserializeAttachment() as Attachment | null;
      return a ? [{ ws, a }] : [];
    });
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* 이미 닫힌 연결 */
    }
  }

  private broadcast(msg: ServerMessage, opts: { exceptSid?: string; exceptUser?: string; filter?: (a: Attachment) => boolean } = {}): void {
    const data = JSON.stringify(msg);
    for (const { ws, a } of this.sockets()) {
      if (a.sid === opts.exceptSid || a.user.id === opts.exceptUser) continue;
      if (opts.filter && !opts.filter(a)) continue;
      try {
        ws.send(data);
      } catch {
        /* 무시 */
      }
    }
  }

  private presenceOf(a: Attachment): PresenceState {
    return {
      socketId: a.sid,
      user: a.user,
      view: a.view,
      cursor: this.cursors.get(a.sid) ?? null,
      viewport: a.viewport,
      selection: a.selection,
      idle: a.idle,
      action: this.actions.get(a.sid) ?? null,
    };
  }

  private onlineUserIds(): string[] {
    return Array.from(new Set(this.sockets().map((s) => s.a.user.id)));
  }

  /* ───────────── 연결 ───────────── */

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('WebSocket이 필요합니다.', { status: 426 });
    // 헤더 값은 Latin-1만 허용되므로 Worker에서 URI 인코딩해서 넘긴다 (한글 이름·이모지)
    const user = JSON.parse(decodeURIComponent(request.headers.get('x-lt-user') ?? 'null')) as PublicUser | null;
    const role = request.headers.get('x-lt-role') as Role | null;
    const templateId = request.headers.get('x-lt-template') ?? '';
    if (!user || !role || !templateId) return new Response('잘못된 요청', { status: 400 });
    if (!this.templateId) this.setMetaValue('templateId', templateId);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [user.id]);
    const a: Attachment = { sid: newId(10), user, role, view: { module: 'overview', itemId: null }, viewport: null, selection: [], idle: false, synced: false, aw: [], notes: {} };
    server.serializeAttachment(a);

    const others = this.sockets().filter((s) => s.a.sid !== a.sid);
    const requests: JoinRequest[] = role === 'viewer' ? [] : await this.directory.pendingRequestsFor(templateId);
    this.send(server, {
      t: 'welcome',
      sid: a.sid,
      role,
      presence: others.map((s) => this.presenceOf(s.a)),
      chat: this.chatHistory(),
      notes: this.noteList(),
      requests,
    });
    this.broadcast({ t: 'presence', state: this.presenceOf(a) }, { exceptSid: a.sid });

    // 이 사용자의 첫 연결이면 접속 기록 (새로고침처럼 잠깐 끊겼다 돌아온 경우는 제외)
    if (others.every((s) => s.a.user.id !== user.id)) {
      const timer = this.leaveTimers.get(user.id);
      if (timer) {
        clearTimeout(timer);
        this.leaveTimers.delete(user.id);
      } else {
        this.record(user, { type: 'presence.join' });
      }
      await this.directory.setOnline(templateId, this.onlineUserIds());
    }
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'lt' } });
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    await this.closed(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'bye');
    } catch {
      /* 이미 닫힘 */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.closed(ws);
  }

  private async closed(ws: WebSocket): Promise<void> {
    const a = this.att(ws);
    if (!a) return;
    ws.serializeAttachment(null);
    this.cursors.delete(a.sid);
    this.actions.delete(a.sid);
    this.broadcast({ t: 'presence:leave', sid: a.sid, clients: a.aw }, { exceptSid: a.sid });
    const remaining = this.sockets();
    if (remaining.length === 0) await this.flush();
    if (!remaining.some((s) => s.a.user.id === a.user.id)) {
      const userId = a.user.id;
      this.leaveTimers.set(
        userId,
        setTimeout(() => {
          this.leaveTimers.delete(userId);
          if (this.sockets().some((s) => s.a.user.id === userId)) return;
          this.record(a.user, { type: 'presence.leave' });
          void this.directory.setOnline(this.templateId, this.onlineUserIds());
        }, LEAVE_GRACE_MS),
      );
    }
  }

  /* ───────────── 메시지 ───────────── */

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string' || raw.length > 4_000_000) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      return;
    }
    const a = this.att(ws);
    if (!a) return;
    const ack = (id: number, result: { ok: true; data?: unknown } | { ok: false; status: number; error: string }) =>
      this.send(ws, result.ok ? { t: 'ack', id, ok: true, data: result.data } : { t: 'ack', id, ok: false, status: result.status, error: result.error });

    switch (msg.t) {
      case 'sync': {
        const doc = this.ensureDoc();
        let update: Uint8Array;
        try {
          update = Y.encodeStateAsUpdate(doc, fromB64(msg.sv));
        } catch {
          update = Y.encodeStateAsUpdate(doc);
        }
        if (!a.synced) {
          a.synced = true;
          ws.serializeAttachment(a);
        }
        ack(msg.id, { ok: true, data: { update: toB64(update), sv: toB64(Y.encodeStateVector(doc)), readOnly: a.role === 'viewer' } });
        // 새로 들어온 사람이 다른 사람들의 텍스트 커서를 바로 볼 수 있도록 요청
        this.broadcast({ t: 'aw:query' }, { exceptSid: a.sid, filter: (o) => o.synced });
        return;
      }
      case 'update': {
        if (a.role === 'viewer') return ack(msg.id, { ok: false, status: 403, error: '읽기 전용 권한입니다.' });
        let update: Uint8Array;
        try {
          update = fromB64(msg.u);
          Y.applyUpdate(this.ensureDoc(), update);
        } catch {
          return ack(msg.id, { ok: false, status: 400, error: '잘못된 문서 변경입니다.' });
        }
        const aw = typeof msg.aw === 'string' && msg.aw.length < 20_000 ? msg.aw : undefined;
        if (aw) this.trackAwareness(ws, a, aw);
        this.pending.push(update);
        await this.scheduleFlush();
        this.broadcast(aw ? { t: 'update', u: msg.u, aw } : { t: 'update', u: msg.u }, { exceptSid: a.sid, filter: (o) => o.synced });
        ack(msg.id, { ok: true });
        this.touchDirectory();
        return;
      }
      case 'aw': {
        if (typeof msg.u !== 'string' || msg.u.length > 20_000) return;
        this.trackAwareness(ws, a, msg.u);
        this.broadcast({ t: 'aw', u: msg.u }, { exceptSid: a.sid, filter: (o) => o.synced });
        return;
      }
      case 'live': {
        // 저장하지 않는 순간 정보는 크기만 제한해서 그대로 중계
        if (typeof msg.k !== 'string' || msg.k.length > 16 || raw.length > 16_000) return;
        this.broadcast({ t: 'live', sid: a.sid, k: msg.k, d: msg.d }, { exceptSid: a.sid });
        return;
      }
      case 'presence': {
        const p = msg.patch ?? {};
        if (p.view !== undefined) {
          const view = sanitizeView(p.view);
          if (view.module !== a.view.module || view.itemId !== a.view.itemId) {
            this.cursors.set(a.sid, null);
            a.selection = [];
          }
          a.view = view;
        }
        if (p.viewport !== undefined) a.viewport = sanitizeViewport(p.viewport);
        if (Array.isArray(p.selection)) a.selection = p.selection.filter((s) => typeof s === 'string').slice(0, 200);
        if (typeof p.idle === 'boolean') a.idle = p.idle;
        ws.serializeAttachment(a);
        this.broadcast({ t: 'presence', state: this.presenceOf(a) }, { exceptSid: a.sid });
        return;
      }
      case 'cursor': {
        const c = sanitizeCursor(msg.c);
        this.cursors.set(a.sid, c);
        this.broadcast({ t: 'cursor', sid: a.sid, c }, { exceptSid: a.sid });
        return;
      }
      case 'action': {
        const label = clampText(msg.label, 40);
        if (!label) return;
        this.actions.set(a.sid, { label, at: Date.now() });
        this.broadcast({ t: 'action', sid: a.sid, label }, { exceptSid: a.sid });
        return;
      }
      case 'activity': {
        const input = msg.input as ActivityInput;
        if (!input || !CLIENT_REPORTABLE.has(input.type)) return;
        if (a.role === 'viewer' && input.type !== 'code.run') return;
        const clean = {
          type: input.type,
          targetId: clampText(input.targetId, 64) || undefined,
          targetName: clampText(input.targetName, 80) || undefined,
          detail: clampText(input.detail, 120) || undefined,
        };
        this.record(a.user, clean);
        const label = `${ACTIVITY[input.type].label}${clean.targetName ? ` · ${clean.targetName}` : ''}`;
        this.actions.set(a.sid, { label, at: Date.now() });
        this.broadcast({ t: 'action', sid: a.sid, label }, { exceptSid: a.sid });
        return;
      }
      case 'chat': {
        const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, 2000) : '';
        if (!text) return ack(msg.id, { ok: false, status: 400, error: '메시지를 입력해 주세요.' });
        const message: ChatMessage = { id: newId(), user: a.user, text, at: Date.now() };
        this.sql.exec('INSERT INTO chat (id, at, json) VALUES (?, ?, ?)', message.id, message.at, JSON.stringify(message));
        if (Math.random() < 0.05) {
          this.sql.exec('DELETE FROM chat WHERE id IN (SELECT id FROM chat ORDER BY at DESC LIMIT -1 OFFSET ?)', CHAT_LIMIT);
        }
        this.broadcast({ t: 'chat', message });
        return ack(msg.id, { ok: true, data: message });
      }
      case 'note:join': {
        const t = this.sql
          .exec<{ note_id: string; user_id: string; expires_at: number }>('SELECT * FROM note_tickets WHERE ticket = ?', String(msg.ticket))
          .toArray()[0];
        if (!t || t.note_id !== msg.noteId || t.user_id !== a.user.id || t.expires_at < Date.now()) {
          return ack(msg.id, { ok: false, status: 401, error: '잠금 해제가 만료되었습니다. 비밀번호를 다시 입력해 주세요.' });
        }
        const note = this.noteRow(msg.noteId);
        if (!note) return ack(msg.id, { ok: false, status: 404, error: '비밀 노트를 찾을 수 없습니다.' });
        a.notes[msg.noteId] = t.expires_at;
        ws.serializeAttachment(a);
        const updates = this.sql
          .exec<{ uid: number; data: string }>('SELECT uid, data FROM note_updates WHERE note_id = ? ORDER BY uid', msg.noteId)
          .toArray();
        const data: NoteJoinData = { snapshot: note.snapshot, updates };
        return ack(msg.id, { ok: true, data });
      }
      case 'note:leave': {
        if (a.notes[msg.noteId]) {
          delete a.notes[msg.noteId];
          ws.serializeAttachment(a);
        }
        return;
      }
      case 'note:update':
      case 'note:snapshot': {
        const opened = this.noteOpen(ws, a, msg.noteId);
        if (!opened) return ack(msg.id, { ok: false, status: 401, error: '비밀 노트가 잠겼습니다.' });
        if (a.role === 'viewer') return ack(msg.id, { ok: false, status: 403, error: '읽기 전용 권한입니다.' });
        if (typeof msg.data !== 'string' || msg.data.length > MAX_BLOB_CHARS) return ack(msg.id, { ok: false, status: 413, error: '노트가 너무 큽니다.' });
        if (msg.t === 'note:update') {
          this.sql.exec('INSERT INTO note_updates (note_id, data) VALUES (?, ?)', msg.noteId, msg.data);
          const uid = this.sql.exec<{ uid: number }>('SELECT last_insert_rowid() AS uid').one().uid;
          this.broadcast({ t: 'note:update', noteId: msg.noteId, data: msg.data, uid }, { exceptSid: a.sid, filter: (o) => !!o.notes[msg.noteId] });
          this.touchNote(msg.noteId);
          return ack(msg.id, { ok: true, data: { uid } });
        }
        // 스냅샷: 이 시점까지의 변경을 하나로 합쳐 저장하고 이전 변경 기록을 지운다
        this.sql.exec('UPDATE notes SET snapshot = ? WHERE id = ?', msg.data, msg.noteId);
        this.sql.exec('DELETE FROM note_updates WHERE note_id = ? AND uid <= ?', msg.noteId, Number(msg.upto) || 0);
        this.touchNote(msg.noteId);
        return ack(msg.id, { ok: true });
      }
      case 'note:aw': {
        if (!this.noteOpen(ws, a, msg.noteId) || typeof msg.data !== 'string' || msg.data.length > 20_000) return;
        this.broadcast({ t: 'note:aw', noteId: msg.noteId, data: msg.data }, { exceptSid: a.sid, filter: (o) => !!o.notes[msg.noteId] });
        return;
      }
    }
  }

  /** 이 연결이 가진 awareness clientID 기록 (연결이 끊기면 다른 사람 화면에서 커서를 지우기 위해) */
  private trackAwareness(ws: WebSocket, a: Attachment, u: string): void {
    let entries: { id: number; removed: boolean }[];
    try {
      entries = readAwareness(fromB64(u));
    } catch {
      return;
    }
    let changed = false;
    for (const { id, removed } of entries) {
      const has = a.aw.includes(id);
      if (removed && has) {
        a.aw = a.aw.filter((x) => x !== id);
        changed = true;
      } else if (!removed && !has && a.aw.length < 8) {
        a.aw.push(id);
        changed = true;
      }
    }
    if (changed) ws.serializeAttachment(a);
  }

  /* ───────────── Yjs 문서 저장 ───────────── */

  private ensureDoc(): Y.Doc {
    if (this.doc) return this.doc;
    const doc = new Y.Doc({ gc: true });
    const updates = this.readUpdates();
    if (updates.length) Y.applyUpdate(doc, Y.mergeUpdates(updates));
    this.doc = doc;
    return doc;
  }

  /** 저장된 변경 묶음을 순서대로 읽는다 (나눠 저장한 조각은 다시 이어 붙임) */
  private readUpdates(): Uint8Array[] {
    const groups: Uint8Array[][] = [];
    let last: number | null = null;
    for (const row of this.sql.exec<{ grp: number; data: ArrayBuffer }>('SELECT grp, data FROM doc_updates ORDER BY id')) {
      if (row.grp !== last) groups.push([]);
      groups[groups.length - 1].push(new Uint8Array(row.data));
      last = row.grp;
    }
    return groups.map((parts) => {
      if (parts.length === 1) return parts[0];
      const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let offset = 0;
      for (const p of parts) {
        out.set(p, offset);
        offset += p.length;
      }
      return out;
    });
  }

  private appendUpdate(data: Uint8Array): void {
    const grp = (this.sql.exec<{ g: number | null }>('SELECT max(grp) AS g FROM doc_updates').one().g ?? 0) + 1;
    for (let i = 0; i === 0 || i < data.length; i += CHUNK_BYTES) {
      this.sql.exec('INSERT INTO doc_updates (grp, data) VALUES (?, ?)', grp, data.slice(i, i + CHUNK_BYTES).buffer);
    }
  }

  private async scheduleFlush(): Promise<void> {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    await this.ctx.storage.setAlarm(Date.now() + FLUSH_DELAY_MS);
  }

  async alarm(): Promise<void> {
    await this.flush();
    this.sql.exec('DELETE FROM note_tickets WHERE expires_at < ?', Date.now());
  }

  private async flush(): Promise<void> {
    this.flushScheduled = false;
    if (this.pending.length === 0) return;
    const merged = Y.mergeUpdates(this.pending);
    this.pending = [];
    this.appendUpdate(merged);
    const count = this.sql.exec<{ c: number }>('SELECT count(DISTINCT grp) AS c FROM doc_updates').one().c;
    if (count > COMPACT_AFTER && this.doc) {
      const state = Y.encodeStateAsUpdate(this.doc);
      this.ctx.storage.transactionSync(() => {
        this.sql.exec('DELETE FROM doc_updates');
        this.appendUpdate(state);
      });
    }
  }

  private touchDirectory(): void {
    const now = Date.now();
    if (now - this.lastTouch < TOUCH_INTERVAL_MS) return;
    this.lastTouch = now;
    void this.directory.touch(this.templateId);
  }

  /* ───────────── 타임라인 ───────────── */

  private record(
    user: PublicUser,
    input: { type: ActivityType; targetId?: string; targetName?: string; detail?: string },
    at = Date.now(),
  ): { event: TimelineEvent; merged: boolean } {
    const def = ACTIVITY[input.type];
    const text = def.text(input.targetName ?? '', input.detail ?? '');
    if (def.coalesce) {
      const recent = this.sql
        .exec<{ id: string; json: string }>(
          'SELECT id, json FROM timeline WHERE user_id = ? AND type = ? AND at > ? ORDER BY at DESC LIMIT 10',
          user.id,
          input.type,
          at - COALESCE_WINDOW_MS,
        )
        .toArray();
      for (const row of recent) {
        const e = JSON.parse(row.json) as TimelineEvent;
        if ((e.targetId ?? null) !== (input.targetId ?? null)) continue;
        e.count += 1;
        e.at = at;
        e.text = text;
        e.user = user;
        e.targetName = input.targetName;
        if (input.detail) e.detail = input.detail;
        this.sql.exec('UPDATE timeline SET at = ?, json = ? WHERE id = ?', at, JSON.stringify(e), e.id);
        this.broadcast({ t: 'timeline', event: e, merged: true });
        return { event: e, merged: true };
      }
    }
    const event: TimelineEvent = {
      id: newId(),
      templateId: this.templateId,
      templateName: this.meta('name') ?? '',
      user,
      type: input.type,
      module: def.module,
      targetId: input.targetId,
      targetName: input.targetName,
      detail: input.detail,
      text,
      at,
      count: 1,
      important: Boolean(def.important),
    };
    this.insertEvent(event);
    if (Math.random() < 0.02) {
      this.sql.exec('DELETE FROM timeline WHERE id IN (SELECT id FROM timeline ORDER BY at DESC LIMIT -1 OFFSET ?)', TIMELINE_LIMIT);
    }
    this.broadcast({ t: 'timeline', event, merged: false });
    if (def.important) {
      this.broadcast({ t: 'toast', toast: { kind: def.toastKind ?? 'info', title: user.name, message: text, user } }, { exceptUser: user.id });
    }
    return { event, merged: false };
  }

  private insertEvent(e: TimelineEvent): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO timeline (id, at, user_id, module, type, target_id, json) VALUES (?, ?, ?, ?, ?, ?, ?)',
      e.id,
      e.at,
      e.user.id,
      e.module,
      e.type,
      e.targetId ?? null,
      JSON.stringify(e),
    );
  }

  async getTimeline(q: { before?: number; limit?: number; userId?: string; module?: string; q?: string }): Promise<{ events: TimelineEvent[]; hasMore: boolean }> {
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
    const where: string[] = ['at < ?'];
    const args: (string | number)[] = [Number(q.before) || Number.MAX_SAFE_INTEGER];
    if (q.userId) {
      where.push('user_id = ?');
      args.push(q.userId);
    }
    if (q.module) {
      where.push('module = ?');
      args.push(q.module);
    }
    const needle = q.q?.trim().toLowerCase();
    const scan = needle ? 1000 : limit + 1;
    const rows = this.sql
      .exec<{ json: string }>(`SELECT json FROM timeline WHERE ${where.join(' AND ')} ORDER BY at DESC LIMIT ?`, ...args, scan)
      .toArray()
      .map((r) => JSON.parse(r.json) as TimelineEvent);
    const name = this.meta('name') ?? '';
    const filtered = (needle ? rows.filter((e) => `${e.user.name} ${e.text} ${e.targetName ?? ''}`.toLowerCase().includes(needle)) : rows).map((e) => ({
      ...e,
      templateName: name,
    }));
    return { events: filtered.slice(0, limit), hasMore: filtered.length > limit };
  }

  private chatHistory(): ChatMessage[] {
    return this.sql
      .exec<{ json: string }>('SELECT json FROM chat ORDER BY at DESC LIMIT 100')
      .toArray()
      .map((r) => JSON.parse(r.json) as ChatMessage)
      .reverse();
  }

  /* ───────────── 비밀 노트 (종단 간 암호화) ───────────── */

  private noteRow(id: string): NoteRow | null {
    return this.sql.exec<NoteRow>('SELECT * FROM notes WHERE id = ?', id).toArray()[0] ?? null;
  }

  private noteList(): SecretNoteMeta[] {
    return this.sql
      .exec<{ json: string }>('SELECT json FROM notes')
      .toArray()
      .map((r) => JSON.parse(r.json) as SecretNoteMeta)
      .sort((x, y) => x.createdAt - y.createdAt);
  }

  private noteOpen(ws: WebSocket, a: Attachment, noteId: string): boolean {
    const exp = a.notes[noteId];
    if (!exp) return false;
    if (exp < Date.now()) {
      delete a.notes[noteId];
      ws.serializeAttachment(a);
      this.send(ws, { t: 'note:locked', noteId, reason: 'expired' });
      return false;
    }
    return true;
  }

  private touchNote(noteId: string): void {
    const row = this.noteRow(noteId);
    if (!row) return;
    const meta = JSON.parse(row.json) as SecretNoteMeta;
    if (Date.now() - meta.updatedAt < 60_000) return;
    meta.updatedAt = Date.now();
    this.sql.exec('UPDATE notes SET json = ? WHERE id = ?', JSON.stringify(meta), noteId);
  }

  private validateEncrypted(n: Partial<EncryptedNote>, creator: PublicUser): Result<EncryptedNote> {
    if (!isId(n.id, 8, 40)) return fail(400, '잘못된 노트 ID입니다.');
    const title = clampText(n.title, 60);
    if (!title) return fail(400, '노트 제목을 입력해 주세요.');
    const kdf = n.kdf;
    if (!kdf || typeof kdf.salt !== 'string' || kdf.salt.length > 64 || !Number.isInteger(kdf.iterations) || kdf.iterations < 100_000 || kdf.iterations > 5_000_000) {
      return fail(400, '암호화 설정이 올바르지 않습니다.');
    }
    if (typeof n.verifierHash !== 'string' || !/^[0-9a-f]{64}$/.test(n.verifierHash)) return fail(400, '비밀번호 확인값이 올바르지 않습니다.');
    if (typeof n.snapshot !== 'string' || n.snapshot.length > MAX_BLOB_CHARS) return fail(400, '노트 내용이 올바르지 않습니다.');
    const now = Date.now();
    return ok({
      id: n.id,
      title,
      hint: clampText(n.hint, 80),
      createdBy: n.createdBy && typeof n.createdBy.name === 'string' ? n.createdBy : creator,
      createdAt: typeof n.createdAt === 'number' && n.createdAt <= now ? n.createdAt : now,
      updatedAt: typeof n.updatedAt === 'number' && n.updatedAt <= now ? n.updatedAt : now,
      kdf: { salt: kdf.salt, iterations: kdf.iterations },
      verifierHash: n.verifierHash,
      snapshot: n.snapshot,
    });
  }

  private insertNote(n: EncryptedNote): void {
    const { verifierHash, snapshot, ...meta } = n;
    this.sql.exec('INSERT OR REPLACE INTO notes (id, json, verifier_hash, snapshot) VALUES (?, ?, ?, ?)', n.id, JSON.stringify(meta), verifierHash, snapshot);
  }

  async listNotes(): Promise<SecretNoteMeta[]> {
    return this.noteList();
  }

  async createNote(user: PublicUser, input: Partial<EncryptedNote>): Promise<Result<SecretNoteMeta>> {
    const v = this.validateEncrypted(input, user);
    if (!v.ok) return v;
    if (this.noteRow(v.data.id)) return fail(409, '이미 있는 노트입니다.');
    this.insertNote({ ...v.data, createdBy: user });
    this.broadcast({ t: 'notes', notes: this.noteList() });
    this.record(user, { type: 'notes.create', targetId: v.data.id, targetName: v.data.title });
    const { verifierHash: _h, snapshot: _s, ...meta } = v.data;
    return ok({ ...meta, createdBy: user });
  }

  /** 비밀번호 확인값 검증 + 무차별 대입 방지 */
  private async verify(user: PublicUser, noteId: string, verifier: unknown): Promise<Result<NoteRow>> {
    const row = this.noteRow(noteId);
    if (!row) return fail(404, '비밀 노트를 찾을 수 없습니다.');
    const k = `${user.id}:${noteId}`;
    const now = Date.now();
    const at = this.sql.exec<{ fails: number; locked_until: number }>('SELECT fails, locked_until FROM note_attempts WHERE k = ?', k).toArray()[0];
    if (at && at.locked_until > now) {
      const retryAfter = Math.ceil((at.locked_until - now) / 1000);
      return fail(429, `비밀번호를 여러 번 틀려 잠시 잠겼습니다. ${retryAfter}초 후 다시 시도하세요.`, { retryAfter });
    }
    const good = typeof verifier === 'string' && verifier.length > 10 && verifier.length < 200 && safeEqual(await sha256Hex(verifier), row.verifier_hash);
    if (!good) {
      const fails = (at?.fails ?? 0) + 1;
      const meta = JSON.parse(row.json) as SecretNoteMeta;
      this.record(user, { type: 'notes.unlock_fail', targetId: noteId, targetName: meta.title });
      if (fails >= NOTE_MAX_ATTEMPTS) {
        this.sql.exec('INSERT OR REPLACE INTO note_attempts (k, fails, locked_until) VALUES (?, 0, ?)', k, now + NOTE_LOCKOUT_MS);
        return fail(429, `비밀번호를 여러 번 틀려 잠시 잠겼습니다. ${NOTE_LOCKOUT_MS / 1000}초 후 다시 시도하세요.`, { retryAfter: NOTE_LOCKOUT_MS / 1000 });
      }
      this.sql.exec('INSERT OR REPLACE INTO note_attempts (k, fails, locked_until) VALUES (?, ?, 0)', k, fails);
      return fail(401, `비밀번호가 올바르지 않습니다. (남은 시도 ${NOTE_MAX_ATTEMPTS - fails}회)`, { remaining: NOTE_MAX_ATTEMPTS - fails });
    }
    if (at) this.sql.exec('DELETE FROM note_attempts WHERE k = ?', k);
    return ok(row);
  }

  async unlockNote(user: PublicUser, noteId: string, verifier: unknown): Promise<Result<UnlockResult>> {
    const v = await this.verify(user, noteId, verifier);
    if (!v.ok) return v;
    const ticket = newId(32);
    const expiresAt = Date.now() + NOTE_TICKET_TTL_MS;
    this.sql.exec('INSERT INTO note_tickets (ticket, note_id, user_id, expires_at) VALUES (?, ?, ?, ?)', ticket, noteId, user.id, expiresAt);
    const meta = JSON.parse(v.data.json) as SecretNoteMeta;
    this.record(user, { type: 'notes.unlock', targetId: noteId, targetName: meta.title });
    return ok({ ticket, expiresAt });
  }

  private lockNoteEverywhere(noteId: string, reason: 'password' | 'deleted'): void {
    this.sql.exec('DELETE FROM note_tickets WHERE note_id = ?', noteId);
    for (const { ws, a } of this.sockets()) {
      if (!a.notes[noteId]) continue;
      delete a.notes[noteId];
      ws.serializeAttachment(a);
      this.send(ws, { t: 'note:locked', noteId, reason });
    }
  }

  async changeNotePassword(
    user: PublicUser,
    role: Role,
    noteId: string,
    verifier: unknown,
    next: Partial<EncryptedNote>,
  ): Promise<Result<SecretNoteMeta>> {
    if (role === 'viewer') return fail(403, '읽기 전용 권한입니다.');
    const v = await this.verify(user, noteId, verifier);
    if (!v.ok) return v;
    const current = JSON.parse(v.data.json) as SecretNoteMeta;
    const valid = this.validateEncrypted({ ...current, ...next, id: noteId, title: current.title, createdBy: current.createdBy, createdAt: current.createdAt, updatedAt: Date.now() }, user);
    if (!valid.ok) return valid;
    this.ctx.storage.transactionSync(() => {
      this.insertNote(valid.data);
      this.sql.exec('DELETE FROM note_updates WHERE note_id = ?', noteId);
    });
    this.lockNoteEverywhere(noteId, 'password');
    this.broadcast({ t: 'notes', notes: this.noteList() });
    this.record(user, { type: 'notes.password', targetId: noteId, targetName: current.title });
    const { verifierHash: _h, snapshot: _s, ...meta } = valid.data;
    return ok(meta);
  }

  async deleteNote(user: PublicUser, role: Role, noteId: string, verifier: unknown, force: boolean): Promise<Result<{ title: string }>> {
    if (role === 'viewer') return fail(403, '읽기 전용 권한입니다.');
    const row = this.noteRow(noteId);
    if (!row) return fail(404, '비밀 노트를 찾을 수 없습니다.');
    if (!(force && role === 'owner')) {
      const v = await this.verify(user, noteId, verifier);
      if (!v.ok) return v;
    }
    const meta = JSON.parse(row.json) as SecretNoteMeta;
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM notes WHERE id = ?', noteId);
      this.sql.exec('DELETE FROM note_updates WHERE note_id = ?', noteId);
    });
    this.lockNoteEverywhere(noteId, 'deleted');
    this.broadcast({ t: 'notes', notes: this.noteList() });
    this.record(user, { type: 'notes.delete', targetId: noteId, targetName: meta.title });
    return ok({ title: meta.title });
  }

  /* ───────────── Worker가 호출하는 관리 기능 ───────────── */

  /** 개인 공간에서 올린 템플릿 등록 (Directory에 등록한 뒤 방 초기화) */
  async share(user: PublicUser, templateId: string, text: string): Promise<Result<TemplateSummary>> {
    let input: Partial<ShareUpload>;
    try {
      input = JSON.parse(text) as Partial<ShareUpload>;
    } catch {
      return fail(400, '잘못된 요청 형식입니다.');
    }
    if (!input || input.id !== templateId) return fail(400, '템플릿 ID가 일치하지 않습니다.');
    if (typeof input.state !== 'string') return fail(400, '문서 데이터가 없습니다.');
    const created = await this.directory.createTemplate(user.id, input);
    if (!created.ok) return created;
    const template = created.data;
    const init = await this.init({
      templateId,
      name: template.name,
      user,
      state: input.state,
      timeline: Array.isArray(input.timeline) ? input.timeline : [],
      notes: Array.isArray(input.notes) ? input.notes : [],
    });
    if (!init.ok) {
      await this.directory.deleteTemplate(templateId, user.id);
      return init;
    }
    return ok(template);
  }

  /** 개인 공간에서 올라온 템플릿으로 방을 초기화 */
  async init(input: { templateId: string; name: string; user: PublicUser; state: string; timeline: TimelineEvent[]; notes: Partial<EncryptedNote>[] }): Promise<Result<{ notes: number }>> {
    if (this.meta('initialized')) return ok({ notes: this.noteList().length });
    let state: Uint8Array;
    try {
      state = fromB64(input.state);
      Y.applyUpdate(new Y.Doc(), state);
    } catch {
      return fail(400, '문서 데이터가 올바르지 않습니다.');
    }
    const notes: EncryptedNote[] = [];
    for (const n of (input.notes ?? []).slice(0, 100)) {
      const v = this.validateEncrypted(n, input.user);
      if (!v.ok) return v;
      notes.push(v.data);
    }
    const events = (input.timeline ?? [])
      .filter((e) => e && typeof e.id === 'string' && ACTIVITY[e.type] && typeof e.at === 'number')
      .slice(-500);
    this.ctx.storage.transactionSync(() => {
      this.setMetaValue('templateId', input.templateId);
      this.setMetaValue('name', input.name);
      this.appendUpdate(state);
      for (const e of events) {
        // 개인 공간에서의 기록은 올린 사람의 서버 계정으로 옮긴다
        this.insertEvent({ ...e, templateId: input.templateId, templateName: input.name, user: input.user, module: ACTIVITY[e.type].module });
      }
      for (const n of notes) this.insertNote(n);
      this.setMetaValue('initialized', String(Date.now()));
    });
    this.doc = null;
    this.record(input.user, { type: 'template.share' });
    return ok({ notes: notes.length });
  }

  async recordEvent(user: PublicUser, input: { type: ActivityType; targetId?: string; targetName?: string; detail?: string }): Promise<void> {
    this.record(user, input);
  }

  async templateChanged(template: TemplateBroadcast): Promise<void> {
    if (template.name !== this.meta('name')) this.setMetaValue('name', template.name);
    this.broadcast({ t: 'template', template });
  }

  async setRole(userId: string, role: Role): Promise<void> {
    for (const { ws, a } of this.sockets()) {
      if (a.user.id !== userId) continue;
      a.role = role;
      ws.serializeAttachment(a);
      this.send(ws, { t: 'role', role });
    }
  }

  async requestsChanged(requests: JoinRequest[]): Promise<void> {
    this.broadcast({ t: 'requests', requests }, { filter: (a) => a.role !== 'viewer' });
  }

  async userUpdated(user: PublicUser): Promise<void> {
    for (const { ws, a } of this.sockets()) {
      if (a.user.id !== user.id) continue;
      a.user = user;
      ws.serializeAttachment(a);
      this.broadcast({ t: 'presence', state: this.presenceOf(a) }, { exceptSid: a.sid });
    }
  }

  async kick(userId: string, reason: 'removed' | 'left'): Promise<void> {
    for (const ws of this.ctx.getWebSockets(userId)) {
      this.send(ws, { t: 'kicked', reason });
      try {
        ws.close(4001, reason);
      } catch {
        /* 무시 */
      }
    }
  }

  /** 템플릿 삭제: 모두 내보내고 저장된 내용을 지운다 */
  async destroy(byName: string): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, { t: 'kicked', reason: 'deleted', by: byName });
      try {
        ws.close(4002, 'deleted');
      } catch {
        /* 무시 */
      }
    }
    this.doc = null;
    this.pending = [];
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}
