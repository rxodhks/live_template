import type { ReactNode } from 'react';
import { TopBar } from './TopBar';
import { LeftRail } from './LeftRail';
import { CommandPalette } from './CommandPalette';
import { ProfileDialog, ShareDialog, ShortcutsDialog } from './Dialogs';

/** 상단 바 + 왼쪽 레일 + (컨텍스트 패널) + 본문 + (오른쪽 서랍) */
export function AppShell({ panel, drawer, children }: { panel?: ReactNode; drawer?: ReactNode; children: ReactNode }) {
  return (
    <div className="shell">
      <TopBar />
      <div className="shell-body">
        <LeftRail />
        {panel && <aside className="shell-panel">{panel}</aside>}
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
