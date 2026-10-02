/*
 * 패스키(WebAuthn) 확인 도우미
 * ──────────────────────────
 *  · 증명(attestation)은 받지 않는다('none'): 기기 제조사를 가리지 않고, 확인할 것은 "이 사람이 이 키를 가졌다"뿐이다
 *  · 공개 키는 브라우저가 꺼내 주는 SPKI 형식(getPublicKey())을 그대로 받아 WebCrypto로 읽는다 (CBOR 해석 없이)
 *  · 로그인 때는 서명 대상(인증 데이터 + 클라이언트 데이터 해시) · 챌린지 · 출처 · 사이트(RP ID) · 본인 확인(UV)을 모두 확인한다
 */

/** 지원하는 서명 방식 (COSE 번호): Ed25519 · ES256(P-256) · RS256 */
export const PASSKEY_ALGS = [-8, -7, -257] as const;
export type PasskeyAlg = (typeof PASSKEY_ALGS)[number];

export class PasskeyError extends Error {}

export function b64urlEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(value: unknown, max = 4096): Uint8Array {
  if (typeof value !== 'string' || !value || value.length > max || !/^[A-Za-z0-9_-]+$/.test(value)) throw new PasskeyError('잘못된 패스키 응답입니다.');
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const sha256 = async (data: Uint8Array) => new Uint8Array(await crypto.subtle.digest('SHA-256', data));

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export interface ClientData {
  challenge: string;
}

/** 개발 서버(내 컴퓨터)에서 받는 화면 출처 */
const LOCAL_ORIGIN = /^https?:\/\/localhost(:\d{1,5})?$/;

/** 브라우저가 서명한 요청 정보: 종류 · 챌린지 · 출처 확인 (origin이 null이면 localhost 화면만) */
export function readClientData(raw: Uint8Array, type: 'webauthn.create' | 'webauthn.get', origin: string | null): ClientData {
  let data: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try {
    data = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new PasskeyError('잘못된 패스키 응답입니다.');
  }
  if (data.type !== type) throw new PasskeyError('잘못된 패스키 응답입니다.');
  const sameOrigin = origin === null ? typeof data.origin === 'string' && LOCAL_ORIGIN.test(data.origin) : data.origin === origin;
  if (!sameOrigin || data.crossOrigin === true) throw new PasskeyError('이 사이트에서 만든 패스키 요청이 아닙니다.');
  if (typeof data.challenge !== 'string' || data.challenge.length > 128) throw new PasskeyError('잘못된 패스키 응답입니다.');
  return { challenge: data.challenge };
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export interface AuthData {
  signCount: number;
  /** 등록 때만: 새로 만든 자격 증명 ID */
  credentialId: Uint8Array | null;
}

/** 인증 데이터: 사이트(RP ID) 해시 · 사용자 확인 · 본인 확인(지문 · 얼굴 · PIN) 플래그 */
export async function readAuthData(raw: Uint8Array, rpId: string): Promise<AuthData> {
  if (raw.length < 37) throw new PasskeyError('잘못된 패스키 응답입니다.');
  if (!equalBytes(raw.subarray(0, 32), await sha256(new TextEncoder().encode(rpId)))) throw new PasskeyError('이 사이트의 패스키가 아닙니다.');
  const flags = raw[32];
  if (!(flags & FLAG_UP) || !(flags & FLAG_UV)) throw new PasskeyError('기기에서 본인 확인(지문 · 얼굴 · PIN)을 마쳐야 합니다.');
  const signCount = new DataView(raw.buffer, raw.byteOffset + 33, 4).getUint32(0);
  let credentialId: Uint8Array | null = null;
  if (flags & FLAG_AT) {
    // aaguid(16) 다음에 자격 증명 ID 길이(2)와 ID
    if (raw.length < 55) throw new PasskeyError('잘못된 패스키 응답입니다.');
    const len = new DataView(raw.buffer, raw.byteOffset + 53, 2).getUint16(0);
    if (raw.length < 55 + len) throw new PasskeyError('잘못된 패스키 응답입니다.');
    credentialId = raw.slice(55, 55 + len);
  }
  return { signCount, credentialId };
}

type KeyParams = Parameters<SubtleCrypto['importKey']>[2];
type VerifyParams = Parameters<SubtleCrypto['verify']>[0];

function importParams(alg: PasskeyAlg): { key: KeyParams; verify: VerifyParams } {
  switch (alg) {
    case -8:
      return { key: { name: 'Ed25519' }, verify: { name: 'Ed25519' } };
    case -7:
      return { key: { name: 'ECDSA', namedCurve: 'P-256' }, verify: { name: 'ECDSA', hash: 'SHA-256' } };
    case -257:
      return { key: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verify: { name: 'RSASSA-PKCS1-v1_5' } };
  }
}

export const isPasskeyAlg = (v: unknown): v is PasskeyAlg => PASSKEY_ALGS.includes(v as PasskeyAlg);

/** 등록할 공개 키가 실제로 읽히는지 확인 */
export async function checkPublicKey(spki: Uint8Array, alg: PasskeyAlg): Promise<void> {
  try {
    await crypto.subtle.importKey('spki', spki, importParams(alg).key, false, ['verify']);
  } catch {
    throw new PasskeyError('이 기기의 패스키 형식은 아직 지원하지 않습니다.');
  }
}

/** ECDSA 서명은 DER(ASN.1)로 오지만 WebCrypto는 r‖s(각 32바이트)를 받는다 */
function derToRaw(der: Uint8Array): Uint8Array {
  const fail = () => {
    throw new PasskeyError('잘못된 패스키 서명입니다.');
  };
  let i = 0;
  if (der[i++] !== 0x30) fail();
  if (der[i] & 0x80) i += 1 + (der[i] & 0x7f);
  else i++;
  const out = new Uint8Array(64);
  for (let part = 0; part < 2; part++) {
    if (der[i++] !== 0x02) fail();
    const len = der[i++];
    let int = der.subarray(i, i + len);
    i += len;
    while (int.length > 32 && int[0] === 0) int = int.subarray(1);
    if (int.length > 32) fail();
    out.set(int, part * 32 + (32 - int.length));
  }
  return out;
}

/** 로그인 서명 확인: 서명 대상은 인증 데이터 ‖ SHA-256(클라이언트 데이터) */
export async function verifySignature(spki: Uint8Array, alg: PasskeyAlg, authData: Uint8Array, clientData: Uint8Array, signature: Uint8Array): Promise<boolean> {
  const params = importParams(alg);
  const key = await crypto.subtle.importKey('spki', spki, params.key, false, ['verify']);
  const signed = new Uint8Array(authData.length + 32);
  signed.set(authData);
  signed.set(await sha256(clientData), authData.length);
  const sig = alg === -7 ? derToRaw(signature) : signature;
  return crypto.subtle.verify(params.verify, key, sig, signed);
}
