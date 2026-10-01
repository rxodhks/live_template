import { createElement, useEffect, useReducer, type ComponentType } from 'react';

/**
 * 필요할 때 불러오는 화면 (React.lazy 대신).
 * React.lazy는 Suspense로 멈췄다가 다시 그리는데, React 19는 Suspense 대체 화면이 나온 뒤
 * 300ms가 지나기 전에는 다시 그린 화면을 내보내지 않는다 (파일이 일찍 도착해도 기다린다).
 * 여기서는 멈추지 않고 대체 화면을 직접 그렸다가, 파일이 도착하면 곧바로 바꾼다.
 * preload()로 미리 받아 두면 대체 화면 없이 바로 그린다.
 */
export function lazyWithPreload<P extends object>(load: () => Promise<ComponentType<P>>, Fallback: ComponentType = () => null) {
  let loaded: ComponentType<P> | null = null;
  let failed: unknown = null;
  let pending: Promise<ComponentType<P>> | null = null;
  const get = () =>
    (pending ??= load().then(
      (c) => (loaded = c),
      (err: unknown) => {
        // 네트워크 오류였다면 다음에 다시 시도할 수 있게
        pending = null;
        failed = err;
        throw err;
      },
    ));

  function Preloadable(props: P) {
    const [, rerender] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
      if (!loaded) get().then(rerender, rerender);
    }, []);
    if (loaded) return createElement(loaded, props);
    if (failed) {
      const err = failed;
      failed = null;
      throw err;
    }
    return createElement(Fallback);
  }
  return Object.assign(Preloadable, {
    preload: () => void get().catch(() => {}),
  });
}

/** 브라우저가 한가할 때 실행 (지원하지 않으면 잠시 뒤) */
export function whenIdle(fn: () => void): () => void {
  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(fn, { timeout: 3000 });
    return () => window.cancelIdleCallback(id);
  }
  const t = setTimeout(fn, 1000);
  return () => clearTimeout(t);
}
