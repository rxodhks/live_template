import { create } from 'zustand';
import type { CursorPoint, PresenceState } from '@shared/types';

export interface RemotePresence extends PresenceState {
  /** 커서 옆 말풍선 라벨이 표시되기 시작한 시각 */
  actionAt?: number;
  actionLabel?: string;
}

interface PresenceStore {
  mySocketId: string | null;
  others: Record<string, RemotePresence>;
  reset(list: PresenceState[], mySocketId: string | null): void;
  upsert(p: PresenceState): void;
  remove(socketId: string): void;
  setCursor(socketId: string, cursor: CursorPoint | null): void;
  setAction(socketId: string, label: string): void;
  clear(): void;
}

export const usePresence = create<PresenceStore>((set) => ({
  mySocketId: null,
  others: {},
  reset: (list, mySocketId) =>
    set({
      mySocketId,
      others: Object.fromEntries(list.filter((p) => p.socketId !== mySocketId).map((p) => [p.socketId, p])),
    }),
  upsert: (p) =>
    set((s) => {
      if (p.socketId === s.mySocketId) return s;
      const prev = s.others[p.socketId];
      return { others: { ...s.others, [p.socketId]: { ...prev, ...p, actionAt: prev?.actionAt, actionLabel: prev?.actionLabel } } };
    }),
  remove: (socketId) =>
    set((s) => {
      if (!s.others[socketId]) return s;
      const others = { ...s.others };
      delete others[socketId];
      return { others };
    }),
  setCursor: (socketId, cursor) =>
    set((s) => {
      const prev = s.others[socketId];
      return prev ? { others: { ...s.others, [socketId]: { ...prev, cursor } } } : s;
    }),
  setAction: (socketId, label) =>
    set((s) => {
      const prev = s.others[socketId];
      return prev ? { others: { ...s.others, [socketId]: { ...prev, actionLabel: label, actionAt: Date.now() } } } : s;
    }),
  clear: () => set({ others: {}, mySocketId: null }),
}));

/** 특정 사용자의 프레즌스 (탭이 여러 개면 자리 비움이 아닌 최근 탭 우선) */
export function pickUserPresence(others: Record<string, RemotePresence>, userId: string | null): RemotePresence | undefined {
  if (!userId) return undefined;
  let found: RemotePresence | undefined;
  for (const p of Object.values(others)) {
    if (p.user.id !== userId) continue;
    if (!found || (found.idle && !p.idle) || !p.idle) found = p;
  }
  return found;
}

export const useUserPresence = (userId: string | null) => usePresence((s) => pickUserPresence(s.others, userId));

/** 같은 사용자의 여러 탭을 하나로 묶은 온라인 사용자 목록 */
export function uniqueUsers(others: Record<string, RemotePresence>): RemotePresence[] {
  const byUser = new Map<string, RemotePresence>();
  for (const p of Object.values(others)) {
    const existing = byUser.get(p.user.id);
    if (!existing || (existing.idle && !p.idle)) byUser.set(p.user.id, p);
  }
  return Array.from(byUser.values());
}
