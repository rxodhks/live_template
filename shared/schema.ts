import * as Y from 'yjs';

/*
 * 템플릿 하나 = Y.Doc 하나.
 *
 *   files  : Y.Map<fileId, Y.Map{ id, name, language, createdAt, createdBy, content: Y.Text }>
 *   docs   : Y.Map<docId,  Y.Map{ id, title, emoji, createdAt, createdBy, content: Y.XmlFragment }>
 *   boards : Y.Map<boardId,Y.Map{ id, name, background, createdAt, createdBy, shapes: Y.Map<shapeId, Shape> }>
 *   sections : Y.Map<sectionId, SectionRecord>  — 왼쪽 탐색기의 폴더 구성 (사용자 정의)
 *
 * 왼쪽 탐색기 폴더
 *  - 기본 폴더는 기능별(design · code · docs, 폴더 ID = 기능 이름)로 따로 저장하지 않아도 보인다.
 *    이름 · 아이콘 · 순서 · 위치를 바꾸거나 삭제하면 sections에 그 내용만 기록된다.
 *  - 사용자가 만든 폴더는 임의의 ID로 sections에 들어가고, parent로 다른 폴더 안에 들어갈 수 있다 (하위 폴더).
 *  - 페이지(파일 · 문서 · 보드)는 자기 항목에 section(폴더 ID)과 order(폴더 안 순서)를 가진다.
 *    section이 없거나 그 폴더가 사라졌으면 자기 기능의 기본 폴더로 돌아간다 (페이지는 절대 사라지지 않는다).
 *  - 폴더 하나는 한 번에 통째로 덮어써서, 여러 사람이 동시에 바꿔도 폴더가 둘로 갈라지지 않는다.
 * 비밀 노트는 템플릿 문서에 들어가지 않고 별도의 암호화된 Y.Doc(note:<id>)으로 관리된다.
 */

export type YItem = Y.Map<unknown>;

export const getFiles = (doc: Y.Doc) => doc.getMap<YItem>('files');
export const getDocs = (doc: Y.Doc) => doc.getMap<YItem>('docs');
export const getBoards = (doc: Y.Doc) => doc.getMap<YItem>('boards');
export const getSections = (doc: Y.Doc) => doc.getMap<SectionRecord>('sections');

/** 탐색기 폴더 하나 (기본 폴더는 바꾼 값만, 사용자 폴더는 전부 기록) */
export interface SectionRecord {
  name?: string;
  emoji?: string;
  /** 같은 상위 폴더 안에서의 순서 (작을수록 위). 기본 폴더는 기능 순서(0, 1, 2)가 기본값 */
  order?: number;
  /** 상위 폴더 ID (없으면 맨 위) */
  parent?: string;
  /** 삭제한 기본 폴더 */
  deleted?: boolean;
  createdAt?: number;
  createdBy?: string;
}

/** 비밀 노트 Y.Doc 안의 본문 */
export const NOTE_FRAGMENT = 'content';

export interface CodeLanguage {
  id: string;
  name: string;
  ext: string;
  /** @codemirror/language-data 의 언어 이름 */
  cm: string;
  color: string;
}

export const CODE_LANGUAGES: CodeLanguage[] = [
  { id: 'javascript', name: 'JavaScript', ext: 'js', cm: 'JavaScript', color: '#f1e05a' },
  { id: 'typescript', name: 'TypeScript', ext: 'ts', cm: 'TypeScript', color: '#3178c6' },
  { id: 'jsx', name: 'JSX', ext: 'jsx', cm: 'JSX', color: '#61dafb' },
  { id: 'tsx', name: 'TSX', ext: 'tsx', cm: 'TSX', color: '#2f74c0' },
  { id: 'python', name: 'Python', ext: 'py', cm: 'Python', color: '#3572a5' },
  { id: 'java', name: 'Java', ext: 'java', cm: 'Java', color: '#b07219' },
  { id: 'c', name: 'C', ext: 'c', cm: 'C', color: '#6e7681' },
  { id: 'cpp', name: 'C++', ext: 'cpp', cm: 'C++', color: '#f34b7d' },
  { id: 'csharp', name: 'C#', ext: 'cs', cm: 'C#', color: '#178600' },
  { id: 'go', name: 'Go', ext: 'go', cm: 'Go', color: '#00add8' },
  { id: 'rust', name: 'Rust', ext: 'rs', cm: 'Rust', color: '#dea584' },
  { id: 'kotlin', name: 'Kotlin', ext: 'kt', cm: 'Kotlin', color: '#a97bff' },
  { id: 'swift', name: 'Swift', ext: 'swift', cm: 'Swift', color: '#f05138' },
  { id: 'php', name: 'PHP', ext: 'php', cm: 'PHP', color: '#4f5d95' },
  { id: 'ruby', name: 'Ruby', ext: 'rb', cm: 'Ruby', color: '#cc342d' },
  { id: 'lua', name: 'Lua', ext: 'lua', cm: 'Lua', color: '#000080' },
  { id: 'sql', name: 'SQL', ext: 'sql', cm: 'SQL', color: '#e38c00' },
  { id: 'html', name: 'HTML', ext: 'html', cm: 'HTML', color: '#e34c26' },
  { id: 'css', name: 'CSS', ext: 'css', cm: 'CSS', color: '#663399' },
  { id: 'scss', name: 'SCSS', ext: 'scss', cm: 'SCSS', color: '#c6538c' },
  { id: 'json', name: 'JSON', ext: 'json', cm: 'JSON', color: '#8a8a8a' },
  { id: 'yaml', name: 'YAML', ext: 'yaml', cm: 'YAML', color: '#cb171e' },
  { id: 'markdown', name: 'Markdown', ext: 'md', cm: 'Markdown', color: '#3b82f6' },
  { id: 'shell', name: 'Shell', ext: 'sh', cm: 'Shell', color: '#89e051' },
  { id: 'plaintext', name: '일반 텍스트', ext: 'txt', cm: '', color: '#9ca3af' },
];

