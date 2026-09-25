import { type DragEvent, type ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Copy,
  Download,
  FolderInput,
  FolderPlus,
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
  SECTION_EMOJIS,
  createSection,
  deleteSection,
  isCustomized,
  movePage,
  moveSection,
  nextSectionName,
  renameSection,
  resetLayout,
  setSectionEmoji,
  shiftSection,
  useLayout,
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

function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

const PAGE_NOUN: Record<ItemModule, string> = { docs: '문서', design: '디자인 보드', code: '코드 파일' };
/** 목록의 + 메뉴 순서: 기본 목록이면 그 종류를 맨 위에 */
const pageKinds = (first: ItemModule | null): ItemModule[] => (first ? [first, ...(['docs', 'design', 'code'] as ItemModule[]).filter((m) => m !== first)] : ['docs', 'design', 'code']);

type Drag = { kind: 'page'; module: ItemModule; id: string } | { kind: 'section'; id: string };
type Drop =
  | { kind: 'page'; sectionId: string; beforeId: string | null; markId: string | null; pos: 'before' | 'after' | 'end' }
  | { kind: 'section'; beforeId: string | null; markId: string; pos: 'before' | 'after' };

/**
 * 왼쪽 컨텍스트 패널 = 탐색기.
 *  - 페이지(문서 · 디자인 보드 · 코드 파일)를 목록별로 보여 준다. 처음에는 기능별 기본 목록이고,
 *    목록 이름 · 아이콘 · 순서를 바꾸거나 새 목록을 만들고, 페이지를 끌어서 원하는 목록 · 순서로 옮길 수 있다.
 *  - 템플릿 안에서 바로 문서 · 디자인 · 코딩 페이지를 추가할 수 있다 (꺼져 있던 영역은 자동으로 켜진다).
 *  - 누가 어느 페이지를 보고 있는지 점으로 표시하고, 현재 페이지에 따라 문서 목차 / 디자인 레이어가 아래에 붙는다.
 */
export function Explorer() {
  const ws = useWorkspace();
  const me = useSession((s) => s.user)!;
  const setNewNoteOpen = useUI((s) => s.setNewNoteOpen);
  const features = ws.template.features;
  const sections = useLayout(ws.doc, features);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [emojiFor, setEmojiFor] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);

  const setCollapsedKey = (key: string, value: boolean) =>
    setCollapsed((prev) => {
      const next = { ...prev, [key]: value };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        /* 무시 */
      }
      return next;
    });
  const toggle = (key: string) => setCollapsedKey(key, !collapsed[key]);

  // 현재 보고 있는 페이지가 든 목록 (새 페이지를 넣을 곳을 고를 때)
  const current = sections.find((s) => s.pages.some((p) => p.module === ws.view.module && p.id === ws.view.itemId));

  /** 위쪽 + 추가: 그 종류의 기본 목록이 있으면 거기, 없으면 지금 보는 목록 (또는 첫 목록) */
  const addPage = (module: ItemModule, sectionId?: string) => {
    let target = sectionId;
    if (!target && features.includes(module) && !sections.some((s) => s.id === module)) target = current?.id ?? sections[0]?.id;
    if (target) setCollapsedKey(target, false);
    void createPage(ws, module, me, { sectionId: target });
  };

  const addSection = (afterId?: string) => {
    const id = createSection(ws.doc, features, nextSectionName(ws.doc, features), me.id, { afterId });
    setEditingSection(id);
    ws.report({ type: 'section.create', targetId: id, targetName: '새 목록' });
  };

  const onRenameSection = (s: SectionView, name: string) => {
    if (!name.trim() || name.trim() === s.name) return;
    renameSection(ws.doc, s.id, name);
    ws.report({ type: 'section.rename', targetId: s.id, targetName: name.trim(), detail: `${s.name} → ${name.trim()}` });
  };

  const onDeleteSection = async (s: SectionView) => {
    if (sections.length <= 1) {
      toast.warning('목록은 하나 이상 있어야 합니다', '페이지를 넣을 목록이 하나는 필요합니다.');
      return;
    }
    const n = s.pages.length;
    const ok = await confirmDialog({
      title: `‘${s.name}’ 목록을 삭제할까요?`,
      message:
        n > 0
          ? `안에 있는 페이지 ${n}개는 지워지지 않고 다른 목록으로 옮겨집니다 (각 종류의 기본 목록, 없으면 맨 위 목록).`
          : '빈 목록입니다. 페이지는 영향을 받지 않습니다.',
      confirmText: '목록 삭제',
      danger: true,
    });
    if (!ok) return;
    const moved = deleteSection(ws.doc, features, s.id);
    if (!moved) return;
    ws.report({ type: 'section.delete', targetId: s.id, targetName: s.name, detail: n ? `페이지 ${n}개를 다른 목록으로 옮김` : '' });
    toast.show({ kind: 'info', title: '목록을 삭제했습니다', message: n ? `${s.name} · 페이지 ${n}개를 다른 목록으로 옮겼습니다.` : s.name });
  };

  const onReset = async () => {
    const ok = await confirmDialog({
      title: '목록 구성을 처음 상태로 되돌릴까요?',
      message: '직접 만든 목록과 이름 · 순서가 지워지고, 페이지가 종류별 기본 목록(디자인 · 코딩 · 문서)으로 돌아갑니다. 페이지 내용은 그대로입니다.',
      confirmText: '되돌리기',
    });
    if (!ok) return;
    resetLayout(ws.doc);
    toast.success('목록 구성을 처음 상태로 되돌렸습니다');
  };

  const movePageTo = (p: { module: ItemModule; id: string; name: string }, section: SectionView, beforeId: string | null) => {
    movePage(ws.doc, features, p.module, p.id, section.id, beforeId);
    setCollapsedKey(section.id, false);
    ws.report({ type: 'page.move', targetId: p.id, targetName: p.name, detail: `→ ${section.name}` });
  };

  /* ───────────── 끌어서 옮기기 ───────────── */

  const endDrag = () => {
    setDrag(null);
    setDrop(null);
  };

  const pageName = (module: ItemModule, id: string) => {
    for (const s of sections) for (const p of s.pages) if (p.module === module && p.id === id) return itemLabel(p.item, p.module);
    return '';
  };

  const applyDrop = () => {
    if (!drag || !drop) return endDrag();
    if (drag.kind === 'page' && drop.kind === 'page') {
      const section = sections.find((s) => s.id === drop.sectionId);
      const from = sections.find((s) => s.pages.some((p) => p.module === drag.module && p.id === drag.id));
      if (section && drop.beforeId !== drag.id) {
        // 같은 자리에 놓았으면 아무것도 하지 않는다
        const i = section.pages.findIndex((p) => p.module === drag.module && p.id === drag.id);
        const same = i >= 0 && (section.pages[i + 1]?.id ?? null) === drop.beforeId;
        if (!same) {
          const name = pageName(drag.module, drag.id);
          movePage(ws.doc, features, drag.module, drag.id, section.id, drop.beforeId);
          setCollapsedKey(section.id, false);
          if (from?.id !== section.id) ws.report({ type: 'page.move', targetId: drag.id, targetName: name, detail: `→ ${section.name}` });
        }
      }
    }
    if (drag.kind === 'section' && drop.kind === 'section' && drop.beforeId !== drag.id) {
      const i = sections.findIndex((s) => s.id === drag.id);
      const same = (sections[i + 1]?.id ?? null) === drop.beforeId;
      if (!same) moveSection(ws.doc, features, drag.id, drop.beforeId);
    }
    endDrag();
  };

  const acceptsDrag = (e: DragEvent) => ws.canEdit && drag !== null && (e.dataTransfer.types.includes(PAGE_MIME) || e.dataTransfer.types.includes(SECTION_MIME));

  const onSectionDragOver = (e: DragEvent<HTMLElement>, s: SectionView, index: number) => {
    if (!acceptsDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (drag!.kind === 'page') {
      if (drop?.kind !== 'page' || drop.sectionId !== s.id || drop.pos !== 'end') setDrop({ kind: 'page', sectionId: s.id, beforeId: null, markId: null, pos: 'end' });
    } else {
      const r = e.currentTarget.getBoundingClientRect();
      const before = e.clientY < r.top + Math.min(r.height / 2, 40);
      const beforeId = before ? s.id : (sections[index + 1]?.id ?? null);
      if (drop?.kind !== 'section' || drop.markId !== s.id || drop.pos !== (before ? 'before' : 'after'))
        setDrop({ kind: 'section', beforeId, markId: s.id, pos: before ? 'before' : 'after' });
    }
  };

  const onPageDragOver = (e: DragEvent<HTMLElement>, s: SectionView, p: PageRef, index: number) => {
    if (!acceptsDrag(e) || drag!.kind !== 'page') return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const r = e.currentTarget.getBoundingClientRect();
    const before = e.clientY < r.top + r.height / 2;
    const beforeId = before ? p.id : (s.pages[index + 1]?.id ?? null);
    if (drop?.kind !== 'page' || drop.markId !== p.id || drop.pos !== (before ? 'before' : 'after'))
      setDrop({ kind: 'page', sectionId: s.id, beforeId, markId: p.id, pos: before ? 'before' : 'after' });
  };

  return (
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
                { label: '새 목록', icon: <FolderPlus size={15} />, onSelect: () => addSection() },
                {
                  label: '새 비밀 노트',
                  icon: <Lock size={15} />,
                  onSelect: () => {
                    ws.go('notes');
                    setNewNoteOpen(true);
                  },
                },
              ]}
              trigger={({ toggle, ref, open }) => (
                <button ref={ref} type="button" className={cx('ex-add-btn', open && 'is-open')} onClick={toggle} aria-label="페이지 · 목록 추가" data-tip="문서 · 디자인 · 코드 파일 · 목록 추가">
                  <Plus size={14} /> 추가
                </button>
              )}
            />
            <Menu
              align="start"
              width={220}
              items={() => [
                { label: '새 목록', icon: <FolderPlus size={15} />, onSelect: () => addSection() },
                { label: '모든 목록 펼치기', icon: <ChevronRight size={15} />, onSelect: () => sections.forEach((s) => setCollapsedKey(s.id, false)) },
                { divider: true, label: '' },
                { label: '목록 구성 초기화', icon: <RotateCcw size={15} />, disabled: !isCustomized(ws.doc), onSelect: () => void onReset() },
              ]}
              trigger={({ toggle, ref }) => (
                <IconButton ref={ref} label="목록 설정" size="sm" onClick={toggle} tipSide="right">
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
        {sections.map((s, index) => (
          <PageSection
            key={s.id}
            section={s}
            index={index}
            total={sections.length}
            collapsed={!!collapsed[s.id]}
            onToggle={() => toggle(s.id)}
            editing={editingSection === s.id}
            onEditingChange={(v) => setEditingSection(v ? s.id : null)}
            onRename={(name) => onRenameSection(s, name)}
            emojiOpen={emojiFor === s.id}
            onEmojiOpen={(v) => setEmojiFor(v ? s.id : null)}
            onEmoji={(e) => {
              setSectionEmoji(ws.doc, s.id, e);
              setEmojiFor(null);
            }}
            onAddPage={(m) => addPage(m, s.id)}
            onAddSectionBelow={() => addSection(s.id)}
            onShift={(dir) => shiftSection(ws.doc, features, s.id, dir)}
            onDelete={() => void onDeleteSection(s)}
            sections={sections}
            onMovePage={(p, target) => movePageTo(p, target, null)}
            onNewSectionFor={(p) => {
              const id = createSection(ws.doc, features, nextSectionName(ws.doc, features), me.id, { afterId: s.id });
              movePage(ws.doc, features, p.module, p.id, id, null);
              setEditingSection(id);
              ws.report({ type: 'section.create', targetId: id, targetName: '새 목록' });
            }}
            drag={drag}
            drop={drop}
            onDragStartSection={(e) => {
              e.dataTransfer.setData(SECTION_MIME, s.id);
              e.dataTransfer.setData('text/plain', s.name);
              e.dataTransfer.effectAllowed = 'move';
              setDrag({ kind: 'section', id: s.id });
            }}
            onDragStartPage={(e, p) => {
              e.dataTransfer.setData(PAGE_MIME, `${p.module}:${p.id}`);
              e.dataTransfer.setData('text/plain', itemLabel(p.item, p.module));
              e.dataTransfer.effectAllowed = 'move';
              setDrag({ kind: 'page', module: p.module, id: p.id });
            }}
            onDragEnd={endDrag}
            onSectionDragOver={(e) => onSectionDragOver(e, s, index)}
            onPageDragOver={(e, p, i) => onPageDragOver(e, s, p, i)}
            onDrop={(e) => {
              if (!acceptsDrag(e)) return;
              e.preventDefault();
              e.stopPropagation();
              applyDrop();
            }}
          />
        ))}
        {sections.length === 0 && <p className="ex-empty">켜진 영역이 없습니다. 위의 ‘추가’로 문서 · 디자인 · 코드 파일을 만들어 보세요.</p>}
        {ws.canEdit && (
          <button
            type="button"
            className={cx('ex-add-section', drop?.kind === 'section' && drop.beforeId === null && drop.pos === 'after' && 'is-drop-line')}
            onClick={() => addSection()}
          >
            <FolderPlus size={14} /> 새 목록
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

interface PageSectionProps {
  section: SectionView;
  index: number;
  total: number;
  collapsed: boolean;
  onToggle(): void;
  editing: boolean;
  onEditingChange(v: boolean): void;
  onRename(name: string): void;
  emojiOpen: boolean;
  onEmojiOpen(v: boolean): void;
  onEmoji(e: string): void;
  onAddPage(m: ItemModule): void;
  onAddSectionBelow(): void;
  onShift(dir: -1 | 1): void;
  onDelete(): void;
  sections: SectionView[];
  onMovePage(p: { module: ItemModule; id: string; name: string }, target: SectionView): void;
  onNewSectionFor(p: PageRef): void;
  drag: Drag | null;
  drop: Drop | null;
  onDragStartSection(e: DragEvent<HTMLElement>): void;
  onDragStartPage(e: DragEvent<HTMLElement>, p: PageRef): void;
  onDragEnd(): void;
  onSectionDragOver(e: DragEvent<HTMLElement>): void;
  onPageDragOver(e: DragEvent<HTMLElement>, p: PageRef, index: number): void;
  onDrop(e: DragEvent<HTMLElement>): void;
}

/** 사용자가 이름 · 아이콘 · 순서를 바꿀 수 있는 페이지 목록 */
function PageSection(props: PageSectionProps) {
  const { section: s, collapsed, editing, drag, drop } = props;
  const ws = useWorkspace();
  const [draft, setDraft] = useState(s.name);
  useEffect(() => {
    if (editing) setDraft(s.name);
  }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = () => {
    props.onEditingChange(false);
    props.onRename(draft);
  };

  const dropHere = drop?.kind === 'page' && drop.sectionId === s.id && drop.pos === 'end';
  const sectionMark = drop?.kind === 'section' && drop.markId === s.id ? drop.pos : null;
  const dragging = drag?.kind === 'section' && drag.id === s.id;

  const addItems = (): MenuItem[] => [
    { heading: true, label: `‘${s.name}’에 추가` },
    ...pageKinds(s.builtin).map(
      (m): MenuItem => ({
        label: `새 ${PAGE_NOUN[m]}`,
        icon: <span>{FEATURE_INFO[m].emoji}</span>,
        hint: ws.template.features.includes(m) ? undefined : <span className="menu-new-area">영역 추가</span>,
        onSelect: () => props.onAddPage(m),
      }),
    ),
  ];

  return (
    <section
      className={cx('ex-section', 'ex-page-section', collapsed && 'is-collapsed', dropHere && 'is-drop-target', dragging && 'is-dragging', sectionMark && `drop-${sectionMark}`)}
      onDragOver={props.onSectionDragOver}
      onDrop={props.onDrop}
      data-section={s.id}
    >
      <div
        className="ex-section-head"
        draggable={ws.canEdit && !editing}
        onDragStart={props.onDragStartSection}
        onDragEnd={props.onDragEnd}
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
              aria-label="목록 이름"
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') props.onEditingChange(false);
              }}
            />
          </div>
        ) : (
          <button
            className="ex-section-toggle"
            onClick={props.onToggle}
            onDoubleClick={() => ws.canEdit && props.onEditingChange(true)}
            onKeyDown={(e) => {
              if (e.key === 'F2' && ws.canEdit) {
                e.preventDefault();
                props.onEditingChange(true);
              }
            }}
            aria-expanded={!collapsed}
            title={ws.canEdit ? '더블클릭하여 이름 변경 · 끌어서 순서 변경' : undefined}
          >
            <ChevronRight size={14} className="ex-chevron" />
            <span className="ex-feature-emoji">{s.emoji}</span>
            <span className="ex-section-name">{s.name}</span>
            <span className="ex-count">{s.pages.length}</span>
          </button>
        )}
        {ws.canEdit && !editing && (
          <span className="ex-section-actions">
            <Menu
              align="start"
              width={210}
              items={addItems}
              trigger={({ toggle, ref }) => (
                <IconButton ref={ref} label={`‘${s.name}’에 페이지 추가`} size="sm" onClick={toggle} tipSide="right">
                  <Plus size={15} />
                </IconButton>
              )}
            />
            <Menu
              align="start"
              width={210}
              items={() => [
                { label: '이름 변경', icon: <Pencil size={14} />, hint: 'F2', onSelect: () => props.onEditingChange(true) },
                { label: '아이콘 바꾸기', icon: <Smile size={14} />, onSelect: () => props.onEmojiOpen(true) },
                { divider: true, label: '' },
                { label: '위로 이동', icon: <ArrowUp size={14} />, disabled: props.index === 0, onSelect: () => props.onShift(-1) },
                { label: '아래로 이동', icon: <ArrowDown size={14} />, disabled: props.index === props.total - 1, onSelect: () => props.onShift(1) },
                { label: '아래에 새 목록', icon: <FolderPlus size={14} />, onSelect: props.onAddSectionBelow },
                { divider: true, label: '' },
                { label: '목록 삭제', icon: <Trash2 size={14} />, danger: true, disabled: props.total <= 1, hint: props.total <= 1 ? '마지막 목록' : undefined, onSelect: props.onDelete },
              ]}
              trigger={({ toggle, ref }) => (
                <IconButton ref={ref} label="목록 메뉴" size="sm" onClick={toggle} tipSide="right">
                  <MoreHorizontal size={14} />
                </IconButton>
              )}
            />
          </span>
        )}
      </div>
      {props.emojiOpen && (
        <EmojiStrip
          value={s.emoji}
          onPick={props.onEmoji}
          onClose={() => props.onEmojiOpen(false)}
        />
      )}
      {!collapsed && (
        <div className="ex-section-body">
          {s.pages.length === 0 && (
            <p className={cx('ex-empty', !s.builtin && 'ex-drop-hint')}>{s.builtin ? '아직 항목이 없습니다' : ws.canEdit ? '페이지를 끌어다 놓거나 + 로 추가하세요' : '비어 있는 목록입니다'}</p>
          )}
          {s.pages.map((p, i) => (
            <ExplorerItem
              key={`${p.module}:${p.id}`}
              page={p}
              section={s}
              sections={props.sections}
              onMove={props.onMovePage}
              onNewSection={() => props.onNewSectionFor(p)}
              dragging={drag?.kind === 'page' && drag.module === p.module && drag.id === p.id}
              dropMark={drop?.kind === 'page' && drop.sectionId === s.id && drop.markId === p.id ? (drop.pos as 'before' | 'after') : null}
              onDragStart={(e) => props.onDragStartPage(e, p)}
              onDragEnd={props.onDragEnd}
              onDragOver={(e) => props.onPageDragOver(e, p, i)}
              onDrop={props.onDrop}
            />
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
    <div className="ex-emoji-strip" role="listbox" aria-label="목록 아이콘">
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

function ExplorerItem({
  page,
  section,
  sections,
  onMove,
  onNewSection,
  dragging,
  dropMark,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  page: PageRef;
  section: SectionView;
  sections: SectionView[];
  onMove(p: { module: ItemModule; id: string; name: string }, target: SectionView): void;
  onNewSection(): void;
  dragging: boolean;
  dropMark: 'before' | 'after' | null;
  onDragStart(e: DragEvent<HTMLElement>): void;
  onDragEnd(): void;
  onDragOver(e: DragEvent<HTMLElement>): void;
  onDrop(e: DragEvent<HTMLElement>): void;
}) {
  const { item, module, id } = page;
  const ws = useWorkspace();
  const me = useSession((s) => s.user)!;
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const label = itemLabel(item, module);
  const active = ws.view.module === module && ws.view.itemId === id;
  const others = usePresence((s) => s.others);
  const viewers = Object.values(others).filter((p) => p.view.module === module && p.view.itemId === id);
  const targets = sections.filter((s) => s.id !== section.id);

  return (
    <div
      className={cx('ex-item', active && 'is-active', dragging && 'is-dragging', dropMark && `drop-${dropMark}`)}
      onClick={() => !editing && navigate(viewPath(ws.template.id, module, id))}
      role="link"
      tabIndex={0}
      draggable={ws.canEdit && !editing}
      onDragStart={(e) => {
        e.stopPropagation();
        onDragStart(e);
      }}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
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
          width={220}
          items={() => [
            { label: '이름 변경', icon: <Pencil size={14} />, hint: 'F2', disabled: !ws.canEdit, onSelect: () => setEditing(true) },
            { label: '복제', icon: <Copy size={14} />, disabled: !ws.canEdit, onSelect: () => duplicateItem(ws, module, id, me) },
            ...(module === 'code'
              ? [{ label: '다운로드', icon: <Download size={14} />, onSelect: () => downloadText(label, String((item.get('content') as Y.Text).toString())) }]
              : []),
            ...(ws.canEdit
              ? [
                  { divider: true, label: '' },
                  { heading: true, label: '다른 목록으로 이동' },
                  ...targets.map((t): MenuItem => ({ label: t.name, icon: <span>{t.emoji}</span>, onSelect: () => onMove({ module, id, name: label }, t) })),
                  { label: '새 목록으로 이동', icon: <FolderInput size={14} />, onSelect: onNewSection },
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

