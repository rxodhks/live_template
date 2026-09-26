import type * as Y from 'yjs';
import { getFiles, getLanguage, type YItem } from '@shared/schema';
import { buildPreview, line, type OutputLine } from './runner';
import { runInSandbox, type TableOutput } from './sandbox';
import { RUNTIMES, isRuntimeCached, loadRuntimeText, runtimeSizeMB, type RuntimeId } from './runtimes';
import jsWorker from './sandbox/js.js?raw';
import pythonWorker from './sandbox/python.js?raw';
import sqlWorker from './sandbox/sql.js?raw';
import luaWorker from './sandbox/lua.js?raw';
import rubyWorker from './sandbox/ruby.js?raw';
import phpWorker from './sandbox/php.js?raw';

/*
 * 언어별 실행 방법 (모두 브라우저 안에서 — 서버 비용 없음)
 *  - 실행: JavaScript · TypeScript · Python · SQL · Lua · Ruby · PHP (격리된 샌드박스)
 *  - 미리보기: HTML(+CSS/JS) · JSX/TSX(React 컴포넌트) · Markdown
 *  - 검사/변환: JSON · YAML(형식 검사) · SCSS(CSS로 변환)
 *  - 그 밖의 컴파일 언어(C · Java · Go · Rust …)는 서버 실행이 필요해 아직 지원하지 않는다
 */

export type ExecMode = 'run' | 'preview' | 'check' | 'convert' | 'none';

export interface ExecInfo {
  mode: ExecMode;
  label: string;
  runtime?: RuntimeId;
  /** ‘입력’ 칸(표준 입력)을 쓰는 언어 */
  stdin?: boolean;
  timeoutMs?: number;
}

const RUNNERS: Record<string, ExecInfo & { worker?: string }> = {
  javascript: { mode: 'run', label: '실행', worker: jsWorker, timeoutMs: 5000 },
  typescript: { mode: 'run', label: '실행', worker: jsWorker, timeoutMs: 5000 },
  python: { mode: 'run', label: '실행', runtime: 'python', worker: pythonWorker, stdin: true, timeoutMs: 15000 },
  sql: { mode: 'run', label: '실행', runtime: 'sql', worker: sqlWorker, timeoutMs: 10000 },
  lua: { mode: 'run', label: '실행', runtime: 'lua', worker: luaWorker, stdin: true, timeoutMs: 10000 },
  ruby: { mode: 'run', label: '실행', runtime: 'ruby', worker: rubyWorker, stdin: true, timeoutMs: 15000 },
  php: { mode: 'run', label: '실행', runtime: 'php', worker: phpWorker, stdin: true, timeoutMs: 15000 },
  jsx: { mode: 'preview', label: '미리보기', runtime: 'react' },
  tsx: { mode: 'preview', label: '미리보기', runtime: 'react' },
  html: { mode: 'preview', label: '미리보기' },
  css: { mode: 'preview', label: '미리보기' },
  markdown: { mode: 'preview', label: '미리보기' },
  json: { mode: 'check', label: '검사' },
  yaml: { mode: 'check', label: '검사' },
  scss: { mode: 'convert', label: 'CSS로 변환' },
};

export function execInfo(langId: string): ExecInfo {
  const r = RUNNERS[langId];
  return r ? { mode: r.mode, label: r.label, runtime: r.runtime, stdin: r.stdin, timeoutMs: r.timeoutMs } : { mode: 'none', label: '실행' };
}

/** 실행할 수 없는 언어 안내 */
export function unsupportedMessage(langName: string): OutputLine[] {
  return [
    line('system', `${langName}은(는) 아직 사이트 안에서 실행할 수 없습니다.`),
    line('info', '컴파일이 필요한 언어(C · C++ · Java · Go · Rust · Kotlin · Swift · C# · Shell)는 서버 실행 환경이 필요해 준비 중입니다. 코드를 내려받아 로컬에서 실행해 보세요.'),
    line('info', '사이트 안에서 바로 실행: JavaScript · TypeScript · Python · SQL · Lua · Ruby · PHP / 미리보기: HTML · JSX · TSX · Markdown / 검사 · 변환: JSON · YAML · SCSS'),
  ];
}

