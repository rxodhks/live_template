import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { useConnection } from '../store/connection';
import type { RoomConnection, RoomStatus } from './room';
import { fromB64, toB64 } from './crypto';

/*
 * 템플릿 문서(Y.Doc)를 어디와 동기화할지
 *  · LocalProvider : 개인 공간 — 브라우저(IndexedDB)에만 저장. 서버 없음
 *  · RoomProvider  : 협업 공간 — 클라우드플레어 방과 실시간 동기화
 *      1) 접속할 때마다 상태 벡터를 교환해 서로 없는 부분만 주고받는다 (오프라인 편집 자동 병합)
 *      2) 로컬 변경은 짧게 모아 한 번에 보낸다 (요청 수 절약) · 서버 확인(ack)으로 "저장됨" 표시
 *      3) awareness(텍스트 커서/선택 영역)를 같은 방 사람들과 공유
 */

export type ProviderStatus = 'connecting' | 'synced' | 'offline' | 'error';

export interface DocProvider {
  readonly awareness: Awareness;
  readonly status: ProviderStatus;
  readonly readOnly: boolean;
  readonly synced: boolean;
  subscribe(fn: () => void): () => void;
  destroy(): void;
}

export class LocalProvider implements DocProvider {
  readonly awareness: Awareness;
  readonly status = 'synced' as const;
  readonly readOnly = false;
  readonly synced = true;

  constructor(doc: Y.Doc) {
    this.awareness = new Awareness(doc);
  }

  subscribe(): () => void {
    return () => {};
  }

  destroy(): void {
    this.awareness.destroy();
  }
}

/** 변경을 이 시간 동안 모아서 보낸다 */
const BATCH_MS = 60;

export class RoomProvider implements DocProvider {
  readonly awareness: Awareness;
  status: ProviderStatus = 'connecting';
  readOnly: boolean;
  private listeners = new Set<() => void>();
  private offs: (() => void)[] = [];
  private destroyed = false;
  private ready = false;
  private outbox: Uint8Array[] = [];
  private outboxTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly room: RoomConnection,
    readonly doc: Y.Doc,
    opts: { whenReady?: Promise<unknown> } = {},
  ) {
    this.awareness = new Awareness(doc);
    this.readOnly = room.role === 'viewer';
    doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
    this.offs.push(
      room.onStatus(this.onRoomStatus),
      room.on('update', (m) => Y.applyUpdate(doc, fromB64(m.u), this)),
      room.on('aw', (m) => applyAwarenessUpdate(this.awareness, fromB64(m.u), this)),
      room.on('aw:query', () => this.sendAwareness([doc.clientID])),
      room.on('presence:leave', (m) => m.clients.length && removeAwarenessStates(this.awareness, m.clients, this)),
      room.on('role', (m) => {
        this.readOnly = m.role === 'viewer';
        this.notify();
      }),
    );
    void Promise.resolve(opts.whenReady)
      .catch(() => undefined)
      .then(() => {
        this.ready = true;
        if (!this.destroyed && room.online) void this.sync();
      });
  }

  get synced(): boolean {
    return this.status === 'synced';
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }

  private setStatus(status: ProviderStatus) {
    this.status = status;
    this.notify();
  }

  private onRoomStatus = (s: RoomStatus) => {
    if (s === 'online') {
      if (this.ready) void this.sync();
    } else {
      // 끊긴 동안 다른 사람들의 텍스트 커서는 의미가 없으므로 지운다
      const others = Array.from(this.awareness.getStates().keys()).filter((id) => id !== this.doc.clientID);
      removeAwarenessStates(this.awareness, others, this);
      this.setStatus(s === 'denied' ? 'error' : 'offline');
    }
  };

  private async sync() {
    if (this.destroyed) return;
    this.setStatus('connecting');
    const res = await this.room.request<{ update: string; sv: string; readOnly: boolean }>({ t: 'sync', sv: toB64(Y.encodeStateVector(this.doc)) });
    if (this.destroyed) return;
    if (!res.ok || !res.data) {
      this.setStatus(this.room.online ? 'error' : 'offline');
      return;
    }
    this.readOnly = res.data.readOnly;
    Y.applyUpdate(this.doc, fromB64(res.data.update), this);
    // 서버에 없는 로컬 변경(오프라인 편집 등)을 올린다
    if (!this.readOnly) {
      const diff = Y.encodeStateAsUpdate(this.doc, fromB64(res.data.sv));
      if (diff.length > 2) this.queue(diff);
    }
    this.outboxFlush();
    if (this.awareness.getLocalState() !== null) this.sendAwareness([this.doc.clientID]);
    useConnection.getState().setOfflineChanges(false);
    this.setStatus('synced');
  }

  private queue(update: Uint8Array) {
    this.outbox.push(update);
    if (!this.outboxTimer) this.outboxTimer = setTimeout(() => this.outboxFlush(), BATCH_MS);
  }

  private outboxFlush() {
    if (this.outboxTimer) clearTimeout(this.outboxTimer);
    this.outboxTimer = null;
    if (!this.outbox.length || !this.room.online) return;
    const merged = this.outbox.length === 1 ? this.outbox[0] : Y.mergeUpdates(this.outbox);
    this.outbox = [];
    const conn = useConnection.getState();
    conn.addPending(1);
    void this.room.request({ t: 'update', u: toB64(merged) }).then((res) => {
      const c = useConnection.getState();
      c.addPending(-1);
      if (res.ok) return c.markSaved();
      if (res.status === 403) {
        this.readOnly = true;
        this.notify();
        return c.setSaveError('읽기 전용 권한이라 저장되지 않았습니다.');
      }
      c.setSaveError(res.error ?? '저장 확인이 지연되고 있습니다.');
      // 다시 접속하면 상태 벡터 비교로 빠진 부분이 자동으로 다시 전송된다
      if (this.room.online) void this.sync();
    });
  }

  private sendAwareness(clients: number[]) {
    if (this.status !== 'synced' && this.status !== 'connecting') return;
    this.room.send({ t: 'aw', u: toB64(encodeAwarenessUpdate(this.awareness, clients)) });
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || this.readOnly) return;
    if (this.status !== 'synced') {
      useConnection.getState().setOfflineChanges(true);
      return;
    }
    this.queue(update);
  };

  private onAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === this) return;
    this.sendAwareness(added.concat(updated, removed));
  };

  destroy(): void {
    if (this.destroyed) return;
    this.outboxFlush();
    this.destroyed = true;
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    for (const off of this.offs) off();
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy');
    this.room.send({ t: 'aw', u: toB64(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])) });
    this.awareness.destroy();
    this.listeners.clear();
  }
}
