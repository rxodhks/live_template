import { Link, useNavigate } from 'react-router-dom';
import {
  Check,
  ChevronDown,
  Cloud,
  CloudOff,
  HardDrive,
  Keyboard,
  LayoutGrid,
  LogOut,
  ScrollText,
  ShieldCheck,
  MessageSquare,
  Monitor,
  Moon,
  PanelLeft,
  Search,
  Sun,
  UserPlus,
  UserRound,
} from 'lucide-react';
import { FEATURE_INFO } from '@shared/presets';
import { useOptionalWorkspace } from '../workspace/context';
import { useSession, type ThemePref } from '../store/session';
import { isPrivate, useTemplates } from '../store/templates';
import { useUI } from '../store/ui';
import { useConnection } from '../store/connection';
import { Avatar, IconButton, Kbd, Menu } from './ui';
import { SaveIndicator } from './SaveIndicator';
import { BRAND, BrandMark } from './Brand';
import { PresenceBar } from './PresenceBar';
import { modKey } from '../lib/util';
import { logout } from '../lib/auth';
import { MODULE_NAMES } from '../workspace/viewLabel';
import { itemsMap } from '../workspace/actions';
import { useYField } from '../hooks/useY';

const THEME_ICON: Record<ThemePref, typeof Sun> = { light: Sun, dark: Moon, system: Monitor };
const THEME_NEXT: Record<ThemePref, ThemePref> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_LABEL: Record<ThemePref, string> = { system: '시스템 테마', light: '라이트 테마', dark: '다크 테마' };
const PROVIDER_LABEL = { google: 'Google', github: 'GitHub' } as const;

