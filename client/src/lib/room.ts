import type { Role } from '@shared/types';
import type { ClientMessage, ServerMessage } from '@shared/protocol';
import { ApiError, api, wsUrl } from './api';

/*
 * 협업 템플릿 하나의 실시간 연결 (클라우드플레어 Durable Object "방"과 WebSocket 하나)
 *  · 끊기면 점점 간격을 늘려 자동 재연결 (온라인 복귀·탭 복귀 시 즉시)
 *  · 요청/응답(ack)을 Promise로
 *  · 25초마다 ping — 서버는 깨어나지 않고 자동으로 pong을 돌려준다 (무료 사용량 절약)
 */

export type RoomStatus = 'connecting' | 'online' | 'offline' | 'denied';

type Msg<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;
type Outgoing = ClientMessage extends infer M ? (M extends { id: number } ? Omit<M, 'id'> : M) : never;
export type AckResult<T = unknown> = { ok: boolean; data?: T; error?: string; status?: number };

const PING_MS = 25_000;
const PONG_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_MISSED = 200;

export class RoomConnection {
  status: RoomStatus = 'connecting';
  sid: string | null = null;
  role: Role | null = null;
  deniedReason: string | null = null;
  /** 서버가 이 화면이 예전 버전이라며 연결을 거절했다 (새로고침하면 된다) */
  outdated = false;
  /**
   * 마지막으로 받은 입장 메시지. 연결은 만들자마자 시작되므로 화면이 구독하기 전에 도착할 수 있다
   * (처음 여는 템플릿은 브라우저 사본을 기다리느라 구독이 늦다) → 늦게 구독한 쪽이 이것으로 따라잡는다
   */
  lastWelcome: Msg<'welcome'> | null = null;

  /** 같은 방에 있는 다른 연결들 (다른 사람 또는 내 다른 탭) */
  private others = new Set<string>();
  private audienceListeners = new Set<(n: number) => void>();
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<(m: never) => void>>();
  private statusListeners = new Set<(s: RoomStatus) => void>();
  private acks = new Map<number, { resolve: (r: AckResult) => void; timer: ReturnType<typeof setTimeout> }>();
  private seq = 0;
  private attempt = 0;
  private closed = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** replayMissed()를 부르기 전까지 받을 사람이 없던 메시지 */
  private missed: ServerMessage[] | null = [];

  constructor(readonly templateId: string) {
    window.addEventListener('online', this.reconnectNow);
    window.addEventListener('offline', this.dropNow);
    document.addEventListener('visibilitychange', this.onVisible);
    this.connect();
  }

  on<T extends ServerMessage['t']>(t: T, fn: (m: Msg<T>) => void): () => void {
    let set = this.handlers.get(t);
    if (!set) this.handlers.set(t, (set = new Set()));
    set.add(fn as (m: never) => void);
    return () => set!.delete(fn as (m: never) => void);
  }

