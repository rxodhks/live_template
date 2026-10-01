import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
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
import { getBoards, getDocs, getFiles, getLanguage, sortedItems, type Shape } from '@shared/schema';
import type * as Y from 'yjs';
import { useUI } from '../store/ui';
import { useTemplates } from '../store/templates';
import { useSession } from '../store/session';
import { usePresence, uniqueUsers } from '../store/presence';
import { useOptionalWorkspace, viewPath } from '../workspace/context';
import { Kbd } from './ui';
import { cx } from '../lib/util';

interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords?: string;
  /** 내용 검색 결과: 찾은 곳 앞뒤 문장 */
  snippet?: { before: string; match: string; after: string };
  run: () => void;
}

/* ───────────── 한글 초성 검색 ───────────── */

const CHOSUNG = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
/** 한글 음절을 초성으로 바꾼다 (다른 글자는 그대로) */
function chosung(s: string): string {
  let out = '';
  for (const ch of s) {
    const code = ch.charCodeAt(0) - 0xac00;
    out += code >= 0 && code < 11172 ? CHOSUNG[Math.floor(code / 588)] : ch;
  }
  return out;
}

/** 검색어가 한글 자음(ㄱ~ㅎ)만으로 되어 있는지 (띄어쓰기는 무시) */
const JAMO_ONLY = /^[\u3131-\u314e\s]+$/;

/**
 * 초성 검색: 글자들의 초성을 이은 것(공백 무시)이나, 단어마다 첫 글자의 초성을 이은 것에 검색어가 들어 있으면 맞다.
 * 예) ‘ㅁㅅ’ → 문서, ‘ㅅㅂㄱ’ → 서버 계정, ‘ㅅㄱ’ → 서버 계정(단어 첫 글자)
 */
function chosungMatch(text: string, jamo: string): boolean {
  const ini = chosung(text);
  if (ini.replace(/\s+/g, '').includes(jamo)) return true;
  const heads = ini
    .split(/[\s·()\-_/.]+/)
    .map((w) => w.charAt(0))
    .join('');
  return heads.includes(jamo);
}

function matches(cmd: Command, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  if (JAMO_ONLY.test(needle)) {
    const jamo = needle.replace(/\s+/g, '');
    return [cmd.label, cmd.keywords ?? '', cmd.group].some((t) => chosungMatch(t, jamo));
  }
  const hay = `${cmd.label} ${cmd.keywords ?? ''} ${cmd.group}`.toLowerCase();
  return hay.includes(needle);
}

/* ───────────── 내용 검색 ───────────── */

/** 내용 검색을 시작하는 최소 글자 수 · 최대 결과 수 */
const CONTENT_MIN = 2;
const CONTENT_MAX = 30;
const CONTENT_GROUP = '내용에서 찾음';

interface ContentSource {
  key: string;
  module: 'code' | 'docs' | 'design';
  itemId: string;
  title: string;
  icon: ReactNode;
  text: string;
  lower: string;
}

/** Y.XmlFragment(문서 본문)에서 글자만 뽑는다 — yjs 런타임을 불러오지 않도록 메서드 유무로 구분 */
function xmlPlainText(node: unknown, out: string[]): void {
  const n = node as {
    toDelta?: () => { insert?: unknown }[];
    toArray?: () => unknown[];
    nodeName?: string;
    getAttribute?: (k: string) => unknown;
  };
  if (typeof n.toDelta === 'function') {
    // Y.XmlText: 서식(굵게 등)은 버리고 글자만
    out.push(
      n
        .toDelta()
        .map((d) => (typeof d.insert === 'string' ? d.insert : ''))
        .join(''),
    );
    return;
  }
  if (n.nodeName === 'mention' && typeof n.getAttribute === 'function') {
    const label = n.getAttribute('label');
    if (typeof label === 'string') out.push(`@${label}`);
    return;
  }
  if (typeof n.toArray === 'function') for (const c of n.toArray()) xmlPlainText(c, out);
}

