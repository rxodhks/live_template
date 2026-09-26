import type { ReactNode } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Grid3x3,
  Lock,
  Magnet,
  Ruler,
  Spline,
  Trash2,
  Unlock,
} from 'lucide-react';
import { SHAPE_LABEL, type Shape, type YItem } from '@shared/schema';
import { useWorkspace } from '../../workspace/context';
import { useYField } from '../../hooks/useY';
import { useSession } from '../../store/session';
import { toast } from '../../store/toasts';
import { cx } from '../../lib/util';
import { Button, IconButton } from '../../components/ui';
import { BOARD_BACKGROUNDS, PALETTE, STICKY_COLORS, useDesign } from './store';
import { copyShapes, deleteShapes, maxZ, minZ, sortedShapes, updateShapes, useShapes, withFrameChildren, type ShapeMap } from './ops';
import { boundsOf, isLine } from './geometry';
import { exportFrame, exportPng, exportSvg } from './export';
import { pageSetupDialog } from '../docs/page/PageSetupDialog';
import { ALL_PRESETS, describePage, pagePx } from '../docs/page/pageSizes';

function Swatches({ value, colors, onChange, allowNone, disabled }: { value?: string; colors: string[]; onChange: (c: string) => void; allowNone?: boolean; disabled?: boolean }) {
  return (
    <div className="insp-swatches">
      {allowNone && (
        <button className={cx('insp-swatch is-none', (!value || value === 'transparent') && 'is-selected')} onClick={() => onChange('transparent')} disabled={disabled} aria-label="없음" data-tip="없음" />
      )}
      {colors.map((c) => (
        <button key={c} className={cx('insp-swatch', value === c && 'is-selected')} style={{ background: c }} onClick={() => onChange(c)} disabled={disabled} aria-label={c} />
      ))}
      <label className="insp-swatch is-custom" data-tip="직접 선택">
        <input type="color" value={value && value.startsWith('#') ? value : '#000000'} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
      </label>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="insp-row">
      <span className="insp-label">{label}</span>
      <div className="insp-control">{children}</div>
    </div>
  );
}

/** 선의 각도 (도, 화면 위쪽이 +) */
const lineAngle = (s: Shape) => Math.round((-Math.atan2(s.h, s.w) * 180) / Math.PI * 10) / 10;
/** 길이 · 각도 → 시작점 기준 w, h */
const polar = (len: number, deg: number): Partial<Shape> => {
  const a = (-deg * Math.PI) / 180;
  return { w: Math.round(Math.cos(a) * len * 10) / 10, h: Math.round(Math.sin(a) * len * 10) / 10 };
};

function NumberInput({ value, onChange, disabled, min, step = 1 }: { value: number; onChange: (v: number) => void; disabled?: boolean; min?: number; step?: number }) {
  return (
    <input
      type="number"
      className="input input-xs"
      value={Math.round(value * 10) / 10}
      step={step}
      min={min}
      disabled={disabled}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) onChange(min !== undefined ? Math.max(min, v) : v);
      }}
    />
  );
}

