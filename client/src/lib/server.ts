/*
 * 협업 서버 주소
 * ──────────────
 * · 기본: 화면과 같은 주소의 서버 (npm start, Docker, Codespaces)
 * · GitHub Pages처럼 화면만 정적으로 배포한 경우: 서버 주소를 따로 지정한다
 *     1) 초대 링크의 ?server=... (받은 사람이 자동으로 같은 서버에 연결)
 *     2) 이 브라우저에 저장된 주소 (서버 연결 화면에서 입력)
 *     3) 빌드할 때 넣은 기본값 VITE_SERVER_URL
 */

const KEY = 'lt.server';

/** 앱이 배포된 경로 (GitHub Pages 프로젝트 사이트면 /저장소이름/) */
export const BASE_URL = import.meta.env.BASE_URL;
export const ROUTER_BASENAME = BASE_URL.replace(/\/$/, '') || '/';
export const IS_STATIC_HOST = import.meta.env.VITE_STATIC_HOST === '1';
export const REPO = import.meta.env.VITE_REPO ?? '';

export function normalizeServerUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readServerUrl(): string {
  const params = new URLSearchParams(window.location.search);
  const fromLink = params.get('server');
  if (fromLink !== null) {
    const normalized = normalizeServerUrl(fromLink);
    if (normalized) {
      try {
        localStorage.setItem(KEY, normalized);
      } catch {
        /* 무시 */
      }
    }
    // 주소창에서 파라미터를 지운다 (공유 시 깔끔하게)
    params.delete('server');
    const qs = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`);
    if (normalized) return normalized;
  }
  return safeGet(KEY) ?? normalizeServerUrl(import.meta.env.VITE_SERVER_URL ?? '') ?? '';
}

/** 비어 있으면 같은 주소(origin)의 서버 */
export const SERVER_URL = readServerUrl();

export const isExternalServer = (): boolean => !!SERVER_URL && SERVER_URL !== window.location.origin;

/** 서버가 필요한데 아직 정해지지 않았는지 (GitHub Pages 첫 방문) */
export const needsServerSetup = (): boolean => IS_STATIC_HOST && !SERVER_URL;

export const apiUrl = (path: string): string => `${SERVER_URL}/api${path}`;

export function saveServerUrl(url: string | null): void {
  try {
    if (url) localStorage.setItem(KEY, url);
    else localStorage.removeItem(KEY);
  } catch {
    /* 무시 */
  }
  // 소켓·문서·상태를 모두 새로 시작
  window.location.href = BASE_URL;
}

/** 서버마다 사용자 토큰을 따로 보관 (서버를 바꿔도 이전 서버의 프로필이 유지됨) */
export const TOKEN_KEY = isExternalServer() ? `lt.token@${SERVER_URL}` : 'lt.token';

/** 서버가 응답하는지 확인 */
export async function checkServer(url: string, timeoutMs = 8000): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url}/api/health`, { signal: ctrl.signal });
    const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return res.ok && !!data?.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** 라우터 기준 경로 (배포 경로 접두사 제거) */
export function appPathname(): string {
  const p = window.location.pathname;
  return ROUTER_BASENAME !== '/' && p.startsWith(ROUTER_BASENAME) ? p.slice(ROUTER_BASENAME.length) || '/' : p;
}

/** 다른 사람에게 보낼 앱 내부 링크 (외부 서버를 쓰면 서버 주소도 함께 담는다) */
export function shareUrl(path: string): string {
  const url = new URL(`${BASE_URL}${path.replace(/^\//, '')}`, window.location.origin);
  if (isExternalServer()) url.searchParams.set('server', SERVER_URL);
  return url.toString();
}
