import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import type { ActivityInput, PublicUser, SecretNoteMeta, TemplateMode, UnlockResult } from '@shared/types';
import type { NoteJoinData } from '@shared/protocol';
import { ApiError, api } from './api';
import { decryptBytes, deriveNoteKeys, encryptBytes, newKdf, sha256Hex, type NoteKeys } from './crypto';
import { idbGet } from './idb';
import { type LocalNote, deleteLocalNote, listLocalNotes, putLocalNote } from './local';
import type { RoomConnection } from './room';
import { newId } from './util';

/*
 * 비밀 노트 — 개인 공간(브라우저)과 협업 공간(서버) 모두 같은 방식으로 암호화된다.
 * 잠금 해제한 키는 메모리에만 있고, 저장·전송되는 것은 모두 암호문이다.
 */

/** 잠금 해제 유지 시간 */
export const UNLOCK_TTL_MS = 30 * 60 * 1000;
const LOCAL_MAX_ATTEMPTS = 5;
const LOCAL_LOCKOUT_MS = 5 * 60 * 1000;
const SNAPSHOT_EVERY = 50;

export interface UnlockedNote {
  key: CryptoKey;
  /** 협업 공간: 서버가 발급한 열람 티켓 */
  ticket: string | null;
  expiresAt: number;
}

export interface NoteSession {
  readonly awareness: Awareness;
  readonly status: 'loading' | 'ready' | 'offline' | 'error';
  subscribe(fn: () => void): () => void;
  destroy(): void;
}

export interface NotesApi {
  list(): Promise<SecretNoteMeta[]>;
  create(input: { title: string; hint: string; password: string }): Promise<{ meta: SecretNoteMeta; unlocked: UnlockedNote }>;
  unlock(note: SecretNoteMeta, password: string): Promise<UnlockedNote>;
  changePassword(note: SecretNoteMeta, current: string, next: string, hint: string, doc: Y.Doc): Promise<UnlockedNote>;
  remove(note: SecretNoteMeta, password: string | null, force: boolean): Promise<void>;
  open(note: SecretNoteMeta, unlocked: UnlockedNote, doc: Y.Doc, opts: SessionOptions): NoteSession;
}

export interface SessionOptions {
  canEdit: boolean;
  onLocked(reason: 'password' | 'deleted' | 'expired'): void;
  onError(message: string, status?: number): void;
}

interface Ctx {
  mode: TemplateMode;
  templateId: string;
  me: () => PublicUser;
  room: RoomConnection | null;
  /** 개인 공간: 활동 기록 */
  record: (input: ActivityInput) => void;
  /** 개인 공간: 목록이 바뀌었을 때 */
  changed: () => void;
}

const meta = (n: LocalNote): SecretNoteMeta => ({
  id: n.id,
  title: n.title,
  hint: n.hint,
  createdBy: n.createdBy,
  createdAt: n.createdAt,
  updatedAt: n.updatedAt,
  kdf: n.kdf,
});

async function sealNew(noteId: string, password: string, state: Uint8Array) {
  const kdf = newKdf();
  const keys = await deriveNoteKeys(password, kdf);
  return { kdf, keys, verifierHash: await sha256Hex(keys.verifier), snapshot: await encryptBytes(keys.key, state, noteId) };
}

const emptyState = () => Y.encodeStateAsUpdate(new Y.Doc());

export function createNotesApi(ctx: Ctx): NotesApi {
  return ctx.mode === 'shared' ? sharedApi(ctx) : localApi(ctx);
}

/* ───────────── 개인 공간 ───────────── */

