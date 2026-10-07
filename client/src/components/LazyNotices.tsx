import { lazy, Suspense } from 'react';

/** 공지 알림(components/Notices.tsx)은 첫 화면이 뜬 뒤 따로 불러온다 */
const Bell = lazy(() => import('./Notices').then((m) => ({ default: m.NoticeBell })));
const Banner = lazy(() => import('./Notices').then((m) => ({ default: m.NoticeBanner })));

export const NoticeBell = () => (
  <Suspense fallback={null}>
    <Bell />
  </Suspense>
);
export const NoticeBanner = () => (
  <Suspense fallback={null}>
    <Banner />
  </Suspense>
);
