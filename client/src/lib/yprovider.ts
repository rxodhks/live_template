import * as Y from 'yjs';
import type { Socket } from 'socket.io-client';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { useConnection } from '../store/connection';

/*
 * Socket.IO 위에서 동작하는 Yjs 프로바이더.
 *  1) 접속 시 내 상태 벡터를 보내고 서버에 없는 부분만 주고받는다 (오프라인 편집 자동 병합)
 *  2) 이후 로컬 변경을 즉시 전송하고, 서버 확인(ack)을 기준으로 "저장됨" 상태를 표시한다
 *  3) awareness(텍스트 커서/선택 영역)를 같은 방 사용자와 공유한다
 */

export type ProviderStatus = 'connecting' | 'synced' | 'offline' | 'error';

interface ProviderOptions {
  ticket?: string;
  /** 서버와 동기화하기 전에 기다릴 작업 (예: IndexedDB 로드) */
  whenReady?: Promise<unknown>;
  onKicked?: (reason: string) => void;
  onError?: (error: string, status?: number) => void;
}

interface JoinResponse {
  ok: boolean;
  error?: string;
  status?: number;
  update: ArrayBuffer;
  sv: ArrayBuffer;
  readOnly: boolean;
  awareness: ArrayBuffer | null;
}

export class SocketYProvider {
  readonly awareness: Awareness;
  status: ProviderStatus = 'connecting';
  readOnly = false;
  error: string | null = null;
  private listeners = new Set<() => void>();
  private destroyed = false;
  private hasOfflineChanges = false;
  private ready = false;

  constructor(
    private readonly socket: Socket,
    readonly name: string,
    readonly doc: Y.Doc,
    private readonly opts: ProviderOptions = {},
  ) {
    this.awareness = new Awareness(doc);
    doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
    socket.on('doc:update', this.onRemoteUpdate);
    socket.on('doc:awareness', this.onRemoteAwareness);
    socket.on('doc:kicked', this.onKicked);
    socket.on('connect', this.join);
    socket.on('disconnect', this.onDisconnect);
    void Promise.resolve(opts.whenReady)
      .catch(() => undefined)
      .then(() => {
        this.ready = true;
        if (!this.destroyed && socket.connected) this.join();
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

  private join = () => {
    if (this.destroyed || !this.ready) return;
    this.setStatus('connecting');
    const sv = Y.encodeStateVector(this.doc);
    this.socket
      .timeout(15000)
      .emit('doc:join', { name: this.name, sv, ticket: this.opts.ticket }, (err: Error | null, res: JoinResponse) => {
        if (this.destroyed) return;
        if (err || !res?.ok) {
          this.error = err ? '서버 응답이 없습니다.' : res.error ?? '문서를 열 수 없습니다.';
          this.setStatus('error');
          this.opts.onError?.(this.error, res?.status);
          return;
        }
        this.readOnly = res.readOnly;
        Y.applyUpdate(this.doc, new Uint8Array(res.update), this);
        // 서버에 없는 로컬 변경(오프라인 편집 등)을 올린다
        if (!this.readOnly) {
          const diff = Y.encodeStateAsUpdate(this.doc, new Uint8Array(res.sv));
          if (hasChanges(diff)) this.send(diff);
        }
        if (res.awareness) applyAwarenessUpdate(this.awareness, new Uint8Array(res.awareness), this);
        if (this.awareness.getLocalState() !== null) this.sendAwareness([this.doc.clientID]);
        this.hasOfflineChanges = false;
        useConnection.getState().setOfflineChanges(false);
        this.error = null;
        this.setStatus('synced');
      });
  };

  private send(update: Uint8Array) {
    const conn = useConnection.getState();
    conn.addPending(1);
    this.socket.timeout(15000).emit('doc:update', { name: this.name, update }, (err: Error | null, res: { ok: boolean; error?: string }) => {
      const c = useConnection.getState();
      c.addPending(-1);
      if (err || !res?.ok) {
        c.setSaveError(res?.error ?? '저장 확인이 지연되고 있습니다.');
        // 다시 접속하며 상태 벡터로 차이를 재전송한다
        if (!this.destroyed && this.socket.connected) this.join();
        return;
      }
      c.markSaved();
    });
  }

  private sendAwareness(clients: number[]) {
    if (!this.socket.connected || this.status !== 'synced') return;
    this.socket.emit('doc:awareness', { name: this.name, update: encodeAwarenessUpdate(this.awareness, clients) });
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || this.readOnly) return;
    if (!this.socket.connected || this.status !== 'synced') {
      // 재접속 시 상태 벡터 비교로 한꺼번에 전송된다
      if (!this.hasOfflineChanges) {
        this.hasOfflineChanges = true;
        useConnection.getState().setOfflineChanges(true);
      }
      return;
    }
    this.send(update);
  };

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === this) return;
    this.sendAwareness(added.concat(updated, removed));
  };

  private onRemoteUpdate = (p: { name: string; update: ArrayBuffer }) => {
    if (p.name !== this.name) return;
    Y.applyUpdate(this.doc, new Uint8Array(p.update), this);
  };

  private onRemoteAwareness = (p: { name: string; update: ArrayBuffer }) => {
    if (p.name !== this.name) return;
    applyAwarenessUpdate(this.awareness, new Uint8Array(p.update), this);
  };

  private onKicked = (p: { name: string; reason: string }) => {
    if (p.name !== this.name) return;
    this.opts.onKicked?.(p.reason);
  };

  private onDisconnect = () => {
    // 다른 사람들의 커서는 끊긴 동안 의미가 없으므로 지운다
    const others = Array.from(this.awareness.getStates().keys()).filter((id) => id !== this.doc.clientID);
    removeAwarenessStates(this.awareness, others, this);
    this.setStatus('offline');
  };

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    this.socket.off('doc:update', this.onRemoteUpdate);
    this.socket.off('doc:awareness', this.onRemoteAwareness);
    this.socket.off('doc:kicked', this.onKicked);
    this.socket.off('connect', this.join);
    this.socket.off('disconnect', this.onDisconnect);
    if (this.socket.connected) this.socket.emit('doc:leave', { name: this.name });
    this.awareness.destroy();
    this.listeners.clear();
  }
}

/** 빈 업데이트(구조체/삭제 집합 모두 없음)는 전송할 필요가 없다 */
function hasChanges(update: Uint8Array): boolean {
  return update.length > 2;
}
