import { create } from 'zustand';
import type { ShapeType } from '@shared/schema';

export type Tool = 'select' | 'hand' | ShapeType;

interface DesignState {
  tool: Tool;
  selection: string[];
  editingId: string | null;
  showGrid: boolean;
  snap: boolean;
  setTool(tool: Tool): void;
  setSelection(ids: string[]): void;
  setEditing(id: string | null): void;
  toggleGrid(): void;
  toggleSnap(): void;
}

const read = (k: string, d: boolean) => {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v === '1';
  } catch {
    return d;
  }
};
const write = (k: string, v: boolean) => {
  try {
    localStorage.setItem(k, v ? '1' : '0');
  } catch {
    /* 무시 */
  }
};

export const useDesign = create<DesignState>((set, get) => ({
  tool: 'select',
  selection: [],
  editingId: null,
  showGrid: read('lt.design.grid', true),
  snap: read('lt.design.snap', false),
  setTool: (tool) => set({ tool }),
  setSelection: (selection) => set({ selection }),
  setEditing: (editingId) => set({ editingId }),
  toggleGrid: () => {
    write('lt.design.grid', !get().showGrid);
    set({ showGrid: !get().showGrid });
  },
  toggleSnap: () => {
    write('lt.design.snap', !get().snap);
    set({ snap: !get().snap });
  },
}));

export const PALETTE = ['#ffffff', '#f1f5f9', '#94a3b8', '#1f2937', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
export const STICKY_COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#ddd6fe', '#fed7aa'];
export const BOARD_BACKGROUNDS = ['', '#ffffff', '#f8fafc', '#fefce8', '#f0fdf4', '#eff6ff', '#1e1e24'];
