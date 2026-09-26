import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { SHAPE_LABEL, type PageSetup, type Shape, type YItem } from '@shared/schema';
import type { Viewport } from '@shared/types';
import { useWorkspace } from '../../workspace/context';
import { useSession } from '../../store/session';
import { useUserPresence } from '../../store/presence';
import { useIsTouch } from '../../hooks/useMedia';
import { useYField } from '../../hooks/useY';
import { RemoteCursor, useViewers, ACTION_BUBBLE_MS } from '../../components/Cursors';
import { useLive, type RemotePen } from '../../store/live';
import type { LivePen } from '@shared/protocol';
import { isTypingTarget, throttle } from '../../lib/util';
import { useDesign, type Tool } from './store';
import { ShapeView } from './ShapeView';
import { type Box, type Handle, bendAt, boundsOf, contains, intersects, isLine, lineGeom, lineHeight, linePath, resizeBox, snapAngle, snapTo, unionBounds, wrapText, TEXT_FONT } from './geometry';
import { DEFAULT_SIZE, copyShapes, defaultShape, deleteShapes, insertShapes, maxZ, newFrame, updateShapes, useShapes, withFrameChildren, type ShapeMap } from './ops';
import { promptDialog } from '../../components/ui';
import { pagePx } from '../docs/page/pageSizes';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; orig: Viewport }
  | { kind: 'move'; start: { x: number; y: number }; orig: Map<string, { x: number; y: number }>; moved: boolean }
  | { kind: 'resize'; id: string; handle: Handle; orig: Shape }
  | { kind: 'create'; id: string; start: { x: number; y: number }; type: Shape['type'] }
  | { kind: 'pen'; shape: Shape; points: number[]; sent: number; announced: boolean; timer: ReturnType<typeof setTimeout> | null }
  | { kind: 'marquee'; start: { x: number; y: number }; base: string[] }
  | { kind: 'pinch'; startDist: number; startMid: { x: number; y: number }; orig: Viewport };

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

const TOOL_KEYS: Record<string, Tool> = { v: 'select', h: 'hand', r: 'rect', o: 'ellipse', d: 'diamond', l: 'line', a: 'arrow', p: 'pen', t: 'text', s: 'sticky' };
const TEXT_TYPES = new Set(['rect', 'ellipse', 'diamond', 'sticky', 'text']);
/** 그리는 중인 펜 선의 새 점을 모아 보내는 간격 */
const PEN_LIVE_MS = 80;
/** 받는 쪽에서 도착한 점을 드러내는 시간 (도착 간격 + 여유) */
const PEN_REVEAL_MS = 120;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;
/** 휘기 손잡이를 직선 가까이(화면 px) 가져가면 곧은 화살표로 붙는다 */
const BEND_SNAP_PX = 6;

/** 복사/붙여넣기용 (탭 안에서 유지) */
let clipboard: Shape[] = [];

export interface CanvasApi {
  /** 아트보드 추가 (정해진 크기, 기존 아트보드 오른쪽 또는 화면 가운데) */
  addFrame(page: PageSetup, name: string): void;
  zoomBy(factor: number): void;
  zoomTo(zoom: number): void;
  fit(): void;
  undo(): void;
  redo(): void;
  svg(): SVGSVGElement | null;
}

interface Props {
  board: YItem;
  onApi?: (api: CanvasApi) => void;
  onZoom?: (zoom: number) => void;
  /** 아트보드 추가 창 열기 (F) */
  onAddArtboard?: () => void;
}

