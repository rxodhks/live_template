import type { Shape } from '@shared/schema';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const isLine = (s: Pick<Shape, 'type'>) => s.type === 'line' || s.type === 'arrow';

type Geo = Pick<Shape, 'x' | 'y' | 'w' | 'h'> & Partial<Pick<Shape, 'type' | 'bend'>>;

/**
 * 선/화살표의 모양. 화살표는 가운데를 끌어 휠 수 있다 (2차 곡선).
 *  · (x1,y1)→(x2,y2): 양 끝
 *  · (mx,my): 곡선의 가운데 = 휘기 손잡이 자리
 *  · (cx,cy): 곡선 조절점 (가운데가 손잡이 위치를 지나도록 2배 거리)
 */
export interface LineGeom {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  mx: number;
  my: number;
  cx: number;
  cy: number;
  curved: boolean;
}

export function lineGeom(s: Geo): LineGeom {
  const x1 = s.x;
  const y1 = s.y;
  const x2 = s.x + s.w;
  const y2 = s.y + s.h;
  const bend = s.type === 'arrow' ? s.bend ?? 0 : 0;
  const len = Math.hypot(s.w, s.h) || 1;
  // 시작→끝 방향의 왼쪽 수직 방향
  const nx = -s.h / len;
  const ny = s.w / len;
  const hx = (x1 + x2) / 2;
  const hy = (y1 + y2) / 2;
  return { x1, y1, x2, y2, mx: hx + nx * bend, my: hy + ny * bend, cx: hx + nx * bend * 2, cy: hy + ny * bend * 2, curved: bend !== 0 };
}

/** 포인터 위치로 휜 정도 구하기 (가운데 손잡이가 포인터를 따라가도록 수직 성분만) */
export function bendAt(s: Geo, px: number, py: number): number {
  const len = Math.hypot(s.w, s.h) || 1;
  return (px - (s.x + s.w / 2)) * (-s.h / len) + (py - (s.y + s.h / 2)) * (s.w / len);
}

/** 끝을 back만큼 줄인 선 경로 (화살표 머리 아래로 선 끝이 삐져나오지 않게) */
export function linePath(g: LineGeom, back = 0): string {
  let { x2, y2 } = g;
  if (back > 0) {
    const tx = x2 - (g.curved ? g.cx : g.x1);
    const ty = y2 - (g.curved ? g.cy : g.y1);
    const tl = Math.hypot(tx, ty) || 1;
    const k = Math.min(back, tl * 0.5) / tl;
    x2 -= tx * k;
    y2 -= ty * k;
  }
  const f = (v: number) => Math.round(v * 100) / 100;
  return g.curved ? `M${f(g.x1)},${f(g.y1)} Q${f(g.cx)},${f(g.cy)} ${f(x2)},${f(y2)}` : `M${f(g.x1)},${f(g.y1)} L${f(x2)},${f(y2)}`;
}

/** 끝점에서의 진행 방향 (화살표 머리 각도) */
export const endAngle = (g: LineGeom) => Math.atan2(g.y2 - (g.curved ? g.cy : g.y1), g.x2 - (g.curved ? g.cx : g.x1));

/** 2차 곡선이 한 축에서 차지하는 범위 */
function quadRange(a: number, c: number, b: number): [number, number] {
  let lo = Math.min(a, b);
  let hi = Math.max(a, b);
  const den = a - 2 * c + b;
  if (den !== 0) {
    const t = (a - c) / den;
    if (t > 0 && t < 1) {
      const v = (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  return [lo, hi];
}

/** 음수 크기(선/화살표)를 정규화한 경계 상자 — 휜 화살표는 곡선이 지나는 곳까지 */
export function boundsOf(s: Geo): Box {
  if (s.type === 'arrow' && s.bend) {
    const g = lineGeom(s);
    const [x1, x2] = quadRange(g.x1, g.cx, g.x2);
    const [y1, y2] = quadRange(g.y1, g.cy, g.y2);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  const x = Math.min(s.x, s.x + s.w);
  const y = Math.min(s.y, s.y + s.h);
  return { x, y, w: Math.abs(s.w), h: Math.abs(s.h) };
}

export function unionBounds(shapes: Geo[]): Box | null {
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

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'start' | 'end' | 'bend';

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
