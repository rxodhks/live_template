import type { Server, Socket } from 'socket.io';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import type {
  ActivityInput,
  ActivityType,
  CursorPoint,
  PresenceState,
  PresenceView,
  PublicUser,
  ToastPayload,
  ViewModule,
  Viewport,
} from '../../shared/types.js';
import { ACTIVITY, CLIENT_REPORTABLE } from '../../shared/activity.js';
import {
  type TemplateRecord,
  getTemplate,
  getUser,
  listTemplatesFor,
  requireMember,
  roleOf,
  summarize,
  toPublicUser,
  touchTemplate,
  touchUser,
  findUserByToken,
} from './db.js';
import { DocManager, parseDocName, type DocEntry } from './docs.js';
import { recordActivity } from './timeline.js';
import { addChatMessage, chatHistory } from './chat.js';
import { listNotes, sweepTickets, useTicket } from './secrets.js';
import { HttpError, clampText } from './util.js';

interface SocketData {
  userId: string;
  templateId: string | null;
  docs: Set<string>;
  /** 비밀 노트 문서명 → 티켓 만료 시각 */
  noteExpiry: Map<string, number>;
}
type AppSocket = Socket<Record<string, any>, Record<string, any>, Record<string, any>, SocketData>;

let io: Server;
export let docs: DocManager;

/** templateId → socketId → 프레즌스 */
const presence = new Map<string, Map<string, PresenceState>>();
/** templateId → userId → socketIds */
const onlineSockets = new Map<string, Map<string, Set<string>>>();
/** 새로고침처럼 잠깐 끊겼다 돌아오는 경우 퇴장 기록을 남기지 않기 위한 유예 */
const pendingLeave = new Map<string, NodeJS.Timeout>();
const LEAVE_GRACE_MS = 4000;

const VIEW_MODULES: ReadonlySet<ViewModule> = new Set([
  'overview',
  'design',
  'code',
  'docs',
  'notes',
  'timeline',
  'members',
  'settings',
]);

function presenceOf(templateId: string): Map<string, PresenceState> {
  let m = presence.get(templateId);
  if (!m) presence.set(templateId, (m = new Map()));
  return m;
}

function onlineOf(templateId: string): Map<string, Set<string>> {
  let m = onlineSockets.get(templateId);
  if (!m) onlineSockets.set(templateId, (m = new Map()));
  return m;
}

export function onlineUserIds(templateId: string): string[] {
  return Array.from(onlineSockets.get(templateId)?.keys() ?? []);
}

const memberRooms = (t: TemplateRecord) => t.members.map((m) => `user:${m.userId}`);

function toU8(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  return null;
}

function sanitizeView(v: unknown): PresenceView {
  const obj = (v ?? {}) as Partial<PresenceView>;
  const module = VIEW_MODULES.has(obj.module as ViewModule) ? (obj.module as ViewModule) : 'overview';
  const itemId = typeof obj.itemId === 'string' ? obj.itemId.slice(0, 64) : null;
  return { module, itemId };
}

function sanitizeCursor(c: unknown): CursorPoint | null {
  const obj = c as CursorPoint | null;
  if (!obj || !Number.isFinite(obj.x) || !Number.isFinite(obj.y)) return null;
  return { x: Math.round(obj.x * 1000) / 1000, y: Math.round(obj.y * 10) / 10 };
}

function sanitizeViewport(v: unknown): Viewport | null {
  const obj = v as Viewport | null;
  if (!obj || !Number.isFinite(obj.x) || !Number.isFinite(obj.y) || !Number.isFinite(obj.zoom)) return null;
  return { x: obj.x, y: obj.y, zoom: Math.min(Math.max(obj.zoom, 0.05), 20) };
}

/* ───────────── 방송 헬퍼 ───────────── */

export function emitToMembers(t: TemplateRecord, event: string, payload: unknown): void {
  const rooms = memberRooms(t);
  if (rooms.length) io.to(rooms).emit(event, payload);
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  io.to(`user:${userId}`).emit(event, payload);
}

