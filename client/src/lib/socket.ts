import { io, type ManagerOptions, type Socket, type SocketOptions } from 'socket.io-client';
import { getToken } from './api';
import { SERVER_URL } from './server';
import { useConnection } from '../store/connection';

let socket: Socket | null = null;

/** 앱 전체에서 하나의 소켓 연결을 공유한다 */
export function getSocket(): Socket {
  if (socket) return socket;
  const opts: Partial<ManagerOptions & SocketOptions> = {
    auth: (cb) => cb({ token: getToken() }),
    transports: ['websocket', 'polling'],
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
  };
  // 같은 주소면 io(opts), 외부 서버면 io(url, opts)
  const s = SERVER_URL ? io(SERVER_URL, opts) : io(opts);
  const setStatus = useConnection.getState().setStatus;
  s.on('connect', () => setStatus('online'));
  s.on('disconnect', () => setStatus('offline'));
  s.on('connect_error', () => setStatus('offline'));
  s.io.on('reconnect_attempt', () => setStatus('connecting'));
  socket = s;
  return s;
}

export function resetSocket(): void {
  socket?.disconnect();
  socket = null;
}

/** ack를 Promise로 */
export function request<T = Record<string, unknown>>(event: string, payload: unknown, timeoutMs = 10000): Promise<T & { ok: boolean; error?: string; status?: number }> {
  const s = getSocket();
  return new Promise((resolve) => {
    s.timeout(timeoutMs).emit(event, payload, (err: Error | null, res: T & { ok: boolean }) => {
      if (err) resolve({ ok: false, error: '서버 응답이 없습니다.' } as T & { ok: boolean; error: string });
      else resolve(res);
    });
  });
}
