import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import { useConnection } from '../store/connection';
import type { AckResult, RoomConnection, RoomStatus } from './room';
import { fromB64, toB64 } from './crypto';

/*
 * 템플릿 문서(Y.Doc)를 어디와 동기화할지
 *  · LocalProvider : 개인 공간 — 브라우저(IndexedDB)에만 저장. 서버 없음
 *  · RoomProvider  : 협업 공간 — 클라우드플레어 방과 실시간 동기화
 *      1) 접속할 때마다 상태 벡터를 교환해 서로 없는 부분만 주고받는다 (오프라인 편집 자동 병합)
 *      2) 로컬 변경은 짧게 모아 한 번에 보낸다 (요청 수 절약) · 서버 확인(ack)으로 "저장됨" 표시
 *      3) awareness(텍스트 커서/선택 영역)는 보는 사람이 있을 때만, 문서 변경과 같은 메시지에 실어 보낸다
 */

export type ProviderStatus = 'connecting' | 'synced' | 'offline' | 'error';

export interface DocProvider {
  readonly awareness: Awareness;
  readonly status: ProviderStatus;
  readonly readOnly: boolean;
  readonly synced: boolean;
  /** 템플릿이 저장 한도(MAX_DOC_BYTES)에 닿아 서버가 변경을 받지 않는 상태 */
  readonly tooLarge?: boolean;
  subscribe(fn: () => void): () => void;
  /** 연속 동작(도형 끌기 등) 중에는 더 자주 동기화 */
  setLive?(on: boolean): void;
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

/*
 * 전송 묶음 간격 — 다른 사람 화면에서 부드럽게 보이는 선에서 메시지 수를 줄인다
 *  · 혼자일 때: 보는 사람이 없으니 1초씩 모아 저장만 (브라우저 사본에는 즉시 기록됨)
 *  · 함께일 때: 150ms — 글자는 1~2자 단위로 자연스럽게 나타나고, 한글 조합 중 생기는 여러 변경이 한 번에 합쳐진다
 *  · 도형을 끄는 중: 50ms — 움직임이 끊겨 보이지 않도록
 */
const ALONE_MS = 1000;
const SHARED_MS = 150;
const LIVE_MS = 50;
/** 문서 변경 메시지 하나의 최대 크기 (base64로 늘어나도 서버 한도 4MB 안) */
const MAX_MESSAGE_BYTES = 2_500_000;

export class RoomProvider implements DocProvider {
  readonly awareness: Awareness;
  status: ProviderStatus = 'connecting';
  readOnly: boolean;
  tooLarge = false;
  private listeners = new Set<() => void>();
  private offs: (() => void)[] = [];
  private destroyed = false;
  private ready = false;
  private outbox: Uint8Array[] = [];
  /** 보내야 할 텍스트 커서(awareness) 변경 */
  private awDirty = new Set<number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dueAt = 0;
  private live = false;

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
      room.onAudience((n) => {
        // 누군가 들어오면 모아 둔 변경과 내 텍스트 커서를 바로 보낸다
        if (n > 0) {
          this.awDirty.add(doc.clientID);
          this.flush();
        }
      }),
      room.on('update', (m) => {
        Y.applyUpdate(doc, fromB64(m.u), this);
        if (m.aw) applyAwarenessUpdate(this.awareness, fromB64(m.aw), this);
      }),
      room.on('aw', (m) => applyAwarenessUpdate(this.awareness, fromB64(m.u), this)),
      room.on('aw:query', () => {
        this.awDirty.add(doc.clientID);
        this.flush();
      }),
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

  /** 도형을 끄는 동안처럼 움직임이 연속적일 때 더 자주 보낸다 */
  setLive(on: boolean): void {
    this.live = on;
    if (!on && this.outbox.length) this.flush();
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
    const serverUpdate = fromB64(res.data.update);
    Y.applyUpdate(this.doc, serverUpdate, this);
    // 서버에 없는 로컬 변경(오프라인 편집 등)을 올린다
    if (!this.readOnly) {
      const diff = Y.encodeStateAsUpdate(this.doc, fromB64(res.data.sv));
      if (diff.length > 2 && hasLocalOnlyChanges(diff, serverUpdate)) this.enqueue(diff);
    }
    if (this.awareness.getLocalState() !== null) this.awDirty.add(this.doc.clientID);
    useConnection.getState().setOfflineChanges(false);
    this.setStatus('synced');
    this.flush();
  }

  /** 다음 전송 예약 (이미 더 이른 예약이 있으면 그대로) */
  private schedule(ms: number) {
    const due = Date.now() + ms;
    if (this.timer && this.dueAt <= due) return;
    if (this.timer) clearTimeout(this.timer);
    this.dueAt = due;
    this.timer = setTimeout(() => this.flush(), ms);
  }

  private windowMs(): number {
    if (this.room.audience === 0) return ALONE_MS;
    return this.live ? LIVE_MS : SHARED_MS;
  }

