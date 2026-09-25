import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { TopBar } from './TopBar';
import { LeftRail } from './LeftRail';
import { CommandPalette } from './CommandPalette';
import { ProfileDialog, ShortcutsDialog } from './Dialogs';
import { InviteDialog } from './InviteDialog';
import { cx } from '../lib/util';

interface Props {
  panel?: ReactNode;
  /** 탐색 패널 표시 여부 */
  panelOpen?: boolean;
  drawer?: ReactNode;
  children: ReactNode;
}

const PANEL_KEY = 'lt.panelWidth';
const PANEL_MIN = 200;
const PANEL_MAX = 420;

function readWidth(): number {
  try {
    const v = Number(localStorage.getItem(PANEL_KEY));
    return v >= PANEL_MIN && v <= PANEL_MAX ? v : 260;
  } catch {
    return 260;
  }
}

/**
 * 데스크톱 레이아웃: 상단 바 + 왼쪽 레일 + (크기 조절 가능한 탐색 패널) + 본문 + (오른쪽 서랍)
 */
export function AppShell({ panel, panelOpen = true, drawer, children }: Props) {
  const [width, setWidth] = useState(readWidth);
  const dragging = useRef(false);

  const startResize = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startW = width;
    const move = (ev: PointerEvent) => setWidth(Math.min(PANEL_MAX, Math.max(PANEL_MIN, startW + ev.clientX - startX)));
    const up = () => {
      dragging.current = false;
      document.body.classList.remove('is-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    document.body.classList.add('is-resizing');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [width]);

  useEffect(() => {
    if (dragging.current) return;
    try {
      localStorage.setItem(PANEL_KEY, String(width));
    } catch {
      /* 무시 */
    }
  }, [width]);

  const showPanel = !!panel && panelOpen;

  return (
    <div className="shell">
      <TopBar />
      <div className="shell-body">
        <div className={cx('shell-nav', showPanel && 'has-panel')}>
          <LeftRail />
          {showPanel && (
            <aside className="shell-panel" style={{ width }}>
              {panel}
              <div
                className="panel-resizer"
                role="separator"
                aria-orientation="vertical"
                aria-label="탐색 패널 너비 조절"
                onPointerDown={startResize}
                onDoubleClick={() => setWidth(260)}
              />
            </aside>
          )}
        </div>
        <main className="shell-main" id="main">
          {children}
        </main>
        {drawer && <aside className="shell-drawer">{drawer}</aside>}
      </div>
      {/* 워크스페이스 컨텍스트 안에서 렌더링되어야 하는 전역 대화상자 */}
      <CommandPalette />
      <InviteDialog />
      <ProfileDialog />
      <ShortcutsDialog />
    </div>
  );
}
