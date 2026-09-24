import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import * as Y from 'yjs';
import type { PublicUser, SecretNoteMeta, UnlockResult } from '../../shared/types.js';
import { config } from './config.js';
import { getUser, toPublicUser } from './db.js';
import { JsonFile, dataPath } from './store.js';
import { HttpError, clampText, newId } from './util.js';

/*
 * 비밀 노트
 * ─────────
 * · 비밀번호는 저장하지 않는다. scrypt로 두 개의 값을 유도한다.
 *     verifier = scrypt(pw, verifierSalt)  → 비밀번호 확인용 (저장)
 *     key      = scrypt(pw, salt)          → AES-256-GCM 암호화 키 (저장하지 않음)
 * · 노트 본문(Y.Doc 상태)은 key로 암호화되어 디스크에 저장된다.
 *   서버 디스크만으로는 내용을 복호화할 수 없다.
 * · 잠금 해제에 성공하면 짧은 수명의 "티켓"을 발급하고, 키는 티켓과 함께 메모리에만 보관한다.
 * · 연속 실패 시 일정 시간 잠금 (무차별 대입 방지).
 */

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const KDF = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

interface NoteRecord {
  id: string;
  title: string;
  hint: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  salt: string;
  verifierSalt: string;
  verifier: string;
  iv: string;
  tag: string;
  data: string;
}

interface NotesFile {
  notes: NoteRecord[];
}

const files = new Map<string, JsonFile<NotesFile>>();

function fileFor(templateId: string): JsonFile<NotesFile> {
  let f = files.get(templateId);
  if (!f) {
    f = new JsonFile<NotesFile>(dataPath('notes', `${templateId}.json`), () => ({ notes: [] }));
    files.set(templateId, f);
  }
  return f;
}

function findNote(templateId: string, noteId: string): NoteRecord {
  const note = fileFor(templateId).data.notes.find((n) => n.id === noteId);
  if (!note) throw new HttpError(404, '비밀 노트를 찾을 수 없습니다.');
  return note;
}

function toMeta(n: NoteRecord): SecretNoteMeta {
  const u = getUser(n.createdBy);
  const createdBy: PublicUser = u ? toPublicUser(u) : { id: n.createdBy, name: '알 수 없음', color: '#888888', avatar: '❔' };
  return { id: n.id, title: n.title, hint: n.hint, createdBy, createdAt: n.createdAt, updatedAt: n.updatedAt };
}

function validatePassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 4) throw new HttpError(400, '비밀번호는 4자 이상이어야 합니다.');
  if (pw.length > 128) throw new HttpError(400, '비밀번호가 너무 깁니다.');
  return pw;
}

async function deriveKeys(pw: string, salt: Buffer, verifierSalt: Buffer) {
  const [key, verifier] = await Promise.all([scrypt(pw, salt, 32, KDF), scrypt(pw, verifierSalt, 32, KDF)]);
  return { key, verifier };
}

function encrypt(key: Buffer, plain: Uint8Array) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}

function decrypt(key: Buffer, n: Pick<NoteRecord, 'iv' | 'tag' | 'data'>): Uint8Array {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(n.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(n.tag, 'base64'));
  return new Uint8Array(Buffer.concat([decipher.update(Buffer.from(n.data, 'base64')), decipher.final()]));
}

/* ───────────── 공개 API ───────────── */

export function listNotes(templateId: string): SecretNoteMeta[] {
  return fileFor(templateId).data.notes.map(toMeta);
}

export function getNoteMeta(templateId: string, noteId: string): SecretNoteMeta {
  return toMeta(findNote(templateId, noteId));
}

export async function createNote(
  templateId: string,
  userId: string,
  input: { title?: unknown; password?: unknown; hint?: unknown },
): Promise<SecretNoteMeta> {
  const title = clampText(input.title, 60);
  if (!title) throw new HttpError(400, '노트 제목을 입력해 주세요.');
  const password = validatePassword(input.password);
  const hint = clampText(input.hint, 80);
  if (hint && hint.toLowerCase().includes(password.toLowerCase()))
    throw new HttpError(400, '힌트에 비밀번호를 포함할 수 없습니다.');

  const salt = randomBytes(16);
  const verifierSalt = randomBytes(16);
  const { key, verifier } = await deriveKeys(password, salt, verifierSalt);
  const empty = Y.encodeStateAsUpdate(new Y.Doc());
  const now = Date.now();
  const note: NoteRecord = {
    id: newId(),
    title,
    hint,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    salt: salt.toString('base64'),
    verifierSalt: verifierSalt.toString('base64'),
    verifier: verifier.toString('base64'),
    ...encrypt(key, empty),
  };
  const f = fileFor(templateId);
  f.data.notes.push(note);
  f.save();
  return toMeta(note);
}

/* 무차별 대입 방지 */
interface AttemptState {
  fails: number;
  lockedUntil: number;
}
const attempts = new Map<string, AttemptState>();

function checkLockout(k: string): void {
  const a = attempts.get(k);
  if (a && a.lockedUntil > Date.now()) {
    const retryAfter = Math.ceil((a.lockedUntil - Date.now()) / 1000);
    throw new HttpError(429, `비밀번호를 여러 번 틀려 잠시 잠겼습니다. ${retryAfter}초 후 다시 시도하세요.`, { retryAfter });
  }
}

