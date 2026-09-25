import { type ReactNode, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  Copy,
  Download,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type * as Y from 'yjs';
import type { Feature } from '@shared/types';
import { FEATURE_INFO } from '@shared/presets';
import { getLanguage, type YItem } from '@shared/schema';
import { useWorkspace, viewPath } from './context';
import { createBoard, createCodeFile, createDocument, deleteItem, duplicateItem, itemLabel, itemsMap, renameItem, type ItemModule } from './actions';
import { useYItems } from '../hooks/useY';
import { usePresence } from '../store/presence';
import { useSession } from '../store/session';
import { useUI } from '../store/ui';
import { IconButton, InlineEdit, Menu } from '../components/ui';
import { cx, downloadText } from '../lib/util';
import { DocOutline } from '../modules/docs/DocOutline';
import { DesignLayers } from '../modules/design/DesignLayers';

const COLLAPSE_KEY = 'lt.explorer.collapsed';

function readCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/**
 * 왼쪽 컨텍스트 패널 = 탐색기.
 * 켜진 모든 기능의 항목을 한 트리에 보여주고, 누가 어느 항목을 보고 있는지 점으로 표시한다.
 * 현재 항목에 따라 문서 목차 / 디자인 레이어가 아래에 붙는다.
 */
export function Explorer() {
  const ws = useWorkspace();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed);
  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        /* 무시 */
      }
      return next;
    });

  return (
    <div className="explorer">
      <div className="explorer-scroll">
        {ws.template.features.map((f) => (
          <FeatureSection key={f} feature={f} collapsed={!!collapsed[f]} onToggle={() => toggle(f)} />
        ))}
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
          <span>{title}</span>
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

function FeatureSection({ feature, collapsed, onToggle }: { feature: Feature; collapsed: boolean; onToggle: () => void }) {
  const ws = useWorkspace();
  const me = useSession((s) => s.user)!;
  const module = feature as ItemModule;
  const items = useYItems(itemsMap(ws.doc, module));
  const add = () => (module === 'code' ? void createCodeFile(ws, me) : module === 'docs' ? createDocument(ws, me) : createBoard(ws, me));
  const info = FEATURE_INFO[feature];
  return (
    <Section
      title={info.name}
      icon={<span className="ex-feature-emoji">{info.emoji}</span>}
      count={items.length}
      collapsed={collapsed}
      onToggle={onToggle}
      onAdd={ws.canEdit ? add : undefined}
      addLabel={`새 ${module === 'code' ? '파일' : module === 'docs' ? '문서' : '보드'}`}
    >
      {items.length === 0 && <p className="ex-empty">아직 항목이 없습니다</p>}
      {items.map((item) => (
        <ExplorerItem key={item.get('id') as string} item={item} module={module} />
      ))}
    </Section>
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

function ExplorerItem({ item, module }: { item: YItem; module: ItemModule }) {
  const ws = useWorkspace();
  const me = useSession((s) => s.user)!;
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const id = item.get('id') as string;
  const label = itemLabel(item, module);
  const active = ws.view.module === module && ws.view.itemId === id;
  const others = usePresence((s) => s.others);
  const viewers = Object.values(others).filter((p) => p.view.module === module && p.view.itemId === id);

  return (
    <div
      className={cx('ex-item', active && 'is-active')}
      onClick={() => !editing && navigate(viewPath(ws.template.id, module, id))}
      role="link"
      tabIndex={0}
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
          width={200}
          items={[
            { label: '이름 변경', icon: <Pencil size={14} />, hint: 'F2', disabled: !ws.canEdit, onSelect: () => setEditing(true) },
            { label: '복제', icon: <Copy size={14} />, disabled: !ws.canEdit, onSelect: () => duplicateItem(ws, module, id, me) },
            ...(module === 'code'
              ? [{ label: '다운로드', icon: <Download size={14} />, onSelect: () => downloadText(label, String((item.get('content') as Y.Text).toString())) }]
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
