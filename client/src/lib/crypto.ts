import type { NoteKdf } from '@shared/types';

/*
 * 비밀 노트 종단 간 암호화 (브라우저 WebCrypto)
 * ──────────────────────────────────────────────
 *  비밀번호 ──PBKDF2-SHA256(60만 회)──▶ 512비트
 *     ├─ 앞 256비트: AES-256-GCM 키   → 노트 내용 암호화 (브라우저 밖으로 나가지 않음)
 *     └─ 뒤 256비트: 확인값(verifier) → 서버는 SHA-256(확인값)만 저장해 비밀번호가 맞는지만 확인
 *  서버·클라우드 운영자는 키를 알 수 없으므로 내용을 읽을 수 없다.
 */

export const NOTE_ITERATIONS = 600_000;
const IV_BYTES = 12;

export interface NoteKeys {
  key: CryptoKey;
  verifier: string;
}

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const toB64Url = (bytes: Uint8Array) => toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function newKdf(): NoteKdf {
  return { salt: toB64(crypto.getRandomValues(new Uint8Array(16))), iterations: NOTE_ITERATIONS };
}

export async function deriveNoteKeys(password: string, kdf: NoteKdf): Promise<NoteKeys> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(kdf.salt), iterations: kdf.iterations }, base, 512),
  );
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { key, verifier: toB64Url(bits.slice(32)) };
}

export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** iv(12바이트) + 암호문을 base64로. aad(노트 ID)를 묶어 다른 노트의 암호문으로 바꿔치기할 수 없게 한다 */
export async function encryptBytes(key: CryptoKey, plain: Uint8Array, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }, key, plain as Uint8Array<ArrayBuffer>),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return toB64(out);
}

export async function decryptBytes(key: CryptoKey, data: string, aad: string): Promise<Uint8Array> {
  const bytes = fromB64(data);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.subarray(0, IV_BYTES), additionalData: new TextEncoder().encode(aad) },
    key,
    bytes.subarray(IV_BYTES),
  );
  return new Uint8Array(plain);
}
