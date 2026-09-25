import { useSyncExternalStore } from 'react';

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
  );
}

/** 휴대폰 크기 화면 (CSS의 모바일 구간과 동일) */
export const MOBILE_QUERY = '(max-width: 768px)';
export const useIsMobile = () => useMediaQuery(MOBILE_QUERY);
export const isMobileNow = () => window.matchMedia(MOBILE_QUERY).matches;

/** 손가락으로 조작하는 기기 */
export const useIsTouch = () => useMediaQuery('(hover: none) and (pointer: coarse)');