const EXT_ALIASES: Record<string, string> = {
  mjs: 'javascript',
  cjs: 'javascript',
  htm: 'html',
  yml: 'yaml',
  h: 'c',
  hpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  bash: 'shell',
  zsh: 'shell',
  markdown: 'markdown',
  sass: 'scss',
  kts: 'kotlin',
};

export function getLanguage(id: string | undefined | null): CodeLanguage {
  return CODE_LANGUAGES.find((l) => l.id === id) ?? CODE_LANGUAGES[CODE_LANGUAGES.length - 1];
}

export function languageFromFilename(name: string): CodeLanguage {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  const byExt = CODE_LANGUAGES.find((l) => l.ext === ext);
  if (byExt) return byExt;
  const alias = EXT_ALIASES[ext];
  return getLanguage(alias ?? 'plaintext');
}

/** 언어를 바꿀 때 기존 확장자가 이전 언어의 것이라면 새 언어의 확장자로 바꿔준다 */
export function renameForLanguage(name: string, from: CodeLanguage, to: CodeLanguage): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return to.id === 'plaintext' ? name : `${name}.${to.ext}`;
  const base = name.slice(0, dot);
  const ext = name.slice(dot + 1).toLowerCase();
  const fromMatches = ext === from.ext || EXT_ALIASES[ext] === from.id;
  return fromMatches ? `${base}.${to.ext}` : name;
}

/* ───────────────────────── 디자인 도형 ───────────────────────── */

export type ShapeType = 'rect' | 'ellipse' | 'diamond' | 'line' | 'arrow' | 'text' | 'sticky' | 'pen';

export interface Shape {
  id: string;
  type: ShapeType;
  /** line/arrow는 (x,y)→(x+w,y+h) 이므로 w,h가 음수일 수 있다 */
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  opacity: number;
  radius?: number;
  text?: string;
  fontSize?: number;
  textColor?: string;
  align?: 'left' | 'center' | 'right';
  /** pen: 바운딩 박스 기준 0~1 정규화 좌표 [x0,y0,x1,y1,...] */
  points?: number[];
  z: number;
  locked?: boolean;
  createdBy?: string;
}

export const SHAPE_LABEL: Record<ShapeType, string> = {
  rect: '사각형',
  ellipse: '원',
  diamond: '마름모',
  line: '선',
  arrow: '화살표',
  text: '텍스트',
  sticky: '스티키 노트',
  pen: '펜 드로잉',
};

/* ───────────────────────── 생성 헬퍼 (서버 시드 + 클라이언트 공용) ───────────────────────── */

export interface NewCodeFile {
  id: string;
  name: string;
  language?: string;
  content?: string;
  createdBy: string;
  createdAt?: number;
}

export function addCodeFile(doc: Y.Doc, f: NewCodeFile): YItem {
  const map = new Y.Map<unknown>();
  doc.transact(() => {
    getFiles(doc).set(f.id, map);
    map.set('id', f.id);
    map.set('name', f.name);
    map.set('language', f.language ?? languageFromFilename(f.name).id);
    map.set('createdAt', f.createdAt ?? Date.now());
    map.set('createdBy', f.createdBy);
    map.set('content', new Y.Text(f.content ?? ''));
  });
  return map;
}

