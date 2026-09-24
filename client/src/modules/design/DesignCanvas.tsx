import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { SHAPE_LABEL, type Shape, type YItem } from '@shared/schema';
import type { Viewport } from '@shared/types';
import { useWorkspace } from '../../workspace/context';
import { useSession } from '../../store/session';
import { useUserPresence } from '../../store/presence';
import { useYField } from '../../hooks/useY';
import { RemoteCursor, useViewers, ACTION_BUBBLE_MS } from '../../components/Cursors';
import { isTypingTarget, newId, throttle } from '../../lib/util';
import { useDesign, type Tool } from './store';
import { ShapeView } from './ShapeView';
import { type Box, type Handle, boundsOf, intersects, isLine, lineHeight, resizeBox, snapAngle, snapTo, unionBounds, wrapText, TEXT_FONT } from './geometry';
import { DEFAULT_SIZE, defaultShape, deleteShapes, insertShapes, maxZ, updateShapes, useShapes, type ShapeMap } from './ops';

type Drag =
  | { kind: 'pan'; sx: number; sy: number; orig: Viewport }
  | { kind: 'move'; start: { x: number; y: number }; orig: Map<string, { x: number; y: number }>; moved: boolean }
  | { kind: 'resize'; id: string; handle: Handle; orig: Shape }
  | { kind: 'create'; id: string; start: { x: number; y: number }; type: Shape['type'] }
  | { kind: 'pen'; id: string; points: number[] }
  | { kind: 'marquee'; start: { x: number; y: number }; base: string[] };

const TOOL_KEYS: Record<string, Tool> = { v: 'select', h: 'hand', r: 'rect', o: 'ellipse', d: 'diamond', l: 'line', a: 'arrow', p: 'pen', t: 'text', s: 'sticky' };
const TEXT_TYPES = new Set(['rect', 'ellipse', 'diamond', 'sticky', 'text']);
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 5;

/** 복사/붙여넣기용 (탭 안에서 유지) */
let clipboard: Shape[] = [];

export interface CanvasApi {
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
}