export function DesignCanvas({ board, onApi, onZoom, onAddArtboard }: Props) {
  const onAddArtboardRef = useRef(onAddArtboard);
  onAddArtboardRef.current = onAddArtboard;
  const ws = useWorkspace();
  const me = useSession((s) => s.user)!;
  const boardId = board.get('id') as string;
  const boardName = useYField<string>(board, 'name') ?? '';
  const background = useYField<string>(board, 'background') ?? '';
  const map = board.get('shapes') as ShapeMap;
  const shapes = useShapes(map);
  const byId = useMemo(() => new Map(shapes.map((s) => [s.id, s])), [shapes]);
  const { tool, setTool, selection, setSelection, editingId, setEditing, showGrid, snap } = useDesign();
  const readOnly = !ws.canEdit;
  const isTouch = useIsTouch();
  /** 화면에 닿아 있는 손가락들 (두 손가락 확대/이동용) */
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const lastPointerType = useRef('mouse');

  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<Viewport>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`lt.vp.${boardId}`) ?? 'null');
      if (saved && Number.isFinite(saved.zoom)) return saved;
    } catch {
      /* 무시 */
    }
    return { x: 80, y: 60, zoom: 1 };
  });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [spaceDown, setSpaceDown] = useState(false);
  const [marquee, setMarquee] = useState<Box | null>(null);
  const drag = useRef<Drag | null>(null);
  const [dragKind, setDragKind] = useState<Drag['kind'] | null>(null);
  /** 내가 그리고 있는 펜 선 (손을 뗄 때 한 번만 문서에 저장) */
  const [draft, setDraft] = useState<{ points: number[]; stroke: string; strokeWidth: number; opacity: number } | null>(null);
  const [, bump] = useState(0);

  const undo = useMemo(() => new Y.UndoManager(map, { captureTimeout: 400 }), [map]);
  useEffect(() => () => undo.destroy(), [undo]);

  const report = useCallback(
    (type: 'design.shape.add' | 'design.shape.delete' | 'design.edit', detail?: string) =>
      ws.report({ type, targetId: boardId, targetName: boardName, detail }),
    [ws, boardId, boardName],
  );

  /* ── 크기/뷰포트 ── */
  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const saveViewport = useMemo(
    () =>
      throttle((v: Viewport) => {
        try {
          localStorage.setItem(`lt.vp.${boardId}`, JSON.stringify(v));
        } catch {
          /* 무시 */
        }
      }, 500),
    [boardId],
  );

  useEffect(() => {
    saveViewport(view);
    onZoom?.(view.zoom);
    // 따라가기를 위해 화면 중심(월드 좌표)과 배율을 공유
    ws.updatePresence({ viewport: { x: (size.w / 2 - view.x) / view.zoom, y: (size.h / 2 - view.y) / view.zoom, zoom: view.zoom } });
  }, [view, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAround = useCallback((factor: number, sx?: number, sy?: number) => {
    setView((v) => {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      const cx = sx ?? (wrapRef.current?.clientWidth ?? 0) / 2;
      const cy = sy ?? (wrapRef.current?.clientHeight ?? 0) / 2;
      return { zoom, x: cx - ((cx - v.x) * zoom) / v.zoom, y: cy - ((cy - v.y) * zoom) / v.zoom };
    });
  }, []);

  const fit = useCallback(() => {
    const b = unionBounds(Array.from(map.values()));
    const el = wrapRef.current;
    if (!el) return;
    if (!b) {
      setView({ x: 80, y: 60, zoom: 1 });
      return;
    }
    const pad = 80;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((el.clientWidth - pad * 2) / Math.max(b.w, 1), (el.clientHeight - pad * 2) / Math.max(b.h, 1), 1.5)));
    setView({ zoom, x: el.clientWidth / 2 - (b.x + b.w / 2) * zoom, y: el.clientHeight / 2 - (b.y + b.h / 2) * zoom });
  }, [map]);

  // 처음 여는 보드는 내용에 맞춘다
  useEffect(() => {
    if (!localStorage.getItem(`lt.vp.${boardId}`) && map.size > 0) requestAnimationFrame(fit);
  }, [boardId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 새 아트보드: 기존 아트보드 오른쪽에 나란히 (없으면 화면 가운데), 그리고 그 아트보드로 화면을 맞춘다 */
  const addFrame = useCallback(
    (page: PageSetup, name: string) => {
      const px = pagePx(page);
      const w = Math.round(px.width);
      const h = Math.round(px.height);
      const frames = Array.from(map.values()).filter((x) => x.type === 'frame');
      const v = viewRef.current;
      const el = wrapRef.current;
      const x = frames.length ? Math.max(...frames.map((f) => boundsOf(f).x + boundsOf(f).w)) + 80 : Math.round(((el?.clientWidth ?? 800) / 2 - v.x) / v.zoom - w / 2);
      const y = frames.length ? Math.min(...frames.map((f) => boundsOf(f).y)) : Math.round(((el?.clientHeight ?? 600) / 2 - v.y) / v.zoom - h / 2);
      const frame = newFrame(map, { x, y, w, h }, name, page.preset, me.id);
      insertShapes(map, [frame]);
      useDesign.getState().setSelection([frame.id]);
      useDesign.getState().setTool('select');
      if (el) {
        const pad = 80;
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((el.clientWidth - pad * 2) / w, (el.clientHeight - pad * 2) / h, 1)));
        setView({ zoom, x: el.clientWidth / 2 - (x + w / 2) * zoom, y: el.clientHeight / 2 - (y + h / 2) * zoom });
      }
      ws.action(`▢ 아트보드 추가 · ${name}`);
      ws.report({ type: 'design.shape.add', targetId: boardId, targetName: boardName, detail: `아트보드 ${name}` });
    },
    [map, me.id, ws, boardId, boardName],
  );

  useEffect(() => {
    onApi?.({
      addFrame,
      zoomBy: (f) => zoomAround(f),
      zoomTo: (z) => zoomAround(z / viewRef.current.zoom),
      fit,
      undo: () => undo.undo(),
      redo: () => undo.redo(),
      svg: () => svgRef.current,
    });
  }, [onApi, zoomAround, fit, undo, addFrame]);

  /* ── 선택 공유 & 정리 ── */
  useEffect(() => {
    const alive = selection.filter((id) => byId.has(id));
    if (alive.length !== selection.length) setSelection(alive);
  }, [byId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    ws.updatePresence({ selection });
  }, [selection]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () => () => {
      ws.updatePresence({ selection: [] });
      useDesign.getState().setSelection([]);
      useDesign.getState().setEditing(null);
    },
    [boardId], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /* ── 따라가기: 상대의 화면 중심/배율에 맞춘다 ── */
  const followed = useUserPresence(ws.follow);
  useEffect(() => {
    const vp = followed?.viewport;
    if (!vp || followed.view.module !== 'design' || followed.view.itemId !== boardId) return;
    setView({ zoom: vp.zoom, x: size.w / 2 - vp.x * vp.zoom, y: size.h / 2 - vp.y * vp.zoom });
  }, [followed?.viewport, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopFollow = () => ws.follow && ws.setFollow(null);

  /* ── 좌표 변환 ── */
  const toWorld = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
  };
  const toScreen = (x: number, y: number) => ({ x: x * view.zoom + view.x, y: y * view.zoom + view.y });

  /* ── 포인터 ── */
  const frame = useRef<number | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const schedule = (fn: () => void) => {
    pending.current = fn;
    if (frame.current === null)
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        pending.current?.();
        pending.current = null;
      });
  };

  /** 그리는 중인 펜 선: 지난번 이후 새로 생긴 점만 보낸다 */
  const sendPen = (d: Extract<Drag, { kind: 'pen' }>, end?: LivePen['end']) => {
    if (d.timer) clearTimeout(d.timer);
    d.timer = null;
    const pts = d.points.slice(d.sent).map((v) => Math.round(v * 10) / 10);
    d.sent = d.points.length;
    if (!pts.length && !end) return;
    const msg: LivePen = { id: d.shape.id, board: boardId, pts, end };
    if (!d.announced) msg.style = { stroke: d.shape.stroke, strokeWidth: d.shape.strokeWidth, opacity: d.shape.opacity };
    d.announced = true;
    ws.live('pen', msg);
  };

  const beginDrag = (d: Drag, pointerId: number) => {
    drag.current = d;
    setDragKind(d.kind);
    // 도형을 끄는 동안에는 다른 사람 화면에서 끊기지 않도록 더 자주 동기화
    if (d.kind === 'move' || d.kind === 'resize' || d.kind === 'create') ws.provider.setLive?.(true);
    svgRef.current?.setPointerCapture(pointerId);
  };

  /** 두 번째 손가락이 닿으면 진행 중이던 조작을 취소한다 (방금 만들던 도형은 지움) */
  const cancelDrag = () => {
    const d = drag.current;
    if (d?.kind === 'create') deleteShapes(map, [d.id]);
    if (d?.kind === 'pen') {
      sendPen(d, 'cancel');
      setDraft(null);
    }
    ws.provider.setLive?.(false);
    drag.current = null;
    setMarquee(null);
    undo.stopCapturing();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    lastPointerType.current = e.pointerType;
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size >= 2) {
        const [a, b] = Array.from(touches.current.values());
        cancelDrag();
        stopFollow();
        lastTap.current = null;
        beginDrag({ kind: 'pinch', startDist: dist(a, b), startMid: mid(a, b), orig: viewRef.current }, e.pointerId);
        return;
      }
      // 더블 탭 = 더블 클릭 (텍스트 편집)
      const now = Date.now();
      const lt = lastTap.current;
      if (lt && now - lt.t < 320 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 24) {
        lastTap.current = null;
        openAt(e.target as Element, e.clientX, e.clientY);
        return;
      }
      lastTap.current = { t: now, x: e.clientX, y: e.clientY };
    }
    if (editingId && !(e.target as Element).closest('.canvas-textedit')) finishEditing();
    stopFollow();
    wrapRef.current?.focus({ preventScroll: true });
    const v = viewRef.current;
    if (e.button === 1 || tool === 'hand' || spaceDown) {
      e.preventDefault();
      beginDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, orig: v }, e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const p = toWorld(e.clientX, e.clientY);
    const target = e.target as Element;
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle') as Handle | null;
    const shapeId = target.closest('[data-shape-id]')?.getAttribute('data-shape-id') ?? null;

    if (tool === 'select' || readOnly) {
      if (handle && selection.length === 1 && !readOnly) {
        const s = byId.get(selection[0]);
        if (s && !s.locked) beginDrag({ kind: 'resize', id: s.id, handle, orig: s }, e.pointerId);
        return;
      }
      if (shapeId) {
        let sel = selection;
        if (e.shiftKey) sel = selection.includes(shapeId) ? selection.filter((x) => x !== shapeId) : [...selection, shapeId];
        else if (!selection.includes(shapeId)) sel = [shapeId];
        setSelection(sel);
        if (readOnly) return;
        const orig = new Map<string, { x: number; y: number }>();
        // 아트보드를 옮기면 안에 그린 도형도 함께
        const picked = sel.map((id) => byId.get(id)).filter((s): s is Shape => !!s);
        for (const s of withFrameChildren(shapes, picked)) if (!s.locked) orig.set(s.id, { x: s.x, y: s.y });
        if (orig.size) beginDrag({ kind: 'move', start: p, orig, moved: false }, e.pointerId);
        return;
      }
      const base = e.shiftKey ? selection : [];
      if (!e.shiftKey) setSelection([]);
      // 손가락으로 빈 곳을 끌면 화면 이동 (영역 선택은 마우스로)
      if (e.pointerType === 'touch') {
        beginDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, orig: v }, e.pointerId);
        return;
      }
      beginDrag({ kind: 'marquee', start: p, base }, e.pointerId);
      return;
    }

    // 도형 만들기
    const x = snapTo(p.x, snap);
    const y = snapTo(p.y, snap);
    const shape = defaultShape(tool as Shape['type'], x, y, maxZ(map) + 1, me.id);
    if (tool === 'pen') {
      // 그리는 동안은 문서에 쓰지 않고 내 화면에만 그린다. 다른 사람에게는 새 점만 짧게 중계
      const d: Drag = { kind: 'pen', shape, points: [p.x, p.y], sent: 0, announced: false, timer: null };
      beginDrag(d, e.pointerId);
      setDraft({ points: d.points.slice(), stroke: shape.stroke, strokeWidth: shape.strokeWidth, opacity: shape.opacity });
      sendPen(d);
      ws.action('✏️ 펜으로 그리는 중');
      return;
    }
    insertShapes(map, [shape]);
    setSelection([shape.id]);
    beginDrag({ kind: 'create', id: shape.id, start: { x, y }, type: shape.type }, e.pointerId);
    ws.action(`${SHAPE_LABEL[shape.type]} 그리는 중`);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (d?.kind === 'pinch') {
      if (touches.current.size < 2) return;
      const [a, b] = Array.from(touches.current.values());
      const r = svgRef.current!.getBoundingClientRect();
      const o = d.orig;
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (o.zoom * dist(a, b)) / d.startDist));
      // 처음 두 손가락 가운데 있던 지점이 지금 가운데에 오도록
      const wx = (d.startMid.x - r.left - o.x) / o.zoom;
      const wy = (d.startMid.y - r.top - o.y) / o.zoom;
      const m = mid(a, b);
      setView({ zoom, x: m.x - r.left - wx * zoom, y: m.y - r.top - wy * zoom });
      return;
    }
    const p = toWorld(e.clientX, e.clientY);
    // 펜으로 그리는 중에는 선 끝이 곧 커서 위치라 따로 보내지 않는다
    if (d?.kind !== 'pen') ws.publishCursor(p);
    if (!d) return;
    switch (d.kind) {
      case 'pan':
        setView({ ...d.orig, x: d.orig.x + e.clientX - d.sx, y: d.orig.y + e.clientY - d.sy });
        return;
      case 'move': {
        const first = d.orig.values().next().value!;
        let dx = p.x - d.start.x;
        let dy = p.y - d.start.y;
        if (snap) {
          dx = snapTo(first.x + dx, true) - first.x;
          dy = snapTo(first.y + dy, true) - first.y;
        }
        if (!d.moved && Math.hypot(dx, dy) * viewRef.current.zoom < 2) return;
        d.moved = true;
        ws.action('↔️ 도형 이동 중');
        schedule(() => {
          const patches: Record<string, Partial<Shape>> = {};
          for (const [id, o] of d.orig) patches[id] = { x: o.x + dx, y: o.y + dy };
          updateShapes(map, patches);
        });
        return;
      }
      case 'resize': {
        const o = d.orig;
        const px = snapTo(p.x, snap);
        const py = snapTo(p.y, snap);
        ws.action(d.handle === 'bend' ? '↪️ 화살표 휘는 중' : isLine(o) ? '⤡ 끝점 옮기는 중' : '⤡ 크기 조절 중');
        schedule(() => {
          if (isLine(o)) {
            if (d.handle === 'bend') {
              // 가운데 손잡이: 포인터 쪽으로 휘고, 직선 가까이 오면 다시 곧게
              const bend = bendAt(o, p.x, p.y);
              updateShapes(map, { [o.id]: { bend: Math.abs(bend) * viewRef.current.zoom < BEND_SNAP_PX ? 0 : Math.round(bend) } });
            } else if (d.handle === 'start') {
              // 반대쪽 끝은 그대로 두고 이 끝만 옮긴다 (Shift: 45° 단위)
              const ex = o.x + o.w;
              const ey = o.y + o.h;
              const v = e.shiftKey ? snapAngle(px - ex, py - ey) : { dx: px - ex, dy: py - ey };
              updateShapes(map, { [o.id]: { x: ex + v.dx, y: ey + v.dy, w: -v.dx, h: -v.dy } });
            } else {
              const v = e.shiftKey ? snapAngle(px - o.x, py - o.y) : { dx: px - o.x, dy: py - o.y };
              updateShapes(map, { [o.id]: { w: v.dx, h: v.dy } });
            }
          } else {
            updateShapes(map, { [o.id]: resizeBox(boundsOf(o), d.handle, px, py, e.shiftKey || o.type === 'pen') });
          }
        });
        return;
      }
      case 'create': {
        const px = snapTo(p.x, snap);
        const py = snapTo(p.y, snap);
        schedule(() => {
          if (d.type === 'line' || d.type === 'arrow') {
            const v = e.shiftKey ? snapAngle(px - d.start.x, py - d.start.y) : { dx: px - d.start.x, dy: py - d.start.y };
            updateShapes(map, { [d.id]: { w: v.dx, h: v.dy } });
          } else {
            let w = px - d.start.x;
            let h = py - d.start.y;
            if (e.shiftKey) {
              const m = Math.max(Math.abs(w), Math.abs(h));
              w = Math.sign(w || 1) * m;
              h = Math.sign(h || 1) * m;
            }
            updateShapes(map, { [d.id]: { x: Math.min(d.start.x, d.start.x + w), y: Math.min(d.start.y, d.start.y + h), w: Math.abs(w), h: Math.abs(h) } });
          }
        });
        return;
      }
      case 'pen': {
        const last = d.points.length - 2;
        if (Math.hypot(p.x - d.points[last], p.y - d.points[last + 1]) * viewRef.current.zoom < 2) return;
        d.points.push(p.x, p.y);
        schedule(() => setDraft((cur) => (cur ? { ...cur, points: d.points.slice() } : cur)));
        if (!d.timer) d.timer = setTimeout(() => sendPen(d), PEN_LIVE_MS);
        return;
      }
      case 'marquee': {
        const box = { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) };
        setMarquee(box);
        // 아트보드는 통째로 감쌌을 때만 (안쪽에서 끌면 안의 도형만 고른다)
        const hit = shapes.filter((s) => (s.type === 'frame' ? contains(box, boundsOf(s)) : intersects(boundsOf(s), box))).map((s) => s.id);
        setSelection(Array.from(new Set([...d.base, ...hit])));
        return;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch') touches.current.delete(e.pointerId);
    if (drag.current?.kind === 'pinch') {
      svgRef.current?.releasePointerCapture?.(e.pointerId);
      // 두 손가락을 모두 뗄 때까지 다른 조작을 시작하지 않는다
      if (touches.current.size === 0) {
        drag.current = null;
        setDragKind(null);
      }
      return;
    }
    const d = drag.current;
    drag.current = null;
    setDragKind(null);
    setMarquee(null);
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
      pending.current?.();
      pending.current = null;
    }
    svgRef.current?.releasePointerCapture?.(e.pointerId);
    ws.provider.setLive?.(false);
    if (!d) return;
    if (d.kind === 'create') {
      const s = map.get(d.id);
      if (s) {
        const tiny = isLine(s) ? Math.hypot(s.w, s.h) < 6 : s.w < 6 && s.h < 6;
        if (tiny) {
          const [w, h] = DEFAULT_SIZE[s.type];
          updateShapes(map, { [s.id]: isLine(s) ? { w, h } : { x: s.x - w / 2, y: s.y - h / 2, w, h } });
        } else if (s.type === 'text' || s.type === 'sticky') {
          updateShapes(map, { [s.id]: { w: Math.max(s.w, 60), h: Math.max(s.h, 34) } });
        }
        setTool('select');
        if (TEXT_TYPES.has(s.type) && (s.type === 'text' || s.type === 'sticky')) setEditing(s.id);
        ws.action(`➕ ${SHAPE_LABEL[s.type]} 추가`);
        report('design.shape.add', SHAPE_LABEL[s.type]);
      }
    } else if (d.kind === 'pen') {
      setDraft(null);
      if (d.points.length < 4) sendPen(d, 'cancel');
      else {
        // 완성된 선을 한 번에 저장 (그리는 동안 매 프레임 문서에 쓰지 않음)
        insertShapes(map, [{ ...d.shape, ...penPatch(d.points) }]);
        sendPen(d, 'commit');
        ws.action('✏️ 펜 드로잉 추가');
        report('design.shape.add', SHAPE_LABEL.pen);
      }
    } else if ((d.kind === 'move' && d.moved) || d.kind === 'resize') {
      report('design.edit');
    }
    undo.stopCapturing();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    // 터치는 직접 더블 탭을 감지하므로 브라우저의 dblclick은 무시
    if (lastPointerType.current === 'touch') return;
    // 첫 클릭의 끌기에서 캔버스가 포인터를 잡고 있었으면 e.target이 캔버스 전체가 되므로, 실제로 누른 곳의 요소를 찾는다
    openAt(document.elementFromPoint(e.clientX, e.clientY) ?? (e.target as Element), e.clientX, e.clientY);
  };

  /** 도형의 글자를 편집하거나, 빈 곳이면 새 텍스트 상자를 만든다 */
  function openAt(target: Element, clientX: number, clientY: number) {
    if (readOnly) return;
    // 손잡이를 두 번 누른 경우: 휘기 손잡이면 곧게 펴고, 나머지는 아무 것도 하지 않는다 (새 텍스트 상자 X)
    const handle = target.closest('[data-handle]')?.getAttribute('data-handle');
    if (handle) {
      const s = selection.length === 1 ? byId.get(selection[0]) : undefined;
      if (handle === 'bend' && s?.bend && !s.locked) {
        updateShapes(map, { [s.id]: { bend: 0 } });
        ws.action('➖ 화살표 곧게 펴기');
      }
      return;
    }
    const shapeId = target.closest('[data-shape-id]')?.getAttribute('data-shape-id');
    const s = shapeId ? byId.get(shapeId) : undefined;
    // 아트보드 이름표를 두 번 누르면 이름 바꾸기
    if (s?.type === 'frame' && !s.locked) {
      void promptDialog({ title: '아트보드 이름', label: '이름', initial: s.name ?? '', confirmText: '바꾸기' }).then((v) => v && updateShapes(map, { [s.id]: { name: v.slice(0, 60) } }));
      return;
    }
    if (s && TEXT_TYPES.has(s.type) && !s.locked) {
      setSelection([s.id]);
      setEditing(s.id);
      return;
    }
    if (!s && tool === 'select') {
      const p = toWorld(clientX, clientY);
      const shape = { ...defaultShape('text', p.x, p.y - 17, maxZ(map) + 1, me.id), w: 220, h: 34 };
      insertShapes(map, [shape]);
      setSelection([shape.id]);
      setEditing(shape.id);
      report('design.shape.add', SHAPE_LABEL.text);
    }
  }

  /* ── 휠: 이동 / Ctrl+휠: 확대 ── */
  useEffect(() => {
    const el = wrapRef.current!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element).closest('.canvas-textedit')) return;
      e.preventDefault();
      if (ws.follow) ws.setFollow(null);
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect();
        zoomAround(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      } else {
        setView((v) => ({ ...v, x: v.x - (e.shiftKey ? e.deltaY : e.deltaX), y: v.y - (e.shiftKey ? 0 : e.deltaY) }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAround, ws]);

  /* ── 키보드 ── */
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || document.querySelector('.modal-backdrop')) return;
      const st = useDesign.getState();
      const sel = st.selection;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (e.key === ' ') {
        setSpaceDown(true);
        e.preventDefault();
        return;
      }
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) undo.redo();
        else undo.undo();
        ws.action(e.shiftKey ? '↪️ 다시 실행' : '↩️ 실행 취소');
        return;
      }
      if (mod && key === 'y') {
        e.preventDefault();
        undo.redo();
        return;
      }
      if (mod && key === 'a') {
        e.preventDefault();
        st.setSelection(shapesRef.current.map((s) => s.id));
        return;
      }
      if (mod && key === 'c') {
        clipboard = withFrameChildren(shapesRef.current, sel.map((id) => map.get(id)).filter((s): s is Shape => !!s));
        return;
      }
      if (e.key === 'Escape') {
        if (sel.length) st.setSelection([]);
        else st.setTool('select');
        return;
      }
      if (e.shiftKey && e.code === 'Digit1') {
        fit();
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        zoomAround(1 / viewRef.current.zoom);
        return;
      }
      if ((e.key === '=' || e.key === '+') && !mod) return zoomAround(1.2);
      if (e.key === '-' && !mod) return zoomAround(1 / 1.2);
      if (readOnly) return;
      if (mod && key === 'v' && clipboard.length) {
        e.preventDefault();
        pasteShapes(clipboard, 24);
        return;
      }
      if (mod && key === 'd') {
        e.preventDefault();
        pasteShapes(withFrameChildren(shapesRef.current, sel.map((id) => map.get(id)).filter((s): s is Shape => !!s)), 20);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) {
        e.preventDefault();
        const removable = sel.filter((id) => !map.get(id)?.locked);
        deleteShapes(map, removable);
        st.setSelection([]);
        ws.action(`🗑 도형 ${removable.length}개 삭제`);
        report('design.shape.delete', `${removable.length}개`);
        return;
      }
      if (e.key.startsWith('Arrow') && sel.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const patches: Record<string, Partial<Shape>> = {};
        for (const id of sel) {
          const s = map.get(id);
          if (s && !s.locked) patches[id] = { x: s.x + dx, y: s.y + dy };
        }
        updateShapes(map, patches);
        return;
      }
      if (e.key === ']' || e.key === '[') {
        reorder(sel, e.key === ']' ? 'up' : 'down');
        return;
      }
      if (!mod && !e.altKey && key === 'f') {
        e.preventDefault();
        onAddArtboardRef.current?.();
        return;
      }
      if (!mod && !e.altKey && TOOL_KEYS[key]) st.setTool(TOOL_KEYS[key]);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceDown(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [map, undo, readOnly, fit, zoomAround]); // eslint-disable-line react-hooks/exhaustive-deps

  const pasteShapes = (source: Shape[], offset: number) => {
    if (!source.length) return;
    // 아트보드는 맨 뒤, 안의 도형은 원래 순서대로 맨 앞에
    const copies = copyShapes(map, source, offset, me.id);
    setSelection(copies.map((s) => s.id));
    clipboard = copies;
    ws.action(`📋 도형 ${copies.length}개 복제`);
    report('design.shape.add', `복제 ${copies.length}개`);
  };

  const reorder = (ids: string[], dir: 'up' | 'down') => {
    const list = shapesRef.current;
    const patches: Record<string, Partial<Shape>> = {};
    const ordered = dir === 'up' ? [...ids].reverse() : ids;
    for (const id of ordered) {
      const i = list.findIndex((s) => s.id === id);
      const j = dir === 'up' ? i + 1 : i - 1;
      if (i < 0 || j < 0 || j >= list.length) continue;
      patches[id] = { z: list[j].z };
      patches[list[j].id] = { z: list[i].z };
    }
    updateShapes(map, patches);
  };

  /* ── 텍스트 편집 ── */
  const editing = editingId ? byId.get(editingId) : undefined;
  const finishEditing = () => {
    const s = editingId ? map.get(editingId) : undefined;
    setEditing(null);
    if (s && s.type === 'text' && !s.text?.trim()) deleteShapes(map, [s.id]);
    else if (s) report('design.edit');
  };

  /* ── 다른 사람들 ── */
  const viewers = useViewers(ws.view);
  const allPens = useLive((s) => s.pens);
  const livePens = useMemo(() => Object.values(allPens).filter((p) => p.board === boardId && !(p.committed && byId.has(p.id))), [allPens, boardId, byId]);
  // 완성된 선이 문서에 들어오면 미리보기를 지운다
  useEffect(() => {
    for (const p of Object.values(allPens)) if (p.committed && byId.has(p.id)) useLive.getState().removePen(p.id);
  }, [allPens, byId]);
  useEffect(() => {
    const latest = Math.max(0, ...viewers.map((v) => v.actionAt ?? 0));
    const left = latest + ACTION_BUBBLE_MS - Date.now();
    if (left <= 0) return;
    const t = setTimeout(() => bump((n) => n + 1), left + 50);
    return () => clearTimeout(t);
  }, [viewers]);

  const selectedShapes = selection.map((id) => byId.get(id)).filter((s): s is Shape => !!s);
  const selBounds = unionBounds(selectedShapes);
  const handleSize = (isTouch ? 16 : 9) / view.zoom;
  const gridStep = 24 * view.zoom;
  const cursorClass =
    dragKind === 'pan' ? 'is-panning' : tool === 'hand' || spaceDown ? 'is-hand' : tool !== 'select' && !readOnly ? 'is-crosshair' : '';

  return (
    <div
      className={`canvas-wrap ${cursorClass}`}
      ref={wrapRef}
      tabIndex={0}
      style={{ background: background || undefined }}
      onPointerLeave={() => ws.publishCursor(null)}
      aria-label={`디자인 보드 ${boardName}`}
    >
      <svg
        ref={svgRef}
        className="canvas-svg"
        width={size.w}
        height={size.h}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id={`grid-${boardId}`} x={view.x % gridStep} y={view.y % gridStep} width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
            <circle cx={1} cy={1} r={view.zoom > 0.5 ? 1.1 : 0.8} className="grid-dot" />
          </pattern>
        </defs>
        {showGrid && <rect width="100%" height="100%" fill={`url(#grid-${boardId})`} />}
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {shapes.map((s) => (
            <ShapeView key={s.id} shape={s} zoom={view.zoom} hit={isTouch ? 28 : 12} hideText={editingId === s.id} />
          ))}

          {/* 다른 사람이 지금 그리고 있는 펜 선 */}
          {livePens.map((p) => (
            <LivePenPath key={p.id} pen={p} />
          ))}
          {/* 내가 그리고 있는 펜 선 */}
          {draft && (
            <path d={pathOf(draft.points, draft.points.length)} fill="none" stroke={draft.stroke} strokeWidth={draft.strokeWidth} opacity={draft.opacity} strokeLinecap="round" strokeLinejoin="round" />
          )}

          {/* 다른 사람의 선택 영역 */}
          {viewers.map((p) => {
            const picked = (p.selection ?? []).map((id) => byId.get(id)).filter((s): s is Shape => !!s);
            const b = unionBounds(picked);
            if (!b) return null;
            const pad = 4 / view.zoom;
            const only = picked.length === 1 && isLine(picked[0]) ? picked[0] : null;
            return (
              <g key={`sel-${p.socketId}`} className="remote-selection" style={{ ['--user-color' as string]: p.user.color }}>
                {only ? (
                  // 선 · 화살표는 상자 대신 선을 따라 표시
                  <path d={linePath(lineGeom(only))} fill="none" stroke={p.user.color} strokeOpacity={0.35} strokeWidth={only.strokeWidth + 6 / view.zoom} strokeLinecap="round" />
                ) : (
                  <rect x={b.x - pad} y={b.y - pad} width={b.w + pad * 2} height={b.h + pad * 2} fill="none" stroke={p.user.color} strokeWidth={2 / view.zoom} strokeDasharray={`${6 / view.zoom} ${4 / view.zoom}`} rx={4 / view.zoom} />
                )}
                <g transform={`translate(${b.x - pad} ${b.y - pad - 20 / view.zoom}) scale(${1 / view.zoom})`}>
                  <rect height={18} width={p.user.name.length * 12 + 28} rx={4} fill={p.user.color} />
                  <text x={6} y={13} fontSize={11} fill="#fff" fontFamily={TEXT_FONT} fontWeight={600}>
                    {p.user.avatar} {p.user.name}
                  </text>
                </g>
              </g>
            );
          })}

          {/* 내 선택 영역 + 핸들 */}
          {selBounds && !editing && (
            <g className="my-selection">
              {selectedShapes.length === 1 && isLine(selectedShapes[0]) ? (
                // 선 · 화살표 하나: 상자 없이 선을 따라 얇게 강조하고 끝점(과 휘기) 손잡이만
                <path d={linePath(lineGeom(selectedShapes[0]))} fill="none" className="sel-outline" strokeWidth={1.5 / view.zoom} />
              ) : (
                <rect x={selBounds.x} y={selBounds.y} width={selBounds.w} height={selBounds.h} fill="none" className="sel-outline" strokeWidth={1.5 / view.zoom} />
              )}
              {selectedShapes.length === 1 && !readOnly && !selectedShapes[0].locked && (
                <Handles shape={selectedShapes[0]} size={handleSize} />
              )}
              {selectedShapes.some((s) => s.locked) && (
                <text x={selBounds.x} y={selBounds.y - 6 / view.zoom} fontSize={12 / view.zoom} className="lock-label">
                  🔒 잠김
                </text>
              )}
            </g>
          )}
          {marquee && <rect x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} className="marquee" strokeWidth={1 / view.zoom} />}
        </g>
      </svg>

      {/* 다른 사람의 커서 (월드 좌표 → 화면 좌표) */}
      <div className="cursor-layer" aria-hidden>
        {viewers.map((p) => {
          if (!p.cursor) return null;
          const s = toScreen(p.cursor.x, p.cursor.y);
          if (s.x < -30 || s.y < -30 || s.x > size.w + 30 || s.y > size.h + 30) return null;
          return <RemoteCursor key={p.socketId} presence={p} x={s.x} y={s.y} />;
        })}
      </div>

      {editing && <TextEditOverlay shape={editing} view={view} map={map} onDone={finishEditing} onTyping={() => ws.action('✏️ 텍스트 입력 중')} />}

      {shapes.length === 0 && !readOnly && (
        <div className="canvas-hint">
          <b>빈 보드입니다</b>
          <span>위 도구에서 도형을 고르거나, 빈 곳을 더블클릭해 텍스트를 추가하세요. 정해진 크기(iPhone · A4 · 슬라이드…)로 그리려면 아트보드(F)를 추가하세요.</span>
        </div>
      )}
    </div>
  );
}

