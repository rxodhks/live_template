import type { ChainedCommands, Editor } from '@tiptap/core';
import { TextSelection, type Transaction } from '@tiptap/pm/state';
import {
  AtSign,
  CalendarDays,
  Clapperboard,
  Code2,
  Columns2,
  Columns3,
  Heading1,
  Heading2,
  Heading3,
  ImageUp,
  Lightbulb,
  Link,
  List,
  ListCollapse,
  ListChecks,
  ListOrdered,
  ListTree,
  Minus,
  Quote,
  Radical,
  SeparatorHorizontal,
  Sigma,
  Table,
  Type,
} from 'lucide-react';
import { promptDialog } from '../../../components/ui';
import { toast, useToasts } from '../../../store/toasts';
import type { ListItem } from './suggestion';
import { EMBED_PROVIDERS, resolveEmbed } from './embed';
import { isSafeImageSrc, prepareImage } from './images';
import { type DocEnv, dateLabel, isoDate } from './env';

/*
 * 문서 블록 목록 — '/' 메뉴, 블록 왼쪽 '+', 블록 메뉴의 '전환'이 함께 쓴다
 */

export interface BlockDef extends ListItem {
  keywords: string[];
  /** 지금 블록을 이 종류로 바꾸기 (글 블록 종류만) */
  turnInto?: (c: ChainedCommands) => ChainedCommands;
  /** 지금 블록이 이 종류인지 */
  isActive?: (e: Editor) => boolean;
  /** '/' 메뉴에서 골랐을 때 (없으면 turnInto로 지금 블록을 바꾼다) */
  insert?: (editor: Editor, env: DocEnv) => void | Promise<void>;
  /** 이미지 파일 올리기처럼 조건이 있는 블록 */
  available?: (env: DocEnv) => boolean;
}

const s = 15;