export type SeedBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; items: string[] }
  | { type: 'ordered'; items: string[] }
  | { type: 'task'; items: { text: string; checked?: boolean }[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; text: string; language?: string }
  | { type: 'rule' };

function para(text: string): Y.XmlElement {
  const p = new Y.XmlElement('paragraph');
  if (text) p.insert(0, [new Y.XmlText(text)]);
  return p;
}

function blockToXml(block: SeedBlock): Y.XmlElement {
  switch (block.type) {
    case 'heading': {
      const h = new Y.XmlElement('heading');
      h.setAttribute('level', block.level as unknown as string);
      h.insert(0, [new Y.XmlText(block.text)]);
      return h;
    }
    case 'paragraph':
      return para(block.text);
    case 'bullet':
    case 'ordered': {
      const list = new Y.XmlElement(block.type === 'bullet' ? 'bulletList' : 'orderedList');
      if (block.type === 'ordered') list.setAttribute('start', 1 as unknown as string);
      list.insert(
        0,
        block.items.map((text) => {
          const li = new Y.XmlElement('listItem');
          li.insert(0, [para(text)]);
          return li;
        }),
      );
      return list;
    }
    case 'task': {
      const list = new Y.XmlElement('taskList');
      list.insert(
        0,
        block.items.map((item) => {
          const li = new Y.XmlElement('taskItem');
          li.setAttribute('checked', Boolean(item.checked) as unknown as string);
          li.insert(0, [para(item.text)]);
          return li;
        }),
      );
      return list;
    }
    case 'quote': {
      const q = new Y.XmlElement('blockquote');
      q.insert(0, [para(block.text)]);
      return q;
    }
    case 'code': {
      const c = new Y.XmlElement('codeBlock');
      c.setAttribute('language', (block.language ?? null) as unknown as string);
      c.insert(0, [new Y.XmlText(block.text)]);
      return c;
    }
    case 'rule':
      return new Y.XmlElement('horizontalRule');
  }
}

/* ───────────── 문서 페이지 크기 (A4 · 기기 화면 · 직접 입력) ───────────── */

export type PageUnit = 'px' | 'mm' | 'cm' | 'in' | 'pt';
export const PAGE_UNITS: PageUnit[] = ['px', 'mm', 'cm', 'in', 'pt'];

/** 1단위 = 몇 CSS 픽셀 (화면 기준 96dpi) */
export const PX_PER_UNIT: Record<PageUnit, number> = { px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72 };

/**
 * 문서의 페이지 설정 (문서 항목의 'page' 값). 없으면 끝없이 이어지는 자유 형식 문서.
 * 너비 · 높이 · 여백은 unit 단위, 가로 방향이면 이미 너비 > 높이로 저장한다.
 */
export interface PageSetup {
  /** 고른 형식 (a4, iphone-16 …) — 직접 입력이면 'custom' */
  preset: string;
  width: number;
  height: number;
  unit: PageUnit;
  margin: number;
  /** 본문 글자 크기 (CSS px) */
  fontSize: number;
}

const clampNum = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** 문서에 저장된 값을 믿을 수 있는 형태로 (다른 사람이 보낸 값일 수 있다) */
export function readPageSetup(raw: unknown): PageSetup | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const unit = PAGE_UNITS.includes(r.unit as PageUnit) ? (r.unit as PageUnit) : 'px';
  const k = PX_PER_UNIT[unit];
  // 화면 기준 가로 · 세로 120px ~ 8000px 사이
  const width = clampNum(r.width, 120 / k, 8000 / k, 794 / k);
  const height = clampNum(r.height, 120 / k, 8000 / k, 1123 / k);
  return {
    preset: typeof r.preset === 'string' ? r.preset.slice(0, 40) : 'custom',
    width,
    height,
    unit,
    margin: clampNum(r.margin, 0, Math.min(width, height) / 3, 0),
    fontSize: clampNum(r.fontSize, 8, 96, 15),
  };
}

export interface NewDocument {
  id: string;
  title: string;
  emoji?: string;
  blocks?: SeedBlock[];
  /** 페이지 크기 (없으면 자유 형식) */
  page?: PageSetup | null;
  createdBy: string;
  createdAt?: number;
}

export function addDocument(doc: Y.Doc, d: NewDocument): YItem {
  const map = new Y.Map<unknown>();
  doc.transact(() => {
    getDocs(doc).set(d.id, map);
    map.set('id', d.id);
    map.set('title', d.title);
    map.set('emoji', d.emoji ?? '📄');
    map.set('createdAt', d.createdAt ?? Date.now());
    map.set('createdBy', d.createdBy);
    if (d.page) map.set('page', d.page);
    const fragment = new Y.XmlFragment();
    map.set('content', fragment);
    const blocks = d.blocks?.length ? d.blocks : [{ type: 'paragraph', text: '' } as SeedBlock];
    fragment.insert(0, blocks.map(blockToXml));
  });
  return map;
}

export interface NewBoard {
  id: string;
  name: string;
  background?: string;
  shapes?: Shape[];
  createdBy: string;
  createdAt?: number;
}

export function addBoard(doc: Y.Doc, b: NewBoard): YItem {
  const map = new Y.Map<unknown>();
  doc.transact(() => {
    getBoards(doc).set(b.id, map);
    map.set('id', b.id);
    map.set('name', b.name);
    map.set('background', b.background ?? '');
    map.set('createdAt', b.createdAt ?? Date.now());
    map.set('createdBy', b.createdBy);
    const shapes = new Y.Map<Shape>();
    map.set('shapes', shapes);
    for (const s of b.shapes ?? []) shapes.set(s.id, s);
  });
  return map;
}

/** Y.Map 목록을 생성 순서대로 정렬해 반환 */
export function sortedItems(map: Y.Map<YItem>): YItem[] {
  return Array.from(map.values()).sort(
    (a, b) => ((a.get('createdAt') as number) ?? 0) - ((b.get('createdAt') as number) ?? 0),
  );
}
