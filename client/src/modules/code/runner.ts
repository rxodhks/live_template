import type * as Y from 'yjs';
import { getFiles, getLanguage } from '@shared/schema';

export interface OutputLine {
  id: number;
  level: 'log' | 'info' | 'warn' | 'error' | 'system';
  text: string;
}

let lineSeq = 0;
export const line = (level: OutputLine['level'], text: string): OutputLine => ({ id: ++lineSeq, level, text });

/* 워커 안에서 실행될 코드: console을 가로채 부모에게 전달 */
const WORKER_PRELUDE = `
const fmt = (v, depth = 0) => {
  if (typeof v === 'string') return depth ? JSON.stringify(v) : v;
  if (typeof v === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
  if (v instanceof Error) return v.name + ': ' + v.message;
  if (typeof v === 'bigint') return v + 'n';
  if (v === undefined) return 'undefined';
  try {
    const seen = new WeakSet();
    return JSON.stringify(v, (k, x) => {
      if (typeof x === 'object' && x !== null) { if (seen.has(x)) return '[Circular]'; seen.add(x); }
      if (typeof x === 'bigint') return x + 'n';
      if (typeof x === 'function') return '[Function]';
      return x;
    }, 2);
  } catch { return String(v); }
};
const send = (level, args) => postMessage({ level, text: args.map((a) => fmt(a)).join(' ') });
console.log = (...a) => send('log', a);
console.info = (...a) => send('info', a);
console.debug = (...a) => send('log', a);
console.warn = (...a) => send('warn', a);
console.error = (...a) => send('error', a);
console.table = (d) => send('log', [d]);
self.onerror = (msg) => { send('error', [String(msg)]); return true; };
self.onunhandledrejection = (e) => send('error', ['Unhandled Promise rejection: ' + fmt(e.reason)]);
`;

/**
 * JavaScript를 Web Worker에서 격리 실행한다.
 * DOM에는 접근할 수 없고, 5초가 지나면 강제 종료된다.
 */
const PRELUDE_LINES = WORKER_PRELUDE.split('\n').length + 1;

export function runJavaScript(code: string, onLine: (l: OutputLine) => void, timeoutMs = 5000): () => void {
  const source = `${WORKER_PRELUDE}\n;(async () => {\n${code}\n})().then(() => postMessage({ done: true }), (e) => { send('error', [e]); postMessage({ done: true }); });`;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  const worker = new Worker(url);
  const started = performance.now();
  let finished = false;
  const finish = (msg: string, level: OutputLine['level'] = 'system') => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    worker.terminate();
    URL.revokeObjectURL(url);
    onLine(line(level, msg));
  };
  const timer = setTimeout(() => finish(`⏱ ${timeoutMs / 1000}초 제한을 넘어 실행을 중단했습니다.`, 'warn'), timeoutMs);
  worker.onmessage = (e: MessageEvent<{ level?: OutputLine['level']; text?: string; done?: boolean }>) => {
    if (e.data.done) finish(`✓ 실행 완료 (${Math.round(performance.now() - started)}ms)`);
    else if (e.data.level) onLine(line(e.data.level, e.data.text ?? ''));
  };
  worker.onerror = (e) => {
    e.preventDefault();
    const userLine = e.lineno ? e.lineno - PRELUDE_LINES : 0;
    onLine(line('error', `${e.message}${userLine > 0 ? ` (줄 ${userLine})` : ''}`));
    finish('✗ 오류로 종료되었습니다.');
  };
  return () => finish('■ 실행을 중지했습니다.');
}

/* ───────── HTML 미리보기: 템플릿의 CSS/JS 파일을 합쳐 하나의 문서로 ───────── */

const PREVIEW_CONSOLE = `<script>(function(){var p=function(l,a){try{parent.postMessage({__ltPreview:true,level:l,text:Array.prototype.map.call(a,function(x){try{return typeof x==='string'?x:JSON.stringify(x)}catch(e){return String(x)}}).join(' ')},'*')}catch(e){}};['log','info','warn','error'].forEach(function(l){var o=console[l];console[l]=function(){p(l,arguments);o&&o.apply(console,arguments)}});window.addEventListener('error',function(e){p('error',[e.message])});})();<\/script>`;

export function hasHtml(doc: Y.Doc): boolean {
  return Array.from(getFiles(doc).values()).some((f) => getLanguage(f.get('language') as string).id === 'html');
}

export function buildPreview(doc: Y.Doc, preferredHtmlId?: string | null): string | null {
  const files = Array.from(getFiles(doc).values()).map((f) => ({
    id: f.get('id') as string,
    name: String(f.get('name')),
    lang: getLanguage(f.get('language') as string).id,
    content: String((f.get('content') as Y.Text).toString()),
  }));
  const html =
    files.find((f) => f.id === preferredHtmlId && f.lang === 'html') ??
    files.find((f) => f.lang === 'html' && f.name.toLowerCase() === 'index.html') ??
    files.find((f) => f.lang === 'html');
  if (!html) return null;
  let out = html.content;
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headExtra: string[] = [PREVIEW_CONSOLE];
  const bodyExtra: string[] = [];
  for (const f of files) {
    if (f.lang === 'css') {
      const re = new RegExp(`<link[^>]*href=["']\\.?/?${escapeRe(f.name)}["'][^>]*>`, 'i');
      const tag = `<style data-file="${f.name}">\n${f.content}\n</style>`;
      if (re.test(out)) out = out.replace(re, () => tag);
      else headExtra.push(tag);
    }
    if (f.lang === 'javascript') {
      const re = new RegExp(`<script[^>]*src=["']\\.?/?${escapeRe(f.name)}["'][^>]*>\\s*</script>`, 'i');
      const safe = f.content.replace(/<\/script/gi, '<\\/script');
      const tag = `<script data-file="${f.name}">\n${safe}\n</script>`;
      if (re.test(out)) out = out.replace(re, () => tag);
      else bodyExtra.push(tag);
    }
  }
  out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (m) => `${m}\n${headExtra.join('\n')}`) : headExtra.join('\n') + out;
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, () => `${bodyExtra.join('\n')}\n</body>`) : out + bodyExtra.join('\n');
  return out;
}
