/*
 * 협업 서버(클라우드플레어 Worker) API
 * 화면과 서버가 같은 주소에서 제공되므로 상대 경로(/api)를 쓰고, 로그인은 쿠키(HttpOnly)로 유지된다.
 */

import { CLIENT_VERSION, CLIENT_VERSION_HEADER, CLIENT_VERSION_PARAM } from '@shared/protocol';

export const API_BASE = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');

export const apiUrl = (path: string): string => `${API_BASE}/api${path}`;

/** 실시간 연결 주소 (http → ws) */
export function wsUrl(path: string): string {
  const base = API_BASE || window.location.origin;
  // 화면 버전을 함께 보낸다 — 서버가 예전 화면을 알아보고 새로고침을 안내한다
  return `${base.replace(/^http/, 'ws')}/api${path}${path.includes('?') ? '&' : '?'}${CLIENT_VERSION_PARAM}=${CLIENT_VERSION}`;
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

/** 로그인이 풀렸을 때(다른 기기에서 로그아웃 등) 할 일 — 세션 모듈이 등록한다 */
let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => void (onUnauthorized = fn);

export async function api<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method,
      credentials: 'same-origin',
      headers: { [CLIENT_VERSION_HEADER]: String(CLIENT_VERSION), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, '서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.');
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status === 401 && data.reason === 'login_required' && !path.startsWith('/auth/')) onUnauthorized?.();
    throw new ApiError(res.status, String(data.error ?? `요청 실패 (${res.status})`), data);
  }
  return data as T;
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.');

/* 로그인 기능 이전(가입 없이 쓰던 때)에 이 브라우저에 남은 값 — 처음 로그인할 때 계정으로 옮기고 지운다 */
const LEGACY_TOKEN = 'lt.token';
const LEGACY_PROFILE = 'lt.profile';

export function legacyToken(): string | null {
  try {
    return localStorage.getItem(LEGACY_TOKEN);
  } catch {
    return null;
  }
}

export function legacyProfile(): { name: string; color: string; avatar: string } | null {
  try {
    const p = JSON.parse(localStorage.getItem(LEGACY_PROFILE) ?? 'null') as { name?: unknown; color?: unknown; avatar?: unknown } | null;
    return p && typeof p.name === 'string' && typeof p.color === 'string' && typeof p.avatar === 'string' ? { name: p.name, color: p.color, avatar: p.avatar } : null;
  } catch {
    return null;
  }
}

export function clearLegacy(): void {
  try {
    localStorage.removeItem(LEGACY_TOKEN);
    localStorage.removeItem(LEGACY_PROFILE);
  } catch {
    /* 무시 */
  }
}