type FileEntry = { name: string; lang: string; content: string };

function allFiles(doc: Y.Doc): FileEntry[] {
  return Array.from(getFiles(doc).values()).map((f) => ({
    name: String(f.get('name')),
    lang: String(f.get('language')),
    content: (f.get('content') as Y.Text).toString(),
  }));
}

/* ───────────── JavaScript · TypeScript · JSX 변환 (sucrase, 필요할 때만 불러옴) ───────────── */

const SCRIPT_LANGS = new Set(['javascript', 'typescript', 'jsx', 'tsx']);

/** 템플릿의 스크립트 파일을 모두 CommonJS로 변환 (다른 파일 import 지원). 문법 오류는 그 파일을 불러올 때 알린다 */
export async function transpileModules(doc: Y.Doc): Promise<Record<string, string>> {
  const { transform } = await import('sucrase');
  const modules: Record<string, string> = {};
  for (const f of allFiles(doc)) {
    if (f.lang === 'json') {
      modules[f.name] = f.content;
      continue;
    }
    if (!SCRIPT_LANGS.has(f.lang)) continue;
    const transforms: ('typescript' | 'jsx' | 'imports')[] = ['imports'];
    if (f.lang === 'typescript' || f.lang === 'tsx') transforms.push('typescript');
    if (f.lang === 'jsx' || f.lang === 'tsx') transforms.push('jsx');
    try {
      modules[f.name] = transform(f.content, { transforms, filePath: f.name, production: true, jsxRuntime: 'classic', preserveDynamicImport: false }).code;
    } catch (err) {
      const e = err as Error & { loc?: { line: number; column: number } };
      const where = e.loc ? ` (${f.name}:${e.loc.line}:${e.loc.column + 1})` : ` (${f.name})`;
      modules[f.name] = `throw new SyntaxError(${JSON.stringify(e.message.replace(/\s*\(\d+:\d+\)$/, '') + where)});`;
    }
  }
  return modules;
}

/* ───────────── 실행 ───────────── */

export interface ExecCallbacks {
  onLine(l: OutputLine): void;
  onTable(t: TableOutput): void;
  onStatus(s: string | null): void;
  onEnd(ok: boolean): void;
}

/** 파일을 실행하고 중지 함수를 돌려준다 */
export async function executeFile(doc: Y.Doc, file: YItem, stdin: string, cb: ExecCallbacks): Promise<() => void> {
  const name = String(file.get('name'));
  const lang = getLanguage(file.get('language') as string);
  const r = RUNNERS[lang.id];
  if (!r?.worker) {
    cb.onEnd(false);
    return () => {};
  }
  const files = allFiles(doc);
  const same = (exts: string[]) => Object.fromEntries(files.filter((f) => exts.includes(f.lang)).map((f) => [f.name, f.content]));
  let payload: Record<string, unknown>;
  switch (lang.id) {
    case 'javascript':
    case 'typescript':
      payload = { entry: name, modules: await transpileModules(doc) };
      break;
    case 'sql': {
      // schema · seed · init 이름의 다른 .sql 파일은 먼저 실행한다 (테이블 · 샘플 데이터 준비)
      const setup = files
        .filter((f) => f.lang === 'sql' && f.name !== name && /^(schema|seed|init|setup|create|data)/i.test(f.name))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => ({ name: f.name, code: f.content }));
      payload = { name, code: String((file.get('content') as Y.Text).toString()), setup };
      break;
    }
    case 'python':
      payload = { entry: name, files: same(['python']), stdin, cdn: `https://cdn.jsdelivr.net/pyodide/v${RUNTIMES.python.version}/full/` };
      break;
    default:
      payload = { entry: name, files: same([lang.id]), stdin };
  }
  if (r.runtime && !(await isRuntimeCached(r.runtime))) {
    cb.onLine(line('info', `${lang.name} 실행 환경을 처음 한 번 내려받습니다 (약 ${runtimeSizeMB(r.runtime)}MB). 이후에는 바로 실행됩니다.`));
  }
  return runInSandbox({
    worker: r.worker,
    payload,
    runtime: r.runtime,
    timeoutMs: r.timeoutMs ?? 10000,
    onLine: cb.onLine,
    onTable: cb.onTable,
    onStatus: cb.onStatus,
    onEnd: cb.onEnd,
  });
}

