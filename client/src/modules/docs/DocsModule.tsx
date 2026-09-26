import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type * as Y from 'yjs';
import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import { Copy, Download, FilePlus2, FileText, Infinity as InfinityIcon, MoreHorizontal, Printer, Ruler, Trash2 } from 'lucide-react';
import { getDocs, readPageSetup, type YItem } from '@shared/schema';
import { useWorkspace, viewPath } from '../../workspace/context';
import { createDocument, deleteItem, duplicateItem } from '../../workspace/actions';
import { useYField, useYItems } from '../../hooks/useY';
import { useSession } from '../../store/session';
import { toast } from '../../store/toasts';
import { copyText, cx, downloadText } from '../../lib/util';
import { toHtmlDocument, toMarkdown } from '../../lib/markdown';
import { Avatar, Button, EmptyState, IconButton, Menu, Spinner } from '../../components/ui';
import { useViewers } from '../../components/Cursors';
import { DocEditor } from './DocEditor';
import { useDocEnv } from './blocks/useDocEnv';
import { pageSetupDialog } from './page/PageSetupDialog';
import { describePage } from './page/pageSizes';
import type { Zoom } from './page/usePagedLayout';

const DOC_EMOJIS = ['📄', '📝', '📘', '🧭', '🗓️', '📊', '💡', '✅', '🚀', '📌', '🔍', '🎯'];

export function DocsModule() {
  const ws = useWorkspace();
  const me = useSession((s) => s.user)!;
  const navigate = useNavigate();
  const docs = useYItems(getDocs(ws.doc));
  const itemId = ws.view.itemId;
  const item = itemId ? docs.find((d) => d.get('id') === itemId) : undefined;

  useEffect(() => {
    if (!item && docs.length > 0 && ws.synced) navigate(viewPath(ws.template.id, 'docs', docs[0].get('id') as string), { replace: true });
  }, [item, docs.length, ws.synced]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) {
    if (!ws.synced && docs.length === 0)
      return (
        <div className="center-fill">
          <Spinner size={24} />
        </div>
      );
    return (
      <EmptyState
        icon={<FileText size={34} />}
        title={docs.length ? '문서를 여는 중…' : '아직 문서가 없습니다'}
        action={
          ws.canEdit && !docs.length ? (
            <Button variant="primary" icon={<FilePlus2 size={15} />} onClick={() => createDocument(ws, me)}>
              새 문서 만들기
            </Button>
          ) : undefined
        }
      >
        여러 사람이 동시에 같은 문서를 편집할 수 있습니다.
      </EmptyState>
    );
  }
  return <DocView key={item.get('id') as string} item={item} />;
}