function localApi(ctx: Ctx): NotesApi {
  const attempts = new Map<string, { fails: number; lockedUntil: number }>();

  const verify = async (note: SecretNoteMeta, password: string): Promise<{ row: LocalNote; keys: NoteKeys }> => {
    const row = await idbGet<LocalNote>('notes', note.id);
    if (!row) throw new ApiError(404, '비밀 노트를 찾을 수 없습니다.');
    const a = attempts.get(note.id) ?? { fails: 0, lockedUntil: 0 };
    const now = Date.now();
    if (a.lockedUntil > now) {
      const retryAfter = Math.ceil((a.lockedUntil - now) / 1000);
      throw new ApiError(429, `비밀번호를 여러 번 틀려 잠시 잠겼습니다. ${retryAfter}초 후 다시 시도하세요.`, { retryAfter });
    }
    const keys = await deriveNoteKeys(password, row.kdf);
    if ((await sha256Hex(keys.verifier)) !== row.verifierHash) {
      a.fails += 1;
      ctx.record({ type: 'notes.unlock_fail', targetId: note.id, targetName: note.title });
      if (a.fails >= LOCAL_MAX_ATTEMPTS) {
        attempts.set(note.id, { fails: 0, lockedUntil: now + LOCAL_LOCKOUT_MS });
        throw new ApiError(429, `비밀번호를 여러 번 틀려 잠시 잠겼습니다. ${LOCAL_LOCKOUT_MS / 1000}초 후 다시 시도하세요.`, { retryAfter: LOCAL_LOCKOUT_MS / 1000 });
      }
      attempts.set(note.id, a);
      throw new ApiError(401, `비밀번호가 올바르지 않습니다. (남은 시도 ${LOCAL_MAX_ATTEMPTS - a.fails}회)`);
    }
    attempts.delete(note.id);
    return { row, keys };
  };

  return {
    list: async () => (await listLocalNotes(ctx.templateId)).map(meta).sort((a, b) => a.createdAt - b.createdAt),

    create: async ({ title, hint, password }) => {
      const id = newId(16);
      const sealed = await sealNew(id, password, emptyState());
      const now = Date.now();
      const row: LocalNote = {
        id,
        templateId: ctx.templateId,
        title: title.trim().slice(0, 60),
        hint: hint.trim().slice(0, 80),
        createdBy: ctx.me(),
        createdAt: now,
        updatedAt: now,
        kdf: sealed.kdf,
        verifierHash: sealed.verifierHash,
        snapshot: sealed.snapshot,
      };
      await putLocalNote(row);
      ctx.record({ type: 'notes.create', targetId: id, targetName: row.title });
      ctx.changed();
      return { meta: meta(row), unlocked: { key: sealed.keys.key, ticket: null, expiresAt: now + UNLOCK_TTL_MS } };
    },

    unlock: async (note, password) => {
      const { keys } = await verify(note, password);
      ctx.record({ type: 'notes.unlock', targetId: note.id, targetName: note.title });
      return { key: keys.key, ticket: null, expiresAt: Date.now() + UNLOCK_TTL_MS };
    },

    changePassword: async (note, current, next, hint, doc) => {
      const { row } = await verify(note, current);
      const sealed = await sealNew(note.id, next, Y.encodeStateAsUpdate(doc));
      await putLocalNote({ ...row, hint: hint.trim().slice(0, 80), kdf: sealed.kdf, verifierHash: sealed.verifierHash, snapshot: sealed.snapshot, updatedAt: Date.now() });
      ctx.record({ type: 'notes.password', targetId: note.id, targetName: note.title });
      ctx.changed();
      return { key: sealed.keys.key, ticket: null, expiresAt: Date.now() + UNLOCK_TTL_MS };
    },

    remove: async (note, password, force) => {
      if (!force) await verify(note, password ?? '');
      await deleteLocalNote(note.id);
      ctx.record({ type: 'notes.delete', targetId: note.id, targetName: note.title });
      ctx.changed();
    },

    open: (note, unlocked, doc) => new LocalNoteSession(note.id, unlocked.key, doc),
  };
}

class LocalNoteSession implements NoteSession {
  readonly awareness: Awareness;
  status: NoteSession['status'] = 'loading';
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private destroyed = false;

  constructor(
    private noteId: string,
    private key: CryptoKey,
    private doc: Y.Doc,
  ) {
    this.awareness = new Awareness(doc);
    void this.load();
  }

  private async load() {
    try {
      const row = await idbGet<LocalNote>('notes', this.noteId);
      if (!row) throw new Error('missing');
      Y.applyUpdate(this.doc, await decryptBytes(this.key, row.snapshot, this.noteId), this);
      if (this.destroyed) return;
      this.doc.on('update', this.onUpdate);
      this.status = 'ready';
    } catch {
      this.status = 'error';
    }
    this.notify();
  }

