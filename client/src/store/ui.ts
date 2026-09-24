import { create } from 'zustand';

interface UIState {
  paletteOpen: boolean;
  profileOpen: boolean;
  shortcutsOpen: boolean;
  shareOpen: boolean;
  newNoteOpen: boolean;
  setNewNoteOpen(v: boolean): void;
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
  setNewNoteOpen: (newNoteOpen) => set({ newNoteOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setProfileOpen: (profileOpen) => set({ profileOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setShareOpen: (shareOpen) => set({ shareOpen }),
}));
