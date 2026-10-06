/*
 * 열린 파일 탭 — 브라우저 · IDE 탭처럼 위에서 파일을 바로 오간다
 *  - 왼쪽 목록에서 파일을 열면 지금 탭 오른쪽에 새 탭이 생긴다
 *  - × · 가운데 클릭으로 닫기, 끌어서 순서 바꾸기, 지금 탭 이름은 더블클릭으로 바꾸기
 *  - 열린 탭과 순서는 템플릿마다 이 기기에만 기억한다 (다른 사람 화면에는 영향 없음)
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { getFiles, getLanguage } from '@shared/schema';
import { useWorkspace, viewPath } from '../../workspace/context';
import { createCodeFile, renameItem } from '../../workspace/actions';
import { useYItems } from '../../hooks/useY';
import { useSession } from '../../store/session';
import { cx } from '../../lib/util';
import { InlineEdit } from '../../components/ui';

// ── 템플릿별 열린 탭 (이 기기) ──
const storeKey = (templateId: string) => `lt.code.tabs.${templateId}`;
const tabsCache = new Map<string, string[]>();
const listeners = new Set<() => void>();
const EMPTY: string[] = [];

function readTabs(templateId: string): string[] {
  let v = tabsCache.get(templateId);
  if (!v) {
    try {
      const raw = JSON.parse(localStorage.getItem(storeKey(templateId)) ?? '[]');
      v = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : EMPTY;
    } catch {
      v = EMPTY;
    }
    tabsCache.set(templateId, v);
  }
  return v;
}
function writeTabs(templateId: string, ids: string[]) {
  tabsCache.set(templateId, ids);
  try {
    localStorage.setItem(storeKey(templateId), JSON.stringify(ids));
  } catch {
    /* 저장 못 해도 이번 화면에서는 쓴다 */
  }
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

/** 지금 탭 다음에 새 탭을 넣을 자리 (마지막으로 보던 탭 기억) */
const lastActive = new Map<string, string>();

export function FileTabs({ activeId }: { activeId: string }) {
  const ws = useWorkspace();
  const me = useSession((s) => s.user)!;
  const navigate = useNavigate();
  const templateId = ws.template.id;
  const files = useYItems(getFiles(ws.doc));
  const stored = useSyncExternalStore(subscribe, () => readTabs(templateId));
  const stripRef = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  const byId = new Map(files.map((f) => [String(f.get('id')), f]));
  // 지워진 파일의 탭은 뺀다 (불러오는 중에는 그대로 둔다)
  const tabs = ws.synced ? stored.filter((id) => byId.has(id)) : stored;

  // 지금 연 파일이 탭에 없으면 마지막으로 보던 탭 오른쪽에 넣는다
  useEffect(() => {
    const cur = readTabs(templateId);
    const alive = ws.synced ? cur.filter((id) => byId.has(id)) : cur;
    let next = alive;
    if (!alive.includes(activeId)) {
      const prev = lastActive.get(templateId);
      const at = prev ? alive.indexOf(prev) : -1;
      next = at >= 0 ? [...alive.slice(0, at + 1), activeId, ...alive.slice(at + 1)] : [...alive, activeId];
    }
    if (next.length !== cur.length || next.some((id, i) => id !== cur[i])) writeTabs(templateId, next);
    lastActive.set(templateId, activeId);
  }, [activeId, templateId, ws.synced, files.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // 지금 탭이 보이게
  useLayoutEffect(() => {
    stripRef.current?.querySelector<HTMLElement>('.file-tab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId, tabs.length]);

  const open = (id: string) => id !== activeId && navigate(viewPath(templateId, 'code', id));
  const close = (id: string) => {
    const i = tabs.indexOf(id);
    const rest = tabs.filter((t) => t !== id);
    if (!rest.length) return;
    writeTabs(templateId, rest);
    if (id === activeId) {
      const to = rest[Math.min(i, rest.length - 1)];
      lastActive.set(templateId, to);
      navigate(viewPath(templateId, 'code', to));
    }
  };
  const moveTo = (id: string, target: string) => {
    if (id === target) return;
    const rest = tabs.filter((t) => t !== id);
    const at = rest.indexOf(target);
    // 오른쪽으로 끌면 대상 뒤, 왼쪽으로 끌면 대상 앞
    const after = tabs.indexOf(id) < tabs.indexOf(target);
    rest.splice(after ? at + 1 : at, 0, id);
    writeTabs(templateId, rest);
  };

  return (
    <div className="file-tabs" ref={stripRef} role="tablist" aria-label="열린 파일">
      {(tabs.includes(activeId) ? tabs : [...tabs, activeId]).map((id) => {
        const f = byId.get(id);
        if (!f) return null;
        const name = String(f.get('name') ?? '');
        const lang = getLanguage(String(f.get('language') ?? 'plaintext'));
        const active = id === activeId;
        return (
          <div
            key={id}
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            className={cx('file-tab', active && 'is-active', dragId === id && 'is-dragging')}
            title={active && ws.canEdit ? `${name} · 더블클릭하여 이름 변경` : name}
            draggable={!renaming}
            onClick={() => open(id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') open(id);
            }}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                close(id);
              }
            }}
            onMouseDown={(e) => e.button === 1 && e.preventDefault()}
            onDragStart={(e) => {
              setDragId(id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', name);
            }}
            onDragOver={(e) => {
              if (!dragId) return;
              e.preventDefault();
              moveTo(dragId, id);
            }}
            onDragEnd={() => setDragId(null)}
          >
            <span className="lang-dot" style={{ background: lang.color }} />
            {active ? (
              <InlineEdit
                className="file-tab-name"
                value={name}
                disabled={!ws.canEdit}
                editing={renaming}
                onEditingChange={setRenaming}
                onCommit={(v) => renameItem(ws, 'code', id, v)}
              />
            ) : (
              <span className="file-tab-name">{name}</span>
            )}
            {tabs.length > 1 && (
              <button
                type="button"
                className="file-tab-close"
                aria-label={`${name} 탭 닫기`}
                data-tip="탭 닫기 (가운데 클릭)"
                onClick={(e) => {
                  e.stopPropagation();
                  close(id);
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        );
      })}
      {ws.canEdit && (
        <button type="button" className="file-tab-new" aria-label="새 파일" data-tip="새 파일" onClick={() => void createCodeFile(ws, me)}>
          <Plus size={14} />
        </button>
      )}
    </div>
  );
}