function collectSources(doc: Y.Doc, features: string[]): ContentSource[] {
  const list: ContentSource[] = [];
  const push = (src: Omit<ContentSource, 'lower'>) => {
    if (src.text.trim()) list.push({ ...src, lower: src.text.toLowerCase() });
  };
  if (features.includes('code'))
    for (const item of sortedItems(getFiles(doc))) {
      const content = item.get('content') as Y.Text | undefined;
      push({ key: `file:${item.get('id')}`, module: 'code', itemId: String(item.get('id')), title: String(item.get('name')), icon: <Code2 size={16} />, text: content ? content.toString() : '' });
    }
  if (features.includes('docs'))
    for (const item of sortedItems(getDocs(doc))) {
      const out: string[] = [];
      const content = item.get('content');
      if (content) xmlPlainText(content, out);
      push({ key: `doc:${item.get('id')}`, module: 'docs', itemId: String(item.get('id')), title: String(item.get('title')), icon: <span>{String(item.get('emoji') ?? '📄')}</span>, text: out.join('\n') });
    }
  if (features.includes('design'))
    for (const item of sortedItems(getBoards(doc))) {
      const shapes = item.get('shapes') as Y.Map<Shape> | undefined;
      const out: string[] = [];
      shapes?.forEach((s) => {
        if (s.text) out.push(s.text);
        if (s.type === 'frame' && s.name) out.push(s.name);
      });
      push({ key: `board:${item.get('id')}`, module: 'design', itemId: String(item.get('id')), title: String(item.get('name')), icon: <Palette size={16} />, text: out.join('\n') });
    }
  return list;
}

/** 찾은 곳 앞뒤를 잘라 한 줄로 */
function makeSnippet(text: string, at: number, len: number): NonNullable<Command['snippet']> {
  const flat = (t: string) => t.replace(/\s+/g, ' ');
  const start = Math.max(0, at - 28);
  const end = Math.min(text.length, at + len + 60);
  return {
    before: (start > 0 ? '…' : '') + flat(text.slice(start, at)).trimStart(),
    match: flat(text.slice(at, at + len)),
    after: flat(text.slice(at + len, end)).trimEnd() + (end < text.length ? '…' : ''),
  };
}

/**
 * 문서 페이지를 연 뒤 찾은 글자가 있는 곳으로 스크롤한다.
 * 편집기는 지연 로딩되므로 잠시 동안 나타나기를 기다린다. 못 찾으면 그냥 둔다.
 */
