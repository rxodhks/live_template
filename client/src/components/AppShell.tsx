import { type ReactNode, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { TopBar } from './TopBar';
import { LeftRail } from './LeftRail';
import { CommandPalette } from './CommandPalette';
import { ProfileDialog, ShareDialog, ShortcutsDialog } from './Dialogs';
import { useUI } from '../store/ui';
import { useIsMobile } from '../hooks/useMedia';
import { cx } from '../lib/util';

interface Props {
  panel?: ReactNode;
  /** 데스크톱에서 탐색 패널 표시 여부 (모바일은 서랍 안에 항상 표시) */
  panelOpen?: boolean;
  drawer?: ReactNode;
  children: ReactNode;
}

/**
 * 상단 바 + 왼쪽 레일 + (컨텍스트 패널) + 본문 + (오른쪽 서랍)
 * 휴대폰에서는 레일과 패널이 햄버거 버튼으로 여는 왼쪽 서랍이 된다.
 */
export function AppShell({ panel, panelOpen = true, drawer, children }: Props) {
  const navOpen = useUI((s) => s.navOpen);
  const setNavOpen = useUI((s) => s.setNavOpen);
  const isMobile = useIsMobile();
  const location = useLocation();

  // 이동하면 서랍을 닫는다
  useEffect(() => setNavOpen(false), [location.pathname, setNavOpen]);
  useEffect(() => {
    if (!isMobile) setNavOpen(false);
  }, [isMobile, setNavOpen]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setNavOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen, setNavOpen]);

  const showPanel = !!panel && (isMobile || panelOpen);
  const drawerHidden = isMobile && !navOpen;

  return (
    <div className={cx('shell', navOpen && 'is-nav-open', isMobile && 'is-mobile')}>
      <TopBar />
      <div className="shell-body">
        <div className={cx('shell-nav', showPanel && 'has-panel')} id="app-nav" inert={drawerHidden || undefined}>
          <LeftRail />
          {showPanel && <aside className="shell-panel">{panel}</aside>}
        </div>
        {isMobile && navOpen && <div className="nav-backdrop" onClick={() => setNavOpen(false)} aria-hidden />}
        <main className="shell-main" id="main">
          {children}
        </main>
        {drawer && <aside className="shell-drawer">{drawer}</aside>}
      </div>
      {/* 워크스페이스 컨텍스트 안에서 렌더링되어야 하는 전역 대화상자 */}
      <CommandPalette />
      <ShareDialog />
      <ProfileDialog />
      <ShortcutsDialog />
    </div>
  );
}
