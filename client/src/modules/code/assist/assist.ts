/*
 * 코드 검사(오류 밑줄) · 자동 정렬 — 모두 브라우저 안에서, 필요할 때만 불러온다
 *  - JS · TS · JSX · TSX 검사: TypeScript 언어 서비스 (워커)
 *  - 파이썬 검사 · 정렬: Ruff (워커, 웹어셈블리)
 *  - 그 밖의 정렬: Prettier (JS · TS · CSS · SCSS · HTML · JSON · YAML · Markdown)
 */
import type { AssistDiagnostic, CheckRequest, CompleteRequest, CompleteResult, DetailRequest } from './protocol';

export type { AssistDiagnostic } from './protocol';

const TS_LANGS = new Set(['javascript', 'typescript', 'jsx', 'tsx']);
const CHECK_LANGS = new Set([...TS_LANGS, 'python']);
const PRETTIER_LANGS = new Set([...TS_LANGS, 'css', 'scss', 'html', 'json', 'yaml', 'markdown']);

/** 오류 밑줄을 보여 줄 수 있는 언어 */
export const canCheck = (lang: string) => CHECK_LANGS.has(lang);
/** 자동 정렬할 수 있는 언어 */
export const canFormat = (lang: string) => PRETTIER_LANGS.has(lang) || lang === 'python';
/** 검사할 때 함께 넘길 파일 (import 를 따라가는 언어끼리) */
export const checkGroup = (lang: string) => (TS_LANGS.has(lang) ? TS_LANGS : new Set([lang]));

type Reply = {
  id: number;
  diagnostics?: AssistDiagnostic[];
  formatted?: string;
  completions?: CompleteResult;
  detail?: { detail: string; doc: string } | null;
  error?: string;
};

class WorkerClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve(r: Reply): void; reject(e: Error): void }>();
  constructor(private create: () => Worker) {}

  call(msg: Record<string, unknown>): Promise<Reply> {
    if (!this.worker) {
      const w = this.create();
      w.onmessage = (e: MessageEvent<Reply>) => {
        const p = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        if (!p) return;
        if (e.data.error) p.reject(new Error(e.data.error));
        else p.resolve(e.data);
      };
      // 워커 파일을 못 불러오면 (배포 직후 옛 화면 등) 기다리던 요청을 모두 실패로 끝내고 다음에 새로 만든다
      w.onerror = (e) => {
        e.preventDefault();
        for (const p of this.pending.values()) p.reject(new Error('코드 검사 도구를 불러오지 못했습니다'));
        this.pending.clear();
        w.terminate();
        if (this.worker === w) this.worker = null;
      };
      this.worker = w;
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, ...msg });
    });
  }
}

const tsWorker = new WorkerClient(() => new Worker(new URL('./ts.worker.ts', import.meta.url), { type: 'module', name: 'ts-check' }));
const pyWorker = new WorkerClient(() => new Worker(new URL('./py.worker.ts', import.meta.url), { type: 'module', name: 'py-check' }));

/** 파일 하나 검사 */
export async function checkCode(lang: string, req: CheckRequest): Promise<AssistDiagnostic[]> {
  if (TS_LANGS.has(lang)) return (await tsWorker.call({ req })).diagnostics ?? [];
  if (lang === 'python') return (await pyWorker.call({ req })).diagnostics ?? [];
  return [];
}

/** 자동 완성 (JS · TS · JSX · TSX) — TypeScript 언어 서비스 */
export const canComplete = (lang: string) => TS_LANGS.has(lang);
export async function completeCode(req: CompleteRequest): Promise<CompleteResult> {
  return (await tsWorker.call({ complete: req })).completions ?? { from: req.pos, items: [] };
}
export async function completionDetail(req: DetailRequest) {
  return (await tsWorker.call({ detail: req })).detail ?? null;
}

/** 자동 정렬 — 정렬된 코드를 돌려준다 (문법 오류가 있으면 예외) */
export async function formatCode(lang: string, name: string, text: string, tabWidth: number): Promise<string> {
  if (lang === 'python') return (await pyWorker.call({ format: text })).formatted ?? text;
  const { format, plugins, parser } = await prettierFor(lang);
  return format(text, { parser, plugins, tabWidth, printWidth: 100, filepath: name });
}

async function prettierFor(lang: string) {
  const [{ format }, estree] = await Promise.all([import('prettier/standalone'), import('prettier/plugins/estree')]);
  const babel = () => import('prettier/plugins/babel');
  const load = {
    javascript: () => [babel()],
    jsx: () => [babel()],
    json: () => [babel()],
    typescript: () => [import('prettier/plugins/typescript')],
    tsx: () => [import('prettier/plugins/typescript')],
    css: () => [import('prettier/plugins/postcss')],
    scss: () => [import('prettier/plugins/postcss')],
    // HTML 안의 <script> · <style> 도 정렬한다
    html: () => [import('prettier/plugins/html'), babel(), import('prettier/plugins/postcss')],
    yaml: () => [import('prettier/plugins/yaml')],
    markdown: () => [import('prettier/plugins/markdown'), babel(), import('prettier/plugins/postcss')],
  }[lang];
  if (!load) throw new Error('이 언어는 자동 정렬을 지원하지 않습니다');
  const parser = { javascript: 'babel', jsx: 'babel', json: 'json', typescript: 'typescript', tsx: 'typescript', css: 'css', scss: 'scss', html: 'html', yaml: 'yaml', markdown: 'markdown' }[lang]!;
  const plugins = (await Promise.all(load())).map((m) => ('default' in m ? m.default : m));
  return { format, plugins: [estree.default ?? estree, ...plugins], parser };
}

/** 정렬 오류 메시지를 짧게 (첫 줄 + 위치) */
export function formatError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.split('\n')[0];
}