  onStatus(fn: (s: RoomStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  get online(): boolean {
    return this.status === 'online';
  }

  /** 지금 내 화면을 볼 수 있는 다른 연결 수. 0이면 커서·텍스트 커서처럼 보는 사람이 필요한 정보는 보내지 않는다 */
  get audience(): number {
    return this.others.size;
  }

  onAudience(fn: (n: number) => void): () => void {
    this.audienceListeners.add(fn);
    return () => this.audienceListeners.delete(fn);
  }

  private setOthers(update: (s: Set<string>) => void) {
    const before = this.others.size;
    update(this.others);
    if (this.others.size !== before) for (const fn of this.audienceListeners) fn(this.others.size);
  }

  send(msg: Outgoing): boolean {
    return this.raw(msg);
  }

  private raw(msg: object): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.status !== 'online') return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  request<T = unknown>(msg: Outgoing, timeoutMs = REQUEST_TIMEOUT_MS): Promise<AckResult<T>> {
    const id = ++this.seq;
    if (!this.raw({ ...msg, id })) return Promise.resolve({ ok: false, status: 0, error: '서버에 연결되어 있지 않습니다.' });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.acks.delete(id);
        resolve({ ok: false, status: 0, error: '서버 응답이 없습니다.' });
      }, timeoutMs);
      this.acks.set(id, { resolve: resolve as (r: AckResult) => void, timer });
    });
  }

  close(): void {
    this.closed = true;
    window.removeEventListener('online', this.reconnectNow);
    window.removeEventListener('offline', this.dropNow);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.cleanup();
    try {
      this.ws?.close(1000, 'leave');
    } catch {
      /* 무시 */
    }
    this.ws = null;
    this.handlers.clear();
    this.statusListeners.clear();
    this.audienceListeners.clear();
  }

  /* ───────────── 내부 ───────────── */

  private setStatus(s: RoomStatus) {
    if (this.status === s) return;
    this.status = s;
    for (const fn of this.statusListeners) fn(s);
  }

  private emit(m: ServerMessage) {
    const set = this.handlers.get(m.t);
    if (!set?.size) {
      // 화면이 아직 구독하지 않은 메시지는 replayMissed()까지 모아 둔다
      if (this.missed && this.missed.length < MAX_MISSED) this.missed.push(m);
      return;
    }
    for (const fn of Array.from(set)) (fn as (m: ServerMessage) => void)(m);
  }

  /**
   * 구독하기 전에 도착한 메시지를 순서대로 다시 전달한다 (한 번만).
   * 연결은 화면이 준비되기 전(브라우저 사본을 읽는 동안)에 열리므로 welcome이 먼저 도착할 수 있다.
   */
  replayMissed(): void {
    const missed = this.missed ?? [];
    this.missed = null;
    for (const m of missed) this.emit(m);
  }

  private connect = () => {
    if (this.closed) return;
    this.retryTimer = null;
    this.setStatus(this.attempt === 0 ? 'connecting' : 'offline');
    let welcomed = false;
    // 로그인은 쿠키로 확인한다 ('lt'는 이 서버의 실시간 프로토콜 이름)
    const ws = new WebSocket(wsUrl(`/templates/${this.templateId}/ws`), ['lt']);
    this.ws = ws;

    ws.onmessage = (e) => {
      // 오프라인 알림으로 먼저 내려놓은 연결이 늦게 받은 메시지는 버린다
      if (this.ws !== ws) return;
      if (e.data === 'pong') {
        if (this.pongTimer) clearTimeout(this.pongTimer);
        this.pongTimer = null;
        return;
      }
      let m: ServerMessage;
      try {
        m = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      if (m.t === 'welcome') {
        welcomed = true;
        this.lastWelcome = m;
        this.attempt = 0;
        this.sid = m.sid;
        this.role = m.role;
        this.startPing();
        this.setOthers((set) => {
          set.clear();
          for (const p of m.presence) if (p.socketId !== m.sid) set.add(p.socketId);
        });
        this.setStatus('online');
      } else if (m.t === 'presence') {
        if (m.state.socketId !== this.sid) this.setOthers((set) => set.add(m.state.socketId));
      } else if (m.t === 'presence:leave') {
        this.setOthers((set) => set.delete(m.sid));
      } else if (m.t === 'ack') {
        const a = this.acks.get(m.id);
        if (a) {
          clearTimeout(a.timer);
          this.acks.delete(m.id);
          a.resolve({ ok: m.ok, data: m.data, error: m.error, status: m.status });
        }
        return;
      } else if (m.t === 'role') {
        this.role = m.role;
      } else if (m.t === 'kicked') {
        this.closed = true;
      }
      this.emit(m);
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.cleanup();
      this.setOthers((set) => set.clear());
      if (this.closed) {
        this.setStatus('offline');
        return;
      }
      this.setStatus('offline');
      // 한 번도 들어가지 못했다면 권한 문제인지 확인
      if (!welcomed) void this.checkAccess();
      else this.scheduleRetry();
    };
  };

  private async checkAccess() {
    try {
      await api('GET', `/templates/${this.templateId}`);
    } catch (err) {
      if (err instanceof ApiError && err.data.reason === 'outdated') this.outdated = true;
      if (err instanceof ApiError && [401, 403, 404, 426].includes(err.status)) return this.deny(err.message);
    }
    this.scheduleRetry();
  }

  private deny(reason: string) {
    this.closed = true;
    this.deniedReason = reason;
    this.setStatus('denied');
  }

  private scheduleRetry() {
    if (this.closed || this.retryTimer) return;
    const delay = Math.min(500 * 2 ** this.attempt, 10_000) * (0.8 + Math.random() * 0.4);
    this.attempt++;
    this.retryTimer = setTimeout(this.connect, delay);
  }

  private reconnectNow = () => {
    if (this.closed || this.ws) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.attempt = 0;
    this.connect();
  };

  /**
   * 브라우저가 인터넷이 끊겼다고 알려 주면 바로 오프라인으로 바꾼다.
   * 끊긴 연결은 닫기 응답도 오지 않아 ping 시간 초과(최대 35초)까지 "저장 중"으로 보였다.
   * 다시 연결되면 'online' 이벤트(또는 재시도)로 접속하고, 상태 벡터 비교로 빠진 변경을 다시 보낸다.
   */
  private dropNow = () => {
    const ws = this.ws;
    if (this.closed || !ws) return;
    this.ws = null;
    this.cleanup();
    this.setOthers((set) => set.clear());
    this.setStatus('offline');
    try {
      ws.close(4003, 'offline');
    } catch {
      /* 무시 */
    }
    this.scheduleRetry();
  };

  private onVisible = () => {
    if (document.visibilityState === 'visible') this.reconnectNow();
  };

  private startPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send('ping');
      if (!this.pongTimer) this.pongTimer = setTimeout(() => ws.close(4000, 'timeout'), PONG_TIMEOUT_MS);
    }, PING_MS);
  }

  private cleanup() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.pongTimer) clearTimeout(this.pongTimer);
    if (this.retryTimer && this.closed) clearTimeout(this.retryTimer);
    this.pingTimer = this.pongTimer = null;
    for (const [, a] of this.acks) {
      clearTimeout(a.timer);
      a.resolve({ ok: false, status: 0, error: '연결이 끊겼습니다.' });
    }
    this.acks.clear();
  }
}
