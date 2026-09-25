import { create } from 'zustand';
import type { PublicUser } from '@shared/types';

export type ThemePref = 'system' | 'light' | 'dark';

const THEME_KEY = 'lt.theme';

function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(pref: ThemePref): void {
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
}

export function resolvedTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

interface SessionState {
  /** 이 브라우저의 프로필. 협업을 시작하면 서버 계정과 같은 ID가 된다 */
  user: PublicUser | null;
  /** 협업 서버 계정이 있는지 (처음 초대하거나 초대를 받을 때 자동으로 만들어진다) */
  hasAccount: boolean;
  ready: boolean;
  theme: ThemePref;
  setUser(user: PublicUser | null): void;
  setHasAccount(v: boolean): void;
  setReady(ready: boolean): void;
  setTheme(theme: ThemePref): void;
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  hasAccount: false,
  ready: false,
  theme: readTheme(),
  setUser: (user) => set({ user }),
  setHasAccount: (hasAccount) => set({ hasAccount }),
  setReady: (ready) => set({ ready }),
  setTheme: (theme) => {
    try {
      if (theme === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* 무시 */
    }
    applyTheme(theme);
    set({ theme });
  },
}));
