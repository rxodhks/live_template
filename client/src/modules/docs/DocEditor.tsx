import { useEffect, useMemo, useRef } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Collaboration, isChangeOrigin } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Highlight } from '@tiptap/extension-highlight';
import { TextAlign } from '@tiptap/extension-text-align';
import { TableKit } from '@tiptap/extension-table';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import 'katex/dist/katex.min.css';
import type * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Code2,
  Highlighter,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Table,
  Underline,
  Undo2,
  Columns3,
  Rows3,
  Trash2,
  Plus,
} from 'lucide-react';
import type { PublicUser } from '@shared/types';
import { IconButton, promptDialog } from '../../components/ui';
import { CursorLayer } from '../../components/Cursors';
import { cx } from '../../lib/util';
import { blockExtensions } from './blocks/extensions';
import { BlockHandle } from './blocks/BlockHandle';
import { BubbleToolbar } from './blocks/BubbleToolbar';
import { type DocEnv, EMPTY_ENV } from './blocks/env';
import type { PageSetup } from '@shared/schema';
import { type PageBreakMark, type Zoom, usePagedLayout } from './page/usePagedLayout';
import { pageCss } from './page/pageSizes';

interface Props {
  fragment: Y.XmlFragment;
  awareness: Awareness;
  user: PublicUser;
  readOnly: boolean;
  placeholder?: string;
  /** 문서 식별자 (목차 이동 이벤트 매칭용) */
  docKey: string;
  onLocalEdit?: () => void;
  onSelectText?: () => void;
  onEditor?: (editor: Editor | null) => void;
  /** 제목 등 에디터 위에 들어갈 요소 */
  header?: React.ReactNode;
  /** 페이지 커서 공유 여부 (비밀 노트도 같은 방식) */
  cursors?: boolean;
  /** 멘션할 사람 · 페이지, 이미지 올리기 허용 등 */
  env?: DocEnv;
  /** 페이지 크기 (없으면 끝없이 이어지는 자유 형식) */
  page?: PageSetup | null;
  /** 크기가 정해진 문서의 화면 배율 */
  zoom?: Zoom;
  /** 쪽 수가 바뀌면 */
  onPages?: (pages: number) => void;
}