function revealInDoc(needle: string, skip: Element | null) {
  const lower = needle.toLowerCase();
  let tries = 0;
  const tick = () => {
    const root = document.querySelector('.doc-content .ProseMirror');
    if (root && root !== skip) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = (n.textContent ?? '').toLowerCase().indexOf(lower);
        if (i < 0) continue;
        const range = document.createRange();
        range.setStart(n, i);
        range.setEnd(n, i + needle.length);
        n.parentElement?.scrollIntoView({ block: 'center' });
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        return;
      }
      // 서식이 섞여 글자가 여러 조각으로 나뉜 경우: 그 글자를 품은 블록으로
      const blocks = root.querySelectorAll<HTMLElement>('p, h1, h2, h3, h4, h5, h6, li, td, th, pre, blockquote');
      for (const b of blocks)
        if ((b.textContent ?? '').toLowerCase().includes(lower)) {
          b.scrollIntoView({ block: 'center' });
          return;
        }
      // 본문이 아직 동기화 중일 수 있으니 조금 더 기다린다
    }
    if (++tries < 40) window.setTimeout(tick, 100);
  };
  window.setTimeout(tick, 50);
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
        // 꺼져 있는 영역이어도 만들 수 있다 (만들면 그 영역이 켜진다)
        const area = (m: 'code' | 'docs' | 'design') => (f.includes(m) ? undefined : '영역 추가');
        list.push({ id: 'new-doc', group: '만들기', label: '새 문서', hint: area('docs'), icon: <FileText size={16} />, keywords: 'new document 문서 추가', run: () => void import('../workspace/actions').then((a) => a.createDocument(ws, me)) });
        list.push({ id: 'new-board', group: '만들기', label: '새 디자인 보드', hint: area('design'), icon: <Palette size={16} />, keywords: 'new board canvas 디자인 추가', run: () => void import('../workspace/actions').then((a) => a.createBoard(ws, me)) });
        list.push({ id: 'new-file', group: '만들기', label: '새 코드 파일', hint: area('code'), icon: <FilePlus2 size={16} />, keywords: 'new file 파일 추가 코딩', run: () => void import('../workspace/actions').then((a) => a.createCodeFile(ws, me)) });
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
      for (const p of uniqueUsers(others, me?.id))
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

  // 내용 검색 — 열려 있는 동안 페이지 글자는 처음 한 번만 뽑아 두고, 검색어가 바뀔 때만 훑는다
  const sourcesRef = useRef<ContentSource[] | null>(null);
  const query = q.trim();
  const contentResults = useMemo<Command[]>(() => {
    if (!ws || query.length < CONTENT_MIN) return [];
    sourcesRef.current ??= collectSources(ws.doc, ws.template.features);
    const needle = query.toLowerCase();
    const out: Command[] = [];
    for (const src of sourcesRef.current) {
      const at = src.lower.indexOf(needle);
      if (at < 0) continue;
      // 같은 페이지에서 몇 곳 더 나오는지 (많으면 99+)
      let count = 1;
      for (let i = src.lower.indexOf(needle, at + needle.length); i >= 0 && count < 100; i = src.lower.indexOf(needle, i + needle.length)) count++;
      // toLowerCase로 길이가 달라지는 드문 글자가 있으면 소문자 본문으로 잘라 위치가 어긋나지 않게
      const base = src.lower.length === src.text.length ? src.text : src.lower;
      out.push({
        id: `content:${src.key}`,
        group: CONTENT_GROUP,
        label: src.title,
        hint: count > 1 ? `${count > 99 ? '99+' : count}곳` : undefined,
        icon: src.icon,
        snippet: makeSnippet(base, at, needle.length),
        run: () => {
          const target = viewPath(ws.template.id, src.module, src.itemId);
          const already = window.location.pathname === target;
          const prevEditor = already ? null : document.querySelector('.doc-content .ProseMirror');
          ws.go(src.module, src.itemId);
          if (src.module === 'docs') revealInDoc(query, prevEditor);
        },
      });
      if (out.length >= CONTENT_MAX) break;
    }
    return out;
  }, [ws, query]);

  const filtered = useMemo(
    () => [...commands.filter((c) => matches(c, query)).slice(0, 60), ...contentResults],
    [commands, query, contentResults],
  );
  const safeIndex = Math.min(index, Math.max(0, filtered.length - 1));

  // 같은 묶음끼리 모아 role="group"으로 보여준다 (순서는 그대로)
  const groups = useMemo(() => {
    const list: { name: string; items: { c: Command; i: number }[] }[] = [];
    filtered.forEach((c, i) => {
      const last = list[list.length - 1];
      if (last && last.name === c.group) last.items.push({ c, i });
      else list.push({ name: c.group, items: [{ c, i }] });
    });
    return list;
  }, [filtered]);

  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
  }, [safeIndex]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    close();
    c.run();
  };

  return createPortal(
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="명령 팔레트">
        <div className="palette-input">
          <Search size={18} />
          <input
            autoFocus
            value={q}
            role="combobox"
            aria-label="명령 · 페이지 검색"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={filtered.length ? optionId(safeIndex) : undefined}
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
        <div className="palette-list" ref={listRef} id={listId} role="listbox" aria-label="검색 결과">
          {filtered.length === 0 && (
            <div className="palette-empty" role="presentation">
              일치하는 항목이 없습니다
            </div>
          )}
          {groups.map((g, gi) => (
            <div key={`${g.name}-${gi}`} role="group" aria-labelledby={`${baseId}-g-${gi}`}>
              <div className="palette-group" id={`${baseId}-g-${gi}`} role="presentation">
                {g.name}
              </div>
              {g.items.map(({ c, i }) => (
                <div
                  key={c.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === safeIndex}
                  className={cx('palette-item', i === safeIndex && 'is-selected', c.snippet && 'has-snippet')}
                  onMouseMove={() => setIndex(i)}
                  // 입력 칸의 포커스를 빼앗지 않는다
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => run(c)}
                >
                  <span className="palette-icon">{c.icon}</span>
                  {c.snippet ? (
                    <span className="palette-text">
                      <span className="palette-label">{c.label}</span>
                      <span className="palette-snippet">
                        {c.snippet.before}
                        <mark>{c.snippet.match}</mark>
                        {c.snippet.after}
                      </span>
                    </span>
                  ) : (
                    <span className="palette-label">{c.label}</span>
                  )}
                  {c.hint && <span className="palette-hint">{c.hint}</span>}
                  <ArrowRight size={14} className="palette-arrow" />
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="palette-footer">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> 이동
          </span>
          <span>
            <Kbd>Enter</Kbd> 실행
          </span>
          {ws && query.length > 0 && query.length < CONTENT_MIN && <span>두 글자 이상이면 본문 내용도 찾습니다</span>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
