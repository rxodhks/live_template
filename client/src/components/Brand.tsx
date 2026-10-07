/**
 * Madang 로고 "열린 마당": 아래가 열린 링(누구나 들어올 수 있는 마당)과 가운데 주황 점(지금 함께 하는 작업).
 * 링은 글자색을 따라가 라이트 · 다크 테마 모두에서 보인다. 파비콘(public/favicon.svg)도 같은 모양이다.
 */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden style={{ overflow: 'visible' }}>
      <path d="M33.10 81.79 A36 36 0 1 1 66.90 81.79" fill="none" stroke="currentColor" strokeWidth="13" strokeLinecap="round" />
      <circle cx="50" cy="50" r="12" fill="#ff7a45" />
    </svg>
  );
}

export const BRAND = 'Madang';
/** 개인정보처리방침 · 이용약관에 표시되는 운영자와 공개 문의처 */
export const OPERATOR = 'Madang 운영팀';
export { CONTACT_EMAIL } from '@shared/contact';
