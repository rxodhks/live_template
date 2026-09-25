import { type CSSProperties, type DragEvent, type ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  CornerLeftUp,
  Download,
  FolderInput,
  FolderPlus,
  FolderTree,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Smile,
  Trash2,
} from 'lucide-react';
import type * as Y from 'yjs';
import { FEATURE_INFO } from '@shared/presets';
import { getLanguage, type YItem } from '@shared/schema';
import { useWorkspace, viewPath } from './context';
import { createPage, deleteItem, duplicateItem, itemLabel, renameItem, type ItemModule } from './actions';
import {
  MAX_FOLDER_DEPTH,
  SECTION_EMOJIS,
  canNestInto,
  createSection,
  deleteSection,
  isCustomized,
  movePage,
  moveSection,
  nextSectionName,
  outdentSection,
  renameSection,
  resetLayout,
  setSectionEmoji,
  shiftSection,
  useLayout,
  type Layout,
  type PageRef,
  type SectionView,
} from './layout';
import { usePresence } from '../store/presence';
import { useSession } from '../store/session';
import { toast } from '../store/toasts';
import { useUI } from '../store/ui';
import { IconButton, InlineEdit, Menu, confirmDialog, type MenuItem } from '../components/ui';
import { cx, downloadText } from '../lib/util';
import { DocOutline } from '../modules/docs/DocOutline';
import { DesignLayers } from '../modules/design/DesignLayers';

const COLLAPSE_KEY = 'lt.explorer.collapsed';
const PAGE_MIME = 'application/x-madang-page';
const SECTION_MIME = 'application/x-madang-section';
/** 폴더 한 단계마다 들여쓰는 폭 */
const INDENT = 14;

function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

const PAGE_NOUN: Record<ItemModule, string> = { docs: '문서', design: '디자인 보드', code: '코드 파일' };
/** 폴더의 + 메뉴 순서: 기본 폴더면 그 종류를 맨 위에 */
const pageKinds = (first: ItemModule | null): ItemModule[] => (first ? [first, ...(['docs', 'design', 'code'] as ItemModule[]).filter((m) => m !== first)] : ['docs', 'design', 'code']);

type Drag = { kind: 'page'; module: ItemModule; id: string } | { kind: 'section'; id: string };
type Drop =
  | { kind: 'page'; sectionId: string; beforeId: string | null; markId: string | null; pos: 'before' | 'after' | 'end' }
  | { kind: 'section'; parentId: string | null; beforeId: string | null; markId: string; pos: 'before' | 'after' | 'into' };

/** 폴더 트리 곳곳에서 쓰는 상태와 동작 */
interface TreeApi {
  layout: Layout;
  collapsed: Record<string, boolean>;
  toggle(id: string): void;
  expand(id: string): void;
  editing: string | null;
  setEditing(id: string | null): void;
  emojiFor: string | null;
  setEmojiFor(id: string | null): void;
  drag: Drag | null;
  drop: Drop | null;
  setDrag(d: Drag | null): void;
  setDrop(d: Drop | null): void;
  applyDrop(): void;
  endDrag(): void;
  addPage(m: ItemModule, sectionId?: string): void;
  addSection(opts?: { afterId?: string; parentId?: string }): void;
  rename(s: SectionView, name: string): void;
  remove(s: SectionView): void;
  movePageTo(p: { module: ItemModule; id: string; name: string }, target: SectionView): void;
  newFolderFor(p: PageRef, s: SectionView): void;
}

const TreeContext = createContext<TreeApi | null>(null);
const useTree = () => useContext(TreeContext)!;

/**
 * 왼쪽 컨텍스트 패널 = 탐색기.
 *  - 페이지(문서 · 디자인 보드 · 코드 파일)를 폴더별로 보여 준다. 처음에는 기능별 기본 폴더이고,
 *    폴더 이름 · 아이콘 · 순서를 바꾸고, 새 폴더와 폴더 안의 폴더(하위 폴더)를 만들고,
 *    페이지와 폴더를 끌어서 원하는 곳 · 순서로 옮길 수 있다.
 *  - 템플릿 안에서 바로 문서 · 디자인 · 코딩 페이지를 추가할 수 있다 (꺼져 있던 영역은 자동으로 켜진다).
 *  - 누가 어느 페이지를 보고 있는지 점으로 표시하고, 현재 페이지에 따라 문서 목차 / 디자인 레이어가 아래에 붙는다.
 */
