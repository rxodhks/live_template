import { ArrowUpRight, Circle, Diamond, Eraser, Frame, Hand, Highlighter, Minus, MousePointer2, Pencil, Redo2, Square, StickyNote, Type, Undo2 } from 'lucide-react';
import { HIGHLIGHTER_OPACITY, PEN_COLORS, PEN_WIDTHS, useDesign, type Tool } from './store';
import { IconButton } from '../../components/ui';
import { cx } from '../../lib/util';
import { t } from '../../i18n';

const TOOLS: { tool: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  { tool: 'select', label: t('선택'), key: 'V', icon: <MousePointer2 size={17} /> },
  { tool: 'hand', label: t('손 (화면 이동)'), key: 'H', icon: <Hand size={17} /> },
  { tool: 'rect', label: t('사각형'), key: 'R', icon: <Square size={17} /> },
  { tool: 'ellipse', label: t('원'), key: 'O', icon: <Circle size={17} /> },
  { tool: 'diamond', label: t('마름모'), key: 'D', icon: <Diamond size={17} /> },
  { tool: 'line', label: t('선'), key: 'L', icon: <Minus size={17} /> },
  { tool: 'arrow', label: t('화살표'), key: 'A', icon: <ArrowUpRight size={17} /> },
  { tool: 'pen', label: t('펜'), key: 'P', icon: <Pencil size={17} /> },
  { tool: 'eraser', label: t('지우개 (문지른 부분만 지움)'), key: 'E', icon: <Eraser size={17} /> },
  { tool: 'text', label: t('텍스트'), key: 'T', icon: <Type size={17} /> },
  { tool: 'sticky', label: t('스티키 노트'), key: 'S', icon: <StickyNote size={17} /> },
];

/** 캔버스 위에 떠 있는 도구 모음 */
export function DesignToolbar({ readOnly, onUndo, onRedo, onAddArtboard }: { readOnly: boolean; onUndo: () => void; onRedo: () => void; onAddArtboard: () => void }) {
  const tool = useDesign((s) => s.tool);
  const setTool = useDesign((s) => s.setTool);
  return (
    <>
    <div className="design-toolbar" role="toolbar" aria-label={t('디자인 도구')}>
      {TOOLS.map((t, i) => (
        <span key={t.tool} className="tool-slot">
          {i === 2 && <span className="tb-sep" />}
          <IconButton
            label={`${t.label} (${t.key})`}
            active={tool === t.tool}
            disabled={readOnly && t.tool !== 'select' && t.tool !== 'hand'}
            onClick={() => setTool(t.tool)}
          >
            {t.icon}
          </IconButton>
        </span>
      ))}
      <span className="tb-sep" />
      <IconButton label={t('아트보드 추가 (F) — iPhone · A4 · 슬라이드 등 정해진 크기')} disabled={readOnly} onClick={onAddArtboard}>
        <Frame size={17} />
      </IconButton>
      <span className="tb-sep" />
      <IconButton label={t('실행 취소 (내 변경만)')} disabled={readOnly} onClick={onUndo}>
        <Undo2 size={17} />
      </IconButton>
      <IconButton label={t('다시 실행')} disabled={readOnly} onClick={onRedo}>
        <Redo2 size={17} />
      </IconButton>
    </div>
    {tool === 'pen' && !readOnly && <PenOptions />}
    </>
  );
}

/** 펜을 고르면 도구 모음 아래에 뜨는 색 · 굵기 · 형광펜 설정 (그리기 전에 미리 고른다) */
function PenOptions() {
  const pen = useDesign((s) => s.pen);
  const setPen = useDesign((s) => s.setPen);
  return (
    <div className="pen-options" role="toolbar" aria-label={t('펜 설정')}>
      {PEN_COLORS.map((c) => (
        <button
          key={c}
          className={cx('pen-swatch', pen.color === c && 'is-selected')}
          style={{ background: c }}
          onClick={() => setPen({ color: c })}
          aria-label={t('펜 색 {c}', { c })}
          aria-pressed={pen.color === c}
          data-tip={c}
        />
      ))}
      <label className={cx('pen-swatch is-custom', !PEN_COLORS.includes(pen.color) && 'is-selected')} data-tip={t('직접 선택')} style={!PEN_COLORS.includes(pen.color) ? { background: pen.color } : undefined}>
        <input type="color" value={pen.color} onChange={(e) => setPen({ color: e.target.value })} aria-label={t('펜 색 직접 선택')} />
      </label>
      <span className="tb-sep" />
      {PEN_WIDTHS.map((w, i) => (
        <IconButton key={w.width} label={`${w.label} ${w.width}px (${i + 1})`} active={pen.width === w.width} onClick={() => setPen({ width: w.width })}>
          <span className="pen-width-dot" style={{ width: w.width + 2, height: w.width + 2, background: pen.color, opacity: pen.highlighter ? HIGHLIGHTER_OPACITY + 0.25 : 1 }} />
        </IconButton>
      ))}
      <span className="tb-sep" />
      <IconButton label={t('형광펜 (반투명)')} active={pen.highlighter} onClick={() => setPen({ highlighter: !pen.highlighter })}>
        <Highlighter size={16} />
      </IconButton>
    </div>
  );
}
