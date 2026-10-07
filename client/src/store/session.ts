import { create } from 'zustand';
import type { AccountInfo, PublicUser } from '@shared/types';

export type ThemePref = 'system' | 'light' | 'dark';

const THEME_KEY = 'lt.theme';

/** 고른 적이 없으면 다크 테마로 시작한다 (마당의 기본 화면). 시스템 설정을 따르려면 'system'을 고른다 */
function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'dark';
  } catch {
    return 'dark';
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

/** loading: 로그인 확인 중 · authed: 로그인됨 · anon: 로그인 필요 · down: 서버에 연결할 수 없고 이 기기에 로그인 정보도 없음 */
export type AuthStatus = 'loading' | 'authed' | 'anon' | 'down';

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
  /** 서버 장애 안내 화면으로 (code: 응답 코드, 연결 자체가 안 되면 0) */
  setDown(code: number): void;
  /** 장애 안내 화면에 보일 응답 코드 */
  downCode: number;
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
  downCode: 0,
  setDown: (code) => set({ user: null, account: null, status: 'down', offline: false, downCode: code }),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* 무시 */
    }
    applyTheme(theme);
    set({ theme });
  },
}));
