import { useEffect, useState } from 'react';
import type * as Y from 'yjs';
import type { Shape, ShapeType } from '@shared/schema';
import { newId } from '../../lib/util';
import { STICKY_COLORS } from './store';

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
};
