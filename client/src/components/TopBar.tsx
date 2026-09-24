import { Link, useNavigate } from 'react-router-dom';
import {
  ChevronDown,
  Eye,
  LayoutGrid,
  LogOut,
  MapPin,
  MessageSquare,
  Moon,
  Monitor,
  PanelLeft,
  Search,
  Share2,
  Sun,
  UserRound,
  Wifi,
  WifiOff,
  Keyboard,
} from 'lucide-react';
import { FEATURE_INFO } from '@shared/presets';
import { useOptionalWorkspace, viewPath } from '../workspace/context';
import { useSession, type ThemePref } from '../store/session';
import { useTemplates } from '../store/templates';
import { usePresence, uniqueUsers } from '../store/presence';
import { useConnection } from '../store/connection';
import { useUI } from '../store/ui';
import { Avatar, IconButton, Kbd, Menu, confirmDialog } from './ui';
import { SaveIndicator } from './SaveIndicator';
import { modKey } from '../lib/util';
import { setToken } from '../lib/api';
import { resetSocket } from '../lib/socket';
import { viewLabel } from '../workspace/viewLabel';

const THEME_ICON: Record<ThemePref, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };
const THEME_NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<ThemePref, string> = { system: '시스템 테마', light: '라이트 테마', dark: '다크 테마' };

export function TopBar() {
  const ws = useOptionalWorkspace();
  const user = useSession((s) => s.user);
  const theme = useSession((s) => s.theme);
  const setTheme = useSession((s) => s.setTheme);
  const templates = useTemplates((s) => s.templates);
  const status = useConnection((s) => s.status);
  const ui = useUI();
  const navigate = useNavigate();

  const ThemeIcon = THEME_ICON[theme];
  const sortedTemplates = Object.values(templates).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link to="/" className="brand" aria-label="LiveTemplate 홈">
          <span className="brand-mark">
            <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden>
              <rect width="32" height="32" rx="8" fill="var(--accent)" />
              <path d="M9 8v13a3 3 0 0 0 3 3h11" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
              <circle cx="21" cy="11" r="3.5" fill="#ffd166" />
            </svg>
          </span>
          <span className="brand-name">LiveTemplate</span>
        </Link>

        {ws && (
          <>
            <IconButton label={ws.panelOpen ? '탐색 패널 닫기' : '탐색 패널 열기'} onClick={() => ws.setPanelOpen(!ws.panelOpen)} active={ws.panelOpen}>
              <PanelLeft size={17} />
            </IconButton>
            <span className="crumb-sep">/</span>
            <Menu
              width={280}
              header="템플릿 전환"
              items={() => [
                ...sortedTemplates.map((t) => ({
                  label: t.name,
                  icon: <span>{t.emoji}</span>,
                  checked: t.id === ws.template.id,
                  hint: t.features.map((f) => FEATURE_INFO[f].emoji).join(''),
                  onSelect: () => navigate(`/t/${t.id}`),
                })),
                { divider: true, label: '' },
                { label: '모든 템플릿 보기', icon: <LayoutGrid size={15} />, onSelect: () => navigate('/') },
              ]}
              trigger={({ toggle, ref, open }) => (
                <button ref={ref} className="crumb-template" onClick={toggle} aria-expanded={open}>
                  <span className="crumb-emoji">{ws.template.emoji}</span>
                  <span className="crumb-name">{ws.template.name}</span>
                  <ChevronDown size={14} />
                </button>
              )}
            />
            <span className="crumb-sep">/</span>
            <span className="crumb-view">{viewLabel(ws)}</span>
          </>
        )}
      </div>

      <button className="search-trigger" onClick={() => ui.setPaletteOpen(true)}>
        <Search size={15} />
        <span>{ws ? '파일·문서·보드 검색, 명령 실행' : '템플릿 검색, 명령 실행'}</span>
        <Kbd>{modKey} K</Kbd>
      </button>

      <div className="topbar-right">
        {ws && <SaveIndicator synced={ws.synced} />}
        {!ws && (
          <span className={`conn-dot is-${status}`} data-tip={status === 'online' ? '실시간 연결됨' : '연결 끊김 · 재연결 중'}>
            {status === 'online' ? <Wifi size={15} /> : <WifiOff size={15} />}
          </span>
        )}
        {ws && <PresenceAvatars />}
        {ws && ws.role !== 'viewer' && (
          <button className="btn btn-primary btn-sm" onClick={() => ui.setShareOpen(true)}>
            <Share2 size={14} />
            <span className="hide-sm">초대</span>
          </button>
        )}
        {ws && (
          <span className="badge-anchor">
            <IconButton label="채팅" active={ws.chatOpen} onClick={() => ws.setChatOpen(!ws.chatOpen)}>
              <MessageSquare size={17} />
            </IconButton>
            {ws.unread > 0 && <span className="badge-count">{ws.unread > 99 ? '99+' : ws.unread}</span>}
          </span>
        )}
        <IconButton label={`${THEME_LABEL[theme]} (클릭하여 전환)`} onClick={() => setTheme(THEME_NEXT[theme])}>
          <ThemeIcon size={17} />
        </IconButton>
        {user && (
          <Menu
            align="end"
            width={240}
            header={
              <div className="menu-profile">
                <Avatar user={user} size={32} tooltip={false} />
                <div>
                  <b>{user.name}</b>
                  <span className="muted">이 브라우저에 저장된 프로필</span>
                </div>
              </div>
            }
            items={[
              { label: '프로필 수정', icon: <UserRound size={15} />, onSelect: () => ui.setProfileOpen(true) },
              { label: '키보드 단축키', icon: <Keyboard size={15} />, onSelect: () => ui.setShortcutsOpen(true) },
              { divider: true, label: '' },
              {
                label: '이 기기에서 로그아웃',
                icon: <LogOut size={15} />,
                danger: true,
                onSelect: async () => {
                  const ok = await confirmDialog({
                    title: '로그아웃할까요?',
                    message: '이 브라우저에 저장된 프로필 토큰이 삭제됩니다. 같은 계정으로 다시 들어오려면 초대 링크로 새로 참여해야 합니다.',
                    confirmText: '로그아웃',
                    danger: true,
                  });
                  if (!ok) return;
                  setToken(null);
                  resetSocket();
                  location.href = '/';
                },
              },
            ]}
            trigger={({ toggle, ref }) => (
              <button ref={ref} className="profile-trigger" onClick={toggle} aria-label="내 프로필">
                <Avatar user={user} size={30} tooltip={false} />
              </button>
            )}
          />
        )}
      </div>
    </header>
  );
}

