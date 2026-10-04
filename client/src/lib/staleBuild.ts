/*
 * 배포 전에 열어 둔 탭 — 화면 파일 이름에는 내용 해시가 붙어서, 새 버전이 배포되면 예전 탭이 찾는 파일이 사라진다.
 * 그 파일을 못 불러오면 새 버전이 있는지 확인하고 한 번 새로고침한다.
 *  · 새 버전이 없으면(연결이 잠시 끊긴 경우 등) 새로고침하지 않고 오류를 그대로 보여 준다
 *  · 새로고침은 30초에 한 번까지 (같은 오류로 계속 새로고침되지 않게)
 */

const RELOADED_AT = 'madang.staleReloadAt';
const RELOAD_GAP_MS = 30_000;

/** 화면 파일(지연 로딩되는 JS · CSS)을 불러오지 못한 오류인지 — 브라우저마다 문구가 다르다 */
export const isChunkError = (err: unknown): boolean =>
  err instanceof Error &&
  /dynamically imported module|Importing a module script failed|error loading dynamically|is not a valid JavaScript MIME type|Unable to preload CSS/i.test(err.message);

/** 지금 화면의 진입 파일 (/assets/index-<해시>.js) */
const entryOf = (html: string) => html.match(/\/assets\/index-[\w-]+\.js/)?.[0] ?? null;
const currentEntry = () => document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')?.getAttribute('src') ?? null;

let checking: Promise<boolean> | null = null;

/** 새 버전이 배포됐으면 새로고침한다. 새로고침하면 true */
export function reloadIfNewVersion(): Promise<boolean> {
  return (checking ??= check().finally(() => (checking = null)));
}

async function check(): Promise<boolean> {
  const current = currentEntry();
  if (!current || !navigator.onLine) return false; // 개발 서버이거나 오프라인
  try {
    const last = Number(sessionStorage.getItem(RELOADED_AT)) || 0;
    if (Date.now() - last < RELOAD_GAP_MS) return false;
  } catch {
    /* 저장소를 못 쓰면 확인 없이 진행 */
  }
  try {
    const res = await fetch('/', { cache: 'no-store', credentials: 'same-origin' });
    const latest = res.ok ? entryOf(await res.text()) : null;
    if (!latest || latest === current) return false;
  } catch {
    return false;
  }
  try {
    sessionStorage.setItem(RELOADED_AT, String(Date.now()));
  } catch {
    /* 무시 */
  }
  window.location.reload();
  return true;
}

/** 화면 파일을 못 불러온 오류가 어디서 나든 새 버전을 확인한다 */
export function installStaleBuildRecovery(): void {
  // Vite가 감싼 import()가 실패하면 알려 준다 (CSS 미리 받기 실패 포함)
  window.addEventListener('vite:preloadError', () => void reloadIfNewVersion());
  window.addEventListener('unhandledrejection', (ev) => {
    if (isChunkError(ev.reason)) void reloadIfNewVersion();
  });
}