export function TopBar() {
  const ws = useOptionalWorkspace();
  const user = useSession((s) => s.user);
  const theme = useSession((s) => s.theme);
  const setTheme = useSession((s) => s.setTheme);
  const templates = useTemplates((s) => s.templates);
  const account = useSession((s) => s.account);
  const offline = useSession((s) => s.offline);
  const remoteError = useTemplates((s) => s.remoteError);
  const ui = useUI();
  const navigate = useNavigate();

  const ThemeIcon = THEME_ICON[theme];
  const sortedTemplates = Object.values(templates).sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <Link to="/" className="brand" aria-label={`${BRAND} 홈`}>
          <span className="brand-mark">
            <BrandMark size={22} />
          </span>
          <span className="brand-name">{BRAND}</span>
        </Link>

        {ws && (
          <>
            <IconButton className="panel-toggle" label={ws.panelOpen ? '탐색 패널 닫기' : '탐색 패널 열기'} onClick={() => ws.setPanelOpen(!ws.panelOpen)} active={ws.panelOpen}>
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
                  hint: `${isPrivate(t) ? '개인' : '협업'} ${t.features.map((f) => FEATURE_INFO[f].emoji).join('')}`,
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
            <SpaceBadge />
            <span className="crumb-sep">/</span>
            <CurrentViewLabel />
          </>
        )}
      </div>

      <button className="search-trigger" onClick={() => ui.setPaletteOpen(true)}>
        <Search size={15} />
        <span>{ws ? '파일·문서·보드 검색, 명령 실행' : '템플릿 검색, 명령 실행'}</span>
        <Kbd>{modKey} K</Kbd>
      </button>

      <div className="topbar-right">
        {ws && <SaveIndicator synced={ws.synced} mode={ws.mode} />}
        {!ws && (remoteError || offline) && (
          <span className="conn-dot is-offline" data-tip={`협업 서버에 연결할 수 없습니다 · 개인 공간은 계속 사용할 수 있습니다`}>
            <CloudOff size={15} />
          </span>
        )}
        {ws && !ws.isPrivate && <PresenceBar />}
        {ws && ws.canEdit && (
          <span className="badge-anchor">
            <button className="btn btn-primary btn-sm" onClick={() => ui.setShareOpen(true)} data-tip={ws.isPrivate ? '초대하면 협업 공간으로 전환됩니다' : '초대 링크 만들기 · 관리'}>
              <UserPlus size={14} />
              <span>초대</span>
            </button>
            {ws.requests.length > 0 && <span className="badge-count">{ws.requests.length}</span>}
          </span>
        )}
        {ws && !ws.isPrivate && (
          <span className="badge-anchor">
            <IconButton label="채팅" active={ws.chatOpen} onClick={() => ws.setChatOpen(!ws.chatOpen)}>
              <MessageSquare size={17} />
            </IconButton>
            {ws.unread > 0 && <span className="badge-count">{ws.unread > 99 ? '99+' : ws.unread}</span>}
          </span>
        )}
        <IconButton className="theme-toggle" label={`${THEME_LABEL[theme]} (클릭하여 전환)`} onClick={() => setTheme(THEME_NEXT[theme])}>
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
                  <span className="muted menu-profile-email">{account?.email ?? (account?.providers[0] ? `${PROVIDER_LABEL[account.providers[0]]} 계정으로 로그인` : '로그인됨')}</span>
                </div>
              </div>
            }
            items={[
              { label: '프로필 수정', icon: <UserRound size={15} />, onSelect: () => ui.setProfileOpen(true) },
              ...(['system', 'light', 'dark'] as ThemePref[]).map((t) => {
                const Icon = THEME_ICON[t];
                return { label: THEME_LABEL[t], icon: <Icon size={15} />, checked: theme === t, hint: theme === t ? <Check size={14} /> : undefined, onSelect: () => setTheme(t) };
              }),
              { divider: true, label: '' },
              { label: '키보드 단축키', icon: <Keyboard size={15} />, onSelect: () => ui.setShortcutsOpen(true) },
              { label: '이용약관', icon: <ScrollText size={15} />, onSelect: () => navigate('/terms') },
              { label: '개인정보처리방침', icon: <ShieldCheck size={15} />, onSelect: () => navigate('/privacy') },
              { divider: true, label: '' },
              { label: '로그아웃', icon: <LogOut size={15} />, onSelect: () => void logout() },
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

/** 개인 공간 / 협업 공간 표시 */
function SpaceBadge() {
  const ws = useOptionalWorkspace()!;
  const ui = useUI();
  const status = useConnection((s) => s.status);
  if (ws.isPrivate) {
    return (
      <button
        className="space-chip is-personal as-button"
        data-tip={
          ws.mode === 'personal'
            ? '나만 볼 수 있는 개인 공간 · 아직 이 기기에만 있어 인터넷에 연결되면 자동으로 백업됩니다. 초대하면 협업 공간으로 전환됩니다.'
            : '나만 볼 수 있는 개인 공간 · 클라우드에 자동 백업됩니다. 초대하면 협업 공간으로 전환됩니다.'
        }
        onClick={() => ws.canEdit && ui.setShareOpen(true)}
      >
        <HardDrive size={12} /> 개인 공간
      </button>
    );
  }
  const offline = status !== 'online';
  return (
    <span className={`space-chip is-shared${offline ? ' is-offline' : ''}`} data-tip={offline ? '연결이 끊겼습니다 · 편집은 이 기기에 보관되고 다시 연결되면 합쳐집니다' : '클라우드에 저장되는 협업 공간입니다'}>
      {offline ? <CloudOff size={12} /> : <Cloud size={12} />} 협업 공간
    </span>
  );
}

/** 현재 위치 라벨 (항목 이름이 바뀌면 바로 반영) */
function CurrentViewLabel() {
  const ws = useOptionalWorkspace()!;
  const { module, itemId } = ws.view;
  const isItem = module === 'code' || module === 'docs' || module === 'design';
  const item = isItem && itemId ? itemsMap(ws.doc, module).get(itemId) : undefined;
  const name = useYField<string>(item, module === 'docs' ? 'title' : 'name');
  const noteTitle = module === 'notes' && itemId ? ws.notes.find((n) => n.id === itemId)?.title : undefined;
  const label = name ?? noteTitle;
  return <span className="crumb-view">{label ? `${MODULE_NAMES[module]} › ${label}` : MODULE_NAMES[module]}</span>;
}