export const BLOCKS: BlockDef[] = [
  { key: 'paragraph', label: '텍스트', group: '기본 블록', icon: <Type size={s} />, keywords: ['text', 'paragraph', '본문', '글'], turnInto: (c) => c.setParagraph(), isActive: (e) => e.isActive('paragraph') },
  { key: 'h1', label: '제목 1', hint: '#', group: '기본 블록', icon: <Heading1 size={s} />, keywords: ['heading', 'h1', 'title', '제목', '큰'], turnInto: (c) => c.setHeading({ level: 1 }), isActive: (e) => e.isActive('heading', { level: 1 }) },
  { key: 'h2', label: '제목 2', hint: '##', group: '기본 블록', icon: <Heading2 size={s} />, keywords: ['heading', 'h2', '제목', '중간'], turnInto: (c) => c.setHeading({ level: 2 }), isActive: (e) => e.isActive('heading', { level: 2 }) },
  { key: 'h3', label: '제목 3', hint: '###', group: '기본 블록', icon: <Heading3 size={s} />, keywords: ['heading', 'h3', '제목', '작은'], turnInto: (c) => c.setHeading({ level: 3 }), isActive: (e) => e.isActive('heading', { level: 3 }) },
  { key: 'bullet', label: '글머리 기호 목록', hint: '-', group: '기본 블록', icon: <List size={s} />, keywords: ['bullet', 'list', 'ul', '목록', '글머리'], turnInto: (c) => c.toggleBulletList(), isActive: (e) => e.isActive('bulletList') },
  { key: 'ordered', label: '번호 목록', hint: '1.', group: '기본 블록', icon: <ListOrdered size={s} />, keywords: ['number', 'ordered', 'ol', '번호', '목록'], turnInto: (c) => c.toggleOrderedList(), isActive: (e) => e.isActive('orderedList') },
  { key: 'task', label: '할 일 목록', hint: '[ ]', group: '기본 블록', icon: <ListChecks size={s} />, keywords: ['todo', 'task', 'check', '할일', '체크', '투두'], turnInto: (c) => c.toggleTaskList(), isActive: (e) => e.isActive('taskList') },
  { key: 'toggle', label: '토글 목록', group: '기본 블록', icon: <ListCollapse size={s} />, keywords: ['toggle', 'details', 'collapse', '토글', '접기', '펼치기'], turnInto: (c) => c.setToggle(), isActive: (e) => e.isActive('details') },
  { key: 'quote', label: '인용', hint: '>', group: '기본 블록', icon: <Quote size={s} />, keywords: ['quote', 'blockquote', '인용'], turnInto: (c) => c.setBlockquote(), isActive: (e) => e.isActive('blockquote') },
  { key: 'callout', label: '콜아웃', group: '기본 블록', icon: <Lightbulb size={s} />, keywords: ['callout', 'note', 'tip', '콜아웃', '강조', '알림', '박스'], turnInto: (c) => c.setCallout(), isActive: (e) => e.isActive('callout') },
  { key: 'code', label: '코드', hint: '```', group: '기본 블록', icon: <Code2 size={s} />, keywords: ['code', 'codeblock', '코드'], turnInto: (c) => c.setCodeBlock(), isActive: (e) => e.isActive('codeBlock') },
  { key: 'divider', label: '구분선', hint: '---', group: '기본 블록', icon: <Minus size={s} />, keywords: ['divider', 'hr', 'line', '구분선', '줄'], insert: (e) => void e.chain().focus().setHorizontalRule().run() },
  { key: 'table', label: '표', group: '기본 블록', icon: <Table size={s} />, keywords: ['table', '표', '테이블'], insert: (e) => void e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },

  { key: 'image', label: '이미지 올리기', group: '미디어', icon: <ImageUp size={s} />, keywords: ['image', 'photo', 'picture', 'upload', '이미지', '사진', '그림'], available: (env) => env.uploads, insert: (e) => pickImages(e) },
  { key: 'image-url', label: '이미지 주소로 넣기', group: '미디어', icon: <Link size={s} />, keywords: ['image', 'url', '이미지', '사진', '주소', '링크'], insert: (e) => insertImageUrl(e) },
  { key: 'embed', label: '동영상 · 임베드', group: '미디어', icon: <Clapperboard size={s} />, keywords: ['embed', 'video', 'youtube', 'vimeo', 'figma', 'map', '유튜브', '동영상', '영상', '임베드', '지도', '피그마'], insert: (e) => insertEmbedUrl(e) },

  { key: 'columns2', label: '2단', group: '레이아웃', icon: <Columns2 size={s} />, keywords: ['columns', 'column', '2', '단', '나란히', '레이아웃'], insert: (e) => void e.chain().focus().insertColumns(2).run() },
  { key: 'columns3', label: '3단', group: '레이아웃', icon: <Columns3 size={s} />, keywords: ['columns', 'column', '3', '단', '나란히', '레이아웃'], insert: (e) => void e.chain().focus().insertColumns(3).run() },
  { key: 'page-break', label: '페이지 나누기', hint: 'Ctrl+Enter', group: '레이아웃', icon: <SeparatorHorizontal size={s} />, keywords: ['page break', 'break', 'page', '페이지', '쪽', '나누기', '새 페이지'], insert: (e) => void e.chain().focus().setPageBreak().run() },
  { key: 'toc', label: '목차', group: '레이아웃', icon: <ListTree size={s} />, keywords: ['toc', 'table of contents', 'outline', '목차', '차례'], insert: (e) => void e.chain().focus().insertTableOfContents().run() },

  { key: 'math', label: '수식 블록', group: '고급', icon: <Sigma size={s} />, keywords: ['math', 'latex', 'equation', 'katex', '수식', '수학'], insert: (e) => insertMath(e, 'block') },
  { key: 'math-inline', label: '인라인 수식', hint: '$$x$$', group: '고급', icon: <Radical size={s} />, keywords: ['math', 'inline', 'latex', '수식', '수학'], insert: (e) => insertMath(e, 'inline') },
  { key: 'mention', label: '사람 · 페이지 멘션', hint: '@', group: '고급', icon: <AtSign size={s} />, keywords: ['mention', 'person', 'page', 'link', '멘션', '사람', '페이지', '링크'], insert: (e) => void e.chain().focus().insertContent('@').run() },
  {
    key: 'date',
    label: '오늘 날짜',
    group: '고급',
    icon: <CalendarDays size={s} />,
    keywords: ['date', 'today', 'now', '날짜', '오늘'],
    insert: (e) => {
      const d = isoDate(new Date());
      e.chain()
        .focus()
        .insertContent([{ type: 'mention', attrs: { id: `d:${d}`, label: dateLabel(d), mentionSuggestionChar: '@' } }, { type: 'text', text: ' ' }])
        .run();
    },
  },
];

/** 블록 메뉴 · 선택 메뉴의 '전환'에 나오는 종류 */
export const TURN_INTO = BLOCKS.filter((b) => b.turnInto);

export const blockLabel = (editor: Editor): string => TURN_INTO.find((b) => b.isActive?.(editor) && b.key !== 'paragraph')?.label ?? '텍스트';

/**
 * 블록 하나(pos 위치의 노드)를 다른 종류로 바꾼다 — 목록 · 인용 · 콜아웃 · 토글에서 먼저 꺼낸 뒤 바꾼다
 */