/* ───────────── JSX · TSX 미리보기 (React 컴포넌트) ───────────── */

const PREVIEW_CONSOLE = `<script>(function(){var p=function(l,a){try{parent.postMessage({__ltPreview:true,level:l,text:Array.prototype.map.call(a,function(x){try{return typeof x==='string'?x:JSON.stringify(x)}catch(e){return String(x)}}).join(' ')},'*')}catch(e){}};['log','info','warn','error'].forEach(function(l){var o=console[l];console[l]=function(){p(l,arguments);o&&o.apply(console,arguments)}});window.addEventListener('error',function(e){p('error',[e.message])});window.addEventListener('unhandledrejection',function(e){p('error',[String(e.reason&&e.reason.message||e.reason)])});})();<\/script>`;

/**
 * React 컴포넌트 미리보기 HTML
 *  - 파일이 export default 한 컴포넌트(없으면 App)를 #root에 그린다
 *  - 템플릿의 다른 JS/TS/JSX/TSX · CSS 파일을 불러올 수 있다 (react · react-dom은 기본 제공)
 */
export async function buildReactPreview(doc: Y.Doc, entry: string): Promise<string> {
  const [modules, react] = await Promise.all([transpileModules(doc), loadRuntimeText('react', 'react.js')]);
  const css = allFiles(doc)
    .filter((f) => f.lang === 'css')
    .map((f) => `<style data-file="${f.name.replace(/"/g, '')}">\n${f.content.replace(/<\/style/gi, '<\\/style')}\n</style>`)
    .join('\n');
  const boot = `
(function () {
  var modules = ${JSON.stringify(modules).replace(/<\/script/gi, '<\\/script')};
  var EXT = ['', '.tsx', '.ts', '.jsx', '.js', '.json'];
  var builtin = { 'react': React, 'react-dom': ReactDOM, 'react-dom/client': ReactDOM, 'react/jsx-runtime': ReactJSXRuntime };
  var cache = {};
  function resolve(spec) {
    var base = spec.replace(/^(\\.\\.?\\/)+/, '').replace(/^\\//, '');
    for (var i = 0; i < EXT.length; i++) if (modules[base + EXT[i]] !== undefined) return base + EXT[i];
    var noJs = base.replace(/\\.(m|c)?js$/, '');
    if (modules[noJs + '.ts'] !== undefined) return noJs + '.ts';
    if (modules[noJs + '.tsx'] !== undefined) return noJs + '.tsx';
    return null;
  }
  function req(spec) {
    if (builtin[spec]) return builtin[spec];
    if (/\\.css$/.test(spec)) return {};
    if (spec.charAt(0) !== '.' && spec.charAt(0) !== '/') throw new Error("외부 패키지 '" + spec + "'는 미리보기에서 불러올 수 없습니다 (react · react-dom만 기본 제공)");
    var name = resolve(spec);
    if (!name) throw new Error("'" + spec + "' 파일을 찾을 수 없습니다");
    if (cache[name]) return cache[name].exports;
    var mod = { exports: {} };
    cache[name] = mod;
    if (/\\.json$/.test(name)) { mod.exports = JSON.parse(modules[name]); return mod.exports; }
    new Function('exports', 'require', 'module', 'React', modules[name] + '\\n//# sourceURL=' + encodeURI(name))(mod.exports, req, mod, React);
    return mod.exports;
  }
  try {
    var exp = req('./' + ${JSON.stringify(entry)});
    var Comp = exp && (exp.default || exp.App);
    var root = document.getElementById('root');
    if (typeof Comp === 'function' || (Comp && typeof Comp === 'object' && Comp.$$typeof)) {
      if (!root.hasChildNodes()) ReactDOM.createRoot(root).render(React.createElement(Comp));
    } else if (!root.hasChildNodes() && !document.body.dataset.rendered) {
      root.innerHTML = '<p style="font:14px system-ui;color:#888;padding:16px">export default 로 내보낸 컴포넌트(또는 App)가 없습니다. 예) export default function App() { return &lt;h1&gt;안녕하세요&lt;/h1&gt; }</p>';
    }
  } catch (e) {
    console.error(e && e.message ? e.message : e);
    document.getElementById('root').innerHTML = '<pre style="color:#dc2626;white-space:pre-wrap;font:13px ui-monospace,monospace;padding:16px"></pre>';
    document.querySelector('#root pre').textContent = String(e && e.message ? e.message : e);
  }
})();`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${PREVIEW_CONSOLE}
<style>body{margin:16px;font-family:system-ui,-apple-system,'Segoe UI','Apple SD Gothic Neo','Malgun Gothic',sans-serif}</style>${css}</head>
<body><div id="root"></div><script>${react.replace(/<\/script/gi, '<\\/script')}<\/script><script>${boot}<\/script></body></html>`;
}

/* ───────────── Markdown 미리보기 ───────────── */

export async function buildMarkdownPreview(text: string): Promise<string> {
  const { marked } = await import('marked');
  const html = await marked.parse(text, { gfm: true, breaks: false });
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:24px 28px;font:15px/1.7 system-ui,-apple-system,'Segoe UI','Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#1f2328;max-width:860px}
  @media (prefers-color-scheme: dark){body{background:#0d1117;color:#e6edf3}a{color:#58a6ff}code,pre{background:#161b22!important}th,td{border-color:#30363d!important}blockquote{color:#9198a1!important;border-color:#30363d!important}}
  h1,h2{border-bottom:1px solid #d1d9e066;padding-bottom:.3em}code{background:#f0f2f5;padding:.15em .35em;border-radius:5px;font:.9em ui-monospace,SFMono-Regular,Menlo,monospace}
  pre{background:#f6f8fa;padding:14px 16px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}
  blockquote{margin:0;padding:0 1em;color:#59636e;border-left:.25em solid #d1d9e0}table{border-collapse:collapse}th,td{border:1px solid #d1d9e0;padding:6px 13px}img{max-width:100%}
  </style></head><body>${html}</body></html>`;
}

