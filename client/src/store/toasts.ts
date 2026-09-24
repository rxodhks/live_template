import { create } from 'zustand';
import type { ToastPayload } from '@shared/types';

export interface Toast extends ToastPayload {
  id: string;
  createdAt: number;
  duration: number;
  /** 페이드 아웃 진행 중 */
  leaving: boolean;
}

export const TOAST_FADE_MS = 320;
const MAX_VISIBLE = 5;

interface ToastState {
  toasts: Toast[];
  push(t: ToastPayload): string;
  dismiss(id: string): void;
  remove(id: string): void;
}

let seq = 0;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (payload) => {
    const id = payload.id ?? `t${++seq}`;
    const toast: Toast = {
      ...payload,
      id,
      createdAt: Date.now(),
      duration: payload.duration ?? (payload.kind === 'danger' ? 5500 : 4200),
      leaving: false,
    };
    set((s) => {
      const list = [...s.toasts.filter((t) => t.id !== id), toast];
      // 너무 많이 쌓이면 가장 오래된 것부터 페이드 아웃
      const active = list.filter((t) => !t.leaving);
      if (active.length > MAX_VISIBLE) {
        const oldest = active[0];
        setTimeout(() => get().dismiss(oldest.id), 0);
      }
      return { toasts: list };
    });
    return id;
  },
  dismiss: (id) => {
    const t = get().toasts.find((x) => x.id === id);
    if (!t || t.leaving) return;
    set((s) => ({ toasts: s.toasts.map((x) => (x.id === id ? { ...x, leaving: true } : x)) }));
    setTimeout(() => get().remove(id), TOAST_FADE_MS);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  show: (t: ToastPayload) => useToasts.getState().push(t),
  success: (title: string, message?: string) => useToasts.getState().push({ kind: 'success', title, message }),
  info: (title: string, message?: string) => useToasts.getState().push({ kind: 'info', title, message }),
  warning: (title: string, message?: string) => useToasts.getState().push({ kind: 'warning', title, message }),
  error: (title: string, message?: string) => useToasts.getState().push({ kind: 'danger', title, message }),
};