  private flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.room.online || this.status !== 'synced') return;
    // 보는 사람이 있을 때만 텍스트 커서를 싣는다 (혼자면 모아 두었다가 누가 들어오면 보냄)
    let aw: string | undefined;
    if (this.awDirty.size && this.room.audience > 0) {
      aw = toB64(encodeAwarenessUpdate(this.awareness, Array.from(this.awDirty)));
      this.awDirty.clear();
    }
    if (!this.outbox.length) {
      if (aw) this.room.send({ t: 'aw', u: aw });
      return;
    }
    // 한 메시지가 너무 커지지 않게 나눠 보낸다 (서버는 4MB가 넘는 메시지를 받지 않는다 — 이미지 여러 장을 한 번에 넣을 때)
    const groups: Uint8Array[][] = [];
    let size = 0;
    for (const u of this.outbox) {
      if (!groups.length || (size > 0 && size + u.length > MAX_MESSAGE_BYTES)) {
        groups.push([]);
        size = 0;
      }
      groups[groups.length - 1].push(u);
      size += u.length;
    }
    this.outbox = [];
    // 대기 중으로 세어 둔 1건을 첫 요청이 이어받고, 나머지는 하나씩 더 센다 (응답이 오면 해제)
    useConnection.getState().addPending(groups.length - 1);
    groups.forEach((g, i) => {
      const merged = g.length === 1 ? g[0] : Y.mergeUpdates(g);
      void this.room.request({ t: 'update', u: toB64(merged), aw: i === 0 ? aw : undefined }).then(this.onUpdateAck);
    });
  }

  private onUpdateAck = (res: AckResult) => {
    const c = useConnection.getState();
    c.addPending(-1);
    if (res.ok) return c.markSaved();
    if (res.status === 403) {
      this.readOnly = true;
      this.notify();
      return c.setSaveError('읽기 전용 권한이라 저장되지 않았습니다.');
    }
    if (res.status === 413) {
      // 다시 보내도 같은 이유로 거절되므로 반복 전송하지 않는다. 화면이 편집을 막고 되돌리는 방법을 안내한다 (Workspace)
      if (this.tooLarge) return;
      this.readOnly = true;
      this.tooLarge = true;
      this.notify();
      c.setSaveBlocked(true);
      return c.setSaveError(res.error ?? '문서가 너무 커서 더 이상 저장할 수 없습니다.');
    }
    c.setSaveError(res.error ?? '저장 확인이 지연되고 있습니다.');
    // 다시 접속하면 상태 벡터 비교로 빠진 부분이 자동으로 다시 전송된다
    if (this.room.online) void this.sync();
  };

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this || this.readOnly) return;
    // 브라우저 사본(IndexedDB)을 불러오는 중의 변경은 편집이 아니다 — 접속하면 상태 벡터 비교로 맞춘다
    if (!this.ready) return;
    if (this.status !== 'synced') {
      useConnection.getState().setOfflineChanges(true);
      return;
    }
    this.enqueue(update);
    this.schedule(this.windowMs());
  };

  /** 보낼 변경을 쌓는다. 비어 있다가 처음 쌓이면 "저장 중"으로 표시 */
  private enqueue(update: Uint8Array) {
    if (!this.outbox.length) useConnection.getState().addPending(1);
    this.outbox.push(update);
  }

  private onAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === this) return;
    for (const id of [...added, ...updated, ...removed]) this.awDirty.add(id);
    // 혼자면 보내지 않고, 함께면 문서 변경과 같은 묶음으로
    if (this.room.audience > 0) this.schedule(this.live ? LIVE_MS : SHARED_MS);
  };

  destroy(): void {
    if (this.destroyed) return;
    this.flush();
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    // 연결이 없어 못 보낸 변경은 브라우저 사본에 남아 다음 접속 때 동기화된다
    if (this.outbox.length) useConnection.getState().addPending(-1);
    if (this.tooLarge) useConnection.getState().setSaveBlocked(false);
    this.outbox = [];
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    for (const off of this.offs) off();
    removeAwarenessStates(this.awareness, [this.doc.clientID], 'destroy');
    if (this.room.audience > 0) this.room.send({ t: 'aw', u: toB64(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])) });
    this.awareness.destroy();
    this.listeners.clear();
  }
}

/**
 * 접속 때 계산한 차이(diff)에 서버에 아직 없는 변경이 있는지
 * encodeStateAsUpdate는 새 변경이 없어도 삭제 기록(delete set)을 통째로 싣는다 — 글자를 지운 적이 있는 문서는
 * 열 때마다 "변경"을 보내 "저장 중"이 잠깐 떴다. 새 항목이 없고 삭제 기록도 서버가 이미 가진 것뿐이면 보내지 않는다.
 * (서버 응답은 서버 문서의 삭제 기록 전체를 담고 있다. 판단이 애매하면 보낸다)
 */
function hasLocalOnlyChanges(diff: Uint8Array, serverUpdate: Uint8Array): boolean {
  try {
    const local = Y.decodeUpdate(diff);
    if (local.structs.length) return true;
    const server = Y.decodeUpdate(serverUpdate).ds.clients;
    for (const [client, items] of local.ds.clients) {
      const have = (server.get(client) ?? []).slice().sort((a, b) => a.clock - b.clock);
      for (const { clock, len } of items) {
        // [clock, clock + len)이 서버의 삭제 구간들로 빈틈없이 덮이는지
        let at = clock;
        for (const r of have) {
          if (r.clock > at) break;
          if (r.clock + r.len > at) at = r.clock + r.len;
          if (at >= clock + len) break;
        }
        if (at < clock + len) return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}
