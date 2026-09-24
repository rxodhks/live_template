import { ArrowUpRight, Circle, Diamond, Hand, Minus, MousePointer2, Pencil, Redo2, Square, StickyNote, Type, Undo2 } from 'lucide-react';
import { useDesign, type Tool } from './store';
import { IconButton } from '../../components/ui';

const TOOLS: { tool: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  { tool: 'select', label: '선택', key: 'V', icon: <MousePointer2 size={17} /> },
  { tool: 'hand', label: '손 (화면 이동)', key: 'H', icon: <Hand size={17} /> },
  { tool: 'rect', label: '사각형', key: 'R', icon: <Square size={17} /> },
  { tool: 'ellipse', label: '원', key: 'O', icon: <Circle size={17} /> },
  { tool: 'diamond', label: '마름모', key: 'D', icon: <Diamond size={17} /> },
  { tool: 'line', label: '선', key: 'L', icon: <Minus size={17} /> },
  { tool: 'arrow', label: '화살표', key: 'A', icon: <ArrowUpRight size={17} /> },
  { tool: 'pen', label: '펜', key: 'P', icon: <Pencil size={17} /> },
  { tool: 'text', label: '텍스트', key: 'T', icon: <Type size={17} /> },
  { tool: 'sticky', label: '스티키 노트', key: 'S', icon: <StickyNote size={17} /> },
];

/** 캔버스 위에 떠 있는 도구 모음 */
export function DesignToolbar({ readOnly, onUndo, onRedo }: { readOnly: boolean; onUndo: () => void; onRedo: () => void }) {
  const tool = useDesign((s) => s.tool);
  const setTool = useDesign((s) => s.setTool);
  return (
    <div className="design-toolbar" role="toolbar" aria-label="디자인 도구">
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
      <IconButton label="실행 취소 (내 변경만)" disabled={readOnly} onClick={onUndo}>
        <Undo2 size={17} />
      </IconButton>
      <IconButton label="다시 실행" disabled={readOnly} onClick={onRedo}>
        <Redo2 size={17} />
      </IconButton>
    </div>
  );
}