export function turnBlockInto(editor: Editor, pos: number, def: BlockDef) {
  const node = editor.state.doc.nodeAt(pos);
  if (!node || !def.turnInto) return;
  const from = pos + 1;
  const to = Math.max(from, pos + node.nodeSize - 1);
  let chain = editor.chain().focus().setTextSelection({ from, to });
  if (node.type.name === 'details') chain = chain.unsetDetails();
  def.turnInto(chain.clearNodes().command(keepRange(from, to))).run();
}

/** 선택 영역을 글 블록으로 되돌린 뒤 다른 종류로 바꾼다 (선택 막대의 '전환') */
export function turnSelectionInto(editor: Editor, def: BlockDef) {
  if (!def.turnInto) return;
  const { from, to } = editor.state.selection;
  def.turnInto(editor.chain().focus().clearNodes().command(keepRange(from, to))).run();
}

/**
 * clearNodes는 선택을 맨 끝으로 접어 버려 다음 명령이 마지막 블록에만 적용된다 — 원래 범위를 다시 고른다
 * (같은 명령 묶음 안의 변경을 따라 위치를 옮긴다)
 */
const keepRange =
  (from: number, to: number) =>
  ({ tr }: { tr: Transaction }) => {
    const a = tr.mapping.map(from, 1);
    const b = Math.max(a, tr.mapping.map(to, -1));
    tr.setSelection(TextSelection.between(tr.doc.resolve(a), tr.doc.resolve(Math.min(b, tr.doc.content.size))));
    return true;
  };

/* ───────────── 미디어 넣기 ───────────── */

/** 파일 선택 창에서 이미지를 골라 넣는다 */
export function pickImages(editor: Editor) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/heic,image/avif';
  input.multiple = true;
  input.onchange = () => void insertImageFiles(editor, Array.from(input.files ?? []));
  input.click();
}

/** 이미지 파일들을 줄여서 차례로 넣는다 (pos가 있으면 그 위치에) */
export async function insertImageFiles(editor: Editor, files: File[], pos?: number) {
  const images = files.filter((f) => f.type.startsWith('image/'));
  if (!images.length) return;
  // 큰 사진을 줄이는 데 잠깐 걸릴 수 있어 알려 준다
  const id = images.length > 1 || images.some((f) => f.size > 1_500_000) ? toast.info(images.length > 1 ? `이미지 ${images.length}개를 넣는 중…` : '이미지를 넣는 중…') : null;
  let at = pos;
  for (const file of images) {
    try {
      const img = await prepareImage(file);
      const node = { type: 'image', attrs: { src: img.src, alt: file.name.replace(/\.[^.]+$/, '') } };
      if (at === undefined) editor.chain().focus().insertContent(node).run();
      else {
        editor.chain().insertContentAt(at, node).run();
        at += 1;
      }
    } catch (err) {
      toast.error(`${file.name}을(를) 넣지 못했습니다`, err instanceof Error ? err.message : undefined);
    }
  }
  if (id) useToasts.getState().dismiss(id);
}

async function insertImageUrl(editor: Editor) {
  const url = await promptDialog({
    title: '이미지 주소로 넣기',
    label: '이미지 주소 (https://…)',
    placeholder: 'https://example.com/photo.png',
    confirmText: '넣기',
    validate: (v) => (isSafeImageSrc(v) ? null : 'https:// 로 시작하는 이미지 주소를 넣어 주세요.'),
  });
  if (url) editor.chain().focus().insertImage({ src: url }).run();
}

async function insertEmbedUrl(editor: Editor) {
  const url = await promptDialog({
    title: '동영상 · 임베드',
    label: '주소',
    placeholder: 'https://www.youtube.com/watch?v=…',
    confirmText: '넣기',
    hint: `지원: ${EMBED_PROVIDERS}`,
    validate: (v) => (resolveEmbed(v) ? null : '지원하는 서비스의 주소가 아닙니다.'),
  });
  if (!url) return;
  const info = resolveEmbed(url);
  if (info) editor.chain().focus().insertEmbed({ src: info.src, url, provider: info.provider, height: info.height ?? null }).run();
}

export async function insertMath(editor: Editor, kind: 'block' | 'inline', initial = '') {
  const latex = await promptDialog({
    title: kind === 'block' ? '수식 블록' : '인라인 수식',
    label: 'LaTeX',
    placeholder: kind === 'block' ? 'E = mc^2' : 'a^2 + b^2 = c^2',
    initial,
    confirmText: '넣기',
    multiline: kind === 'block',
    mono: true,
    hint: kind === 'block' ? 'Ctrl/⌘ + Enter로 넣기 · 수식을 누르면 다시 고칠 수 있습니다' : '문장 안에서 $$x^2$$처럼 입력해도 됩니다',
  });
  if (!latex) return;
  if (kind === 'block') editor.chain().focus().insertBlockMath({ latex }).run();
  else editor.chain().focus().insertInlineMath({ latex }).run();
}
