import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Maximize, Minus, PanelRight, Palette, Plus } from 'lucide-react';
import { getBoards, type YItem } from '@shared/schema';
import { useWorkspace, viewPath } from '../../workspace/context';
import { createBoard, renameItem } from '../../workspace/actions';
import { useYField, useYItems } from '../../hooks/useY';
import { useSession } from '../../store/session';
import { Avatar, Button, EmptyState, IconButton, InlineEdit, Spinner } from '../../components/ui';
import { useViewers } from '../../components/Cursors';
import { DesignCanvas, type CanvasApi } from './DesignCanvas';
import { DesignToolbar } from './DesignToolbar';
import { Inspector } from './Inspector';
import { lastPageSetup, pageSetupDialog } from '../docs/page/PageSetupDialog';
import { ALL_PRESETS } from '../docs/page/pageSizes';

export function DesignModule() {
  const ws = useWorkspace();
  const me = useSession((s) => s.user)!;
  const navigate = useNavigate();
  const boards = useYItems(getBoards(ws.doc));
  const itemId = ws.view.itemId;
  const board = itemId ? boards.find((b) => b.get('id') === itemId) : undefined;

  useEffect(() => {
    if (!board && boards.length > 0 && ws.synced) navigate(viewPath(ws.template.id, 'design', boards[0].get('id') as string), { replace: true });
  }, [board, boards.length, ws.synced]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!board) {
    if (!ws.synced && boards.length === 0)
      return (
        <div className="center-fill">
          <Spinner size={24} />
        </div>
      );
    return (
      <EmptyState
        icon={<Palette size={34} />}
        title={boards.length ? '보드를 여는 중…' : '아직 디자인 보드가 없습니다'}
        action={
          ws.canEdit && !boards.length ? (
            <Button variant="primary" icon={<Plus size={15} />} onClick={() => createBoard(ws, me)}>
              새 보드 만들기
            </Button>
          ) : undefined
        }
      >
        무한 캔버스에서 도형, 스티키 노트, 펜으로 함께 그릴 수 있습니다.
      </EmptyState>
    );
  }
  return <BoardView key={board.get('id') as string} board={board} />;
}

function BoardView({ board }: { board: YItem }) {
  const ws = useWorkspace();
  const id = board.get('id') as string;
  const name = useYField<string>(board, 'name') ?? '';
  const viewers = useViewers(ws.view);
  const api = useRef<CanvasApi | null>(null);
  const [zoom, setZoom] = useState(1);
  const [inspector, setInspector] = useState(() => localStorage.getItem('lt.design.inspector') !== '0' && window.innerWidth > 1000);
  const onApi = useCallback((a: CanvasApi) => {
    api.current = a;
  }, []);

  /** 아트보드 추가 — 크기(iPhone · A4 · 슬라이드 · 직접 입력)를 고른다 */
  const addArtboard = useCallback(async () => {
    if (!ws.canEdit) return;
    const r = await pageSetupDialog({ mode: 'create', kind: 'artboard', initial: lastPageSetup('artboard'), title: '' });
    if (!r?.page) return;
    const preset = ALL_PRESETS.find((p) => p.id === r.page!.preset);
    api.current?.addFrame(r.page, r.title || preset?.name || '아트보드');
  }, [ws.canEdit]);

  useEffect(() => {
    try {
      localStorage.setItem('lt.design.inspector', inspector ? '1' : '0');
    } catch {
      /* 무시 */
    }
  }, [inspector]);

  return (
    <div className="design-module">
      <div className="module-toolbar">
        <span className="toolbar-emoji">🖼️</span>
        <InlineEdit className="toolbar-title" value={name} disabled={!ws.canEdit} onCommit={(v) => renameItem(ws, 'design', id, v)} />
        {viewers.length > 0 && (
          <span className="toolbar-viewers">
            {viewers.map((v) => (
              <Avatar key={v.socketId} user={v.user} size={22} status={v.idle ? 'idle' : 'online'} tooltip={`${v.user.name} 님이 이 보드를 보는 중`} />
            ))}
          </span>
        )}
        <span className="toolbar-spacer" />
        {!ws.canEdit && <span className="status-readonly">읽기 전용</span>}
        <IconButton label={inspector ? '속성 패널 닫기' : '속성 패널 열기'} active={inspector} onClick={() => setInspector((v) => !v)}>
          <PanelRight size={16} />
        </IconButton>
      </div>
      <div className="design-body">
        <div className="design-stage">
          <DesignToolbar readOnly={!ws.canEdit} onUndo={() => api.current?.undo()} onRedo={() => api.current?.redo()} onAddArtboard={() => void addArtboard()} />
          <DesignCanvas board={board} onApi={onApi} onZoom={setZoom} onAddArtboard={() => void addArtboard()} />
          <div className="zoom-controls">
            <IconButton label="축소 (-)" size="sm" onClick={() => api.current?.zoomBy(1 / 1.2)}>
              <Minus size={14} />
            </IconButton>
            <button className="zoom-value" onClick={() => api.current?.zoomTo(1)} data-tip="100%로 (Ctrl+0)">
              {Math.round(zoom * 100)}%
            </button>
            <IconButton label="확대 (+)" size="sm" onClick={() => api.current?.zoomBy(1.2)}>
              <Plus size={14} />
            </IconButton>
            <IconButton label="화면에 맞추기 (Shift+1)" size="sm" onClick={() => api.current?.fit()}>
              <Maximize size={14} />
            </IconButton>
          </div>
        </div>
        {inspector && <Inspector board={board} />}
      </div>
    </div>
  );
}
