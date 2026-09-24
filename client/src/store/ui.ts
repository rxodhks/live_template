import { create } from 'zustand';

export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface UIState {
  paletteOpen: boolean;
  profileOpen: boolean;
  shortcutsOpen: boolean;
  shareOpen: boolean;
  newNoteOpen: boolean;
  /** 모바일: 왼쪽 내비게이션 서랍 */
  navOpen: boolean;
  /** 브라우저가 제공한 "앱 설치" 이벤트 (Android Chrome 등) */
  installPrompt: InstallPromptEvent | null;
  setNewNoteOpen(v: boolean): void;
  setNavOpen(v: boolean): void;
  setInstallPrompt(e: InstallPromptEvent | null): void;
  setPaletteOpen(v: boolean): void;
  setProfileOpen(v: boolean): void;
  setShortcutsOpen(v: boolean): void;
  setShareOpen(v: boolean): void;
}

export const useUI = create<UIState>((set) => ({
  paletteOpen: false,
  profileOpen: false,
  shortcutsOpen: false,
  shareOpen: false,
  newNoteOpen: false,
  navOpen: false,
  installPrompt: null,
  setNewNoteOpen: (newNoteOpen) => set({ newNoteOpen }),
  setNavOpen: (navOpen) => set({ navOpen }),
  setInstallPrompt: (installPrompt) => set({ installPrompt }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setProfileOpen: (profileOpen) => set({ profileOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setShareOpen: (shareOpen) => set({ shareOpen }),
}));
