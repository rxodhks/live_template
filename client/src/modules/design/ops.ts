import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import type { PageUnit, Shape, ShapeType } from '@shared/schema';
import { newId } from '../../lib/util';
import { STICKY_COLORS } from './store';
import { boundsOf, contains } from './geometry';

export type ShapeMap = Y.Map<Shape>;

export function sortedShapes(map: ShapeMap): Shape[] {
  return Array.from(map.values()).sort((a, b) => a.z - b.z);
}

/** 보드의 도형 목록 구독 (z 순서) */
export function useShapes(map: ShapeMap): Shape[] {
  const [shapes, setShapes] = useState(() => sortedShapes(map));
  useEffect(() => {
    const h = () => setShapes(sortedShapes(map));
    h();
    map.observe(h);
    return () => map.unobserve(h);
  }, [map]);
  return shapes;
}

export const maxZ = (map: ShapeMap) => Math.max(0, ...Array.from(map.values()).map((s) => s.z));
export const minZ = (map: ShapeMap) => Math.min(0, ...Array.from(map.values()).map((s) => s.z));

export function updateShapes(map: ShapeMap, patches: Record<string, Partial<Shape>>): void {
  const doc = map.doc!;
  doc.transact(() => {
    for (const [id, patch] of Object.entries(patches)) {
      const cur = map.get(id);
      if (cur) map.set(id, { ...cur, ...patch });
    }
  });
}

export function deleteShapes(map: ShapeMap, ids: string[]): void {
  map.doc!.transact(() => ids.forEach((id) => map.delete(id)));
}

export function insertShapes(map: ShapeMap, shapes: Shape[]): void {
  map.doc!.transact(() => shapes.forEach((s) => map.set(s.id, s)));
}

let stickyIndex = 0;

export function defaultShape(type: ShapeType, x: number, y: number, z: number, createdBy: string): Shape {
  const base: Shape = {
    id: newId(),
    type,
    x,
    y,
    w: 0,
    h: 0,
    fill: '#ffffff',
    stroke: '#1f2937',
    strokeWidth: 2,
    opacity: 1,
    z,
    createdBy,
  };
  switch (type) {
    case 'rect':
      return { ...base, fill: '#e0e7ff', stroke: '#6366f1', radius: 8, fontSize: 18, textColor: '#1f2937' };
    case 'ellipse':
      return { ...base, fill: '#dcfce7', stroke: '#22c55e', fontSize: 18, textColor: '#1f2937' };
    case 'diamond':
      return { ...base, fill: '#fef3c7', stroke: '#f59e0b', fontSize: 16, textColor: '#1f2937' };
    case 'line':
    case 'arrow':
      return { ...base, fill: 'transparent', stroke: '#1f2937', strokeWidth: 3 };
    case 'pen':
      return { ...base, fill: 'transparent', stroke: '#3b82f6', strokeWidth: 4, points: [] };
    case 'text':
      return { ...base, fill: 'transparent', stroke: 'transparent', strokeWidth: 0, text: '', fontSize: 22, textColor: '#111827', align: 'left' };
    case 'frame':
      return { ...base, fill: '#ffffff', stroke: 'transparent', strokeWidth: 0, name: '아트보드' };
    case 'sticky':
      return {
        ...base,
        fill: STICKY_COLORS[stickyIndex++ % STICKY_COLORS.length],
        stroke: 'transparent',
        strokeWidth: 0,
        radius: 4,
        text: '',
        fontSize: 18,
        textColor: '#1f2937',
        align: 'left',
      };
  }
}

/** 클릭만 했을 때(드래그 없이) 만들어지는 기본 크기 */
export const DEFAULT_SIZE: Record<ShapeType, [number, number]> = {
  rect: [160, 100],
  ellipse: [120, 120],
  diamond: [140, 110],
  line: [160, 0],
  arrow: [160, 0],
  pen: [0, 0],
  text: [220, 34],
  sticky: [180, 140],
  frame: [393, 852],
};

/* ───────── 아트보드(frame) ───────── */

/** 아트보드 안에 완전히 들어 있는(아트보드보다 위에 그려진) 도형 — 아트보드를 옮기거나 복제하면 함께 */
export function frameChildren(all: Shape[], frame: Shape): Shape[] {
  const fb = boundsOf(frame);
  return all.filter((s) => s.id !== frame.id && s.type !== 'frame' && s.z > frame.z && contains(fb, boundsOf(s)));
}

/** 고른 도형 + 그 안의 아트보드 속 도형 (중복 없이) */
export function withFrameChildren(all: Shape[], selected: Shape[]): Shape[] {
  const out = new Map(selected.map((s) => [s.id, s]));
  for (const s of selected) if (s.type === 'frame') for (const c of frameChildren(all, s)) out.set(c.id, c);
  return Array.from(out.values());
}

/** 복사본을 놓을 간격 — 아트보드가 있으면 기존 아트보드들 오른쪽에 나란히, 아니면 조금 비껴서 */
function copyOffset(map: ShapeMap, source: Shape[], offset: number): { dx: number; dy: number } {
  const srcFrames = source.filter((s) => s.type === 'frame');
  if (!srcFrames.length) return { dx: offset, dy: offset };
  const allFrames = Array.from(map.values()).filter((s) => s.type === 'frame');
  const right = Math.max(...allFrames.map((f) => boundsOf(f).x + boundsOf(f).w));
  const left = Math.min(...srcFrames.map((f) => boundsOf(f).x));
  return { dx: right - left + 80, dy: 0 };
}

/** 복사본 만들기: 아트보드는 맨 뒤, 나머지는 원래 순서대로 맨 앞에 (아트보드가 안의 도형을 가리지 않게) */
export function copyShapes(map: ShapeMap, source: Shape[], offset: number, createdBy: string): Shape[] {
  const { dx, dy } = copyOffset(map, source, offset);
  let top = maxZ(map);
  let bottom = minZ(map);
  const ordered = [...source].sort((a, b) => a.z - b.z);
  const frames = ordered.filter((s) => s.type === 'frame').reverse();
  const copies = new Map<string, Shape>();
  for (const s of frames) copies.set(s.id, { ...s, id: newId(), x: s.x + dx, y: s.y + dy, z: --bottom, locked: false, createdBy });
  for (const s of ordered) if (s.type !== 'frame') copies.set(s.id, { ...s, id: newId(), x: s.x + dx, y: s.y + dy, z: ++top, locked: false, createdBy });
  const list = ordered.map((s) => copies.get(s.id)!);
  insertShapes(map, list);
  return list;
}

/** 새 아트보드 (크기는 CSS px, unit은 크기를 정한 단위) — 다른 도형을 가리지 않게 맨 뒤에 */
export function newFrame(map: ShapeMap, box: { x: number; y: number; w: number; h: number }, name: string, preset: string, unit: PageUnit, createdBy: string): Shape {
  return { ...defaultShape('frame', box.x, box.y, minZ(map) - 1, createdBy), w: box.w, h: box.h, name, preset, unit };
}