  private onUpdate = (_u: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), 600);
  };

  private async save() {
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    const row = await idbGet<LocalNote>('notes', this.noteId);
    if (!row) return;
    const snapshot = await encryptBytes(this.key, Y.encodeStateAsUpdate(this.doc), this.noteId);
    await putLocalNote({ ...row, snapshot, updatedAt: Date.now() });
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }

  destroy() {
    this.destroyed = true;
    this.doc.off('update', this.onUpdate);
    if (this.timer) clearTimeout(this.timer);
    void this.save();
    this.awareness.destroy();
    this.listeners.clear();
  }
}

/* ───────────── 협업 공간 ───────────── */

function sharedApi(ctx: Ctx): NotesApi {
  const base = `/templates/${ctx.templateId}/notes`;
  const ticketFor = async (noteId: string, verifier: string): Promise<UnlockedNote & { ticket: string }> => {
    const res = await api<UnlockResult>('POST', `${base}/${noteId}/unlock`, { verifier });
    return { key: null as unknown as CryptoKey, ticket: res.ticket, expiresAt: res.expiresAt };
  };

  return {
    list: async () => (await api<{ notes: SecretNoteMeta[] }>('GET', base)).notes,

    create: async ({ title, hint, password }) => {
      const id = newId(16);
      const sealed = await sealNew(id, password, emptyState());
      const res = await api<{ note: SecretNoteMeta }>('POST', base, { id, title, hint, kdf: sealed.kdf, verifierHash: sealed.verifierHash, snapshot: sealed.snapshot });
      const t = await ticketFor(id, sealed.keys.verifier);
      return { meta: res.note, unlocked: { ...t, key: sealed.keys.key } };
    },

    unlock: async (note, password) => {
      const keys = await deriveNoteKeys(password, note.kdf);
      const t = await ticketFor(note.id, keys.verifier);
      return { ...t, key: keys.key };
    },

    changePassword: async (note, current, next, hint, doc) => {
      const old = await deriveNoteKeys(current, note.kdf);
      const sealed = await sealNew(note.id, next, Y.encodeStateAsUpdate(doc));
      await api('POST', `${base}/${note.id}/password`, {
        verifier: old.verifier,
        next: { kdf: sealed.kdf, verifierHash: sealed.verifierHash, snapshot: sealed.snapshot, hint },
      });
      const t = await ticketFor(note.id, sealed.keys.verifier);
      return { ...t, key: sealed.keys.key };
    },

    remove: async (note, password, force) => {
      const verifier = force ? undefined : (await deriveNoteKeys(password ?? '', note.kdf)).verifier;
      await api('POST', `${base}/${note.id}/delete`, { verifier, force });
    },

    open: (note, unlocked, doc, opts) => new SharedNoteSession(ctx.room!, note.id, unlocked, doc, opts),
  };
}

