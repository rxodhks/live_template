import { useEffect, useRef } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { Collaboration, isChangeOrigin } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Highlight } from '@tiptap/extension-highlight';
import { TextAlign } from '@tiptap/extension-text-align';
import { TableKit } from '@tiptap/extension-table';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
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
} from 'lucide-react';
import type { PublicUser } from '@shared/types';
import { IconButton, promptDialog } from '../../components/ui';
import { CursorLayer } from '../../components/Cursors';
import { cx } from '../../lib/util';

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
}

/** TipTap(ProseMirror) + Yjs 실시간 문서 편집기 */
export function DocEditor({ fragment, awareness, user, readOnly, placeholder, docKey, onLocalEdit, onSelectText, onEditor, header, cursors = true }: Props) {
  const cb = useRef({ onLocalEdit, onSelectText });
  cb.current = { onLocalEdit, onSelectText };

  const editor = useEditor(
    {
      editable: !readOnly,
      extensions: [
        StarterKit.configure({ undoRedo: false, link: { openOnClick: false, autolink: true } }),
        Collaboration.configure({ fragment }),
        CollaborationCaret.configure({
          provider: { awareness },
          user: { name: `${user.avatar} ${user.name}`, color: user.color },
        }),
        TaskList,
        TaskItem.configure({ nested: true }),
        Highlight,
        TextAlign.configure({ types: ['heading', 'paragraph'] }),
        TableKit.configure({ table: { resizable: false } }),
        CharacterCount,
        Placeholder.configure({
          placeholder: ({ node }) => (node.type.name === 'heading' ? '제목' : placeholder ?? "내용을 입력하세요. '/' 대신 마크다운 단축키(#, -, [ ])를 쓸 수 있어요."),
        }),
      ],
      onUpdate: ({ transaction }) => {
        if (!isChangeOrigin(transaction)) cb.current.onLocalEdit?.();
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

  return (
    <div className="doc-editor">
      {editor && !readOnly && <DocToolbar editor={editor} />}
      <div className="cursor-host" ref={hostRef}>
        <div className="doc-scroll page-scroll" ref={scrollRef}>
          <div className="doc-page" ref={pageRef}>
            {header}
            <EditorContent editor={editor} className="doc-content" />
          </div>
        </div>
        {cursors && <CursorLayer hostRef={hostRef} scrollRef={scrollRef} anchorRef={pageRef} />}
      </div>
    </div>
  );
}

function T({ label, active, onClick, children, disabled }: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <IconButton label={label} size="sm" active={active} onClick={onClick} disabled={disabled} onMouseDown={(e) => e.preventDefault()}>
      {children}
    </IconButton>
  );
}

const BLOCK_TYPES = [
  { label: '본문', level: 0 },
  { label: '제목 1', level: 1 },
  { label: '제목 2', level: 2 },
  { label: '제목 3', level: 3 },
] as const;

function DocToolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
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