/** 같은 템플릿에 접속한 사람들. 클릭하면 따라가기/위치로 이동 */
function PresenceAvatars() {
  const ws = useOptionalWorkspace()!;
  const others = usePresence((s) => s.others);
  const users = uniqueUsers(others);
  const navigate = useNavigate();
  if (users.length === 0) return <span className="presence-alone" data-tip="지금은 혼자 작업 중입니다">혼자 작업 중</span>;
  const shown = users.slice(0, 5);
  return (
    <div className="presence-avatars" aria-label={`${users.length}명 접속 중`}>
      {shown.map((p) => (
        <Menu
          key={p.user.id}
          align="end"
          width={250}
          header={
            <div className="menu-profile">
              <Avatar user={p.user} size={32} status={p.idle ? 'idle' : 'online'} tooltip={false} />
              <div>
                <b>{p.user.name}</b>
                <span className="muted">
                  {p.idle ? '자리 비움 · ' : ''}
                  {viewLabel({ template: ws.template, view: p.view, doc: ws.doc, notes: ws.notes })}
                </span>
              </div>
            </div>
          }
          items={[
            {
              label: ws.follow === p.socketId ? '따라가기 중지' : '따라가기',
              icon: <Eye size={15} />,
              onSelect: () => ws.setFollow(ws.follow === p.socketId ? null : p.socketId),
            },
            {
              label: '이 사람의 위치로 이동',
              icon: <MapPin size={15} />,
              onSelect: () => navigate(viewPath(ws.template.id, p.view.module, p.view.itemId)),
            },
          ]}
          trigger={({ toggle, ref }) => (
            <button
              ref={ref}
              className={`presence-avatar ${ws.follow === p.socketId ? 'is-following' : ''}`}
              onClick={toggle}
              style={{ ['--user-color' as string]: p.user.color }}
              aria-label={`${p.user.name} 메뉴`}
            >
              <Avatar user={p.user} size={28} status={p.idle ? 'idle' : 'online'} tooltip={p.user.name} />
            </button>
          )}
        />
      ))}
      {users.length > shown.length && <span className="avatar avatar-more">+{users.length - shown.length}</span>}
    </div>
  );
}