function penPatch(points: number[]): Partial<Shape> {
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    x1 = Math.min(x1, points[i]);
    y1 = Math.min(y1, points[i + 1]);
    x2 = Math.max(x2, points[i]);
    y2 = Math.max(y2, points[i + 1]);
  }
  const w = Math.max(x2 - x1, 1);
  const h = Math.max(y2 - y1, 1);
  const norm: number[] = [];
  for (let i = 0; i < points.length; i += 2) norm.push(+((points[i] - x1) / w).toFixed(4), +((points[i + 1] - y1) / h).toFixed(4));
  return { x: x1, y: y1, w, h, points: norm };
}

function Handles({ shape, size }: { shape: Shape; size: number }) {
  if (isLine(shape)) {
    const g = lineGeom(shape);
    // 화살표: 가운데 손잡이를 끌면 휜다 (선이 너무 짧으면 끝점과 겹치므로 숨김)
    const showBend = shape.type === 'arrow' && Math.hypot(shape.w, shape.h) > size * 5;
    // 보이는 점보다 넓은 투명 영역으로 잡기 쉽게
    const grip = (h: Handle, x: number, y: number, dot: React.ReactNode, tip: string) => (
      <g key={h} data-handle={h} className={`handle-grip${h === 'bend' ? ' is-bend' : ''}`}>
        <title>{tip}</title>
        {/* 휘기 손잡이는 선 한가운데라 선을 잡아 옮기는 자리를 너무 가리지 않게 조금만 */}
        <circle cx={x} cy={y} r={h === 'bend' ? size * 0.95 : size * 1.3} className="handle-hit" />
        {dot}
      </g>
    );
    return (
      <>
        {showBend &&
          grip(
            'bend',
            g.mx,
            g.my,
            <circle cx={g.mx} cy={g.my} r={size / 2.1} className={`handle handle-bend${g.curved ? ' is-curved' : ''}`} strokeWidth={size / 6} />,
            g.curved ? '끌어서 휘기 · 두 번 눌러 곧게' : '끌어서 휘기',
          )}
        {grip('start', g.x1, g.y1, <circle cx={g.x1} cy={g.y1} r={size / 1.6} className="handle handle-round" strokeWidth={size / 5} />, '시작점 · Shift: 45° 단위')}
        {grip('end', g.x2, g.y2, <circle cx={g.x2} cy={g.y2} r={size / 1.6} className="handle handle-round" strokeWidth={size / 5} />, '끝점 · Shift: 45° 단위')}
      </>
    );
  }
  const b = boundsOf(shape);
  const pts: [Handle, number, number][] = [
    ['nw', b.x, b.y],
    ['n', b.x + b.w / 2, b.y],
    ['ne', b.x + b.w, b.y],
    ['e', b.x + b.w, b.y + b.h / 2],
    ['se', b.x + b.w, b.y + b.h],
    ['s', b.x + b.w / 2, b.y + b.h],
    ['sw', b.x, b.y + b.h],
    ['w', b.x, b.y + b.h / 2],
  ];
  return (
    <>
      {pts.map(([h, x, y]) => (
        <rect key={h} data-handle={h} x={x - size / 2} y={y - size / 2} width={size} height={size} rx={size / 4} className={`handle handle-${h}`} strokeWidth={size / 7} />
      ))}
    </>
  );
}

