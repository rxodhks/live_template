import prelude from './sandbox/prelude.js?raw';
import { line, type OutputLine } from './runner';
import { loadRuntime, type RuntimeId } from './runtimes';

/*
 * 격리된 샌드박스에서 코드 실행
 *  - origin이 없는(opaque) iframe(allow-scripts만) 안의 Web Worker에서 실행 → 이 앱의 저장소 · 로그인 · DOM에 접근할 수 없다
 *  - 실행 환경 파일(파이썬 등)은 이 앱이 받아 두었다가 샌드박스로 넘긴다
 *  - 무한 루프도 화면을 멈추지 않으며, 제한 시간이 지나거나 ‘중지’하면 iframe째 없애 강제 종료한다
 */

export interface TableOutput {
  columns: string[];
  rows: unknown[][];
  total: number;
  note?: string;
}

export interface SandboxRun {
  /** 워커에서 실행할 코드 (main(payload)를 정의한다) */
  worker: string;
  payload: Record<string, unknown>;
  runtime?: RuntimeId;
  /** 실행 환경 준비가 끝난 뒤의 제한 시간 */
  timeoutMs: number;
  onLine(l: OutputLine): void;
  onTable?(t: TableOutput): void;
  /** 준비 상태 (내려받는 중 42% 등). null이면 상태 표시를 지운다 */
  onStatus?(s: string | null): void;
  /** 실행이 끝나면 (정상 · 오류 · 중지 · 시간 초과 모두) 한 번 */
  onEnd?(ok: boolean): void;
}

const SANDBOX_HTML = `<!doctype html><meta charset="utf-8"><script>
var w = null;
addEventListener('message', function (e) {
  var d = e.data;
  if (!d || d.__lt !== 'start' || w) return;
  try {
    var url = URL.createObjectURL(new Blob([d.source], { type: 'text/javascript' }));
    w = new Worker(url);
    w.onmessage = function (m) { parent.postMessage({ __ltRun: true, data: m.data }, '*'); };
    w.onerror = function (err) { err.preventDefault(); parent.postMessage({ __ltRun: true, error: { message: err.message, lineno: err.lineno } }, '*'); };
    var files = d.files || {};
    w.postMessage({ files: files, payload: d.payload }, Object.keys(files).map(function (k) { return files[k]; }));
  } catch (err) { parent.postMessage({ __ltRun: true, error: { message: String(err) } }, '*'); }
});
parent.postMessage({ __ltRun: true, ready: true }, '*');
<\/script>`;

/** 워커 코드에서 사용자 코드가 시작되는 줄 (오류 줄 번호 보정용) */
export const PRELUDE_LINES = prelude.split('\n').length;

export function runInSandbox(run: SandboxRun): () => void {
  let finished = false;
  let iframe: HTMLIFrameElement | null = null;
  let execTimer: ReturnType<typeof setTimeout> | undefined;
  let setupTimer: ReturnType<typeof setTimeout> | undefined;
  let onReady: ((e: MessageEvent) => void) | null = null;
  const started = performance.now();

  const finish = (ok: boolean, msg?: string, level: OutputLine['level'] = 'system') => {
    if (finished) return;
    finished = true;
    clearTimeout(execTimer);
    clearTimeout(setupTimer);
    window.removeEventListener('message', onMessage);
    if (onReady) window.removeEventListener('message', onReady);
    iframe?.remove();
    run.onStatus?.(null);
    if (msg) run.onLine(line(level, msg));
    run.onEnd?.(ok);
  };

  const onMessage = (e: MessageEvent) => {
    if (!iframe || e.source !== iframe.contentWindow) return;
    const d = e.data as { __ltRun?: boolean; ready?: boolean; error?: { message: string; lineno?: number }; data?: Record<string, unknown> };
    if (!d?.__ltRun) return;
    if (d.error) {
      run.onLine(line('error', d.error.message));
      finish(false, '■ 실행 중 오류로 종료되었습니다');
      return;
    }
    const m = d.data;
    if (!m) return;
    switch (m.t) {
      case 'out':
        run.onLine(line(m.level as OutputLine['level'], String(m.text)));
        break;
      case 'table':
        run.onTable?.(m as unknown as TableOutput);
        break;
      case 'status':
        run.onStatus?.(String(m.text));
        break;
      case 'ready':
        // 실행 환경 준비가 끝났다 — 여기서부터 사용자 코드의 제한 시간
        clearTimeout(setupTimer);
        run.onStatus?.(null);
        execTimer = setTimeout(() => finish(false, `⏱ ${Math.round(run.timeoutMs / 1000)}초가 지나 실행을 중단했습니다 (무한 반복을 확인해 보세요)`, 'warn'), run.timeoutMs);
        break;
      case 'done': {
        const ms = typeof m.ms === 'number' ? m.ms : Math.round(performance.now() - started);
        finish(Boolean(m.ok), m.ok ? `✓ 실행 완료 · ${ms}ms` : '■ 오류로 종료되었습니다');
        break;
      }
    }
  };

  const start = async () => {
    let files: Record<string, ArrayBuffer> = {};
    if (run.runtime) {
      run.onStatus?.('실행 환경 확인 중…');
      try {
        files = await loadRuntime(run.runtime, (loaded, total) => {
          if (!finished) run.onStatus?.(`실행 환경 내려받는 중… ${Math.floor((loaded / total) * 100)}% (${(total / 1024 / 1024).toFixed(1)}MB · 처음 한 번만)`);
        });
      } catch (err) {
        finish(false, `실행 환경을 불러오지 못했습니다: ${err instanceof Error ? err.message : String(err)}`, 'error');
        return;
      }
      if (finished) return;
      run.onStatus?.('실행 환경 준비 중…');
    }
    iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('tabindex', '-1');
    iframe.style.display = 'none';
    iframe.srcdoc = SANDBOX_HTML;
    const source = `${prelude}\n${run.worker}`;
    onReady = (e: MessageEvent) => {
      if (e.source !== iframe?.contentWindow || !(e.data as { ready?: boolean })?.ready) return;
      window.removeEventListener('message', onReady!);
      iframe.contentWindow!.postMessage({ __lt: 'start', source, files, payload: run.payload }, '*', Object.values(files));
    };
    window.addEventListener('message', onReady);
    window.addEventListener('message', onMessage);
    // 실행 환경 준비(파이썬 초기화 등)가 너무 오래 걸리면 중단
    setupTimer = setTimeout(() => finish(false, '실행 환경 준비가 너무 오래 걸려 중단했습니다. 다시 시도해 주세요.', 'error'), 90_000);
    document.body.appendChild(iframe);
  };
  void start();

  return () => finish(false, '■ 실행을 중지했습니다', 'warn');
}
