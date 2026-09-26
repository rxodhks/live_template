import type * as Y from 'yjs';
import { getFiles, getLanguage } from '@shared/schema';

export interface OutputLine {
  id: number;
  level: 'log' | 'info' | 'warn' | 'error' | 'system';
  text: string;
  /** SQL 결과 같은 표 */
  table?: { columns: string[]; rows: unknown[][]; total: number };
  /** 미리보기 화면의 console · 오류 */
  fromPreview?: boolean;
}

let lineSeq = 0;
export const line = (level: OutputLine['level'], text: string): OutputLine => ({ id: ++lineSeq, level, text });

/* ───────── HTML 미리보기: 템플릿의 CSS · SCSS · JS · TS 파일을 합쳐 하나의 문서로 ───────── */

const PREVIEW_CONSOLE = `<script>(function(){var p=function(l,a){try{parent.postMessage({__ltPreview:true,level:l,text:Array.prototype.map.call(a,function(x){try{return typeof x==='string'?x:JSON.stringify(x)}catch(e){return String(x)}}).join(' ')},'*')}catch(e){}};['log','info','warn','error'].forEach(function(l){var o=console[l];console[l]=function(){p(l,arguments);o&&o.apply(console,arguments)}});window.addEventListener('error',function(e){p('error',[e.message])});})();<\/script>`;

/*
 * 미리보기 멈춤 감지 — 미리보기 문서가 0.5초마다 신호를 보낸다.
 * 무한 반복 등으로 신호가 끊기면 화면이 미리보기를 없애 멈춘 스크립트를 끝낸다.
 * alert · confirm · prompt 창이 떠 있는 동안에는 신호가 끊겨도 기다린다.
 */
const PREVIEW_WATCHDOG = `<script>(function(){var b=function(m){try{parent.postMessage({__ltBeat:m||1},'*')}catch(e){}};b();setInterval(b,500);['alert','confirm','prompt'].forEach(function(k){var o=window[k];if(typeof o!=='function')return;window[k]=function(){b('modal');try{return o.apply(window,arguments)}finally{b()}}})})();<\/script>`;

/** 미리보기 문서 맨 앞(head 안)에 멈춤 감지 신호를 넣는다 */
export function withPreviewWatchdog(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => `${m}${PREVIEW_WATCHDOG}`);
  if (/<!doctype[^>]*>/i.test(html)) return html.replace(/<!doctype[^>]*>/i, (m) => `${m}${PREVIEW_WATCHDOG}`);
  return PREVIEW_WATCHDOG + html;
}

export function hasHtml(doc: Y.Doc): boolean {
  return Array.from(getFiles(doc).values()).some((f) => getLanguage(f.get('language') as string).id === 'html');
}

type PreviewFile = { id: string; name: string; lang: string; content: string };

/** 미리보기에 쓸 HTML 파일: 지금 보고 있는 HTML → index.html → 첫 HTML 파일 */
function pickHtml<T extends Omit<PreviewFile, 'content'>>(files: T[], preferredHtmlId?: string | null): T | undefined {
  return (
    files.find((f) => f.id === preferredHtmlId && f.lang === 'html') ??
    files.find((f) => f.lang === 'html' && f.name.toLowerCase() === 'index.html') ??
    files.find((f) => f.lang === 'html')
  );
}

export function htmlEntryName(doc: Y.Doc): string | null {
  const files = Array.from(getFiles(doc).values()).map((f) => ({ id: f.get('id') as string, name: String(f.get('name')), lang: getLanguage(f.get('language') as string).id }));
  return pickHtml(files)?.name ?? null;
}

export interface PreviewExtras {
  /** SCSS 파일 이름 → 변환된 CSS */
  scss?: Record<string, string>;
  /** TypeScript 파일 이름 → 변환된 JavaScript */
  ts?: Record<string, string>;
}

export function buildPreview(doc: Y.Doc, preferredHtmlId?: string | null, extras: PreviewExtras = {}): string | null {
  const files: PreviewFile[] = Array.from(getFiles(doc).values()).map((f) => ({
    id: f.get('id') as string,
    name: String(f.get('name')),
    lang: getLanguage(f.get('language') as string).id,
    content: String((f.get('content') as Y.Text).toString()),
  }));
  const html = pickHtml(files, preferredHtmlId);
  if (!html) return null;
  let out = html.content;
  const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headExtra: string[] = [PREVIEW_CONSOLE];
  const bodyExtra: string[] = [];
  // HTML이 로컬 CSS/JS 파일을 직접 연결했으면 연결한 파일만 넣고, 하나도 연결하지 않았을 때만 모든 CSS/JS를 자동으로 붙인다
  const linksLocal = (attr: 'href' | 'src') => files.some((f) => new RegExp(`${attr}=["']\\.?/?${escapeRe(f.name)}["']`, 'i').test(html.content));
  const autoCss = !linksLocal('href');
  const autoJs = !linksLocal('src');
  for (const f of files) {
    const css = f.lang === 'css' ? f.content : f.lang === 'scss' ? extras.scss?.[f.name] : undefined;
    if (css !== undefined) {
      const re = new RegExp(`<link[^>]*href=["']\\.?/?${escapeRe(f.name)}["'][^>]*>`, 'i');
      const tag = `<style data-file="${f.name}">\n${css.replace(/<\/style/gi, '<\\/style')}\n</style>`;
      if (re.test(out)) out = out.replace(re, () => tag);
      // SCSS는 연결한 경우에만 넣는다 (부분 파일이 섞여 들어가지 않게)
      else if (f.lang === 'css' && autoCss) headExtra.push(tag);
    }
    const js = f.lang === 'javascript' ? f.content : f.lang === 'typescript' ? extras.ts?.[f.name] : undefined;
    if (js !== undefined) {
      const re = new RegExp(`<script([^>]*)src=["']\\.?/?${escapeRe(f.name)}["']([^>]*)>\\s*</script>`, 'i');
      const safe = js.replace(/<\/script/gi, '<\\/script');
      const m = re.exec(out);
      const module = m && /type=["']module["']/i.test(m[1] + m[2]);
      const tag = `<script data-file="${f.name}"${module ? ' type="module"' : ''}>\n${safe}\n</script>`;
      if (m) out = out.replace(re, () => tag);
      else if (f.lang === 'javascript' && autoJs) bodyExtra.push(tag);
    }
  }
  out = /<head[^>]*>/i.test(out) ? out.replace(/<head[^>]*>/i, (m) => `${m}\n${headExtra.join('\n')}`) : headExtra.join('\n') + out;
  out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, () => `${bodyExtra.join('\n')}\n</body>`) : out + bodyExtra.join('\n');
  return out;
}
