import { Lock } from 'lucide-react';
import { getBoards, SHAPE_LABEL, type Shape } from '@shared/schema';
import { useWorkspace } from '../../workspace/context';
import { usePresence } from '../../store/presence';
import { cx } from '../../lib/util';
import { useDesign } from './store';
import { useShapes, updateShapes, type ShapeMap } from './ops';

const ICON: Record<Shape['type'], string> = {
  rect: '▭',
  ellipse: '◯',
  diamond: '◇',
  line: '／',
  arrow: '↗',
  text: 'T',
  sticky: '🗒',
  pen: '✎',
  frame: '▢',
};

/** 탐색기에 붙는 레이어 목록 (위가 앞) */
export function DesignLayers({ boardId }: { boardId: string }) {
  const ws = useWorkspace();
  const board = getBoards(ws.doc).get(boardId);
  if (!board) return null;
  return <LayerList map={board.get('shapes') as ShapeMap} />;
}

function LayerList({ map }: { map: ShapeMap }) {
  const ws = useWorkspace();
  const shapes = useShapes(map);
  const selection = useDesign((s) => s.selection);
  const setSelection = useDesign((s) => s.setSelection);
  const others = usePresence((s) => s.others);
  const remoteSel = new Map<string, string>();
  for (const p of Object.values(others)) for (const id of p.selection ?? []) remoteSel.set(id, p.user.color);

  if (shapes.length === 0) return <p className="ex-empty">도형이 없습니다</p>;
  return (
    <ul className="layers">
      {[...shapes].reverse().slice(0, 200).map((s) => (
        <li key={s.id}>
          <button
            className={cx('layer', selection.includes(s.id) && 'is-selected')}
            onClick={(e) => setSelection(e.shiftKey ? Array.from(new Set([...selection, s.id])) : [s.id])}
          >
            <span className="layer-icon">{ICON[s.type]}</span>
            <span className="layer-name">{(s.type === 'frame' ? s.name : s.text?.split('\n')[0])?.slice(0, 24) || SHAPE_LABEL[s.type]}</span>
            {remoteSel.has(s.id) && <span className="layer-remote" style={{ background: remoteSel.get(s.id) }} data-tip="다른 사람이 선택함" />}
            {s.locked && <Lock size={11} className="muted" />}
          </button>
          {ws.canEdit && (
            <button className="layer-lock" data-tip={s.locked ? '잠금 해제' : '잠그기'} onClick={() => updateShapes(map, { [s.id]: { locked: !s.locked } })} aria-label="잠금 전환">
              {s.locked ? '🔒' : '🔓'}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