/** 도형 위에 겹쳐 보이는 텍스트 입력창 (입력 즉시 Yjs에 반영되어 다른 사람도 실시간으로 봄) */
function TextEditOverlay({ shape, view, map, onDone, onTyping }: { shape: Shape; view: Viewport; map: ShapeMap; onDone: () => void; onTyping: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const b = boundsOf(shape);
  const fontSize = shape.fontSize ?? 18;
  const pad = shape.type === 'text' ? 0 : shape.type === 'sticky' ? 14 : 10;
  const align = shape.align ?? (shape.type === 'text' || shape.type === 'sticky' ? 'left' : 'center');
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [shape.id]);
  return (
    <textarea
      ref={ref}
      className="canvas-textedit"
      value={shape.text ?? ''}
      placeholder="텍스트 입력"
      style={{
        left: b.x * view.zoom + view.x,
        top: b.y * view.zoom + view.y,
        width: Math.max(b.w, 40) * view.zoom,
        height: Math.max(b.h, lineHeight(fontSize)) * view.zoom,
        fontSize: fontSize * view.zoom,
        lineHeight: `${lineHeight(fontSize) * view.zoom}px`,
        padding: pad * view.zoom,
        color: shape.textColor ?? '#1f2937',
        textAlign: align,
        fontFamily: TEXT_FONT,
      }}
      onChange={(e) => {
        const text = e.target.value;
        const patch: Partial<Shape> = { text };
        if (shape.type === 'text') {
          // 텍스트 상자는 내용에 맞춰 높이가 늘어난다
          const lines = wrapText(text, fontSize, Math.max(10, b.w)).length;
          patch.h = Math.max(lineHeight(fontSize) * lines, lineHeight(fontSize));
        }
        updateShapes(map, { [shape.id]: patch });
        onTyping();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          onDone();
        }
      }}
      onBlur={onDone}
    />
  );
}

