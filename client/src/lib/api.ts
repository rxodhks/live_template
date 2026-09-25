/*
 * 협업 서버(클라우드플레어 Worker) API
 * 화면과 서버가 같은 주소에서 제공되므로 기본은 상대 경로(/api)를 쓴다.
 * 모바일 앱처럼 다른 곳에서 부를 때는 빌드 시 VITE_API_BASE로 서버 주소를 지정한다.
 */

export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
const TOKEN_KEY = 'lt.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 저장소를 쓸 수 없는 환경 (시크릿 모드 등) */
  }
}

export const apiUrl = (path: string): string => `${API_BASE}/api${path}`;

/** 실시간 연결 주소 (http → ws) */
export function wsUrl(path: string): string {
  const base = API_BASE || window.location.origin;
  return `${base.replace(/^http/, 'ws')}/api${path}`;
}

/** 다른 사람에게 보낼 앱 링크 */
export const appUrl = (path: string): string => new URL(path, window.location.origin).toString();

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function api<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.');
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? `요청 실패 (${res.status})`), data);
  return data as T;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');