function DocView({ item }: { item: YItem }) {
  const ws = useWorkspace();
  const me = useSession((s) => s.user)!;
  const id = item.get('id') as string;
  const title = useYField<string>(item, 'title') ?? '';
  const emoji = useYField<string>(item, 'emoji') ?? '📄';
  const fragment = item.get('content') as Y.XmlFragment;
  const viewers = useViewers(ws.view);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const env = useDocEnv({ uploads: true });
  const page = readPageSetup(useYField<unknown>(item, 'page'));
  const [pages, setPages] = useState(0);
  const [zoom, setZoom] = useState<Zoom>(() => {
    try {
      const v = localStorage.getItem('lt.doc.zoom');
      return v && v !== 'fit' && Number(v) > 0 ? Number(v) : 'fit';
    } catch {
      return 'fit';
    }
  });
  const changeZoom = (z: Zoom) => {
    setZoom(z);
    try {
      localStorage.setItem('lt.doc.zoom', String(z));
    } catch {
      /* 무시 */
    }
  };

  /** 페이지 크기 바꾸기 (모든 사람에게 적용) */
  const editPage = async () => {
    if (!ws.canEdit) return;
    const r = await pageSetupDialog({ mode: 'edit', initial: page });
    if (!r) return;
    if (r.page) item.set('page', r.page);
    else item.delete('page');
    ws.action(`페이지 설정 · ${describePage(r.page)}`);
    toast.success('페이지 설정을 바꿨습니다', describePage(r.page));
  };

  const commitTitle = () => {
    if (titleDraft === null) return;
    const next = titleDraft.trim() || '제목 없는 문서';
    setTitleDraft(null);
    if (next !== title) {
      item.set('title', next);
      ws.report({ type: 'docs.rename', targetId: id, targetName: next, detail: `${title} → ${next}` });
      ws.action(`제목 변경 · ${next}`);
    }
  };

  const exportMd = () => editor && downloadText(`${title || 'document'}.md`, toMarkdown(editor.getJSON(), title), 'text/markdown;charset=utf-8');
  const exportHtml = async () => editor && downloadText(`${title || 'document'}.html`, await toHtmlDocument(title, editor.getHTML(), page), 'text/html;charset=utf-8');

  return (
    <div className="docs-module">
      <div className="module-toolbar">
        <span className="toolbar-emoji">{emoji}</span>
        <span className="toolbar-title-text">{title}</span>
        {viewers.length > 0 && (
          <span className="toolbar-viewers">
            {viewers.map((v) => (
              <Avatar key={v.socketId} user={v.user} size={22} status={v.idle ? 'idle' : 'online'} tooltip={`${v.user.name} 님이 이 문서를 보는 중`} />
            ))}
          </span>
        )}
        <span className="toolbar-spacer" />
        <button
          type="button"
          className={cx('page-chip', page && 'is-paged')}
          onClick={() => void editPage()}
          disabled={!ws.canEdit}
          data-tip={ws.canEdit ? '페이지 설정 (크기 · 방향 · 여백)' : '페이지 크기'}
        >
          {page ? <FileText size={13} /> : <InfinityIcon size={13} />}
          <span>{page ? describePage(page).split(' · ')[0] : '자유 형식'}</span>
          {page && pages > 0 && <span className="page-chip-count">{pages}쪽</span>}
        </button>
        {page && (
          <select className="zoom-select" value={String(zoom)} onChange={(e) => changeZoom(e.target.value === 'fit' ? 'fit' : Number(e.target.value))} aria-label="화면 배율" data-tip="화면 배율">
            <option value="fit">맞춤</option>
            {[50, 75, 100, 125, 150, 200].map((z) => (
              <option key={z} value={z}>
                {z}%
              </option>
            ))}
          </select>
        )}
        <DocStats editor={editor} />
        <Menu
          align="end"
          width={220}
          items={[
            { label: 'Markdown으로 내보내기', icon: <Download size={14} />, onSelect: exportMd },
            { label: 'HTML로 내보내기', icon: <Download size={14} />, onSelect: () => void exportHtml() },
            {
              label: 'Markdown 복사',
              icon: <Copy size={14} />,
              onSelect: async () => editor && (await copyText(toMarkdown(editor.getJSON(), title))) && toast.success('Markdown을 복사했습니다'),
            },
            { label: '페이지 설정…', icon: <Ruler size={14} />, disabled: !ws.canEdit, hint: page ? describePage(page).split(' · ')[0] : '자유 형식', onSelect: () => void editPage() },
            { label: page ? `인쇄 / PDF 저장 (${describePage(page).split(' · ')[0]})` : '인쇄 / PDF 저장', icon: <Printer size={14} />, onSelect: () => window.print() },
            { divider: true, label: '' },
            { label: '문서 복제', icon: <Copy size={14} />, disabled: !ws.canEdit, onSelect: () => duplicateItem(ws, 'docs', id, me) },
            { label: '문서 삭제', icon: <Trash2 size={14} />, danger: true, disabled: !ws.canEdit, onSelect: () => void deleteItem(ws, 'docs', id) },
          ]}
          trigger={({ toggle, ref }) => (
            <IconButton ref={ref} label="내보내기 · 더 보기" onClick={toggle}>
              <MoreHorizontal size={16} />
            </IconButton>
          )}
        />
      </div>
      <DocEditor
        fragment={fragment}
        awareness={ws.provider.awareness}
        user={me}
        readOnly={!ws.canEdit}
        docKey={id}
        env={env}
        page={page}
        zoom={zoom}
        onPages={setPages}
        onEditor={setEditor}
        onLocalEdit={() => {
          ws.action('✏️ 문서 작성 중');
          ws.report({ type: 'docs.edit', targetId: id, targetName: title });
        }}
        onSelectText={() => ws.action('🔍 텍스트 선택 중')}
        header={
          <div className="doc-title-row">
            <Menu
              width={236}
              header="문서 아이콘"
              items={DOC_EMOJIS.map((e) => ({ label: e, onSelect: () => ws.canEdit && item.set('emoji', e) }))}
              trigger={({ toggle, ref }) => (
                <button ref={ref} className="doc-emoji" onClick={toggle} disabled={!ws.canEdit} aria-label="아이콘 변경">
                  {emoji}
                </button>
              )}
            />
            <input
              className="doc-title"
              value={titleDraft ?? title}
              placeholder="제목 없는 문서"
              disabled={!ws.canEdit}
              maxLength={80}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitTitle();
                  editor?.commands.focus('start');
                }
              }}
            />
          </div>
        }
      />
    </div>
  );
}

function DocStats({ editor }: { editor: Editor | null }) {
  if (!editor) return null;
  return <DocStatsInner editor={editor} />;
}

function DocStatsInner({ editor }: { editor: Editor }) {
  const stats = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      // 에디터가 교체/파기되는 순간에는 storage가 비어 있을 수 있다
      const cc = e && !e.isDestroyed ? e.storage.characterCount : undefined;
      return { chars: cc ? (cc.characters() as number) : 0, words: cc ? (cc.words() as number) : 0 };
    },
  });
  const minutes = Math.max(1, Math.round(stats.chars / 500));
  return (
    <span className="doc-stats" data-tip="공백 포함 글자 수 · 읽는 데 걸리는 대략적인 시간">
      {stats.chars.toLocaleString()}자 · {stats.words.toLocaleString()}단어 · 약 {minutes}분
    </span>
  );
}
