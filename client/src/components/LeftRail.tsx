import { NavLink, useLocation } from 'react-router-dom';
import {
  Code2,
  FileText,
  History,
  Home,
  Keyboard,
  LayoutDashboard,
  Lock,
  Palette,
  Settings,
  Users,
} from 'lucide-react';
import type { ViewModule } from '@shared/types';
import { useOptionalWorkspace, viewPath } from '../workspace/context';
import { usePresence } from '../store/presence';
import { useUI } from '../store/ui';
import { cx } from '../lib/util';

const MODULE_ICON: Partial<Record<ViewModule, typeof Home>> = {
  overview: LayoutDashboard,
  design: Palette,
  code: Code2,
  docs: FileText,
  notes: Lock,
  timeline: History,
  members: Users,
  settings: Settings,
};

const MODULE_TIP: Partial<Record<ViewModule, string>> = {
  overview: '개요',
  design: '디자인',
  code: '코딩',
  docs: '문서',
  notes: '비밀 노트',
  timeline: '템플릿 타임라인',
  members: '멤버',
  settings: '템플릿 설정',
};

/**
 * 왼쪽 아이콘 레일
 *  - 위: 전역 이동 (홈, 전체 타임라인)
 *  - 가운데: 템플릿 안에서 켜진 기능들 + 비밀 노트/타임라인/멤버/설정
 *  - 각 아이콘 옆 점은 그 화면에 있는 다른 사용자 색상
 */
export function LeftRail() {
  const ws = useOptionalWorkspace();
  const location = useLocation();
  const others = usePresence((s) => s.others);
  const setShortcutsOpen = useUI((s) => s.setShortcutsOpen);

  const viewersOf = (module: ViewModule) => Object.values(others).filter((p) => p.view.module === module);

  const modules: ViewModule[] = ws
    ? ['overview', ...ws.template.features, 'notes', 'timeline', 'members', 'settings']
    : [];

  return (
    <nav className="rail" aria-label="주 메뉴">
      <div className="rail-group">
        <NavLink to="/" end className={({ isActive }) => cx('rail-item', isActive && 'is-active')} data-tip="대시보드" data-tip-side="right">
          <Home size={19} />
          <span className="rail-label">홈</span>
        </NavLink>
        <NavLink to="/timeline" className={({ isActive }) => cx('rail-item', isActive && 'is-active')} data-tip="전체 타임라인" data-tip-side="right">
          <History size={19} />
          <span className="rail-label">기록</span>
        </NavLink>
      </div>

      {ws && (
        <div className="rail-group rail-modules">
          <span className="rail-template" data-tip={ws.template.name} data-tip-side="right">
            {ws.template.emoji}
          </span>
          {modules.map((m) => {
            const Icon = MODULE_ICON[m]!;
            const active = ws.view.module === m;
            const viewers = viewersOf(m);
            const isFeature = m === 'design' || m === 'code' || m === 'docs';
            return (
              <NavLink
                key={m}
                to={viewPath(ws.template.id, m)}
                className={cx('rail-item', active && 'is-active', isFeature && `rail-feature rail-${m}`)}
                data-tip={`${MODULE_TIP[m]}${viewers.length ? ` · ${viewers.map((v) => v.user.name).join(', ')}` : ''}`}
                data-tip-side="right"
                onClick={(e) => {
                  // 같은 모듈이면 마지막 항목을 유지
                  if (active && location.pathname.startsWith(viewPath(ws.template.id, m))) e.preventDefault();
                }}
              >
                <Icon size={19} />
                <span className="rail-label">{MODULE_TIP[m]!.replace('템플릿 ', '')}</span>
                {viewers.length > 0 && (
                  <span className="rail-viewers">
                    {viewers.slice(0, 3).map((v) => (
                      <span key={v.socketId} style={{ background: v.user.color }} />
                    ))}
                  </span>
                )}
              </NavLink>
            );
          })}
        </div>
      )}

      <div className="rail-group rail-bottom">
        <button className="rail-item" data-tip="키보드 단축키 (?)" data-tip-side="right" onClick={() => setShortcutsOpen(true)}>
          <Keyboard size={19} />
        </button>
      </div>
    </nav>
  );
}
