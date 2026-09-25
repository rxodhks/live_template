import { create } from 'zustand';
import type { InviteInfo } from '@shared/types';

interface UIState {
  paletteOpen: boolean;
  profileOpen: boolean;
  shortcutsOpen: boolean;
  shareOpen: boolean;
  newNoteOpen: boolean;
  /** 방금 만든 초대 링크 (개인 → 협업 전환 중 화면이 다시 그려져도 유지) */
  createdInvite: InviteInfo | null;
  inviteBusy: boolean;
  setNewNoteOpen(v: boolean): void;
  setPaletteOpen(v: boolean): void;
  setProfileOpen(v: boolean): void;
  setShortcutsOpen(v: boolean): void;
  setShareOpen(v: boolean): void;
  setCreatedInvite(v: InviteInfo | null): void;
  setInviteBusy(v: boolean): void;
}

export const useUI = create<UIState>((set) => ({
  paletteOpen: false,
  profileOpen: false,
  shortcutsOpen: false,
  shareOpen: false,
  newNoteOpen: false,
  createdInvite: null,
  inviteBusy: false,
  setNewNoteOpen: (newNoteOpen) => set({ newNoteOpen }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setProfileOpen: (profileOpen) => set({ profileOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setShareOpen: (shareOpen) => set(shareOpen ? { shareOpen } : { shareOpen, createdInvite: null }),
  setCreatedInvite: (createdInvite) => set({ createdInvite }),
  setInviteBusy: (inviteBusy) => set({ inviteBusy }),
}));
