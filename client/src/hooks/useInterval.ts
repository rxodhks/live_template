import { useEffect, useReducer } from 'react';

/** 상대 시간 표시 등을 위해 주기적으로 다시 그리기 */
export function useTick(ms = 30_000): number {
  const [n, tick] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const id = setInterval(tick, ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}
