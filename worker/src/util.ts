/* Worker·Durable Object 공용 도우미 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** URL에 안전한 무작위 ID (기본 12자 ≈ 71비트) */
export function newId(size = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  let out = '';
  for (let i = 0; i < size; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export const isId = (v: unknown, min = 8, max = 64): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max && /^[0-9A-Za-z_-]+$/.test(v);

export function clampText(value: unknown, max: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.trim().replace(/\s+/g, ' ').slice(0, max);
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 길이가 같은 문자열을 시간 차이 없이 비교 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Durable Object RPC 결과: 오류를 상태 코드와 함께 전달하기 위해 예외 대신 값으로 돌려준다 */
export type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string; extra?: Record<string, string | number | boolean> };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = (status: number, error: string, extra?: Record<string, string | number | boolean>): Result<never> => ({ ok: false, status, error, extra });

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function unwrap<T>(r: Result<T>): T {
  if (r.ok) return r.data;
  throw new HttpError(r.status, r.error, r.extra);
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}
