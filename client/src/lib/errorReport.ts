import { CLIENT_VERSION_HEADER, CLIENT_VERSION } from '@shared/protocol';
import { apiUrl } from './api';

/*
 * 화면 오류 보고 — 사용자 브라우저에서 처리되지 않은 오류를 서버 로그(Workers Logs)로 보낸다.
 * 테스터가 "안 돼요"라고만 해도 무슨 일이 있었는지 볼 수 있게.
 *  · 같은 오류는 한 번만, 페이지를 열 때마다 최대 20개까지, 2초씩 모아서 보낸다
 *  · 확장 프로그램이 낸 오류 · 브라우저가 내는 의미 없는 경고는 뺀다
 */

const MAX_PER_PAGE = 20;
const IGNORE = [/ResizeObserver loop/i, /^Script error\.?$/i, /extension:\/\//i];

type Report = { message: string; stack: string; page: string; at: number };

const seen = new Set<string>();
const recent: string[] = [];
let queue: Report[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let sent = 0;

/** 최근에 난 오류 메시지 (피드백에 함께 싣는다) */
export const recentErrors = (): string[] => recent.slice(-5);

export function reportError(err: unknown): void {
  const e = err instanceof Error ? err : null;
  const message = (e ? `${e.name}: ${e.message}` : String(err)).slice(0, 500);
  const stack = (e?.stack ?? '').slice(0, 2000);
  if (!message || IGNORE.some((re) => re.test(message) || re.test(stack))) return;
  if (seen.has(message)) return;
  seen.add(message);
  recent.push(message);
  if (sent >= MAX_PER_PAGE) return;
  sent++;
  queue.push({ message, stack, page: window.location.pathname, at: Date.now() });
  timer ??= setTimeout(flush, 2000);
}

function flush(): void {
  timer = null;
  const errors = queue;
  queue = [];
  if (!errors.length) return;
  void fetch(apiUrl('/client-errors'), {
    method: 'POST',
    credentials: 'same-origin',
    keepalive: true,
    headers: { 'content-type': 'application/json', [CLIENT_VERSION_HEADER]: String(CLIENT_VERSION) },
    body: JSON.stringify({ errors }),
  }).catch(() => {});
}

export function installErrorReporting(): void {
  window.addEventListener('error', (ev) => reportError(ev.error ?? ev.message));
  window.addEventListener('unhandledrejection', (ev) => reportError(ev.reason));
  // 탭을 닫거나 다른 곳으로 갈 때 모아 둔 것을 바로 보낸다
  window.addEventListener('pagehide', () => {
    if (timer) clearTimeout(timer);
    flush();
  });
}
