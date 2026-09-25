import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Code2,
  Eye,
  FilePlus2,
  FileText,
  History,
  Keyboard,
  LayoutDashboard,
  Lock,
  MessageSquare,
  Moon,
  Palette,
  Plus,
  Search,
  Settings,
  Share2,
  UserRound,
  Users,
} from 'lucide-react';
import { getBoards, getDocs, getFiles, getLanguage, sortedItems } from '@shared/schema';
import { useUI } from '../store/ui';
import { useTemplates } from '../store/templates';
import { useSession } from '../store/session';
import { usePresence, uniqueUsers } from '../store/presence';
import { useOptionalWorkspace, viewPath } from '../workspace/context';
import { createBoard, createCodeFile, createDocument } from '../workspace/actions';
import { Kbd } from './ui';
import { cx } from '../lib/util';

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords?: string;
  run: () => void;
}

/** 한글 초성 검색 지원 */
const CHOSUNG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
function chosung(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.charCodeAt(0) - 0xac00;
    out += code >= 0 && code < 11172 ? CHOSUNG[Math.floor(code / 588)] : ch;
  }
  return out;
}

function matches(cmd: Command, q: string): boolean {
  if (!q) return true;
  const hay = `${cmd.label} ${cmd.keywords ?? ''} ${cmd.group}`.toLowerCase();
  const needle = q.toLowerCase();
  return hay.includes(needle) || chosung(hay).includes(needle);
}

export function CommandPalette() {
  const open = useUI((s) => s.paletteOpen);
  if (!open) return null;
  return <Palette_ />;
}

