import type { Editor } from '@tiptap/core';
import type { LanguageFn } from 'highlight.js';
import { createLowlight } from 'lowlight';

type Loader = () => Promise<{ default: LanguageFn }>;

/** lowlight `common`과 같은 언어 목록 — 문법은 필요할 때 언어별 청크로 불러온다 */
const LOADERS: Record<string, Loader> = {
  arduino: () => import('highlight.js/lib/languages/arduino'),
  bash: () => import('highlight.js/lib/languages/bash'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  css: () => import('highlight.js/lib/languages/css'),
  diff: () => import('highlight.js/lib/languages/diff'),
  go: () => import('highlight.js/lib/languages/go'),
  graphql: () => import('highlight.js/lib/languages/graphql'),
  ini: () => import('highlight.js/lib/languages/ini'),
  java: () => import('highlight.js/lib/languages/java'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  json: () => import('highlight.js/lib/languages/json'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  less: () => import('highlight.js/lib/languages/less'),
  lua: () => import('highlight.js/lib/languages/lua'),
  makefile: () => import('highlight.js/lib/languages/makefile'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  objectivec: () => import('highlight.js/lib/languages/objectivec'),
  perl: () => import('highlight.js/lib/languages/perl'),
  php: () => import('highlight.js/lib/languages/php'),
  'php-template': () => import('highlight.js/lib/languages/php-template'),
  plaintext: () => import('highlight.js/lib/languages/plaintext'),
  python: () => import('highlight.js/lib/languages/python'),
  'python-repl': () => import('highlight.js/lib/languages/python-repl'),
  r: () => import('highlight.js/lib/languages/r'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  rust: () => import('highlight.js/lib/languages/rust'),
  scss: () => import('highlight.js/lib/languages/scss'),
  shell: () => import('highlight.js/lib/languages/shell'),
  sql: () => import('highlight.js/lib/languages/sql'),
  swift: () => import('highlight.js/lib/languages/swift'),
  typescript: () => import('highlight.js/lib/languages/typescript'),
  vbnet: () => import('highlight.js/lib/languages/vbnet'),
  wasm: () => import('highlight.js/lib/languages/wasm'),
  xml: () => import('highlight.js/lib/languages/xml'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
};

/** 문법을 불러오기 전에도 알아봐야 하는 흔한 별칭 (불러온 뒤에는 lowlight가 별칭을 안다) */
const ALIASES: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', gyp: 'python',
  sh: 'bash', zsh: 'bash', console: 'shell',
  html: 'xml', xhtml: 'xml', svg: 'xml',
  yml: 'yaml', md: 'markdown', mkdown: 'markdown',
  'c++': 'cpp', cc: 'cpp', hpp: 'cpp', h: 'c',
  cs: 'csharp', 'c#': 'csharp',
  kt: 'kotlin', kts: 'kotlin',
  rb: 'ruby', rs: 'rust', golang: 'go', mk: 'makefile',
  toml: 'ini', gql: 'graphql', objc: 'objectivec', vb: 'vbnet',
  text: 'plaintext', txt: 'plaintext', patch: 'diff',
};

const base = createLowlight();
const pending = new Map<string, Promise<void>>();
/** 불러오기가 끝난 언어 (실패 포함) */
const settled = new Set<string>();
const editors = new Set<Editor>();

function load(name: string): Promise<void> {
  let p = pending.get(name);
  if (!p) {
    // 실패해도 다시 받지 않는다 (코드는 일반 텍스트로 남는다)
    p = LOADERS[name]().then(
      (m) => base.register(name, m.default),
      (err: unknown) => console.warn(`코드 강조 문법(${name})을 불러오지 못했습니다`, err),
    ).finally(() => settled.add(name));
    pending.set(name, p);
  }
  return p;
}

/** 불러온 문법으로 다시 칠하도록, 코드 블록이 있는 편집기마다 같은 속성으로 노드를 한 번 갱신한다 */
function refresh() {
  for (const editor of editors) {
    if (editor.isDestroyed) continue;
    const { tr } = editor.state;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'codeBlock') return true;
      tr.setNodeMarkup(pos, undefined, node.attrs);
      return false;
    });
    if (tr.docChanged) editor.view.dispatch(tr.setMeta('addToHistory', false));
  }
}

let refreshQueued = false;
function request(names: string[]) {
  const missing = names.filter((n) => !pending.has(n));
  if (!missing.length) return;
  void Promise.all(missing.map(load)).then(() => {
    // 여러 블록이 한꺼번에 요청해도 다시 칠하기는 한 번만
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      refresh();
    });
  });
}

function resolve(language: string): string | undefined {
  const id = language.toLowerCase();
  if (Object.hasOwn(LOADERS, id)) return id;
  return Object.hasOwn(ALIASES, id) ? ALIASES[id] : undefined;
}

const plain = (value: string) => ({ type: 'root' as const, children: [{ type: 'text' as const, value }], data: { language: undefined, relevance: 0 } });

/**
 * CodeBlockLowlight에 넘기는 lowlight — 문법이 아직 없으면 일반 텍스트로 두고 뒤에서 불러온 뒤 다시 칠한다.
 * 언어를 모르는 블록(자동 감지)은 lowlight `common` 전체를 불러와야 감지할 수 있다.
 */
export const lowlight = {
  listLanguages: () => base.listLanguages(),
  registered: (language: string) => base.registered(language) || resolve(language) !== undefined,
  highlight(language: string, value: string) {
    if (base.registered(language)) return base.highlight(language, value);
    const name = resolve(language);
    if (name) request([name]);
    return plain(value);
  },
  highlightAuto(value: string) {
    const all = Object.keys(LOADERS);
    if (all.every((n) => settled.has(n))) return base.highlightAuto(value);
    request(all);
    return plain(value);
  },
};

/** 문법을 다 불러오면 이 편집기의 코드 블록을 다시 칠한다 */
export function trackEditor(editor: Editor) {
  editors.add(editor);
}

export function untrackEditor(editor: Editor) {
  editors.delete(editor);
}