/** 오른쪽 속성 패널 — 선택한 도형이 없으면 보드 설정 */
export function Inspector({ board }: { board: YItem }) {
  const ws = useWorkspace();
  const me = useSession((s) => s.user)!;
  const map = board.get('shapes') as ShapeMap;
  const { selection, setSelection, showGrid, snap, toggleGrid, toggleSnap } = useDesign();
  const background = useYField<string>(board, 'background') ?? '';
  const name = useYField<string>(board, 'name') ?? '';
  const readOnly = !ws.canEdit;
  const boardId = board.get('id') as string;

  const shapes = useShapes(map);
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const selected = selection.map((id) => byId.get(id)).filter((s): s is Shape => !!s);
  const first = selected[0];

  const apply = (patch: Partial<Shape>, label = '🎨 스타일 변경') => {
    if (readOnly) return;
    const patches: Record<string, Partial<Shape>> = {};
    for (const s of selected) patches[s.id] = patch;
    updateShapes(map, patches);
    ws.action(label);
    ws.report({ type: 'design.edit', targetId: boardId, targetName: name });
  };

  if (!first) {
    const count = shapes.length;
    return (
      <aside className="inspector">
        <h3>보드</h3>
        <Row label="배경">
          <div className="insp-swatches">
            {BOARD_BACKGROUNDS.map((c) => (
              <button
                key={c || 'default'}
                className={cx('insp-swatch', !c && 'is-default', background === c && 'is-selected')}
                style={c ? { background: c } : undefined}
                onClick={() => !readOnly && board.set('background', c)}
                disabled={readOnly}
                data-tip={c ? c : '기본'}
                aria-label={c || '기본 배경'}
              />
            ))}
          </div>
        </Row>
        <div className="insp-toggles">
          <button className={cx('chip-toggle', showGrid && 'is-on')} onClick={toggleGrid}>
            <Grid3x3 size={13} /> 격자 표시
          </button>
          <button className={cx('chip-toggle', snap && 'is-on')} onClick={toggleSnap}>
            <Magnet size={13} /> 격자에 맞추기
          </button>
        </div>
        <h3>내보내기</h3>
        <div className="insp-buttons">
          <Button size="sm" icon={<Download size={14} />} disabled={!count} onClick={() => void exportSvg(name, sortedShapes(map), background)}>
            SVG
          </Button>
          <Button size="sm" icon={<Download size={14} />} disabled={!count} onClick={() => void exportPng(name, sortedShapes(map), background).catch((e) => toast.error('PNG 내보내기 실패', String(e)))}>
            PNG
          </Button>
        </div>
        <p className="insp-help">
          도형 {count}개 · 도형을 선택하면 색상, 선, 텍스트, 위치를 바꿀 수 있습니다. 여러 사람이 같은 도형을 동시에 바꾸면 마지막 변경이 반영됩니다.
        </p>
      </aside>
    );
  }

  const b = selected.length === 1 ? boundsOf(first) : null;
  const canText = selected.every((s) => ['rect', 'ellipse', 'diamond', 'sticky', 'text'].includes(s.type));
  const canFill = selected.some((s) => !isLine(s) && s.type !== 'pen' && s.type !== 'text');
  const allLocked = selected.every((s) => s.locked);

  const zOrder = (where: 'front' | 'back' | 'up' | 'down') => {
    const list = sortedShapes(map);
    const patches: Record<string, Partial<Shape>> = {};
    if (where === 'front') {
      let z = maxZ(map);
      for (const s of selected) patches[s.id] = { z: ++z };
    } else if (where === 'back') {
      let z = minZ(map);
      for (const s of [...selected].reverse()) patches[s.id] = { z: --z };
    } else {
      for (const s of selected) {
        const i = list.findIndex((x) => x.id === s.id);
        const j = where === 'up' ? i + 1 : i - 1;
        if (j < 0 || j >= list.length) continue;
        patches[s.id] = { z: list[j].z };
        patches[list[j].id] = { z: s.z };
      }
    }
    updateShapes(map, patches);
    ws.action('🗂 순서 변경');
  };

  const duplicate = () => {
    // 아트보드는 안의 도형까지, 아트보드는 맨 뒤로
    const copies = copyShapes(map, withFrameChildren(shapes, selected), 20, me.id);
    setSelection(copies.map((s) => s.id));
    ws.report({ type: 'design.shape.add', targetId: boardId, targetName: name, detail: `복제 ${copies.length}개` });
  };

  const remove = () => {
    const ids = selected.filter((s) => !s.locked).map((s) => s.id);
    deleteShapes(map, ids);
    setSelection([]);
    ws.action(`🗑 도형 ${ids.length}개 삭제`);
    ws.report({ type: 'design.shape.delete', targetId: boardId, targetName: name, detail: `${ids.length}개` });
  };

  const frame = selected.length === 1 && first.type === 'frame' ? first : null;
  /** 아트보드 크기 바꾸기 (위치 그대로) */
  const resizeFrame = async () => {
    if (!frame || readOnly) return;
    const unit = { preset: frame.preset ?? 'custom', width: Math.round(frame.w), height: Math.round(frame.h), unit: 'px' as const, margin: 0, fontSize: 16 };
    const r = await pageSetupDialog({ mode: 'edit', kind: 'artboard', initial: unit });
    if (!r?.page) return;
    const px = pagePx(r.page);
    updateShapes(map, { [frame.id]: { w: Math.round(px.width), h: Math.round(px.height), preset: r.page.preset } });
    ws.action(`▢ 아트보드 크기 · ${describePage(r.page)}`);
  };

  return (
    <aside className="inspector">
      <h3>
        {selected.length === 1 ? (frame ? frame.name || SHAPE_LABEL.frame : SHAPE_LABEL[first.type]) : `${selected.length}개 선택`}
        {allLocked && <Lock size={13} />}
      </h3>

      {frame && (
        <>
          <p className="insp-help">
            {ALL_PRESETS.find((p) => p.id === frame.preset)?.name ?? '직접 입력'} · {Math.round(frame.w)} × {Math.round(frame.h)} px — 안에 그린 도형은 아트보드와 함께 움직입니다. 이름표를 두 번 누르면 이름을 바꿉니다.
          </p>
          <div className="insp-buttons">
            <Button size="sm" icon={<Ruler size={14} />} disabled={readOnly || frame.locked} onClick={() => void resizeFrame()}>
              크기 바꾸기
            </Button>
          </div>
          <h4>아트보드 내보내기</h4>
          <div className="insp-buttons">
            <Button size="sm" icon={<Download size={14} />} onClick={() => void exportFrame(frame, shapes, 'png').catch((e) => toast.error('PNG 내보내기 실패', String(e)))}>
              PNG
            </Button>
            <Button size="sm" icon={<Download size={14} />} onClick={() => void exportFrame(frame, shapes, 'svg')}>
              SVG
            </Button>
          </div>
        </>
      )}

      {canFill && (
        <Row label="채우기">
          <Swatches value={first.fill} colors={first.type === 'sticky' ? STICKY_COLORS : PALETTE} onChange={(c) => apply({ fill: c }, '🎨 채우기 색 변경')} allowNone disabled={readOnly} />
        </Row>
      )}
      {first.type !== 'text' && first.type !== 'sticky' && first.type !== 'frame' && (
        <>
          <Row label="선 색">
            <Swatches value={first.stroke} colors={PALETTE} onChange={(c) => apply({ stroke: c }, '🎨 선 색 변경')} allowNone={!isLine(first) && first.type !== 'pen'} disabled={readOnly} />
          </Row>
          <Row label={`선 굵기 ${first.strokeWidth}`}>
            <input type="range" min={0} max={16} value={first.strokeWidth} disabled={readOnly} onChange={(e) => apply({ strokeWidth: Number(e.target.value) }, '선 굵기 변경')} />
          </Row>
        </>
      )}
      <Row label={`불투명도 ${Math.round((first.opacity ?? 1) * 100)}%`}>
        <input type="range" min={0.1} max={1} step={0.05} value={first.opacity ?? 1} disabled={readOnly} onChange={(e) => apply({ opacity: Number(e.target.value) }, '불투명도 변경')} />
      </Row>
      {(first.type === 'rect' || first.type === 'sticky') && (
        <Row label={`모서리 ${first.radius ?? 0}`}>
          <input type="range" min={0} max={48} value={first.radius ?? 0} disabled={readOnly} onChange={(e) => apply({ radius: Number(e.target.value) }, '모서리 변경')} />
        </Row>
      )}

      {canText && (
        <>
          <h4>텍스트</h4>
          <Row label="글자 색">
            <Swatches value={first.textColor} colors={['#111827', '#ffffff', '#ef4444', '#2563eb', '#16a34a', '#9333ea']} onChange={(c) => apply({ textColor: c }, '글자 색 변경')} disabled={readOnly} />
          </Row>
          <Row label="크기">
            <div className="insp-inline">
              <NumberInput value={first.fontSize ?? 18} min={8} onChange={(v) => apply({ fontSize: Math.min(v, 160) }, '글자 크기 변경')} disabled={readOnly} />
              <span className="insp-seg">
                {(['left', 'center', 'right'] as const).map((a) => (
                  <IconButton key={a} size="sm" label={a === 'left' ? '왼쪽' : a === 'center' ? '가운데' : '오른쪽'} active={(first.align ?? 'center') === a} disabled={readOnly} onClick={() => apply({ align: a }, '정렬 변경')}>
                    {a === 'left' ? <AlignLeft size={14} /> : a === 'center' ? <AlignCenter size={14} /> : <AlignRight size={14} />}
                  </IconButton>
                ))}
              </span>
            </div>
          </Row>
          {selected.length === 1 && <p className="insp-help">도형을 더블클릭하면 글자를 입력할 수 있습니다.</p>}
        </>
      )}

      {b && (
        <>
          <h4>위치 · 크기</h4>
          <div className="insp-grid">
            <label>
              X <NumberInput value={b.x} disabled={readOnly || first.locked} onChange={(v) => apply({ x: first.x + (v - b.x) }, '위치 변경')} />
            </label>
            <label>
              Y <NumberInput value={b.y} disabled={readOnly || first.locked} onChange={(v) => apply({ y: first.y + (v - b.y) }, '위치 변경')} />
            </label>
            {!isLine(first) ? (
              <>
                <label>
                  W <NumberInput value={b.w} min={4} disabled={readOnly || first.locked} onChange={(v) => apply({ w: v }, '크기 변경')} />
                </label>
                <label>
                  H <NumberInput value={b.h} min={4} disabled={readOnly || first.locked} onChange={(v) => apply({ h: v }, '크기 변경')} />
                </label>
              </>
            ) : (
              // 선 · 화살표는 시작점을 기준으로 길이와 각도(위쪽이 +)
              <>
                <label>
                  길이 <NumberInput value={Math.hypot(first.w, first.h)} min={1} disabled={readOnly || first.locked} onChange={(v) => apply(polar(v, lineAngle(first)), '길이 변경')} />
                </label>
                <label>
                  각도 <NumberInput value={lineAngle(first)} disabled={readOnly || first.locked} onChange={(v) => apply(polar(Math.hypot(first.w, first.h), v), '각도 변경')} />
                </label>
              </>
            )}
          </div>
          {first.type === 'arrow' && (
            <div className="insp-buttons">
              <Button size="sm" icon={<Spline size={14} />} disabled={readOnly || first.locked || !first.bend} onClick={() => apply({ bend: 0 }, '➖ 화살표 곧게 펴기')}>
                곧게 펴기
              </Button>
              <span className="insp-help">가운데 점을 끌면 휘어집니다</span>
            </div>
          )}
        </>
      )}

      <h4>순서 · 동작</h4>
      <div className="insp-buttons">
        <IconButton label="맨 앞으로" disabled={readOnly} onClick={() => zOrder('front')}>
          <ArrowUpToLine size={15} />
        </IconButton>
        <IconButton label="앞으로 (])" disabled={readOnly} onClick={() => zOrder('up')}>
          <ChevronUp size={15} />
        </IconButton>
        <IconButton label="뒤로 ([)" disabled={readOnly} onClick={() => zOrder('down')}>
          <ChevronDown size={15} />
        </IconButton>
        <IconButton label="맨 뒤로" disabled={readOnly} onClick={() => zOrder('back')}>
          <ArrowDownToLine size={15} />
        </IconButton>
        <span className="tb-sep" />
        <IconButton label={allLocked ? '잠금 해제' : '잠그기 (이동/편집 방지)'} active={allLocked} disabled={readOnly} onClick={() => apply({ locked: !allLocked }, allLocked ? '🔓 잠금 해제' : '🔒 잠금')}>
          {allLocked ? <Unlock size={15} /> : <Lock size={15} />}
        </IconButton>
        <IconButton label="복제 (Ctrl+D)" disabled={readOnly} onClick={duplicate}>
          <Copy size={15} />
        </IconButton>
        <IconButton label="삭제 (Delete)" disabled={readOnly || allLocked} onClick={remove}>
          <Trash2 size={15} />
        </IconButton>
      </div>
    </aside>
  );
}