function Palette_() {
  const ui = useUI();
  const navigate = useNavigate();
  const ws = useOptionalWorkspace();
  const me = useSession((s) => s.user);
  const setTheme = useSession((s) => s.setTheme);
  const theme = useSession((s) => s.theme);
  const templates = useTemplates((s) => s.templates);
  const others = usePresence((s) => s.others);
  const [q, setQ] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => ui.setPaletteOpen(false);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    if (ws && me) {
      const tid = ws.template.id;
      const f = ws.template.features;
      if (f.includes('code'))
        for (const item of sortedItems(getFiles(ws.doc))) {
          const lang = getLanguage(item.get('language') as string);
          list.push({
            id: `file:${item.get('id')}`,
            group: '코드 파일',
            label: String(item.get('name')),
            hint: lang.name,
            icon: <Code2 size={16} />,
            run: () => ws.go('code', item.get('id') as string),
          });
        }
      if (f.includes('docs'))
        for (const item of sortedItems(getDocs(ws.doc)))
          list.push({
            id: `doc:${item.get('id')}`,
            group: '문서',
            label: String(item.get('title')),
            icon: <span>{String(item.get('emoji') ?? '📄')}</span>,
            run: () => ws.go('docs', item.get('id') as string),
          });
      if (f.includes('design'))
        for (const item of sortedItems(getBoards(ws.doc)))
          list.push({
            id: `board:${item.get('id')}`,
            group: '디자인 보드',
            label: String(item.get('name')),
            icon: <Palette size={16} />,
            run: () => ws.go('design', item.get('id') as string),
          });
      for (const n of ws.notes)
        list.push({ id: `note:${n.id}`, group: '비밀 노트', label: n.title, icon: <Lock size={16} />, run: () => ws.go('notes', n.id) });

      if (ws.canEdit) {
        if (f.includes('code')) list.push({ id: 'new-file', group: '만들기', label: '새 코드 파일', icon: <FilePlus2 size={16} />, keywords: 'new file 파일 추가', run: () => void createCodeFile(ws, me) });
        if (f.includes('docs')) list.push({ id: 'new-doc', group: '만들기', label: '새 문서', icon: <FileText size={16} />, keywords: 'new document', run: () => createDocument(ws, me) });
        if (f.includes('design')) list.push({ id: 'new-board', group: '만들기', label: '새 디자인 보드', icon: <Palette size={16} />, keywords: 'new board canvas', run: () => createBoard(ws, me) });
        list.push({
          id: 'new-note',
          group: '만들기',
          label: '새 비밀 노트',
          icon: <Lock size={16} />,
          keywords: 'secret password 비밀번호',
          run: () => {
            ws.go('notes');
            ui.setNewNoteOpen(true);
          },
        });
        list.push({
          id: 'share',
          group: '작업',
          label: ws.isPrivate ? '팀원 초대하기 (협업 공간으로 전환)' : '팀원 초대하기',
          icon: <Share2 size={16} />,
          keywords: 'invite link 링크 초대 협업',
          run: () => ui.setShareOpen(true),
        });
      }
      if (!ws.isPrivate)
        list.push({ id: 'chat', group: '작업', label: ws.chatOpen ? '채팅 닫기' : '채팅 열기', icon: <MessageSquare size={16} />, run: () => ws.setChatOpen(!ws.chatOpen) });
      for (const p of uniqueUsers(others))
        list.push({
          id: `follow:${p.socketId}`,
          group: '함께 작업 중',
          label: `${p.user.name} 따라가기`,
          icon: <Eye size={16} />,
          keywords: 'follow',
          run: () => ws.setFollow(p.user.id),
        });

      const nav: [string, string, ReactNode, Parameters<typeof viewPath>[1]][] = [
        ['nav-overview', '개요', <LayoutDashboard size={16} />, 'overview'],
        ['nav-timeline', '템플릿 타임라인', <History size={16} />, 'timeline'],
        ['nav-members', '멤버 관리', <Users size={16} />, 'members'],
        ['nav-settings', '템플릿 설정', <Settings size={16} />, 'settings'],
        ['nav-notes', '비밀 노트 목록', <Lock size={16} />, 'notes'],
      ];
      for (const [id, label, icon, module] of nav)
        list.push({ id, group: '이동', label, icon, run: () => navigate(viewPath(tid, module)) });
    }

    for (const t of Object.values(templates).sort((a, b) => b.updatedAt - a.updatedAt))
      list.push({
        id: `tpl:${t.id}`,
        group: '템플릿',
        label: t.name,
        hint: t.id === ws?.template.id ? '현재' : undefined,
        icon: <span>{t.emoji}</span>,
        run: () => navigate(`/t/${t.id}`),
      });
    list.push({ id: 'new-template', group: '템플릿', label: '새 템플릿 만들기', icon: <Plus size={16} />, keywords: 'create new', run: () => navigate('/?new=1') });
    list.push({ id: 'global-timeline', group: '이동', label: '전체 타임라인', icon: <History size={16} />, run: () => navigate('/timeline') });
    list.push({ id: 'home', group: '이동', label: '대시보드', icon: <LayoutDashboard size={16} />, keywords: 'home 홈', run: () => navigate('/') });
    list.push({
      id: 'theme',
      group: '설정',
      label: theme === 'dark' ? '라이트 테마로 전환' : '다크 테마로 전환',
      icon: <Moon size={16} />,
      keywords: 'theme dark light',
      run: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
    });
    list.push({ id: 'profile', group: '설정', label: '프로필 수정', icon: <UserRound size={16} />, run: () => ui.setProfileOpen(true) });
    list.push({ id: 'shortcuts', group: '설정', label: '키보드 단축키 보기', icon: <Keyboard size={16} />, run: () => ui.setShortcutsOpen(true) });
    return list;
  }, [ws, me, templates, others, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = commands.filter((c) => matches(c, q.trim())).slice(0, 60);
  const safeIndex = Math.min(index, Math.max(0, filtered.length - 1));

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
  }, [safeIndex]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    close();
    c.run();
  };

  let lastGroup = '';
  return createPortal(
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="명령 팔레트">
        <div className="palette-input">
          <Search size={18} />
          <input
            autoFocus
            value={q}
            placeholder="무엇을 찾고 있나요? (초성 검색 가능: ㅁㅅ → 문서)"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, filtered.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                run(filtered[safeIndex]);
              } else if (e.key === 'Escape') close();
            }}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className="palette-list" ref={listRef}>
          {filtered.length === 0 && <div className="palette-empty">일치하는 항목이 없습니다</div>}
          {filtered.map((c, i) => {
            const header = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {header && <div className="palette-group">{header}</div>}
                <button
                  className={cx('palette-item', i === safeIndex && 'is-selected')}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => run(c)}
                >
                  <span className="palette-icon">{c.icon}</span>
                  <span className="palette-label">{c.label}</span>
                  {c.hint && <span className="palette-hint">{c.hint}</span>}
                  <ArrowRight size={14} className="palette-arrow" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-footer">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> 이동
          </span>
          <span>
            <Kbd>Enter</Kbd> 실행
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