function pathOf(points: number[], count: number): string {
  let d = '';
  for (let i = 0; i + 1 < count; i += 2) d += `${i === 0 ? 'M' : 'L'}${points[i].toFixed(1)},${points[i + 1].toFixed(1)} `;
  return d;
}

/**
 * 다른 사람의 펜 선을 부드럽게 이어 그린다.
 * 점은 80ms마다 묶음으로 도착한다. 새로 도착한 점들을 120ms에 걸쳐 매 프레임 조금씩 드러내
 * 끊김 없이 이어서 그려지는 것처럼 보이게 한다.
 */
function LivePenPath({ pen }: { pen: RemotePen }) {
  const target = pen.pts.length;
  const [shown, setShown] = useState(() => Math.min(target, 4));
  const pos = useRef(Math.min(target, 4));
  useEffect(() => {
    const from = pos.current;
    if (from >= target) return;
    // 도착 간격보다 조금 길게(버퍼) 나눠 드러내 네트워크 도착 간격이 흔들려도 멈춤 없이 이어지게
    const perMs = (target - from) / PEN_REVEAL_MS;
    let last = performance.now();
    let raf = requestAnimationFrame(function step(now) {
      pos.current = Math.min(target, pos.current + Math.max(0, now - last) * perMs);
      last = now;
      setShown(Math.floor(pos.current / 2) * 2);
      if (pos.current < target) raf = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return (
    <path
      d={pathOf(pen.pts, shown)}
      fill="none"
      stroke={pen.style.stroke}
      strokeWidth={pen.style.strokeWidth}
      opacity={pen.style.opacity}
      strokeLinecap="round"
      strokeLinejoin="round"
      pointerEvents="none"
    />
  );
}