export function Explorer() {
  const ws = useWorkspace();
  const me = useSession((s) => s.user)!;
  const setNewNoteOpen = useUI((s) => s.setNewNoteOpen);
  const features = ws.template.features;
  const layout = useLayout(ws.doc, features);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);
  const [editing, setEditing] = useState<string | null>(null);
  const [emojiFor, setEmojiFor] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);

  const setCollapsedMany = (ids: string[], value: boolean) =>
    setCollapsed((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = value;
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        /* 무시 */
      }
      return next;
    });
  const expand = (id: string) => collapsed[id] && setCollapsedMany([id], false);
  const toggle = (id: string) => setCollapsedMany([id], !collapsed[id]);

  // 현재 보고 있는 페이지가 든 폴더 (새 페이지를 넣을 곳을 고를 때)
  const current = layout.all.find((s) => s.pages.some((p) => p.module === ws.view.module && p.id === ws.view.itemId));

  /** 위쪽 + 추가: 그 종류의 기본 폴더가 있으면 거기, 없으면 지금 보는 폴더 (또는 첫 폴더) */
  const addPage = (module: ItemModule, sectionId?: string) => {
    let target = sectionId;
    if (!target && features.includes(module) && !layout.byId.has(module)) target = current?.id ?? layout.roots[0]?.id;
    if (target) expandPath(target);
    void createPage(ws, module, me, { sectionId: target });
  };

  /** 폴더와 그 상위 폴더를 모두 펼친다 */
  const expandPath = (id: string) => {
    const ids: string[] = [];
    let cur: string | null = id;
    while (cur) {
      ids.push(cur);
      cur = layout.byId.get(cur)?.parent ?? null;
    }
    setCollapsedMany(ids, false);
  };

  const addSection = (opts: { afterId?: string; parentId?: string } = {}) => {
    const name = nextSectionName(ws.doc, features);
    const id = createSection(ws.doc, features, name, me.id, opts);
    if (opts.parentId) expandPath(opts.parentId);
    setEditing(id);
    ws.report({ type: 'section.create', targetId: id, targetName: name });
  };

  const rename = (s: SectionView, name: string) => {
    if (!name.trim() || name.trim() === s.name) return;
    renameSection(ws.doc, s.id, name);
    ws.report({ type: 'section.rename', targetId: s.id, targetName: name.trim(), detail: `${s.name} → ${name.trim()}` });
  };

  const remove = async (s: SectionView) => {
    if (layout.all.length <= 1) {
      toast.warning('폴더는 하나 이상 있어야 합니다', '페이지를 넣을 폴더가 하나는 필요합니다.');
      return;
    }
    const parent = s.parent ? layout.byId.get(s.parent) : undefined;
    const inside = [s.pages.length ? `페이지 ${s.pages.length}개` : '', s.children.length ? `하위 폴더 ${s.children.length}개` : ''].filter(Boolean).join('와 ');
    const ok = await confirmDialog({
      title: `‘${s.name}’ 폴더를 삭제할까요?`,
      message: !inside
        ? '빈 폴더입니다. 페이지는 영향을 받지 않습니다.'
        : parent
          ? `안에 있는 ${inside}는 지워지지 않고 상위 폴더 ‘${parent.name}’로 옮겨집니다.`
          : `안에 있는 ${inside}는 지워지지 않습니다. 페이지는 각 종류의 기본 폴더(없으면 맨 위 폴더)로, 하위 폴더는 한 단계 위로 옮겨집니다.`,
      confirmText: '폴더 삭제',
      danger: true,
    });
    if (!ok) return;
    const r = deleteSection(ws.doc, features, s.id);
    if (!r) return;
    ws.report({ type: 'section.delete', targetId: s.id, targetName: s.name, detail: inside ? `${inside}를 옮김` : '' });
    toast.show({ kind: 'info', title: '폴더를 삭제했습니다', message: inside ? `${s.name} · ${inside}를 ${r.movedTo ? `‘${r.movedTo}’로` : '다른 폴더로'} 옮겼습니다.` : s.name });
  };

  const onReset = async () => {
    const ok = await confirmDialog({
      title: '폴더 구성을 처음 상태로 되돌릴까요?',
      message: '직접 만든 폴더(하위 폴더 포함)와 이름 · 순서가 지워지고, 페이지가 종류별 기본 폴더(디자인 · 코딩 · 문서)로 돌아갑니다. 페이지 내용은 그대로입니다.',
      confirmText: '되돌리기',
    });
    if (!ok) return;
    resetLayout(ws.doc);
    toast.success('폴더 구성을 처음 상태로 되돌렸습니다');
  };

  const movePageTo = (p: { module: ItemModule; id: string; name: string }, section: SectionView) => {
    movePage(ws.doc, features, p.module, p.id, section.id, null);
    expandPath(section.id);
    ws.report({ type: 'page.move', targetId: p.id, targetName: p.name, detail: `→ ${section.name}` });
  };

  const newFolderFor = (p: PageRef, s: SectionView) => {
    const name = nextSectionName(ws.doc, features);
    const id = createSection(ws.doc, features, name, me.id, { afterId: s.id });
    movePage(ws.doc, features, p.module, p.id, id, null);
    setEditing(id);
    ws.report({ type: 'section.create', targetId: id, targetName: name });
  };

  /* ───────────── 끌어서 옮기기 ───────────── */

  const endDrag = () => {
    setDrag(null);
    setDrop(null);
  };

  const applyDrop = () => {
    if (!drag || !drop) return endDrag();
    if (drag.kind === 'page' && drop.kind === 'page') {
      const section = layout.byId.get(drop.sectionId);
      const from = layout.all.find((s) => s.pages.some((p) => p.module === drag.module && p.id === drag.id));
      if (section && drop.beforeId !== drag.id) {
        // 같은 자리에 놓았으면 아무것도 하지 않는다
        const i = section.pages.findIndex((p) => p.module === drag.module && p.id === drag.id);
        const same = i >= 0 && (section.pages[i + 1]?.id ?? null) === drop.beforeId;
        if (!same) {
          const page = from?.pages.find((p) => p.module === drag.module && p.id === drag.id);
          movePage(ws.doc, features, drag.module, drag.id, section.id, drop.beforeId);
          expandPath(section.id);
          if (page && from?.id !== section.id) ws.report({ type: 'page.move', targetId: drag.id, targetName: itemLabel(page.item, page.module), detail: `→ ${section.name}` });
        }
      }
    }
    if (drag.kind === 'section' && drop.kind === 'section' && drop.beforeId !== drag.id) {
      const s = layout.byId.get(drag.id);
      const sib = s ? (s.parent ? layout.byId.get(s.parent)!.children : layout.roots) : [];
      const i = sib.findIndex((x) => x.id === drag.id);
      const same = s && s.parent === drop.parentId && (sib[i + 1]?.id ?? null) === drop.beforeId;
      if (s && !same) {
        if (moveSection(ws.doc, features, drag.id, drop.parentId, drop.beforeId)) {
          if (drop.parentId) expandPath(drop.parentId);
        } else toast.warning('여기로 옮길 수 없습니다', `폴더는 자기 안으로 넣을 수 없고, ${MAX_FOLDER_DEPTH}단계까지만 넣을 수 있습니다.`);
      }
    }
    endDrag();
  };

  const api: TreeApi = {
    layout,
    collapsed,
    toggle,
    expand,
    editing,
    setEditing,
    emojiFor,
    setEmojiFor,
    drag,
    drop,
    setDrag,
    setDrop,
    applyDrop,
    endDrag,
    addPage,
    addSection,
    rename,
    remove: (s) => void remove(s),
    movePageTo,
    newFolderFor,
  };

  const endDropMark = drop?.kind === 'section' && drop.markId === '__end';

  return (
    <TreeContext.Provider value={api}>
      <div className="explorer">
        <div className="ex-head">
          <span className="ex-head-title">페이지</span>
          {ws.canEdit && (
            <>
              <Menu
                align="start"
                width={228}
                items={() => [
                  { heading: true, label: '새 페이지' },
                  ...(['docs', 'design', 'code'] as ItemModule[]).map(
                    (m): MenuItem => ({
                      label: PAGE_NOUN[m],
                      icon: <span>{FEATURE_INFO[m].emoji}</span>,
                      hint: features.includes(m) ? undefined : <span className="menu-new-area">영역 추가</span>,
                      onSelect: () => addPage(m),
                    }),
                  ),
                  { divider: true, label: '' },
                  { label: '새 폴더', icon: <FolderPlus size={15} />, onSelect: () => addSection() },
                  {
                    label: '새 비밀 노트',
                    icon: <Lock size={15} />,
                    onSelect: () => {
                      ws.go('notes');
                      setNewNoteOpen(true);
                    },
                  },
                ]}
                trigger={({ toggle: openMenu, ref, open }) => (
                  <button ref={ref} type="button" className={cx('ex-add-btn', open && 'is-open')} onClick={openMenu} aria-label="페이지 · 폴더 추가" data-tip="문서 · 디자인 · 코드 파일 · 폴더 추가">
                    <Plus size={14} /> 추가
                  </button>
                )}
              />
              <Menu
                align="start"
                width={220}
                items={() => [
                  { label: '새 폴더', icon: <FolderPlus size={15} />, onSelect: () => addSection() },
                  { label: '모든 폴더 펼치기', icon: <ChevronsUpDown size={15} />, onSelect: () => setCollapsedMany(layout.all.map((s) => s.id), false) },
                  { label: '모든 폴더 접기', icon: <ChevronsDownUp size={15} />, onSelect: () => setCollapsedMany(layout.all.map((s) => s.id), true) },
                  { divider: true, label: '' },
                  { label: '폴더 구성 초기화', icon: <RotateCcw size={15} />, disabled: !isCustomized(ws.doc), onSelect: () => void onReset() },
                ]}
                trigger={({ toggle: openMenu, ref }) => (
                  <IconButton ref={ref} label="폴더 설정" size="sm" onClick={openMenu} tipSide="right">
                    <MoreHorizontal size={15} />
                  </IconButton>
                )}
              />
            </>
          )}
        </div>
        <div
          className="explorer-scroll"
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
          }}
        >
          <div className="ex-tree">
            {layout.roots.map((s) => (
              <FolderNode key={s.id} section={s} />
            ))}
          </div>
          {layout.all.length === 0 && <p className="ex-empty">켜진 영역이 없습니다. 위의 ‘추가’로 문서 · 디자인 · 코드 파일을 만들어 보세요.</p>}
          {ws.canEdit && (
            <button
              type="button"
              className={cx('ex-add-section', endDropMark && 'is-drop-line')}
              onClick={() => addSection()}
              onDragOver={(e) => {
                if (!drag || drag.kind !== 'section' || !e.dataTransfer.types.includes(SECTION_MIME)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (!endDropMark) setDrop({ kind: 'section', parentId: null, beforeId: null, markId: '__end', pos: 'after' });
              }}
              onDrop={(e) => {
                if (!drag) return;
                e.preventDefault();
                applyDrop();
              }}
            >
              <FolderPlus size={14} /> 새 폴더
            </button>
          )}

          <NotesSection collapsed={!!collapsed.notes} onToggle={() => toggle('notes')} />

          {ws.view.module === 'docs' && ws.view.itemId && (
            <Section title="목차" collapsed={!!collapsed.outline} onToggle={() => toggle('outline')}>
              <DocOutline docId={ws.view.itemId} />
            </Section>
          )}
          {ws.view.module === 'design' && ws.view.itemId && (
            <Section title="레이어" collapsed={!!collapsed.layers} onToggle={() => toggle('layers')}>
              <DesignLayers boardId={ws.view.itemId} />
            </Section>
          )}
        </div>
      </div>
    </TreeContext.Provider>
  );
}