export function emitTemplateUpdated(t: TemplateRecord): void {
  for (const m of t.members) io.to(`user:${m.userId}`).emit('template:updated', summarize(t, m.userId));
}

export function emitNotesChanged(templateId: string): void {
  io.to(`tpl:${templateId}`).emit('notes:changed', { templateId, notes: listNotes(templateId) });
}

function broadcastOnline(t: TemplateRecord): void {
  emitToMembers(t, 'online', { templateId: t.id, userIds: onlineUserIds(t.id) });
}

export function onlineMapFor(userId: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const t of listTemplatesFor(userId)) out[t.id] = onlineUserIds(t.id);
  return out;
}

/** 다른 사용자에게 토스트 (행동한 본인의 모든 탭은 제외) */
export function toastTemplate(templateId: string, toast: ToastPayload, exceptUserId?: string): void {
  const op = io.to(`tpl:${templateId}`);
  (exceptUserId ? op.except(`user:${exceptUserId}`) : op).emit('toast', toast);
}

/** 타임라인 기록 + 실시간 전파 + (중요한 행동이면) 토스트 */
export function record(
  t: TemplateRecord,
  user: PublicUser,
  input: { type: ActivityType; targetId?: string; targetName?: string; detail?: string },
): void {
  const { event, merged } = recordActivity({ templateId: t.id, templateName: t.name, user, ...input });
  emitToMembers(t, 'timeline:event', { event, merged });
  const def = ACTIVITY[input.type];
  if (def.important && !merged) {
    toastTemplate(t.id, { kind: def.toastKind ?? 'info', title: user.name, message: event.text, user }, user.id);
  }
}

/* ───────────── 입장/퇴장 ───────────── */

function markOnline(t: TemplateRecord, user: PublicUser, socketId: string): void {
  const users = onlineOf(t.id);
  let set = users.get(user.id);
  const wasOnline = !!set && set.size > 0;
  if (!set) users.set(user.id, (set = new Set()));
  set.add(socketId);
  if (wasOnline) return;
  const key = `${t.id}:${user.id}`;
  const pending = pendingLeave.get(key);
  if (pending) {
    clearTimeout(pending);
    pendingLeave.delete(key);
  } else {
    record(t, user, { type: 'presence.join' });
  }
  broadcastOnline(t);
}

function leaveTemplate(socket: AppSocket, opts: { silent?: boolean } = {}): void {
  const tid = socket.data.templateId;
  if (!tid) return;
  const userId = socket.data.userId;
  socket.leave(`tpl:${tid}`);
  socket.data.templateId = null;
  presenceOf(tid).delete(socket.id);
  io.to(`tpl:${tid}`).emit('presence:leave', { socketId: socket.id });

  for (const name of Array.from(socket.data.docs)) {
    if (parseDocName(name)?.templateId === tid) leaveDoc(socket, name);
  }

  const users = onlineOf(tid);
  const set = users.get(userId);
  set?.delete(socket.id);
  if (set && set.size === 0) {
    users.delete(userId);
    const key = `${tid}:${userId}`;
    if (opts.silent) {
      const t = getTemplate(tid);
      if (t) broadcastOnline(t);
      return;
    }
    pendingLeave.set(
      key,
      setTimeout(() => {
        pendingLeave.delete(key);
        const t = getTemplate(tid);
        const u = getUser(userId);
        if (!t) return;
        if (u && roleOf(t, userId)) record(t, toPublicUser(u), { type: 'presence.leave' });
        broadcastOnline(t);
      }, LEAVE_GRACE_MS).unref(),
    );
  }
}

function leaveDoc(socket: AppSocket, name: string): void {
  socket.leave(`doc:${name}`);
  socket.data.docs.delete(name);
  socket.data.noteExpiry.delete(name);
  docs.removeSocket(name, socket.id);
}

