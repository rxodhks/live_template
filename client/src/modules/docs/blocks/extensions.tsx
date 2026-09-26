import { Extension, type AnyExtension, type Editor, type Range } from '@tiptap/core';
import { PluginKey, TextSelection } from '@tiptap/pm/state';
import { Suggestion } from '@tiptap/suggestion';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { Mathematics } from '@tiptap/extension-mathematics';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import { FileHandler } from '@tiptap/extension-file-handler';
import { promptDialog } from '../../../components/ui';
import { toast } from '../../../store/toasts';
import { BLOCKS, type BlockDef, insertImageFiles, insertMath } from './blockDefs';
import { type ListItem, matches, popupRenderer } from './suggestion';
import { type DocEnv, PAGE_MODULE_NAME, dateLabel, isoDate } from './env';
import { Callout } from './nodes/Callout';
import { ImageBlock } from './nodes/ImageBlock';
import { Embed } from './nodes/Embed';
import { Column, Columns } from './nodes/Columns';
import { TableOfContents } from './nodes/Toc';
import { CodeBlock } from './nodes/CodeBlock';
import { DocMention } from './nodes/MentionChip';
import { ToggleCommands } from './nodes/Toggle';

/* ───────────── '/' 블록 메뉴 ───────────── */

const SlashCommand = Extension.create<{ env: DocEnv }>({
  name: 'slashCommand',
  addOptions: () => ({ env: null as unknown as DocEnv }),
  addProseMirrorPlugins() {
    const env = this.options.env;
    return [
      Suggestion<BlockDef>({
        editor: this.editor,
        pluginKey: new PluginKey('slashCommand'),
        char: '/',
        allowSpaces: false,
        // 코드 블록 안에서는 '/'가 그냥 글자
        allow: ({ state, range }) => !state.doc.resolve(range.from).parent.type.spec.code,
        items: ({ query }) => BLOCKS.filter((b) => (!b.available || b.available(env)) && matches(query, b.label, ...b.keywords)),
        command: ({ editor, range, props }) => {
          editor.chain().focus().deleteRange(range).run();
          if (props.insert) void props.insert(editor, env);
          else props.turnInto?.(editor.chain().focus()).run();
        },
        render: popupRenderer<BlockDef>('일치하는 블록이 없습니다'),
      }),
    ];
  },
});

/* ───────────── '@' 멘션 목록 ───────────── */

interface MentionItem extends ListItem {
  attrs: { id: string; label: string };
}

function mentionItems(env: DocEnv, query: string): MentionItem[] {
  const users: MentionItem[] = env
    .users()
    .filter((u) => matches(query, u.name))
    .slice(0, 6)
    .map((u) => ({
      key: `u:${u.id}`,
      label: u.name,
      group: '사람',
      icon: (
        <span className="suggest-avatar" style={{ background: u.color }}>
          {u.avatar}
        </span>
      ),
      attrs: { id: `u:${u.id}`, label: u.name },
    }));
  const pages: MentionItem[] = env
    .pages()
    .filter((p) => matches(query, p.title, PAGE_MODULE_NAME[p.module]))
    .slice(0, 8)
    .map((p) => ({ key: `p:${p.module}:${p.id}`, label: p.title, hint: PAGE_MODULE_NAME[p.module], group: '페이지', icon: <span>{p.emoji}</span>, attrs: { id: `p:${p.module}:${p.id}`, label: p.title } }));
  const now = new Date();
  const day = (n: number) => isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + n));
  const dates: [string, string, string[]][] = [
    [day(0), '오늘', ['today', 'date', '날짜']],
    [day(1), '내일', ['tomorrow', 'date', '날짜']],
    [day(-1), '어제', ['yesterday', 'date', '날짜']],
  ];
  // 2026-10-01 · 10/1 · 10월 1일처럼 입력한 날짜
  const typed = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(query) ?? /^()(\d{1,2})[/.월](\d{1,2})일?$/.exec(query);
  if (typed) {
    const y = Number(typed[1]) || now.getFullYear();
    const d = new Date(y, Number(typed[2]) - 1, Number(typed[3]));
    if (!Number.isNaN(d.getTime())) dates.unshift([isoDate(d), '', [query]]);
  }
  const dateItems: MentionItem[] = dates
    .filter(([, name, words]) => matches(query, name, ...words))
    .map(([iso]) => ({ key: `d:${iso}`, label: dateLabel(iso), group: '날짜', icon: <span>📅</span>, attrs: { id: `d:${iso}`, label: dateLabel(iso) } }));
  return [...users, ...pages, ...dateItems];
}

/* ───────────── 블록 옮기기 단축키 (Ctrl/⌘ + Shift + ↑ ↓) ───────────── */

