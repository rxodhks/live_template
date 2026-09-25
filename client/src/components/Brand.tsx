/**
 * Madang 로고: 마당의 첫 글자 ㅁ(네모난 마당) 안에 모인 사람(노란 점).
 * 파비콘(public/favicon.svg)도 같은 모양이다.
 */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <rect x="8.5" y="8.5" width="15" height="15" rx="3.5" fill="none" stroke="#fff" strokeWidth="3" />
      <circle cx="16" cy="16" r="3" fill="#ffd166" />
    </svg>
  );
}

export const BRAND = 'Madang';