export function DesignCanvas({ board, onApi, onZoom }: Props) {
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

  useEffect(() => {
    onApi?.({
      zoomBy: (f) => zoomAround(f),
      zoomTo: (z) => zoomAround(z / viewRef.current.zoom),
      fit,
      undo: () => undo.undo(),
      redo: () => undo.redo(),
      svg: () => svgRef.current,
    });
  }, [onApi, zoomAround, fit, undo]);

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

  const beginDrag = (d: Drag, pointerId: number) => {
    drag.current = d;
    setDragKind(d.kind);
    svgRef.current?.setPointerCapture(pointerId);
  };

  const onPointerDown = (e: React.PointerEvent) => {
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
        for (const id of sel) {
          const s = byId.get(id);
          if (s && !s.locked) orig.set(id, { x: s.x, y: s.y });
        }
        if (orig.size) beginDrag({ kind: 'move', start: p, orig, moved: false }, e.pointerId);
        return;
      }
      const base = e.shiftKey ? selection : [];
      if (!e.shiftKey) setSelection([]);
      beginDrag({ kind: 'marquee', start: p, base }, e.pointerId);
      return;
    }

    // 도형 만들기
    const x = snapTo(p.x, snap);
    const y = snapTo(p.y, snap);
    const shape = defaultShape(tool as Shape['type'], x, y, maxZ(map) + 1, me.id);
    if (tool === 'pen') {
      shape.x = p.x;
      shape.y = p.y;
      shape.w = 1;
      shape.h = 1;
      shape.points = [0, 0];
      insertShapes(map, [shape]);
      beginDrag({ kind: 'pen', id: shape.id, points: [p.x, p.y] }, e.pointerId);
      ws.action('✏️ 펜으로 그리는 중');
      return;
    }
    insertShapes(map, [shape]);
    setSelection([shape.id]);
    beginDrag({ kind: 'create', id: shape.id, start: { x, y }, type: shape.type }, e.pointerId);
    ws.action(`${SHAPE_LABEL[shape.type]} 그리는 중`);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = toWorld(e.clientX, e.clientY);
    ws.publishCursor(p);
    const d = drag.current;
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
        ws.action('⤡ 크기 조절 중');
        schedule(() => {
          if (isLine(o)) {
            if (d.handle === 'start') updateShapes(map, { [o.id]: { x: px, y: py, w: o.x + o.w - px, h: o.y + o.h - py } });
            else {
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
        schedule(() => updateShapes(map, { [d.id]: penPatch(d.points) }));
        return;
      }
      case 'marquee': {
        const box = { x: Math.min(d.start.x, p.x), y: Math.min(d.start.y, p.y), w: Math.abs(p.x - d.start.x), h: Math.abs(p.y - d.start.y) };
        setMarquee(box);
        const hit = shapes.filter((s) => intersects(boundsOf(s), box)).map((s) => s.id);
        setSelection(Array.from(new Set([...d.base, ...hit])));
        return;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
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
      if (d.points.length < 4) deleteShapes(map, [d.id]);
      else {
        ws.action('✏️ 펜 드로잉 추가');
        report('design.shape.add', SHAPE_LABEL.pen);
      }
    } else if ((d.kind === 'move' && d.moved) || d.kind === 'resize') {
      report('design.edit');
    }
    undo.stopCapturing();
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (readOnly) return;
    const shapeId = (e.target as Element).closest('[data-shape-id]')?.getAttribute('data-shape-id');
    const s = shapeId ? byId.get(shapeId) : undefined;
    if (s && TEXT_TYPES.has(s.type) && !s.locked) {
      setSelection([s.id]);
      setEditing(s.id);
      return;
    }
    if (!s && tool === 'select') {
      const p = toWorld(e.clientX, e.clientY);
      const shape = { ...defaultShape('text', p.x, p.y - 17, maxZ(map) + 1, me.id), w: 220, h: 34 };
      insertShapes(map, [shape]);
      setSelection([shape.id]);
      setEditing(shape.id);
      report('design.shape.add', SHAPE_LABEL.text);
    }
  };

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
        clipboard = sel.map((id) => map.get(id)).filter((s): s is Shape => !!s);
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
        pasteShapes(sel.map((id) => map.get(id)).filter((s): s is Shape => !!s), 20);
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
    let z = maxZ(map);
    const copies = source.map((s) => ({ ...s, id: newId(), x: s.x + offset, y: s.y + offset, z: ++z, locked: false, createdBy: me.id }));
    insertShapes(map, copies);
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
  useEffect(() => {
    const latest = Math.max(0, ...viewers.map((v) => v.actionAt ?? 0));
    const left = latest + ACTION_BUBBLE_MS - Date.now();
    if (left <= 0) return;
    const t = setTimeout(() => bump((n) => n + 1), left + 50);
    return () => clearTimeout(t);
  }, [viewers]);

  const selectedShapes = selection.map((id) => byId.get(id)).filter((s): s is Shape => !!s);
  const selBounds = unionBounds(selectedShapes);
  const handleSize = 9 / view.zoom;
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
            <ShapeView key={s.id} shape={s} zoom={view.zoom} hideText={editingId === s.id} />
          ))}

          {/* 다른 사람의 선택 영역 */}
          {viewers.map((p) => {
            const b = unionBounds((p.selection ?? []).map((id) => byId.get(id)).filter((s): s is Shape => !!s));
            if (!b) return null;
            const pad = 4 / view.zoom;
            return (
              <g key={`sel-${p.socketId}`} className="remote-selection" style={{ ['--user-color' as string]: p.user.color }}>
                <rect x={b.x - pad} y={b.y - pad} width={b.w + pad * 2} height={b.h + pad * 2} fill="none" stroke={p.user.color} strokeWidth={2 / view.zoom} strokeDasharray={`${6 / view.zoom} ${4 / view.zoom}`} rx={4 / view.zoom} />
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
              <rect x={selBounds.x} y={selBounds.y} width={selBounds.w} height={selBounds.h} fill="none" className="sel-outline" strokeWidth={1.5 / view.zoom} />
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
          <span>위 도구에서 도형을 고르거나, 빈 곳을 더블클릭해 텍스트를 추가하세요.</span>
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
    return (
      <>
        {(
          [
            ['start', shape.x, shape.y],
            ['end', shape.x + shape.w, shape.y + shape.h],
          ] as const
        ).map(([h, x, y]) => (
          <circle key={h} data-handle={h} cx={x} cy={y} r={size / 1.6} className="handle handle-round" strokeWidth={size / 6} />
        ))}
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