export function moveBlock(editor: Editor, dir: -1 | 1): boolean {
  const { $from } = editor.state.selection;
  if ($from.depth < 1) return false;
  const pos = $from.before(1);
  const node = $from.node(1);
  const $pos = editor.state.doc.resolve(pos);
  const sibling = $pos.parent.maybeChild($pos.index() + dir);
  if (!sibling) return true;
  // 옮긴 뒤에도 커서가 같은 글자 위치에 있도록
  const offset = $from.pos - pos;
  const target = dir === -1 ? pos - sibling.nodeSize : pos + sibling.nodeSize;
  const tr = editor.state.tr.delete(pos, pos + node.nodeSize).insert(target, node);
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(target + offset, tr.doc.content.size))));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

const BlockKeys = Extension.create({
  name: 'blockKeys',
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-ArrowUp': () => moveBlock(this.editor, -1),
      'Mod-Shift-ArrowDown': () => moveBlock(this.editor, 1),
    };
  },
});

/* ───────────── 전체 구성 ───────────── */

/** 노션식 블록 확장 모음 (StarterKit · 표 · 체크리스트 등 기본 확장과 함께 쓴다) */
export function blockExtensions(env: DocEnv): AnyExtension[] {
  // 수식을 누르면 다시 고친다 — onClick에는 편집기가 넘어오지 않아 이 편집기를 기억해 둔다
  const holder: { editor: Editor | null } = { editor: null };
  const EditorRef = Extension.create({
    name: 'docEditorRef',
    onCreate() {
      holder.editor = this.editor;
    },
    onDestroy() {
      holder.editor = null;
    },
  });
  return [
    TextStyle,
    Color,
    // 펼침 상태도 문서에 저장한다 (새로 만든 토글은 펼친 채로)
    Details.configure({ persist: true, HTMLAttributes: { class: 'doc-toggle' } }),
    ToggleCommands,
    DetailsSummary,
    DetailsContent,
    Callout,
    ImageBlock,
    Embed,
    Column,
    Columns,
    TableOfContents,
    CodeBlock,
    Mathematics.configure({
      katexOptions: { throwOnError: false, strict: false },
      blockOptions: { onClick: (node, pos) => editMath(holder.editor, 'block', node.attrs.latex as string, pos) },
      inlineOptions: { onClick: (node, pos) => editMath(holder.editor, 'inline', node.attrs.latex as string, pos) },
    }),
    DocMention.configure({
      env,
      HTMLAttributes: { class: 'mention' },
      suggestion: {
        char: '@',
        allowSpaces: false,
        items: ({ query }: { query: string }) => mentionItems(env, query),
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: unknown }) => {
          const item = props as unknown as MentionItem;
          editor
            .chain()
            .focus()
            .insertContentAt(range, [
              { type: 'mention', attrs: { ...item.attrs, mentionSuggestionChar: '@' } },
              { type: 'text', text: ' ' },
            ])
            .run();
        },
        render: popupRenderer<MentionItem>('일치하는 사람 · 페이지가 없습니다') as never,
      },
    }),
    SlashCommand.configure({ env }),
    FileHandler.configure({
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif', 'image/heic'],
      onPaste: (editor, files, html) => {
        // 웹 페이지에서 복사한 내용(HTML)은 그대로 붙여 넣는다 — 이미지 주소가 함께 들어온다
        if (html) return;
        if (!env.uploads) return void toast.warning('여기에는 이미지 파일을 넣을 수 없습니다', '비밀 노트는 암호화 크기 제한이 있어 이미지 주소로만 넣을 수 있습니다.');
        void insertImageFiles(editor, files);
      },
      onDrop: (editor, files, pos) => {
        if (!env.uploads) return void toast.warning('여기에는 이미지 파일을 넣을 수 없습니다', '비밀 노트는 암호화 크기 제한이 있어 이미지 주소로만 넣을 수 있습니다.');
        void insertImageFiles(editor, files, pos);
      },
    }),
    EditorRef,
    BlockKeys,
  ];
}

async function editMath(editor: Editor | null, kind: 'block' | 'inline', latex: string, pos: number) {
  if (!editor?.isEditable) return;
  const next = await promptDialog({
    title: kind === 'block' ? '수식 고치기' : '인라인 수식 고치기',
    label: 'LaTeX',
    initial: latex,
    confirmText: '적용',
    multiline: kind === 'block',
    mono: true,
  });
  if (next === null) return;
  if (kind === 'block') editor.chain().setNodeSelection(pos).updateBlockMath({ latex: next }).run();
  else editor.chain().setNodeSelection(pos).updateInlineMath({ latex: next }).run();
}

export { insertMath };
