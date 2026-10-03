import { create } from 'zustand';
import type { ShapeType } from '@shared/schema';

export type Tool = 'select' | 'hand' | 'eraser' | ShapeType;

/** 펜으로 그리기 전에 고르는 색 · 굵기 · 형광펜 (이 브라우저에 기억) */
export interface PenStyle {
  color: string;
  width: number;
  highlighter: boolean;
}

interface DesignState {
  tool: Tool;
  selection: string[];
  editingId: string | null;
  showGrid: boolean;
  snap: boolean;
  pen: PenStyle;
  setPen(patch: Partial<PenStyle>): void;
  /** 이미지로 내보낼 때 배경을 비울지 */
  clearExport: boolean;
  toggleClearExport(): void;
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

export const PEN_COLORS = ['#1f2937', '#ffffff', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];
export const PEN_WIDTHS = [
  { width: 2, label: '얇게' },
  { width: 4, label: '보통' },
  { width: 8, label: '굵게' },
];
/** 형광펜: 반투명으로 겹쳐 칠한다 */
export const HIGHLIGHTER_OPACITY = 0.35;
const DEFAULT_PEN: PenStyle = { color: '#3b82f6', width: 4, highlighter: false };

const readPen = (): PenStyle => {
  try {
    const v = JSON.parse(localStorage.getItem('lt.design.pen') ?? 'null');
    if (v && typeof v.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.color) && Number.isFinite(v.width) && v.width > 0 && v.width <= 40)
      return { color: v.color, width: v.width, highlighter: !!v.highlighter };
  } catch {
    /* 무시 */
  }
  return DEFAULT_PEN;
};

export const useDesign = create<DesignState>((set, get) => ({
  tool: 'select',
  selection: [],
  editingId: null,
  showGrid: read('lt.design.grid', true),
  snap: read('lt.design.snap', false),
  pen: readPen(),
  clearExport: read('lt.design.clearExport', false),
  toggleClearExport: () => {
    write('lt.design.clearExport', !get().clearExport);
    set({ clearExport: !get().clearExport });
  },
  setPen: (patch) => {
    const pen = { ...get().pen, ...patch };
    try {
      localStorage.setItem('lt.design.pen', JSON.stringify(pen));
    } catch {
      /* 무시 */
    }
    set({ pen });
  },
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
