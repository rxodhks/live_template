import { create } from 'zustand';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

interface ConnectionState {
  status: ConnectionStatus;
  /** 서버 확인을 기다리는 문서 변경 수 */
  pending: number;
  /** 연결이 끊긴 동안 로컬에만 있는 변경이 있음 */
  offlineChanges: boolean;
  lastSavedAt: number | null;
  saveError: string | null;
  setStatus(status: ConnectionStatus): void;
  addPending(delta: number): void;
  markSaved(): void;
  setOfflineChanges(v: boolean): void;
  setSaveError(e: string | null): void;
}

export const useConnection = create<ConnectionState>((set) => ({
  status: 'connecting',
  pending: 0,
  offlineChanges: false,
  lastSavedAt: null,
  saveError: null,
  setStatus: (status) => set({ status }),
  addPending: (delta) => set((s) => ({ pending: Math.max(0, s.pending + delta) })),
  markSaved: () => set({ lastSavedAt: Date.now(), saveError: null }),
  setOfflineChanges: (offlineChanges) => set({ offlineChanges }),
  setSaveError: (saveError) => set({ saveError }),
}));
