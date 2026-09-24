import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import { config } from './config.js';
import { DebouncedWriter, binaryWriter, dataPath, readBinary, removeFile, writeBinarySync } from './store.js';
import { readNoteState, writeNoteState } from './secrets.js';

/*
 * Yjs 문서 관리자
 *  - "tpl:<templateId>"             템플릿 본문 (디자인/코드/문서)
 *  - "note:<templateId>:<noteId>"   비밀 노트 (암호화 저장, 키는 메모리에만)
 * 문서는 사용 중일 때만 메모리에 올리고, 변경은 debounce 되어 자동 저장된다.
 */

export type DocKind = 'template' | 'note';

export interface DocEntry {
  name: string;
  kind: DocKind;
  templateId: string;
  noteId?: string;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  /** socketId → 해당 소켓이 소유한 awareness clientID 목록 */
  sockets: Map<string, Set<number>>;
  writer: DebouncedWriter;
  key?: Buffer;
  unloadTimer?: NodeJS.Timeout;
}

export interface DocHooks {
  /** 문서 업데이트를 방 안의 다른 소켓에게 전달 */
  broadcastUpdate(entry: DocEntry, update: Uint8Array, originSocketId: string | null): void;
  broadcastAwareness(entry: DocEntry, update: Uint8Array, originSocketId: string | null): void;
  /** 템플릿 문서가 변경됨 (마지막 수정 시각 갱신 등) */
  onTemplateChanged(templateId: string): void;
}

export function parseDocName(name: unknown): { kind: DocKind; templateId: string; noteId?: string } | null {
  if (typeof name !== 'string') return null;
  const parts = name.split(':');
  if (parts[0] === 'tpl' && parts.length === 2 && parts[1]) return { kind: 'template', templateId: parts[1] };
  if (parts[0] === 'note' && parts.length === 3 && parts[1] && parts[2])
    return { kind: 'note', templateId: parts[1], noteId: parts[2] };
  return null;
}

const templateDocFile = (templateId: string) => dataPath('docs', `${templateId}.ybin`);

export class DocManager {
  private entries = new Map<string, DocEntry>();

  constructor(private hooks: DocHooks) {}

  get(name: string): DocEntry | undefined {
    return this.entries.get(name);
  }

  /** 문서를 메모리에 올린다. 비밀 노트는 key가 필요하다. */
  load(name: string, key?: Buffer): DocEntry {
    const existing = this.entries.get(name);
    if (existing) {
      if (existing.unloadTimer) clearTimeout(existing.unloadTimer);
      existing.unloadTimer = undefined;
      return existing;
    }
    const parsed = parseDocName(name);
    if (!parsed) throw new Error('잘못된 문서 이름');

    const doc = new Y.Doc({ gc: true });
    let writer: DebouncedWriter;
    const entry = { name, ...parsed, doc, sockets: new Map(), key } as DocEntry;

    if (parsed.kind === 'template') {
      const stored = readBinary(templateDocFile(parsed.templateId));
      if (stored) Y.applyUpdate(doc, stored, 'load');
      writer = binaryWriter(templateDocFile(parsed.templateId), () => Y.encodeStateAsUpdate(doc));
    } else {
      if (!key) throw new Error('비밀 노트 키가 없습니다');
      Y.applyUpdate(doc, readNoteState(parsed.templateId, parsed.noteId!, key), 'load');
      writer = new DebouncedWriter(
        async () => writeNoteState(parsed.templateId, parsed.noteId!, entry.key!, Y.encodeStateAsUpdate(doc)),
        () => writeNoteState(parsed.templateId, parsed.noteId!, entry.key!, Y.encodeStateAsUpdate(doc)),
      );
    }
    entry.writer = writer;

    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null); // 서버 자신은 awareness 상태를 갖지 않는다
    entry.awareness = awareness;

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'load') return;
      writer.schedule();
      const originSocket = typeof origin === 'string' ? origin : null;
      this.hooks.broadcastUpdate(entry, update, originSocket);
      if (entry.kind === 'template') this.hooks.onTemplateChanged(entry.templateId);
    });

    awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const changed = added.concat(updated, removed);
        if (typeof origin === 'string') {
          const owned = entry.sockets.get(origin);
          if (owned) {
            for (const id of added.concat(updated)) owned.add(id);
            for (const id of removed) owned.delete(id);
          }
        }
        const update = awarenessProtocol.encodeAwarenessUpdate(awareness, changed);
        this.hooks.broadcastAwareness(entry, update, typeof origin === 'string' ? origin : null);
      },
    );

    this.entries.set(name, entry);
    return entry;
  }

  addSocket(entry: DocEntry, socketId: string): void {
    if (!entry.sockets.has(socketId)) entry.sockets.set(socketId, new Set());
    if (entry.unloadTimer) clearTimeout(entry.unloadTimer);
    entry.unloadTimer = undefined;
  }

  removeSocket(name: string, socketId: string): void {
    const entry = this.entries.get(name);
    if (!entry) return;
    const owned = entry.sockets.get(socketId);
    entry.sockets.delete(socketId);
    if (owned && owned.size > 0) {
      awarenessProtocol.removeAwarenessStates(entry.awareness, Array.from(owned), 'server');
    }
    if (entry.sockets.size === 0) this.scheduleUnload(entry);
  }

  private scheduleUnload(entry: DocEntry): void {
    if (entry.unloadTimer) clearTimeout(entry.unloadTimer);
    // 비밀 노트는 키를 메모리에서 빨리 지우기 위해 곧바로 내린다
    const delay = entry.kind === 'note' ? 1500 : config.docIdleUnloadMs;
    entry.unloadTimer = setTimeout(() => void this.unload(entry.name), delay);
    entry.unloadTimer.unref();
  }

  async unload(name: string): Promise<void> {
    const entry = this.entries.get(name);
    if (!entry || entry.sockets.size > 0) return;
    await entry.writer.flush();
    if (entry.sockets.size > 0) return; // 저장하는 사이 누군가 다시 들어옴
    this.entries.delete(name);
    entry.awareness.destroy();
    entry.doc.destroy();
    entry.key = undefined;
  }

  /** 비밀번호가 바뀌면 이후 저장은 새 키로 암호화 */
  rekeyNote(templateId: string, noteId: string, key: Buffer): void {
    const entry = this.entries.get(`note:${templateId}:${noteId}`);
    if (entry) {
      entry.key = key;
      entry.writer.schedule();
    }
  }

  /** 문서를 저장 없이 즉시 폐기 (삭제된 템플릿/노트) */
  discard(name: string): void {
    const entry = this.entries.get(name);
    if (!entry) return;
    if (entry.unloadTimer) clearTimeout(entry.unloadTimer);
    this.entries.delete(name);
    entry.awareness.destroy();
    entry.doc.destroy();
    entry.key = undefined;
  }

  entriesForTemplate(templateId: string): DocEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.templateId === templateId);
  }

  /** 새 템플릿의 초기 문서를 기록 */
  static writeInitialTemplateDoc(templateId: string, build: (doc: Y.Doc) => void): void {
    const doc = new Y.Doc();
    build(doc);
    writeBinarySync(templateDocFile(templateId), Y.encodeStateAsUpdate(doc));
    doc.destroy();
  }

  static removeTemplateDoc(templateId: string): void {
    removeFile(templateDocFile(templateId));
  }

  async flushAll(): Promise<void> {
    await Promise.all(Array.from(this.entries.values()).map((e) => e.writer.flush()));
  }

  flushAllSync(): void {
    for (const e of this.entries.values()) e.writer.flushSync();
  }
}
