import type { EmailVerifyResult, PasskeyInfo, PublicUser } from '@shared/types';
import { api } from './api';

/*
 * 패스키 (지문 · 얼굴 · 기기 PIN으로 로그인)
 * ─────────────────────────────────────
 *  · 이메일 코드로 한 번 로그인한 뒤 기기에 등록해 두면, 다음부터는 이메일도 코드도 없이 한 번에 로그인한다
 *  · 키는 기기(또는 기기의 암호 관리자)에만 있고, 서버는 공개 키만 보관한다
 *  · 이메일 코드 로그인은 예비 수단으로 그대로 남는다
 */

const toB64url = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64url = (s: string): Uint8Array<ArrayBuffer> => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/** 이 브라우저가 패스키를 쓸 수 있는지 */
export function passkeySupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function' && Boolean(navigator.credentials) && window.isSecureContext;
}

/** 이 기기 자체에 지문 · 얼굴 · PIN 인증기가 있는지 (등록을 권할지 정할 때) */
export async function platformPasskeyAvailable(): Promise<boolean> {
  if (!passkeySupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** 이메일 칸을 누르면 브라우저가 저장된 패스키를 바로 제안할 수 있는지 */
export async function passkeyAutofillAvailable(): Promise<boolean> {
  if (!passkeySupported()) return false;
  try {
    return (await PublicKeyCredential.isConditionalMediationAvailable?.()) === true;
  } catch {
    return false;
  }
}

/** 사용자가 취소했거나 다른 요청에 밀려난 경우 (오류로 알리지 않는다) */
export function isPasskeyCancel(err: unknown): boolean {
  return err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError');
}

/** 이 계정에 지금 기기의 패스키를 등록 */
export async function registerPasskey(): Promise<PasskeyInfo> {
  const opts = await api<{
    challenge: string;
    rp: { id: string; name: string };
    user: { id: string; name: string; displayName: string };
    exclude: { id: string; transports: string[] }[];
  }>('POST', '/auth/passkey/register/options');
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: fromB64url(opts.challenge),
      rp: opts.rp,
      user: { id: fromB64url(opts.user.id), name: opts.user.name, displayName: opts.user.displayName },
      pubKeyCredParams: [
        { type: 'public-key', alg: -8 },
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      excludeCredentials: opts.exclude.map((c) => ({ type: 'public-key' as const, id: fromB64url(c.id), transports: c.transports as AuthenticatorTransport[] })),
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
      attestation: 'none',
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new DOMException('cancelled', 'NotAllowedError');
  const res = cred.response as AuthenticatorAttestationResponse;
  const publicKey = res.getPublicKey?.();
  const authenticatorData = res.getAuthenticatorData?.();
  if (!publicKey || !authenticatorData) throw new Error('이 브라우저에서는 패스키를 등록할 수 없습니다. 최신 브라우저에서 다시 시도해 주세요.');
  const { passkey } = await api<{ passkey: PasskeyInfo }>('POST', '/auth/passkey/register', {
    id: toB64url(cred.rawId),
    clientDataJSON: toB64url(res.clientDataJSON),
    authenticatorData: toB64url(authenticatorData),
    publicKey: toB64url(publicKey),
    algorithm: res.getPublicKeyAlgorithm(),
    transports: res.getTransports?.() ?? [],
  });
  return passkey;
}

/**
 * 패스키로 로그인. autofill: 이메일 칸의 자동 완성 목록에 패스키를 띄워 두고 사용자가 고르기를 기다린다.
 * 사용자가 고르지 않으면 null (취소 · 다른 요청으로 중단)
 */
export async function loginWithPasskey(opts: { autofill?: boolean; signal?: AbortSignal } = {}): Promise<(EmailVerifyResult & { user?: PublicUser }) | null> {
  const { challenge, rpId } = await api<{ challenge: string; rpId: string }>('POST', '/auth/passkey/login/options');
  if (opts.signal?.aborted) return null;
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({
      publicKey: { challenge: fromB64url(challenge), rpId, userVerification: 'required', timeout: opts.autofill ? undefined : 120_000 },
      ...(opts.autofill ? { mediation: 'conditional' as CredentialMediationRequirement } : {}),
      signal: opts.signal,
    })) as PublicKeyCredential | null;
  } catch (err) {
    if (isPasskeyCancel(err)) return null;
    throw err;
  }
  if (!cred) return null;
  const res = cred.response as AuthenticatorAssertionResponse;
  return api('POST', '/auth/passkey/login', {
    id: toB64url(cred.rawId),
    clientDataJSON: toB64url(res.clientDataJSON),
    authenticatorData: toB64url(res.authenticatorData),
    signature: toB64url(res.signature),
    userHandle: res.userHandle ? toB64url(res.userHandle) : null,
  });
}

export const listPasskeys = () => api<{ passkeys: PasskeyInfo[] }>('GET', '/me/passkeys').then((r) => r.passkeys);

export const deletePasskey = (id: string) => api('DELETE', `/me/passkeys/${encodeURIComponent(id)}`);

/* ───────────── 이 기기에서 마지막으로 쓴 로그인 방법 ───────────── */

export type LoginMethod = 'email' | 'google' | 'github' | 'passkey';
export interface LastLogin {
  method: LoginMethod;
  /** 이메일 코드로 로그인한 주소 (다음에 미리 채워 둔다) */
  email?: string;
}

const LAST_LOGIN_KEY = 'lt.lastLogin';
const OFFER_KEY = 'lt.passkeyOffer';

export function readLastLogin(): LastLogin | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_LOGIN_KEY) ?? 'null') as LastLogin | null;
    return v && ['email', 'google', 'github', 'passkey'].includes(v.method) ? { method: v.method, email: typeof v.email === 'string' ? v.email : undefined } : null;
  } catch {
    return null;
  }
}

/** 기억한 이메일은 다른 방법으로 로그인해도 남겨 둔다 (지우기를 누르기 전까지) */
export function rememberLogin(method: LoginMethod, email?: string): void {
  try {
    const prev = readLastLogin();
    localStorage.setItem(LAST_LOGIN_KEY, JSON.stringify({ method, email: email ?? prev?.email }));
  } catch {
    /* 저장소를 쓸 수 없는 환경 */
  }
}

export function forgetLogin(): void {
  try {
    localStorage.removeItem(LAST_LOGIN_KEY);
  } catch {
    /* 저장소를 쓸 수 없는 환경 */
  }
}

/** 등록 권유를 이 기기에서 그만 보기 */
export function passkeyOfferDismissed(): boolean {
  try {
    return localStorage.getItem(OFFER_KEY) === 'dismissed';
  } catch {
    return true;
  }
}

export function dismissPasskeyOffer(): void {
  try {
    localStorage.setItem(OFFER_KEY, 'dismissed');
  } catch {
    /* 저장소를 쓸 수 없는 환경 */
  }
}
