import type { OAuthProvider } from '../../shared/types';
import type { Env } from './env';

/*
 * 로그인 도우미: 쿠키 · 외부 계정(구글 · 깃허브 · 애플) OAuth
 * 계정과 세션 저장은 Directory가 맡고, 여기서는 외부 서비스와 주고받는 부분만 다룬다.
 */

export const OAUTH_PROVIDERS: OAuthProvider[] = ['google', 'github', 'apple'];

/* ───────────── 쿠키 ───────────── */

/**
 * __Host- 접두사: https에서만, 이 주소(하위 도메인 제외)에서만 쓰이는 쿠키
 *  · session : 로그인 세션 (자바스크립트에서 읽을 수 없음)
 *  · signup  : 인증을 마치고 이름을 정하기 전의 가입 티켓
 *  · oauth   : 외부 로그인 요청을 이 브라우저에 묶어 두는 값 (애플은 다른 사이트에서 POST로 돌아오므로 SameSite=None)
 */
export const COOKIE = {
  session: '__Host-madang_sid',
  signup: '__Host-madang_signup',
  oauth: '__Host-madang_oauth',
} as const;

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim() || null;
  }
  return null;
}

export function cookie(name: string, value: string, maxAgeSec: number, sameSite: 'Lax' | 'None' = 'Lax'): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSec}; HttpOnly; Secure; SameSite=${sameSite}`;
}

export const clearCookie = (name: string, sameSite: 'Lax' | 'None' = 'Lax') => cookie(name, '', 0, sameSite);

/** 응답에 쿠키 붙이기 (Set-Cookie는 여러 개를 따로 보내야 한다) */
export function withCookies(res: Response, cookies: string[]): Response {
  const headers = new Headers(res.headers);
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(res.body, { status: res.status, headers });
}

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 302, headers });
}

/** 로그인 후 돌아갈 앱 내부 경로만 허용 (다른 사이트로 보내는 데 쓰이지 않게) */
export function safeNext(value: string | null | undefined): string {
  if (!value || value.length > 512 || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  if (value.startsWith('/login') || value.startsWith('/signup') || value.startsWith('/api/')) return '/';
  return value;
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/* ───────────── 외부 계정 ───────────── */

export interface OAuthProfile {
  subject: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
}

export class OAuthError extends Error {}

export function providerEnabled(env: Env, p: OAuthProvider): boolean {
  switch (p) {
    case 'google':
      return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
    case 'github':
      return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
    case 'apple':
      return Boolean(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY);
  }
}

const utf8 = (s: string) => new TextEncoder().encode(s);

function b64url(input: ArrayBuffer | Uint8Array | string): string {
  const bytes = typeof input === 'string' ? utf8(input) : input instanceof Uint8Array ? input : new Uint8Array(input);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** 공백을 %20으로 인코딩한 쿼리 (애플은 +를 받지 않는다) */
const query = (params: Record<string, string>) =>
  Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

export async function authorizeUrl(env: Env, p: OAuthProvider, redirectUri: string, flow: { state: string; verifier: string; nonce: string }): Promise<string> {
  const challenge = b64url(await crypto.subtle.digest('SHA-256', utf8(flow.verifier)));
  switch (p) {
    case 'google':
      return `https://accounts.google.com/o/oauth2/v2/auth?${query({
        client_id: env.GOOGLE_CLIENT_ID!,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state: flow.state,
        nonce: flow.nonce,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      })}`;
    case 'github':
      return `https://github.com/login/oauth/authorize?${query({
        client_id: env.GITHUB_CLIENT_ID!,
        redirect_uri: redirectUri,
        scope: 'read:user user:email',
        state: flow.state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })}`;
    case 'apple':
      // 이름 · 이메일을 요청하면 애플은 결과를 form_post(POST)로만 돌려준다
      return `https://appleid.apple.com/auth/authorize?${query({
        client_id: env.APPLE_CLIENT_ID!,
        redirect_uri: redirectUri,
        response_type: 'code',
        response_mode: 'form_post',
        scope: 'name email',
        state: flow.state,
        nonce: flow.nonce,
      })}`;
  }
}

async function postForm(url: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: query(params),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || data.error) throw new OAuthError(`${new URL(url).host} 토큰 교환 실패: ${res.status} ${String(data.error ?? '')}`);
  return data;
}

async function getJson<T>(url: string, headers: Record<string, string>): Promise<T> {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new OAuthError(`${url} 요청 실패: ${res.status}`);
  return (await res.json()) as T;
}

type Claims = Record<string, unknown>;

/** 토큰 엔드포인트에서 TLS로 직접 받은 ID 토큰이므로 서명 대신 발급자 · 대상 · 만료 · nonce를 확인한다 (OIDC Core 3.1.3.7) */
function idTokenClaims(token: unknown, expect: { iss: string[]; aud: string; nonce: string }): Claims {
  if (typeof token !== 'string') throw new OAuthError('ID 토큰이 없습니다.');
  let claims: Claims;
  try {
    claims = JSON.parse(fromB64url(token.split('.')[1] ?? '')) as Claims;
  } catch {
    throw new OAuthError('ID 토큰을 읽을 수 없습니다.');
  }
  const aud = claims.aud;
  if (!expect.iss.includes(String(claims.iss))) throw new OAuthError('발급자가 다릅니다.');
  if (!(aud === expect.aud || (Array.isArray(aud) && aud.includes(expect.aud)))) throw new OAuthError('대상이 다릅니다.');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now() - 60_000) throw new OAuthError('만료된 ID 토큰입니다.');
  if (claims.nonce !== expect.nonce) throw new OAuthError('nonce가 다릅니다.');
  if (!claims.sub) throw new OAuthError('계정 ID가 없습니다.');
  return claims;
}

const text = (v: unknown, max = 40) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const verified = (v: unknown) => v === true || v === 'true';

/* 애플은 클라이언트 비밀번호 대신 개인 키로 서명한 JWT를 쓴다 (최대 6개월, 여기서는 1시간짜리를 만들어 재사용) */
let appleSecret: { value: string; exp: number; key: string } | null = null;

async function appleClientSecret(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const cacheKey = `${env.APPLE_TEAM_ID}:${env.APPLE_KEY_ID}:${env.APPLE_CLIENT_ID}`;
  if (appleSecret && appleSecret.key === cacheKey && appleSecret.exp - 300 > now) return appleSecret.value;
  const pem = env.APPLE_PRIVATE_KEY!.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const exp = now + 3600;
  const signing = `${b64url(JSON.stringify({ alg: 'ES256', kid: env.APPLE_KEY_ID }))}.${b64url(
    JSON.stringify({ iss: env.APPLE_TEAM_ID, iat: now, exp, aud: 'https://appleid.apple.com', sub: env.APPLE_CLIENT_ID }),
  )}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(signing));
  const value = `${signing}.${b64url(sig)}`;
  appleSecret = { value, exp, key: cacheKey };
  return value;
}

