import { create } from 'zustand';
import type { AccountInfo, PublicUser } from '@shared/types';

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

/** loading: 로그인 확인 중 · authed: 로그인됨 · anon: 로그인 필요 */
export type AuthStatus = 'loading' | 'authed' | 'anon';

interface SessionState {
  /** 로그인한 사용자 (사이트에서 표시되는 이름 · 커서 색상 · 아바타) */
  user: PublicUser | null;
  /** 로그인 이메일과 연결된 외부 계정 (본인에게만 보인다) */
  account: AccountInfo | null;
  status: AuthStatus;
  /** 서버에 연결할 수 없어 이 기기에 저장된 로그인 정보로 시작했는지 */
  offline: boolean;
  theme: ThemePref;
  setAuthed(user: PublicUser, account: AccountInfo | null, offline?: boolean): void;
  setUser(user: PublicUser): void;
  setAnon(): void;
  setTheme(theme: ThemePref): void;
}

export const useSession = create<SessionState>((set) => ({
  user: null,
  account: null,
  status: 'loading',
  offline: false,
  theme: readTheme(),
  setAuthed: (user, account, offline = false) => set({ user, account, status: 'authed', offline }),
  setUser: (user) => set({ user }),
  setAnon: () => set({ user: null, account: null, status: 'anon', offline: false }),
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