/* ───────────── JSON · YAML 검사, SCSS 변환 ───────────── */

export interface CheckResult {
  lines: OutputLine[];
  /** 정리된 결과 (JSON 들여쓰기 · YAML → JSON · SCSS → CSS) */
  formatted?: { title: string; text: string };
}

export async function checkFile(langId: string, name: string, text: string): Promise<CheckResult> {
  if (langId === 'json') {
    if (!text.trim()) return { lines: [line('warn', '내용이 비어 있습니다.')] };
    try {
      const v = JSON.parse(text);
      const kind = Array.isArray(v) ? `배열 · ${v.length}개 항목` : v && typeof v === 'object' ? `객체 · 키 ${Object.keys(v).length}개` : typeof v;
      return { lines: [line('system', `✓ 올바른 JSON입니다 (${kind})`)], formatted: { title: '정리된 JSON', text: JSON.stringify(v, null, 2) } };
    } catch (err) {
      const msg = (err as Error).message;
      const pos = /position (\d+)/.exec(msg);
      let where = '';
      if (pos) {
        const before = text.slice(0, Number(pos[1]));
        where = ` (${before.split('\n').length}번째 줄, ${before.length - before.lastIndexOf('\n')}번째 글자)`;
      }
      return { lines: [line('error', `JSON 형식 오류${where}: ${msg}`)] };
    }
  }
  if (langId === 'yaml') {
    const { parseAllDocuments } = await import('yaml');
    const docs = parseAllDocuments(text, { prettyErrors: true });
    const errors = docs.flatMap((d) => d.errors);
    if (errors.length) return { lines: errors.map((e) => line('error', `YAML 형식 오류: ${e.message}`)) };
    const values = docs.map((d) => d.toJS({ maxAliasCount: 100 }));
    const v = values.length === 1 ? values[0] : values;
    return {
      lines: [line('system', `✓ 올바른 YAML입니다${docs.length > 1 ? ` (문서 ${docs.length}개)` : ''}`)],
      formatted: { title: 'JSON으로 본 내용', text: JSON.stringify(v, null, 2) ?? 'null' },
    };
  }
  if (langId === 'scss') {
    const css = await compileScss(text, name);
    return css.ok
      ? { lines: [line('system', `✓ CSS로 변환했습니다 (${css.text.split('\n').length}줄)`)], formatted: { title: '변환된 CSS', text: css.text } }
      : { lines: [line('error', css.text)] };
  }
  return { lines: [] };
}

