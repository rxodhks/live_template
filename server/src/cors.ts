import type { NextFunction, Request, Response } from 'express';

/*
 * 다른 주소에서 여는 화면(GitHub Pages 등)이 이 서버를 쓸 수 있도록 허용할 출처.
 * 인증은 쿠키가 아니라 Authorization 헤더의 토큰이므로, 허용하더라도 다른 사이트가
 * 사용자 권한으로 몰래 요청을 보낼 수는 없다. 그래도 기본값은 필요한 곳으로만 좁혀 둔다.
 *
 *   기본 허용: https://*.github.io, https://*.app.github.dev, localhost
 *   추가 허용: CORS_ORIGINS="https://a.com,https://b.com"  (모두 허용: CORS_ORIGINS="*")
 */

const extra = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // 같은 주소에서의 요청
  if (extra.includes('*') || extra.includes(origin)) return true;
  try {
    const u = new URL(origin);
    if (u.protocol === 'https:' && (u.hostname.endsWith('.github.io') || u.hostname.endsWith('.app.github.dev'))) return true;
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]') return true;
  } catch {
    /* 잘못된 Origin */
  }
  return false;
}

export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  res.append('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.sendStatus(origin && isAllowedOrigin(origin) ? 204 : 403);
    return;
  }
  next();
}

/** Socket.IO용 */
export const socketCors = {
  origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => cb(null, isAllowedOrigin(origin)),
};