/** 멤버에서 제외되었거나 템플릿이 삭제되었을 때 해당 사용자를 방에서 내보낸다 */
export async function kickUserFromTemplate(templateId: string, userId: string): Promise<void> {
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  for (const remote of sockets) {
    const s = io.sockets.sockets.get(remote.id) as AppSocket | undefined;
    if (s && s.data.templateId === templateId) leaveTemplate(s, { silent: true });
  }
}

export async function closeTemplate(t: TemplateRecord, by: PublicUser): Promise<void> {
  emitToMembers(t, 'template:deleted', { templateId: t.id, name: t.name, by });
  const sockets = await io.in(`tpl:${t.id}`).fetchSockets();
  for (const remote of sockets) {
    const s = io.sockets.sockets.get(remote.id) as AppSocket | undefined;
    if (s) leaveTemplate(s, { silent: true });
  }
  for (const e of docs.entriesForTemplate(t.id)) docs.discard(e.name);
  presence.delete(t.id);
  onlineSockets.delete(t.id);
}

/** 비밀 노트 문서에서 모두 내보낸다 (비밀번호 변경/삭제/만료) */
export async function kickNote(templateId: string, noteId: string, reason: 'password' | 'deleted' | 'expired'): Promise<void> {
  const name = `note:${templateId}:${noteId}`;
  const sockets = await io.in(`doc:${name}`).fetchSockets();
  for (const remote of sockets) {
    const s = io.sockets.sockets.get(remote.id) as AppSocket | undefined;
    if (!s) continue;
    leaveDoc(s, name);
    s.emit('doc:kicked', { name, reason });
  }
}

/** 프로필이 바뀌면 모든 방의 프레즌스에 반영 */
export function refreshUserPresence(user: PublicUser): void {
  for (const [tid, map] of presence) {
    for (const state of map.values()) {
      if (state.user.id !== user.id) continue;
      state.user = user;
      io.to(`tpl:${tid}`).emit('presence:update', state);
    }
  }
}

/* ───────────── 소켓 이벤트 ───────────── */

type Ack = ((res: unknown) => void) | undefined;

function handle(ack: Ack, fn: () => unknown): void {
  try {
    const result = fn();
    if (typeof ack === 'function') ack({ ok: true, ...(result as object) });
  } catch (err) {
    if (err instanceof HttpError) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message, status: err.status, ...err.extra });
    } else {
      console.error('[socket] 처리 실패', err);
      if (typeof ack === 'function') ack({ ok: false, error: '서버 오류가 발생했습니다.', status: 500 });
    }
  }
}

const templateThrottle = new Map<string, number>();

