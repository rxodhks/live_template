import { useState } from 'react';
import type { PageUnit, Shape, YItem } from '@shared/schema';
import { useYField } from '../../hooks/useY';
import { ALL_PRESETS, type PagePreset, UNIT_DECIMALS, fromPx, isPageUnit, roundTo, toPx } from '../docs/page/pageSizes';

/*
 * 디자인 보드의 크기 단위.
 * 도형 좌표 · 크기는 늘 CSS px(96dpi)로 저장하고, 보여 주고 입력받을 때만 고른 단위로 바꾼다.
 */

/** 아트보드가 크기를 정한 단위 (예전 아트보드는 고른 형식의 단위, 모르면 px) */
export function frameUnit(f: Pick<Shape, 'unit' | 'preset'>): PageUnit {
  if (isPageUnit(f.unit)) return f.unit;
  return ALL_PRESETS.find((p) => p.id === f.preset)?.unit ?? 'px';
}

/** 아트보드가 아직 고른 형식 크기 그대로인지 (가로 · 세로 방향 모두) — 끌어서 크기를 바꿨으면 없음 */
export function framePreset(f: Pick<Shape, 'preset' | 'w' | 'h'>): PagePreset | undefined {
  const p = ALL_PRESETS.find((x) => x.id === f.preset);
  if (!p) return undefined;
  const pw = toPx(p.width, p.unit);
  const ph = toPx(p.height, p.unit);
  const near = (a: number, b: number) => Math.abs(a - b) < 1;
  return (near(f.w, pw) && near(f.h, ph)) || (near(f.w, ph) && near(f.h, pw)) ? p : undefined;
}

const fmt = (v: number) => String(v);

/** 아트보드 크기를 그 단위로 — 형식 그대로면 반올림 오차 없이 형식의 값 (A4 = 210 × 297 mm) */
export function frameSize(f: Pick<Shape, 'unit' | 'preset' | 'w' | 'h'>): { w: number; h: number; unit: PageUnit } {
  const unit = frameUnit(f);
  const p = framePreset(f);
  if (p && p.unit === unit) {
    const portrait = f.h >= f.w;
    const [a, b] = [Math.min(p.width, p.height), Math.max(p.width, p.height)];
    return portrait ? { w: a, h: b, unit } : { w: b, h: a, unit };
  }
  const d = unit === 'px' ? 0 : UNIT_DECIMALS[unit];
  return { w: roundTo(fromPx(f.w, unit), d), h: roundTo(fromPx(f.h, unit), d), unit };
}

/** "210 × 297 mm" */
export function frameSizeText(f: Pick<Shape, 'unit' | 'preset' | 'w' | 'h'>): string {
  const s = frameSize(f);
  return `${fmt(s.w)} × ${fmt(s.h)} ${s.unit}`;
}

const unitKey = (boardId: string) => `lt.design.unit.${boardId}`;

function readUnit(boardId: string): PageUnit | null {
  try {
    const v = localStorage.getItem(unitKey(boardId));
    return isPageUnit(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * 속성 패널에서 쓸 단위. 내가 고른 단위는 이 브라우저에 보드별로 기억한다 (다른 사람 화면은 그대로).
 * 고른 적이 없으면 보드를 만들 때의 단위 → 첫 아트보드의 단위 → px.
 */
export function useBoardUnit(board: YItem, shapes: Shape[]): [PageUnit, (u: PageUnit) => void] {
  const boardId = board.get('id') as string;
  const boardUnit = useYField<string>(board, 'unit');
  const [mine, setMine] = useState(() => ({ boardId, unit: readUnit(boardId) }));
  // 다른 보드로 옮기면 그 보드에서 고른 단위를 다시 읽는다
  const current = mine.boardId === boardId ? mine.unit : readUnit(boardId);
  if (mine.boardId !== boardId) setMine({ boardId, unit: current });
  const firstFrame = shapes.find((s) => s.type === 'frame');
  const unit = current ?? (isPageUnit(boardUnit) ? boardUnit : firstFrame ? frameUnit(firstFrame) : 'px');
  const set = (u: PageUnit) => {
    setMine({ boardId, unit: u });
    try {
      localStorage.setItem(unitKey(boardId), u);
    } catch {
      /* 저장 못 해도 이번 화면에서는 적용 */
    }
  };
  return [unit, set];
}
