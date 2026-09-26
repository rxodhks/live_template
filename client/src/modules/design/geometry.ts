import type { Shape } from '@shared/schema';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const isLine = (s: Pick<Shape, 'type'>) => s.type === 'line' || s.type === 'arrow';

/** 음수 크기(선/화살표)를 정규화한 경계 상자 */
export function boundsOf(s: Pick<Shape, 'x' | 'y' | 'w' | 'h'>): Box {
  const x = Math.min(s.x, s.x + s.w);
  const y = Math.min(s.y, s.y + s.h);
  return { x, y, w: Math.abs(s.w), h: Math.abs(s.h) };
}

export function unionBounds(shapes: Pick<Shape, 'x' | 'y' | 'w' | 'h'>[]): Box | null {
  if (shapes.length === 0) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const s of shapes) {
    const b = boundsOf(s);
    x1 = Math.min(x1, b.x);
    y1 = Math.min(y1, b.y);
    x2 = Math.max(x2, b.x + b.w);
    y2 = Math.max(y2, b.y + b.h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** inner가 outer 안에 완전히 들어 있는지 */
export const contains = (outer: Box, inner: Box) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

export const intersects = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export const snapTo = (v: number, on: boolean, step = 8) => (on ? Math.round(v / step) * step : v);

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'start' | 'end';

/** 핸들을 끌어 크기를 바꾼 새 상자 */
export function resizeBox(orig: Box, handle: Handle, px: number, py: number, keepRatio: boolean): Box {
  let x1 = orig.x;
  let y1 = orig.y;
  let x2 = orig.x + orig.w;
  let y2 = orig.y + orig.h;
  if (handle.includes('w')) x1 = px;
  if (handle.includes('e')) x2 = px;
  if (handle.includes('n')) y1 = py;
  if (handle.includes('s')) y2 = py;
  let box = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(4, Math.abs(x2 - x1)), h: Math.max(4, Math.abs(y2 - y1)) };
  if (keepRatio && orig.w > 0 && orig.h > 0 && handle.length === 2) {
    const ratio = orig.w / orig.h;
    if (box.w / box.h > ratio) box = { ...box, h: box.w / ratio };
    else box = { ...box, w: box.h * ratio };
    if (handle.includes('w')) box.x = orig.x + orig.w - box.w;
    if (handle.includes('n')) box.y = orig.y + orig.h - box.h;
  }
  return box;
}

/** Shift를 누르면 45° 단위로 각도 고정 */
export function snapAngle(dx: number, dy: number): { dx: number; dy: number } {
  const len = Math.hypot(dx, dy);
  const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { dx: Math.round(Math.cos(angle) * len), dy: Math.round(Math.sin(angle) * len) };
}

/* ───────── 텍스트 줄바꿈 (SVG에는 자동 줄바꿈이 없으므로 직접 계산) ───────── */

const FONT_FAMILY = "'Pretendard Variable', Pretendard, system-ui, sans-serif";
let ctx: CanvasRenderingContext2D | null = null;

export function wrapText(text: string, fontSize: number, maxWidth: number): string[] {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return text.split('\n');
  ctx.font = `500 ${fontSize}px ${FONT_FAMILY}`;
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    if (!para) {
      lines.push('');
      continue;
    }
    let current = '';
    const measure = (t: string) => ctx!.measureText(t).width;
    // 공백 단위로 나누되, 한 단어가 너무 길면 글자 단위로 자른다 (공백 없는 한국어 문장 대응)
    for (const token of para.split(/(\s+)/)) {
      if (!token) continue;
      const candidate = current + token;
      if (measure(candidate) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current.trim()) lines.push(current.trimEnd());
      let rest = token.trimStart();
      while (rest.length > 1 && measure(rest) > maxWidth) {
        let lo = 1;
        let hi = rest.length - 1;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (measure(rest.slice(0, mid)) <= maxWidth) lo = mid;
          else hi = mid - 1;
        }
        lines.push(rest.slice(0, lo));
        rest = rest.slice(lo);
      }
      current = rest;
    }
    lines.push(current);
  }
  return lines;
}

export const TEXT_FONT = FONT_FAMILY;
export const lineHeight = (fontSize: number) => Math.round(fontSize * 1.35);
