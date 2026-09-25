import { create } from 'zustand';
import type { LivePen } from '@shared/protocol';

/*
 * 다른 사람이 지금 그리고 있는 펜 선 (저장 전 미리보기).
 * 점이 도착하는 대로 이어 붙이고, 완성되어 문서에 저장되면 캔버스가 지운다.
 */

export interface RemotePen {
  id: string;
  sid: string;
  board: string;
  pts: number[];
  style: { stroke: string; strokeWidth: number; opacity: number };
  committed: boolean;
  updatedAt: number;
}

interface LiveState {
  pens: Record<string, RemotePen>;
  receivePen(sid: string, p: LivePen): void;
  removePen(id: string): void;
  removeBySid(sid: string): void;
  clear(): void;
}

/** 이 시간 동안 소식이 없으면(연결 끊김 등) 미리보기를 지운다 */
const STALE_MS = 4000;

export const useLive = create<LiveState>((set, get) => ({
  pens: {},
  receivePen: (sid, p) =>
    set((s) => {
      if (!p || typeof p.id !== 'string' || !Array.isArray(p.pts)) return s;
      const prev = s.pens[p.id];
      if (p.end === 'cancel') {
        if (!prev) return s;
        const pens = { ...s.pens };
        delete pens[p.id];
        return { pens };
      }
      const style = p.style ?? prev?.style ?? { stroke: '#1f2937', strokeWidth: 3, opacity: 1 };
      const pen: RemotePen = {
        id: p.id,
        sid,
        board: p.board,
        pts: prev ? prev.pts.concat(p.pts) : p.pts.slice(),
        style,
        committed: p.end === 'commit' || !!prev?.committed,
        updatedAt: Date.now(),
      };
      return { pens: { ...s.pens, [p.id]: pen } };
    }),
  removePen: (id) =>
    set((s) => {
      if (!s.pens[id]) return s;
      const pens = { ...s.pens };
      delete pens[id];
      return { pens };
    }),
  removeBySid: (sid) => {
    const ids = Object.values(get().pens)
      .filter((p) => p.sid === sid)
      .map((p) => p.id);
    ids.forEach((id) => get().removePen(id));
  },
  clear: () => set({ pens: {} }),
}));

// 오래된 미리보기 정리
setInterval(() => {
  const now = Date.now();
  for (const p of Object.values(useLive.getState().pens)) if (now - p.updatedAt > STALE_MS) useLive.getState().removePen(p.id);
}, 1000);