class SharedNoteSession implements NoteSession {
  readonly awareness: Awareness;
  status: NoteSession['status'] = 'loading';
  private listeners = new Set<() => void>();
  private offs: (() => void)[] = [];
  /** 들어오는 변경을 도착 순서대로 적용하기 위한 작업 줄 (복호화가 비동기라서) */
  private chain: Promise<void> = Promise.resolve();
  private lastUid = 0;
  private sinceSnapshot = 0;
  private joined = false;
  private unsent: Uint8Array[] = [];
  private outTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(
    private room: RoomConnection,
    private noteId: string,
    private unlocked: UnlockedNote,
    private doc: Y.Doc,
    private opts: SessionOptions,
  ) {
    this.awareness = new Awareness(doc);
    doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwareness);
    this.offs.push(
      room.on('note:update', (m) => {
        if (m.noteId !== noteId) return;
        this.enqueue(async () => {
          Y.applyUpdate(doc, await this.decrypt(m.data), this);
          this.lastUid = Math.max(this.lastUid, m.uid);
          this.sinceSnapshot++;
        });
      }),
      room.on('note:aw', (m) => {
        if (m.noteId !== noteId) return;
        this.enqueue(async () => applyAwarenessUpdate(this.awareness, await this.decrypt(m.data), this));
      }),
      room.on('note:locked', (m) => m.noteId === noteId && opts.onLocked(m.reason)),
      room.onStatus((s) => {
        if (s === 'online') void this.join();
        else {
          this.joined = false;
          this.setStatus('offline');
        }
      }),
    );
    if (room.online) void this.join();
  }

  private enqueue(fn: () => Promise<void>) {
    this.chain = this.chain.then(fn).catch(() => undefined);
  }

  private decrypt(data: string) {
    return decryptBytes(this.unlocked.key, data, this.noteId);
  }

  private encrypt(bytes: Uint8Array) {
    return encryptBytes(this.unlocked.key, bytes, this.noteId);
  }

  private setStatus(s: NoteSession['status']) {
    this.status = s;
    for (const fn of this.listeners) fn();
  }

  private async join() {
    if (this.destroyed || !this.unlocked.ticket) return;
    const res = await this.room.request<NoteJoinData>({ t: 'note:join', noteId: this.noteId, ticket: this.unlocked.ticket });
    if (this.destroyed) return;
    if (!res.ok || !res.data) {
      if (res.status) {
        this.setStatus('error');
        this.opts.onError(res.error ?? '노트를 열 수 없습니다.', res.status);
      }
      return;
    }
    const data = res.data;
    this.enqueue(async () => {
      try {
        if (data.snapshot) Y.applyUpdate(this.doc, await this.decrypt(data.snapshot), this);
        for (const u of data.updates) {
          Y.applyUpdate(this.doc, await this.decrypt(u.data), this);
          this.lastUid = Math.max(this.lastUid, u.uid);
        }
      } catch {
        this.setStatus('error');
        this.opts.onError('노트를 복호화하지 못했습니다. 비밀번호가 바뀌었을 수 있습니다.');
        return;
      }
      this.sinceSnapshot = data.updates.length;
      this.joined = true;
      this.setStatus('ready');
      this.flush();
      if (this.awareness.getLocalState() !== null) void this.sendAwareness([this.doc.clientID]);
    });
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || !this.opts.canEdit) return;
    this.unsent.push(update);
    if (this.joined && !this.outTimer) this.outTimer = setTimeout(() => this.flush(), 80);
  };

  private flush() {
    if (this.outTimer) clearTimeout(this.outTimer);
    this.outTimer = null;
    if (!this.joined || !this.unsent.length) return;
    const merged = Y.mergeUpdates(this.unsent);
    this.unsent = [];
    void (async () => {
      const res = await this.room.request<{ uid: number }>({ t: 'note:update', noteId: this.noteId, data: await this.encrypt(merged) });
      if (!res.ok) {
        // 다시 연결되면 함께 보낸다
        this.unsent.unshift(merged);
        return;
      }
      this.enqueue(async () => {
        this.lastUid = Math.max(this.lastUid, res.data!.uid);
        if (++this.sinceSnapshot >= SNAPSHOT_EVERY) await this.snapshot();
      });
    })();
  }

  /** 지금까지의 변경을 하나의 암호화된 스냅샷으로 합쳐 서버의 변경 기록을 줄인다 */
  private async snapshot() {
    const upto = this.lastUid;
    const data = await this.encrypt(Y.encodeStateAsUpdate(this.doc));
    const res = await this.room.request({ t: 'note:snapshot', noteId: this.noteId, data, upto });
    if (res.ok) this.sinceSnapshot = 0;
  }

  private onAwareness = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    // 처음 보는 사람이 들어오면 내 커서도 알려 준다
    if (origin === this) {
      if (added.length) void this.sendAwareness([this.doc.clientID]);
      return;
    }
    void this.sendAwareness(added.concat(updated, removed));
  };

  private async sendAwareness(clients: number[]) {
    if (!this.joined) return;
    this.room.send({ t: 'note:aw', noteId: this.noteId, data: await this.encrypt(encodeAwarenessUpdate(this.awareness, clients)) });
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  destroy() {
    if (this.destroyed) return;
    this.flush();
    if (this.joined && this.opts.canEdit && this.sinceSnapshot > 0) this.enqueue(() => this.snapshot());
    this.destroyed = true;
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwareness);
    for (const off of this.offs) off();
    if (this.joined) {
      removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy');
      const removal = encodeAwarenessUpdate(this.awareness, [this.doc.clientID]);
      const room = this.room;
      const noteId = this.noteId;
      this.enqueue(async () => {
        room.send({ t: 'note:aw', noteId, data: await this.encrypt(removal) });
        room.send({ t: 'note:leave', noteId });
      });
    }
    this.awareness.destroy();
    this.listeners.clear();
  }
}