/** 목차 · 레이어 · 비밀 노트 같은 고정 목록 */
function Section({
  title,
  icon,
  count,
  collapsed,
  onToggle,
  onAdd,
  addLabel,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  addLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className={cx('ex-section', collapsed && 'is-collapsed')}>
      <div className="ex-section-head">
        <button className="ex-section-toggle" onClick={onToggle} aria-expanded={!collapsed}>
          <ChevronRight size={14} className="ex-chevron" />
          {icon}
          <span className="ex-section-name">{title}</span>
          {count !== undefined && <span className="ex-count">{count}</span>}
        </button>
        {onAdd && (
          <IconButton label={addLabel ?? '추가'} size="sm" onClick={onAdd} tipSide="right">
            <Plus size={15} />
          </IconButton>
        )}
      </div>
      {!collapsed && <div className="ex-section-body">{children}</div>}
    </section>
  );
}

const acceptsDrag = (e: DragEvent, drag: Drag | null) => drag !== null && (e.dataTransfer.types.includes(PAGE_MIME) || e.dataTransfer.types.includes(SECTION_MIME));

/** 폴더 하나 (하위 폴더 → 페이지 순으로, 안에 다시 폴더가 들어갈 수 있다) */
function FolderNode({ section: s }: { section: SectionView }) {
  const ws = useWorkspace();
  const t = useTree();
  const { layout, drag, drop } = t;
  const collapsed = !!t.collapsed[s.id];
  const editing = t.editing === s.id;
  const [draft, setDraft] = useState(s.name);
  useEffect(() => {
    if (editing) setDraft(s.name);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const siblings = s.parent ? (layout.byId.get(s.parent)?.children ?? []) : layout.roots;
  const index = siblings.findIndex((x) => x.id === s.id);
  const canSub = s.depth + 1 < MAX_FOLDER_DEPTH;

  const commit = () => {
    t.setEditing(null);
    t.rename(s, draft);
  };

  const dropHere = drop?.kind === 'page' && drop.sectionId === s.id && drop.pos === 'end';
  const mark = drop?.kind === 'section' && drop.markId === s.id ? drop.pos : null;
  const dragging = drag?.kind === 'section' && drag.id === s.id;

  /** 폴더 몸통 위: 페이지는 이 폴더 맨 아래로, 폴더는 이 폴더 안으로 */
  const onBodyDragOver = (e: DragEvent<HTMLElement>) => {
    if (!ws.canEdit || !acceptsDrag(e, drag)) return;
    e.stopPropagation();
    if (drag!.kind === 'page') {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (!dropHere) t.setDrop({ kind: 'page', sectionId: s.id, beforeId: null, markId: null, pos: 'end' });
      return;
    }
    if (!canNestInto(layout, drag!.id, s.id)) {
      if (drop) t.setDrop(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (mark !== 'into') t.setDrop({ kind: 'section', parentId: s.id, beforeId: null, markId: s.id, pos: 'into' });
  };

  /** 폴더 머리 위(폴더를 끄는 중): 위쪽 = 앞, 아래쪽 = 뒤, 가운데 = 안으로 */
  const onHeadDragOver = (e: DragEvent<HTMLElement>) => {
    if (!ws.canEdit || drag?.kind !== 'section' || !e.dataTransfer.types.includes(SECTION_MIME)) return;
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    let pos: 'before' | 'after' | 'into' = y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'into';
    if (pos === 'into' && !canNestInto(layout, drag.id, s.id)) pos = y < 0.5 ? 'before' : 'after';
    if (pos !== 'into' && !canNestInto(layout, drag.id, s.parent)) {
      if (drop) t.setDrop(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (mark === pos) return;
    if (pos === 'into') t.setDrop({ kind: 'section', parentId: s.id, beforeId: null, markId: s.id, pos });
    else t.setDrop({ kind: 'section', parentId: s.parent, beforeId: pos === 'before' ? s.id : (siblings[index + 1]?.id ?? null), markId: s.id, pos });
  };

  const onDrop = (e: DragEvent<HTMLElement>) => {
    if (!acceptsDrag(e, drag)) return;
    e.preventDefault();
    e.stopPropagation();
    t.applyDrop();
  };

  const addItems = (): MenuItem[] => [
    { heading: true, label: `‘${s.name}’에 추가` },
    ...pageKinds(s.builtin).map(
      (m): MenuItem => ({
        label: `새 ${PAGE_NOUN[m]}`,
        icon: <span>{FEATURE_INFO[m].emoji}</span>,
        hint: ws.template.features.includes(m) ? undefined : <span className="menu-new-area">영역 추가</span>,
        onSelect: () => t.addPage(m, s.id),
      }),
    ),
    { divider: true, label: '' },
    { label: '새 하위 폴더', icon: <FolderPlus size={14} />, disabled: !canSub, hint: canSub ? undefined : `${MAX_FOLDER_DEPTH}단계까지`, onSelect: () => t.addSection({ parentId: s.id }) },
  ];

  const folderMenu = (): MenuItem[] => [
    { label: '이름 변경', icon: <Pencil size={14} />, hint: 'F2', onSelect: () => t.setEditing(s.id) },
    { label: '아이콘 바꾸기', icon: <Smile size={14} />, onSelect: () => t.setEmojiFor(s.id) },
    { divider: true, label: '' },
    { label: '하위 폴더 만들기', icon: <FolderTree size={14} />, disabled: !canSub, hint: canSub ? undefined : `${MAX_FOLDER_DEPTH}단계까지`, onSelect: () => t.addSection({ parentId: s.id }) },
    { label: '아래에 새 폴더', icon: <FolderPlus size={14} />, onSelect: () => t.addSection({ afterId: s.id }) },
    { divider: true, label: '' },
    { label: '위로 이동', icon: <ArrowUp size={14} />, disabled: index <= 0, onSelect: () => shiftSection(ws.doc, ws.template.features, s.id, -1) },
    { label: '아래로 이동', icon: <ArrowDown size={14} />, disabled: index >= siblings.length - 1, onSelect: () => shiftSection(ws.doc, ws.template.features, s.id, 1) },
    ...(s.parent
      ? [{ label: '상위 폴더 밖으로 꺼내기', icon: <CornerLeftUp size={14} />, onSelect: () => outdentSection(ws.doc, ws.template.features, s.id) }]
      : []),
    { divider: true, label: '' },
    { label: '폴더 삭제', icon: <Trash2 size={14} />, danger: true, disabled: layout.all.length <= 1, hint: layout.all.length <= 1 ? '마지막 폴더' : undefined, onSelect: () => t.remove(s) },
  ];

  return (
    <section
      className={cx('ex-section', 'ex-page-section', s.depth > 0 && 'is-nested', collapsed && 'is-collapsed', dropHere && 'is-drop-target', dragging && 'is-dragging', (mark === 'before' || mark === 'after') && `drop-${mark}`)}
      style={{ ['--indent' as string]: `${s.depth * INDENT}px` } as CSSProperties}
      onDragOver={onBodyDragOver}
      onDrop={onDrop}
      data-section={s.id}
      data-depth={s.depth}
    >
      <div
        className={cx('ex-section-head', mark === 'into' && 'is-drop-into')}
        draggable={ws.canEdit && !editing}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData(SECTION_MIME, s.id);
          e.dataTransfer.setData('text/plain', s.name);
          e.dataTransfer.effectAllowed = 'move';
          t.setDrag({ kind: 'section', id: s.id });
        }}
        onDragEnd={t.endDrag}
        onDragOver={onHeadDragOver}
      >
        {editing ? (
          <div className="ex-section-toggle is-editing">
            <ChevronRight size={14} className="ex-chevron" />
            <span className="ex-feature-emoji">{s.emoji}</span>
            <input
              className="inline-edit-input ex-section-input"
              value={draft}
              autoFocus
              maxLength={40}
              aria-label="폴더 이름"
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') t.setEditing(null);
              }}
            />
          </div>
        ) : (
          <button
            className="ex-section-toggle"
            onClick={() => t.toggle(s.id)}
            onDoubleClick={() => ws.canEdit && t.setEditing(s.id)}
            onKeyDown={(e) => {
              if (e.key === 'F2' && ws.canEdit) {
                e.preventDefault();
                t.setEditing(s.id);
              }
            }}
            aria-expanded={!collapsed}
            title={ws.canEdit ? '더블클릭하여 이름 변경 · 끌어서 옮기기 (가운데에 놓으면 폴더 안으로)' : undefined}
          >
            <ChevronRight size={14} className="ex-chevron" />
            <span className="ex-feature-emoji">{s.emoji}</span>
            <span className="ex-section-name">{s.name}</span>
            <span className="ex-count">{s.total}</span>
          </button>
        )}
        {ws.canEdit && !editing && (
          <span className="ex-section-actions">
            <Menu
              align="start"
              width={214}
              items={addItems}
              trigger={({ toggle, ref }) => (
                <IconButton ref={ref} label={`‘${s.name}’에 추가`} size="sm" onClick={toggle} tipSide="right">
                  <Plus size={15} />
                </IconButton>
              )}
            />
            <Menu
              align="start"
              width={214}
              items={folderMenu}
              trigger={({ toggle, ref }) => (
                <IconButton ref={ref} label="폴더 메뉴" size="sm" onClick={toggle} tipSide="right">
                  <MoreHorizontal size={14} />
                </IconButton>
              )}
            />
          </span>
        )}
      </div>
      {t.emojiFor === s.id && (
        <EmojiStrip
          value={s.emoji}
          onPick={(e) => {
            setSectionEmoji(ws.doc, s.id, e);
            t.setEmojiFor(null);
          }}
          onClose={() => t.setEmojiFor(null)}
        />
      )}
      {!collapsed && (
        <div className="ex-section-body">
          {s.children.map((c) => (
            <FolderNode key={c.id} section={c} />
          ))}
          {s.pages.length === 0 && s.children.length === 0 && (
            <p className={cx('ex-empty', !s.builtin && 'ex-drop-hint')}>{s.builtin ? '아직 항목이 없습니다' : ws.canEdit ? '페이지 · 폴더를 끌어다 놓거나 + 로 추가하세요' : '비어 있는 폴더입니다'}</p>
          )}
          {s.pages.map((p, i) => (
            <ExplorerItem key={`${p.module}:${p.id}`} page={p} section={s} index={i} />
          ))}
        </div>
      )}
    </section>
  );
}

function EmojiStrip({ value, onPick, onClose }: { value: string; onPick(e: string): void; onClose(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="ex-emoji-strip" role="listbox" aria-label="폴더 아이콘">
      {SECTION_EMOJIS.map((e) => (
        <button key={e} type="button" role="option" aria-selected={e === value} className={cx('ex-emoji-choice', e === value && 'is-selected')} onClick={() => onPick(e)}>
          {e}
        </button>
      ))}
      <button type="button" className="ex-emoji-close link small" onClick={onClose}>
        닫기
      </button>
    </div>
  );
}

function ItemIcon({ item, module }: { item: YItem; module: ItemModule }) {
  if (module === 'code') {
    const lang = getLanguage(item.get('language') as string);
    return <span className="lang-dot" style={{ background: lang.color }} data-tip={lang.name} />;
  }
  if (module === 'docs') return <span className="ex-emoji">{String(item.get('emoji') ?? '📄')}</span>;
  return <span className="ex-emoji">🖼️</span>;
}

function ExplorerItem({ page, section, index }: { page: PageRef; section: SectionView; index: number }) {
  const { item, module, id } = page;
  const ws = useWorkspace();
  const t = useTree();
  const me = useSession((s) => s.user)!;
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const label = itemLabel(item, module);
  const active = ws.view.module === module && ws.view.itemId === id;
  const others = usePresence((s) => s.others);
  const viewers = Object.values(others).filter((p) => p.view.module === module && p.view.itemId === id);
  const { drag, drop } = t;
  const dragging = drag?.kind === 'page' && drag.module === module && drag.id === id;
  const dropMark = drop?.kind === 'page' && drop.sectionId === section.id && drop.markId === id ? drop.pos : null;

  const onDragOver = (e: DragEvent<HTMLElement>) => {
    // 폴더를 끄는 중이면 폴더 몸통(이 폴더 안으로)이 받는다
    if (!ws.canEdit || drag?.kind !== 'page' || !e.dataTransfer.types.includes(PAGE_MIME)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const r = e.currentTarget.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    const beforeId = before ? id : (section.pages[index + 1]?.id ?? null);
    if (dropMark !== (before ? 'before' : 'after')) t.setDrop({ kind: 'page', sectionId: section.id, beforeId, markId: id, pos: before ? 'before' : 'after' });
  };

  const targets = t.layout.all.filter((s) => s.id !== section.id);

  return (
    <div
      className={cx('ex-item', active && 'is-active', dragging && 'is-dragging', (dropMark === 'before' || dropMark === 'after') && `drop-${dropMark}`)}
      onClick={() => !editing && navigate(viewPath(ws.template.id, module, id))}
      role="link"
      tabIndex={0}
      draggable={ws.canEdit && !editing}
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.setData(PAGE_MIME, `${module}:${id}`);
        e.dataTransfer.setData('text/plain', label);
        e.dataTransfer.effectAllowed = 'move';
        t.setDrag({ kind: 'page', module, id });
      }}
      onDragEnd={t.endDrag}
      onDragOver={onDragOver}
      data-page={`${module}:${id}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !editing) navigate(viewPath(ws.template.id, module, id));
        if (e.key === 'F2' && ws.canEdit) setEditing(true);
      }}
    >
      <ItemIcon item={item} module={module} />
      <InlineEdit
        className="ex-item-name"
        value={label}
        disabled={!ws.canEdit}
        editing={editing}
        onEditingChange={setEditing}
        onCommit={(v) => renameItem(ws, module, id, v)}
      />
      {viewers.length > 0 && (
        <span className="ex-viewers" data-tip={`${viewers.map((v) => v.user.name).join(', ')} 보는 중`}>
          {viewers.slice(0, 3).map((v) => (
            <span key={v.socketId} className="ex-viewer" style={{ background: v.user.color }}>
              {v.user.avatar}
            </span>
          ))}
        </span>
      )}
      <span className="ex-item-actions" onClick={(e) => e.stopPropagation()}>
        <Menu
          align="start"
          width={230}
          items={() => [
            { label: '이름 변경', icon: <Pencil size={14} />, hint: 'F2', disabled: !ws.canEdit, onSelect: () => setEditing(true) },
            { label: '복제', icon: <Copy size={14} />, disabled: !ws.canEdit, onSelect: () => duplicateItem(ws, module, id, me) },
            ...(module === 'code'
              ? [{ label: '다운로드', icon: <Download size={14} />, onSelect: () => downloadText(label, String((item.get('content') as Y.Text).toString())) }]
              : []),
            ...(ws.canEdit
              ? [
                  { divider: true, label: '' },
                  { heading: true, label: '다른 폴더로 이동' },
                  ...targets.map(
                    (f): MenuItem => ({
                      label: (
                        <span className="menu-folder" style={{ paddingLeft: f.depth * 12 }}>
                          {f.name}
                        </span>
                      ),
                      icon: <span>{f.emoji}</span>,
                      onSelect: () => t.movePageTo({ module, id, name: label }, f),
                    }),
                  ),
                  { label: '새 폴더로 이동', icon: <FolderInput size={14} />, onSelect: () => t.newFolderFor(page, section) },
                ]
              : []),
            { divider: true, label: '' },
            { label: '삭제', icon: <Trash2 size={14} />, danger: true, disabled: !ws.canEdit, onSelect: () => void deleteItem(ws, module, id) },
          ]}
          trigger={({ toggle, ref }) => (
            <IconButton ref={ref} label="더 보기" size="sm" onClick={toggle} tipSide="right">
              <MoreHorizontal size={14} />
            </IconButton>
          )}
        />
      </span>
    </div>
  );
}

function NotesSection({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const setNewNoteOpen = useUI((s) => s.setNewNoteOpen);
  const others = usePresence((s) => s.others);
  return (
    <Section
      title="비밀 노트"
      icon={<Lock size={13} className="ex-lock" />}
      count={ws.notes.length}
      collapsed={collapsed}
      onToggle={onToggle}
      onAdd={
        ws.canEdit
          ? () => {
              ws.go('notes');
              setNewNoteOpen(true);
            }
          : undefined
      }
      addLabel="새 비밀 노트"
    >
      {ws.notes.length === 0 && <p className="ex-empty">비밀번호로 잠그는 팀 전용 노트</p>}
      {ws.notes.map((n) => {
        const active = ws.view.module === 'notes' && ws.view.itemId === n.id;
        const unlocked = !!ws.tickets[n.id];
        const viewers = Object.values(others).filter((p) => p.view.module === 'notes' && p.view.itemId === n.id);
        return (
          <div key={n.id} className={cx('ex-item', active && 'is-active')} onClick={() => navigate(viewPath(ws.template.id, 'notes', n.id))} role="link" tabIndex={0}>
            <span className={cx('ex-emoji', unlocked && 'is-unlocked')} data-tip={unlocked ? '잠금 해제됨' : '잠김'}>
              {unlocked ? '🔓' : '🔒'}
            </span>
            <span className="ex-item-name">{n.title}</span>
            {viewers.length > 0 && (
              <span className="ex-viewers" data-tip={`${viewers.map((v) => v.user.name).join(', ')} 보는 중`}>
                {viewers.slice(0, 3).map((v) => (
                  <span key={v.socketId} className="ex-viewer" style={{ background: v.user.color }}>
                    {v.user.avatar}
                  </span>
                ))}
              </span>
            )}
          </div>
        );
      })}
    </Section>
  );
}