/** TipTap(ProseMirror) + Yjs 실시간 문서 편집기 */
export function DocEditor({ fragment, awareness, user, readOnly, placeholder, docKey, onLocalEdit, onSelectText, onEditor, header, cursors = true, env = EMPTY_ENV, page = null, zoom = 'fit', onPages }: Props) {
  const cb = useRef({ onLocalEdit, onSelectText });
  cb.current = { onLocalEdit, onSelectText };
  // 편집기는 문서마다 한 번만 만들어지므로, 바뀌는 값은 항상 최신을 읽도록 감싼다
  const envRef = useRef(env);
  envRef.current = env;
  const stableEnv = useMemo<DocEnv>(
    () => ({
      get uploads() {
        return envRef.current.uploads;
      },
      users: () => envRef.current.users(),
      pages: () => envRef.current.pages(),
      openPage: (m, id) => envRef.current.openPage(m, id),
      subscribe: (fn) => envRef.current.subscribe(fn),
    }),
    [],
  );

  const editor = useEditor(
    {
      editable: !readOnly,
      extensions: [
        // trailingNode는 문서를 열기만 해도 빈 문단을 추가해 동시 편집 시 문단이 늘어나므로 끈다
        // 코드 블록은 문법 색이 들어간 것으로 바꿔 쓴다 (같은 이름 · 속성)
        StarterKit.configure({ undoRedo: false, trailingNode: false, codeBlock: false, link: { openOnClick: false, autolink: true } }),
        Collaboration.configure({ fragment }),
        CollaborationCaret.configure({
          provider: { awareness },
          user: { name: `${user.avatar} ${user.name}`, color: user.color },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Highlight.configure({ multicolor: true }),
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        TableKit.configure({ table: { resizable: false } }),
        CharacterCount,
        Placeholder.configure({
          includeChildren: true,
          placeholder: ({ node }) =>
            node.type.name === 'heading'
              ? `제목 ${node.attrs.level}`
              : node.type.name === 'detailsSummary'
                ? '토글 제목'
                : (placeholder ?? "'/'를 입력해 블록 추가 · '@'로 사람 · 페이지 멘션"),
        }),
        ...blockExtensions(stableEnv),
      ],
      onUpdate: ({ editor, transaction }) => {
        // 원격 변경·초기 렌더링은 제외하고, 내가 직접 편집한 경우만 활동으로 본다
        if (!isChangeOrigin(transaction) && editor.isFocused && editor.isEditable) cb.current.onLocalEdit?.();
      },
      onSelectionUpdate: ({ editor }) => {
        if (!editor.state.selection.empty) cb.current.onSelectText?.();
      },
    },
    [fragment],
  );

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    onEditor?.(editor);
    return () => onEditor?.(null);
  }, [editor]); // eslint-disable-line react-hooks/exhaustive-deps

  // 이 문서를 떠나면 다른 사람 화면의 내 캐럿을 지운다
  useEffect(() => () => awareness.setLocalStateField('cursor', null), [awareness, fragment]);

  // 탐색기 목차에서 제목 클릭 → 해당 위치로 스크롤
  useEffect(() => {
    const onJump = (e: Event) => {
      const { key, index } = (e as CustomEvent<{ key: string; index: number }>).detail;
      if (key !== docKey || !editor) return;
      const el = editor.view.dom.querySelectorAll('h1, h2, h3, h4')[index] as HTMLElement | undefined;
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener('lt:doc-heading', onJump);
    return () => window.removeEventListener('lt:doc-heading', onJump);
  }, [editor, docKey]);

  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const layout = usePagedLayout(page, zoom, editor, scrollRef, pageRef);
  const pages = layout?.pages ?? 0;
  useEffect(() => onPages?.(pages), [pages]); // eslint-disable-line react-hooks/exhaustive-deps

  // 크기가 정해진 문서: 정해진 너비 · 여백 · 글자 크기, 넓으면 배율로 줄인다 (구조는 같게 두어 편집기가 다시 만들어지지 않게)
  const pageStyle = layout
    ? ({
        width: layout.width,
        minHeight: layout.minHeight,
        padding: layout.margin,
        transform: layout.scale !== 1 ? `scale(${layout.scale})` : undefined,
        '--doc-font-size': `${page!.fontSize}px`,
      } as React.CSSProperties)
    : undefined;

  return (
    <div className="doc-editor">
      {editor && !readOnly && <DocToolbar editor={editor} />}
      {editor && !readOnly && <BubbleToolbar editor={editor} />}
      <div className="cursor-host" ref={hostRef}>
        <div className={cx('doc-scroll page-scroll', layout && 'is-paged')} ref={scrollRef}>
          <div className={cx('doc-stage', layout && 'is-paged')} style={layout ? { width: layout.width * layout.scale, height: layout.stageHeight } : undefined}>
            <div className={cx('doc-page', layout && 'is-paged')} ref={pageRef} style={pageStyle}>
              <div className="doc-header">{header}</div>
              <EditorContent editor={editor} className="doc-content" />
              {layout && <PageGuides breaks={layout.breaks} />}
              {editor && !readOnly && <BlockHandle editor={editor} />}
            </div>
          </div>
        </div>
        {cursors && <CursorLayer hostRef={hostRef} scrollRef={scrollRef} anchorRef={pageRef} />}
      </div>
      {page && <style>{printCss(page)}</style>}
    </div>
  );
}

/** 인쇄할 때 쪽이 나뉘는 위치 */
function PageGuides({ breaks }: { breaks: PageBreakMark[] }) {
  return (
    <div className="page-guides" aria-hidden>
      {breaks.map((b, i) => (
        <div key={i} className={cx('page-guide', b.manual && 'is-manual')} style={{ top: b.y }}>
          <span>{i + 2}쪽</span>
        </div>
      ))}
    </div>
  );
}

/** 인쇄 · PDF 저장: 페이지 크기 · 여백 그대로, 화면용 배율 · 안내선은 빼고 */
function printCss(page: PageSetup): string {
  return `@media print {
  ${pageCss(page)}
  .doc-scroll.is-paged, .doc-stage.is-paged { width: auto !important; height: auto !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; }
  .doc-page.is-paged { width: auto !important; min-height: 0 !important; padding: 0 !important; transform: none !important; box-shadow: none !important; border: 0 !important; }
  .page-guides { display: none !important; }
  .doc-content .ProseMirror > * { break-inside: avoid; }
  .doc-content .ProseMirror > [data-page-break] { break-after: page; height: 0 !important; margin: 0 !important; border: 0 !important; visibility: hidden; }
}`;
}

function T({ label, active, onClick, children, disabled }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <IconButton label={label} size="sm" active={active} onClick={onClick} disabled={disabled} onMouseDown={(e) => e.preventDefault()}>
      {children}
    </IconButton>
  );
}

const EMPTY_STATE = {
  level: 0 as 0 | 1 | 2 | 3,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  code: false,
  highlight: false,
  bullet: false,
  ordered: false,
  task: false,
  quote: false,
  codeBlock: false,
  link: false,
  table: false,
  align: 'left' as 'left' | 'center' | 'right',
  canUndo: false,
  canRedo: false,
};

const BLOCK_TYPES = [
  { label: '본문', level: 0 },
  { label: '제목 1', level: 1 },
  { label: '제목 2', level: 2 },
  { label: '제목 3', level: 3 },
] as const;

function DocToolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => e.isDestroyed ? EMPTY_STATE : ({
      level: ([1, 2, 3] as const).find((l) => e.isActive('heading', { level: l })) ?? 0,
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      highlight: e.isActive('highlight'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      link: e.isActive('link'),
      table: e.isActive('table'),
      align: (['center', 'right'] as const).find((a) => e.isActive({ textAlign: a })) ?? 'left',
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();

  const setLink = async () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = await promptDialog({ title: '링크', label: 'URL (비우면 링크 제거)', initial: prev ?? 'https://', confirmText: '적용' });
    if (url === null) return;
    if (!url || url === 'https://') chain().extendMarkRange('link').unsetLink().run();
    else chain().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="doc-toolbar" role="toolbar" aria-label="서식">
      <T label="실행 취소 (내 변경만)" onClick={() => chain().undo().run()} disabled={!s.canUndo}>
        <Undo2 size={15} />
      </T>
      <T label="다시 실행" onClick={() => chain().redo().run()} disabled={!s.canRedo}>
        <Redo2 size={15} />
      </T>
      <span className="tb-sep" />
      <button
        type="button"
        className="tb-add"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          // 빈 줄이면 그 자리에서, 아니면 다음 줄에서 '/' 블록 메뉴를 연다
          const { $from } = editor.state.selection;
          if ($from.parent.isTextblock && $from.parent.content.size === 0) editor.chain().focus().insertContent('/').run();
          else {
            const after = $from.after();
            editor.chain().focus().insertContentAt(after, { type: 'paragraph' }).setTextSelection(after + 1).insertContent('/').run();
          }
        }}
        data-tip="블록 추가 (또는 빈 줄에서 / 입력)"
      >
        <Plus size={14} /> 블록
      </button>
      <span className="tb-sep" />
      <select
        className="tb-select"
        value={s.level}
        aria-label="문단 형식"
        onChange={(e) => {
          const level = Number(e.target.value) as 0 | 1 | 2 | 3;
          if (level === 0) chain().setParagraph().run();
          else chain().setHeading({ level }).run();
        }}
      >
        {BLOCK_TYPES.map((b) => (
          <option key={b.level} value={b.level}>
            {b.label}
          </option>
        ))}
      </select>
      <span className="tb-sep" />
      <T label="굵게 (Ctrl+B)" active={s.bold} onClick={() => chain().toggleBold().run()}>
        <Bold size={15} />
      </T>
      <T label="기울임 (Ctrl+I)" active={s.italic} onClick={() => chain().toggleItalic().run()}>
        <Italic size={15} />
      </T>
      <T label="밑줄 (Ctrl+U)" active={s.underline} onClick={() => chain().toggleUnderline().run()}>
        <Underline size={15} />
      </T>
      <T label="취소선" active={s.strike} onClick={() => chain().toggleStrike().run()}>
        <Strikethrough size={15} />
      </T>
      <T label="인라인 코드" active={s.code} onClick={() => chain().toggleCode().run()}>
        <Code size={15} />
      </T>
      <T label="형광펜" active={s.highlight} onClick={() => chain().toggleHighlight().run()}>
        <Highlighter size={15} />
      </T>
      <T label="링크" active={s.link} onClick={setLink}>
        <Link2 size={15} />
      </T>
      <span className="tb-sep" />
      <T label="글머리 목록" active={s.bullet} onClick={() => chain().toggleBulletList().run()}>
        <List size={15} />
      </T>
      <T label="번호 목록" active={s.ordered} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrdered size={15} />
      </T>
      <T label="체크리스트" active={s.task} onClick={() => chain().toggleTaskList().run()}>
        <ListChecks size={15} />
      </T>
      <T label="인용" active={s.quote} onClick={() => chain().toggleBlockquote().run()}>
        <Quote size={15} />
      </T>
      <T label="코드 블록" active={s.codeBlock} onClick={() => chain().toggleCodeBlock().run()}>
        <Code2 size={15} />
      </T>
      <T label="구분선" onClick={() => chain().setHorizontalRule().run()}>
        <Minus size={15} />
      </T>
      <span className="tb-sep" />
      <T label="왼쪽 정렬" active={s.align === 'left'} onClick={() => chain().setTextAlign('left').run()}>
        <AlignLeft size={15} />
      </T>
      <T label="가운데 정렬" active={s.align === 'center'} onClick={() => chain().setTextAlign('center').run()}>
        <AlignCenter size={15} />
      </T>
      <T label="오른쪽 정렬" active={s.align === 'right'} onClick={() => chain().setTextAlign('right').run()}>
        <AlignRight size={15} />
      </T>
      <span className="tb-sep" />
      <T label="표 삽입 (3×3)" onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <Table size={15} />
      </T>
      <span className={cx('tb-table', s.table && 'is-visible')}>
        <T label="아래에 행 추가" onClick={() => chain().addRowAfter().run()} disabled={!s.table}>
          <Rows3 size={15} />
        </T>
        <T label="오른쪽에 열 추가" onClick={() => chain().addColumnAfter().run()} disabled={!s.table}>
          <Columns3 size={15} />
        </T>
        <T label="행 삭제" onClick={() => chain().deleteRow().run()} disabled={!s.table}>
          <Rows3 size={15} className="icon-strike" />
        </T>
        <T label="열 삭제" onClick={() => chain().deleteColumn().run()} disabled={!s.table}>
          <Columns3 size={15} className="icon-strike" />
        </T>
        <T label="표 삭제" onClick={() => chain().deleteTable().run()} disabled={!s.table}>
          <Trash2 size={15} />
        </T>
      </span>
    </div>
  );
}