async function verify(templateId: string, noteId: string, userId: string, password: unknown): Promise<Buffer> {
  const note = findNote(templateId, noteId);
  const k = `${userId}:${noteId}`;
  checkLockout(k);
  const pw = typeof password === 'string' ? password : '';
  const { key, verifier } = await deriveKeys(pw, Buffer.from(note.salt, 'base64'), Buffer.from(note.verifierSalt, 'base64'));
  const expected = Buffer.from(note.verifier, 'base64');
  if (!pw || !timingSafeEqual(verifier, expected)) {
    const a = attempts.get(k) ?? { fails: 0, lockedUntil: 0 };
    a.fails += 1;
    const remaining = config.secretMaxAttempts - a.fails;
    if (remaining <= 0) {
      a.fails = 0;
      a.lockedUntil = Date.now() + config.secretLockoutMs;
      attempts.set(k, a);
      checkLockout(k);
    }
    attempts.set(k, a);
    throw new HttpError(401, `비밀번호가 올바르지 않습니다. (남은 시도 ${remaining}회)`, { remaining });
  }
  attempts.delete(k);
  return key;
}

/* 잠금 해제 티켓 (메모리 전용) */
interface Ticket {
  userId: string;
  templateId: string;
  noteId: string;
  key: Buffer;
  expiresAt: number;
}
const tickets = new Map<string, Ticket>();

export async function unlockNote(templateId: string, noteId: string, userId: string, password: unknown): Promise<UnlockResult> {
  const key = await verify(templateId, noteId, userId, password);
  const ticket = newId(32);
  const expiresAt = Date.now() + config.secretTicketTtlMs;
  tickets.set(ticket, { userId, templateId, noteId, key, expiresAt });
  return { ticket, expiresAt };
}

export function useTicket(ticket: unknown, userId: string, templateId: string, noteId: string): Ticket {
  const t = typeof ticket === 'string' ? tickets.get(ticket) : undefined;
  if (!t || t.userId !== userId || t.templateId !== templateId || t.noteId !== noteId || t.expiresAt < Date.now()) {
    throw new HttpError(401, '잠금 해제가 만료되었습니다. 비밀번호를 다시 입력해 주세요.');
  }
  return t;
}

export function revokeTicket(ticket: unknown): void {
  if (typeof ticket === 'string') tickets.delete(ticket);
}

export function revokeNoteTickets(noteId: string): void {
  for (const [id, t] of tickets) if (t.noteId === noteId) tickets.delete(id);
}

/** 만료된 티켓 정리 후 만료된 티켓 목록을 돌려준다 */
export function sweepTickets(): Ticket[] {
  const now = Date.now();
  const expired: Ticket[] = [];
  for (const [id, t] of tickets) {
    if (t.expiresAt < now) {
      tickets.delete(id);
      expired.push(t);
    }
  }
  return expired;
}

export function readNoteState(templateId: string, noteId: string, key: Buffer): Uint8Array {
  try {
    return decrypt(key, findNote(templateId, noteId));
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(401, '노트를 복호화할 수 없습니다.');
  }
}

export function writeNoteState(templateId: string, noteId: string, key: Buffer, state: Uint8Array): void {
  const f = fileFor(templateId);
  const note = f.data.notes.find((n) => n.id === noteId);
  if (!note) return; // 삭제된 노트
  Object.assign(note, encrypt(key, state), { updatedAt: Date.now() });
  f.save();
}

export async function changeNotePassword(
  templateId: string,
  noteId: string,
  userId: string,
  input: { current?: unknown; next?: unknown; hint?: unknown },
): Promise<{ meta: SecretNoteMeta; key: Buffer }> {
  const oldKey = await verify(templateId, noteId, userId, input.current);
  const next = validatePassword(input.next);
  const note = findNote(templateId, noteId);
  const plain = decrypt(oldKey, note);
  const salt = randomBytes(16);
  const verifierSalt = randomBytes(16);
  const { key, verifier } = await deriveKeys(next, salt, verifierSalt);
  const hint = input.hint !== undefined ? clampText(input.hint, 80) : note.hint;
  if (hint && hint.toLowerCase().includes(next.toLowerCase())) throw new HttpError(400, '힌트에 비밀번호를 포함할 수 없습니다.');
  Object.assign(note, {
    salt: salt.toString('base64'),
    verifierSalt: verifierSalt.toString('base64'),
    verifier: verifier.toString('base64'),
    hint,
    updatedAt: Date.now(),
    ...encrypt(key, plain),
  });
  fileFor(templateId).save();
  revokeNoteTickets(noteId);
  return { meta: toMeta(note), key };
}

/** 소유자는 비밀번호 없이 삭제 가능, 그 외에는 비밀번호 확인 */
export async function deleteNote(
  templateId: string,
  noteId: string,
  userId: string,
  opts: { password?: unknown; force?: boolean },
): Promise<SecretNoteMeta> {
  const note = findNote(templateId, noteId);
  if (!opts.force) await verify(templateId, noteId, userId, opts.password);
  const f = fileFor(templateId);
  f.data.notes = f.data.notes.filter((n) => n.id !== noteId);
  f.save();
  revokeNoteTickets(noteId);
  return toMeta(note);
}

export function deleteAllNotes(templateId: string): void {
  for (const n of fileFor(templateId).data.notes) revokeNoteTickets(n.id);
  fileFor(templateId).delete();
  files.delete(templateId);
}