export function initRealtime(server: Server): void {
  io = server;

  docs = new DocManager({
    broadcastUpdate(entry: DocEntry, update, origin) {
      const op = io.to(`doc:${entry.name}`);
      (origin ? op.except(origin) : op).emit('doc:update', { name: entry.name, update });
    },
    broadcastAwareness(entry: DocEntry, update, origin) {
      const op = io.to(`doc:${entry.name}`);
      (origin ? op.except(origin) : op).emit('doc:awareness', { name: entry.name, update });
    },
    onTemplateChanged(templateId) {
      const now = Date.now();
      if (now - (templateThrottle.get(templateId) ?? 0) < 10_000) return;
      templateThrottle.set(templateId, now);
      const t = getTemplate(templateId);
      if (!t) return;
      touchTemplate(t);
      emitToMembers(t, 'template:touched', { templateId, updatedAt: t.updatedAt });
    },
  });

  io.use((socket, next) => {
    const user = findUserByToken((socket.handshake.auth as { token?: string })?.token);
    if (!user) return next(new Error('unauthorized'));
    const s = socket as AppSocket;
    s.data.userId = user.id;
    s.data.templateId = null;
    s.data.docs = new Set();
    s.data.noteExpiry = new Map();
    next();
  });

  io.on('connection', (raw) => {
    const socket = raw as AppSocket;
    const userId = socket.data.userId;
    socket.join(`user:${userId}`);
    touchUser(userId);

    const me = (): PublicUser => {
      const u = getUser(userId);
      if (!u) throw new HttpError(401, '사용자 정보가 없습니다.');
      return toPublicUser(u);
    };

    socket.on('online:get', (_p: unknown, ack: Ack) => handle(ack, () => ({ online: onlineMapFor(userId) })));

    socket.on('template:enter', (payload: { templateId?: string; view?: PresenceView }, ack: Ack) =>
      handle(ack, () => {
        const { t } = requireMember(String(payload?.templateId ?? ''), userId);
        if (socket.data.templateId && socket.data.templateId !== t.id) leaveTemplate(socket);
        const user = me();
        const map = presenceOf(t.id);
        const state: PresenceState = map.get(socket.id) ?? {
          socketId: socket.id,
          user,
          view: sanitizeView(payload?.view),
          cursor: null,
          idle: false,
        };
        socket.join(`tpl:${t.id}`);
        socket.data.templateId = t.id;
        map.set(socket.id, state);
        socket.to(`tpl:${t.id}`).emit('presence:update', state);
        markOnline(t, user, socket.id);
        return {
          template: summarize(t, userId),
          presence: Array.from(map.values()),
          chat: chatHistory(t.id),
          notes: listNotes(t.id),
        };
      }),
    );

    socket.on('template:leave', (_p: unknown, ack: Ack) => handle(ack, () => leaveTemplate(socket)));

    socket.on('presence:update', (patch: Partial<PresenceState>) => {
      const tid = socket.data.templateId;
      const state = tid ? presence.get(tid)?.get(socket.id) : undefined;
      if (!tid || !state || !patch) return;
      if (patch.view !== undefined) {
        const view = sanitizeView(patch.view);
        if (view.module !== state.view.module || view.itemId !== state.view.itemId) {
          state.cursor = null;
          state.selection = [];
        }
        state.view = view;
      }
      if (patch.viewport !== undefined) state.viewport = sanitizeViewport(patch.viewport);
      if (Array.isArray(patch.selection)) state.selection = patch.selection.filter((s) => typeof s === 'string').slice(0, 200);
      if (typeof patch.idle === 'boolean') state.idle = patch.idle;
      socket.to(`tpl:${tid}`).emit('presence:update', state);
    });

    socket.on('presence:cursor', (payload: { cursor?: unknown }) => {
      const tid = socket.data.templateId;
      const state = tid ? presence.get(tid)?.get(socket.id) : undefined;
      if (!tid || !state) return;
      state.cursor = sanitizeCursor(payload?.cursor);
      socket.to(`tpl:${tid}`).volatile.emit('presence:cursor', { socketId: socket.id, cursor: state.cursor });
    });

    socket.on('presence:action', (payload: { label?: unknown }) => {
      const tid = socket.data.templateId;
      const state = tid ? presence.get(tid)?.get(socket.id) : undefined;
      const label = clampText(payload?.label, 40);
      if (!tid || !state || !label) return;
      state.action = { label, at: Date.now() };
      socket.to(`tpl:${tid}`).emit('presence:action', { socketId: socket.id, label });
    });

    socket.on('activity', (input: ActivityInput, ack: Ack) =>
      handle(ack, () => {
        if (!input || !CLIENT_REPORTABLE.has(input.type)) throw new HttpError(400, '알 수 없는 활동입니다.');
        const tid = socket.data.templateId;
        if (!tid) throw new HttpError(400, '템플릿에 먼저 입장하세요.');
        const { t, role } = requireMember(tid, userId);
        if (role === 'viewer' && input.type !== 'code.run') throw new HttpError(403, '읽기 전용 권한입니다.');
        const user = me();
        const clean = {
          type: input.type,
          targetId: clampText(input.targetId, 64) || undefined,
          targetName: clampText(input.targetName, 80) || undefined,
          detail: clampText(input.detail, 120) || undefined,
        };
        record(t, user, clean);
        const label = `${ACTIVITY[input.type].label}${clean.targetName ? ` · ${clean.targetName}` : ''}`;
        const state = presence.get(tid)?.get(socket.id);
        if (state) state.action = { label, at: Date.now() };
        socket.to(`tpl:${tid}`).emit('presence:action', { socketId: socket.id, label });
      }),
    );

    socket.on('chat:send', (payload: { text?: unknown }, ack: Ack) =>
      handle(ack, () => {
        const tid = socket.data.templateId;
        if (!tid) throw new HttpError(400, '템플릿에 먼저 입장하세요.');
        requireMember(tid, userId);
        const message = addChatMessage(tid, me(), payload?.text);
        io.to(`tpl:${tid}`).emit('chat:message', { templateId: tid, message });
        return { message };
      }),
    );

    /* ── Yjs 문서 동기화 ── */

    socket.on('doc:join', (payload: { name?: string; sv?: unknown; ticket?: unknown }, ack: Ack) =>
      handle(ack, () => {
        const name = String(payload?.name ?? '');
        const parsed = parseDocName(name);
        if (!parsed) throw new HttpError(400, '잘못된 문서입니다.');
        const { t, role } = requireMember(parsed.templateId, userId);
        let key: Buffer | undefined;
        if (parsed.kind === 'note') {
          const ticket = useTicket(payload?.ticket, userId, t.id, parsed.noteId!);
          key = ticket.key;
          socket.data.noteExpiry.set(name, ticket.expiresAt);
        }
        const entry = docs.load(name, key);
        docs.addSocket(entry, socket.id);
        socket.join(`doc:${name}`);
        socket.data.docs.add(name);

        const clientSv = toU8(payload?.sv);
        let update: Uint8Array;
        try {
          update = Y.encodeStateAsUpdate(entry.doc, clientSv ?? undefined);
        } catch {
          update = Y.encodeStateAsUpdate(entry.doc);
        }
        const clients = Array.from(entry.awareness.getStates().keys());
        return {
          update,
          sv: Y.encodeStateVector(entry.doc),
          readOnly: role === 'viewer',
          awareness: clients.length ? awarenessProtocol.encodeAwarenessUpdate(entry.awareness, clients) : null,
        };
      }),
    );

    socket.on('doc:update', (payload: { name?: string; update?: unknown }, ack: Ack) =>
      handle(ack, () => {
        const name = String(payload?.name ?? '');
        if (!socket.data.docs.has(name)) throw new HttpError(409, '문서에 참여하지 않았습니다.');
        const parsed = parseDocName(name)!;
        const { role } = requireMember(parsed.templateId, userId);
        if (role === 'viewer') throw new HttpError(403, '읽기 전용 권한입니다.');
        const entry = docs.get(name);
        const update = toU8(payload?.update);
        if (!entry || !update) throw new HttpError(409, '문서를 찾을 수 없습니다.');
        Y.applyUpdate(entry.doc, update, socket.id);
      }),
    );

    socket.on('doc:awareness', (payload: { name?: string; update?: unknown }) => {
      const name = String(payload?.name ?? '');
      const entry = docs.get(name);
      const update = toU8(payload?.update);
      if (!entry || !update || !socket.data.docs.has(name)) return;
      try {
        awarenessProtocol.applyAwarenessUpdate(entry.awareness, update, socket.id);
      } catch (err) {
        console.warn('[socket] awareness 적용 실패', err);
      }
    });

    socket.on('doc:leave', (payload: { name?: string }) => {
      const name = String(payload?.name ?? '');
      if (socket.data.docs.has(name)) leaveDoc(socket, name);
    });

    socket.on('disconnect', () => {
      leaveTemplate(socket);
      for (const name of Array.from(socket.data.docs)) leaveDoc(socket, name);
    });
  });

  // 만료된 비밀 노트 잠금 해제를 주기적으로 회수
  setInterval(() => {
    sweepTickets();
    const now = Date.now();
    for (const s of io.sockets.sockets.values() as IterableIterator<AppSocket>) {
      for (const [name, expiresAt] of s.data.noteExpiry ?? []) {
        if (expiresAt < now) {
          leaveDoc(s, name);
          s.emit('doc:kicked', { name, reason: 'expired' });
        }
      }
    }
  }, 30_000).unref();
}