/** 돌려받은 인가 코드로 외부 계정 정보를 확인한다 */
export async function fetchProfile(
  env: Env,
  p: OAuthProvider,
  redirectUri: string,
  code: string,
  flow: { verifier: string; nonce: string },
  appleUser: string | null,
): Promise<OAuthProfile> {
  if (p === 'google') {
    const tokens = await postForm('https://oauth2.googleapis.com/token', {
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: flow.verifier,
    });
    const c = idTokenClaims(tokens.id_token, { iss: ['https://accounts.google.com', 'accounts.google.com'], aud: env.GOOGLE_CLIENT_ID!, nonce: flow.nonce });
    return { subject: String(c.sub), email: text(c.email, 254).toLowerCase() || null, emailVerified: verified(c.email_verified), name: text(c.name) };
  }

  if (p === 'github') {
    const tokens = await postForm('https://github.com/login/oauth/access_token', {
      client_id: env.GITHUB_CLIENT_ID!,
      client_secret: env.GITHUB_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
      code_verifier: flow.verifier,
    });
    if (typeof tokens.access_token !== 'string') throw new OAuthError('깃허브 토큰이 없습니다.');
    const headers = {
      authorization: `Bearer ${tokens.access_token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'Madang',
      'x-github-api-version': '2022-11-28',
    };
    const user = await getJson<{ id: number; login: string; name: string | null }>('https://api.github.com/user', headers);
    const emails = await getJson<{ email: string; primary: boolean; verified: boolean }[]>('https://api.github.com/user/emails', headers).catch(() => []);
    const best = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    return { subject: String(user.id), email: best ? best.email.toLowerCase() : null, emailVerified: Boolean(best), name: text(user.name) || text(user.login) };
  }

  const tokens = await postForm('https://appleid.apple.com/auth/token', {
    client_id: env.APPLE_CLIENT_ID!,
    client_secret: await appleClientSecret(env),
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  const c = idTokenClaims(tokens.id_token, { iss: ['https://appleid.apple.com'], aud: env.APPLE_CLIENT_ID!, nonce: flow.nonce });
  // 애플은 이름을 처음 동의할 때 한 번만, 폼 값으로 준다
  let name = '';
  try {
    const u = JSON.parse(appleUser ?? '') as { name?: { firstName?: string; lastName?: string } };
    name = text(`${u.name?.firstName ?? ''} ${u.name?.lastName ?? ''}`);
  } catch {
    /* 두 번째 로그인부터는 없다 */
  }
  return { subject: String(c.sub), email: text(c.email, 254).toLowerCase() || null, emailVerified: verified(c.email_verified), name };
}