let sassWorker: Worker | null = null;
let sassSeq = 0;

/** SCSS → CSS (Sass를 별도 워커에서 — 무한 반복(@while)이 있어도 화면이 멈추지 않는다) */
export function compileScss(text: string, name: string): Promise<{ ok: boolean; text: string }> {
  return new Promise((resolve) => {
    if (!sassWorker) sassWorker = new Worker(new URL('./scss.worker.ts', import.meta.url), { type: 'module' });
    const worker = sassWorker;
    const id = ++sassSeq;
    const timer = setTimeout(() => {
      worker.terminate();
      sassWorker = null;
      worker.removeEventListener('message', onMsg);
      resolve({ ok: false, text: 'SCSS 변환이 10초 안에 끝나지 않아 중단했습니다 (무한 반복을 확인해 보세요).' });
    }, 10_000);
    const onMsg = (e: MessageEvent) => {
      if (e.data?.id !== id) return;
      clearTimeout(timer);
      worker.removeEventListener('message', onMsg);
      resolve({ ok: e.data.ok, text: e.data.text });
    };
    worker.addEventListener('message', onMsg);
    worker.postMessage({ id, text, name });
  });
}

/** HTML 미리보기에 SCSS 파일을 CSS로 바꿔 넣는다 */
export async function scssForPreview(doc: Y.Doc): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of allFiles(doc).filter((x) => x.lang === 'scss')) {
    const r = await compileScss(f.content, f.name);
    out[f.name] = r.ok ? r.text : `/* ${f.name}: ${r.text.replace(/\*\//g, '* /')} */`;
  }
  return out;
}

/** HTML 미리보기 — 연결한 SCSS는 CSS로, TypeScript는 JavaScript로 바꿔 넣는다 */
export async function buildHtmlPreview(doc: Y.Doc, preferredHtmlId: string | null): Promise<string | null> {
  const files = allFiles(doc);
  const scss = files.some((f) => f.lang === 'scss') ? await scssForPreview(doc) : undefined;
  let ts: Record<string, string> | undefined;
  if (files.some((f) => f.lang === 'typescript')) {
    const { transform } = await import('sucrase');
    ts = {};
    for (const f of files.filter((x) => x.lang === 'typescript')) {
      try {
        ts[f.name] = transform(f.content, { transforms: ['typescript'], filePath: f.name }).code;
      } catch (err) {
        ts[f.name] = `console.error(${JSON.stringify(`${f.name}: ${(err as Error).message}`)});`;
      }
    }
  }
  return buildPreview(doc, preferredHtmlId, { scss, ts });
}
