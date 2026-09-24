import { useEffect, useReducer, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import { sortedItems, type YItem } from '@shared/schema';

/**
 * 최상위 Y.Map(파일/문서/보드 목록)을 구독한다.
 * 항목 추가/삭제와 각 항목의 속성(이름, 언어 등) 변경에만 반응하고
 * 본문(Y.Text 등) 편집에는 다시 그리지 않는다.
 */
export function useYItems(map: Y.Map<YItem> | null | undefined): YItem[] {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!map) return;
    const observed = new Set<YItem>();
    const onChild = () => force();
    const sync = () => {
      for (const item of observed) item.unobserve(onChild);
      observed.clear();
      map.forEach((item) => {
        item.observe(onChild);
        observed.add(item);
      });
    };
    const onTop = () => {
      sync();
      force();
    };
    sync();
    map.observe(onTop);
    force();
    return () => {
      map.unobserve(onTop);
      for (const item of observed) item.unobserve(onChild);
    };
  }, [map]);
  return map ? sortedItems(map) : [];
}

/** Y.Map의 특정 키 값을 구독 */
export function useYField<T>(map: Y.Map<unknown> | null | undefined, key: string): T | undefined {
  return useSyncExternalStore(
    (cb) => {
      if (!map) return () => {};
      const h = (e: Y.YMapEvent<unknown>) => {
        if (e.keysChanged.has(key)) cb();
      };
      map.observe(h);
      return () => map.unobserve(h);
    },
    () => (map ? (map.get(key) as T) : undefined),
  );
}

/** Y 타입 변경 시 다시 그리기 (얕은 관찰) */
export function useYObserve(type: Y.AbstractType<any> | null | undefined, deep = false): number {
  const [n, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!type) return;
    const h = () => force();
    if (deep) type.observeDeep(h);
    else type.observe(h);
    return () => {
      if (deep) type.unobserveDeep(h);
      else type.unobserve(h);
    };
  }, [type, deep]);
  return n;
}
