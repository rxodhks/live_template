import type { AccountInfo, AuthConfig, EmailVerifyResult, OAuthProvider, PublicUser, SignupInfo } from '@shared/types';
import { useSession } from '../store/session';
import { toast } from '../store/toasts';
import { api, clearLegacy, legacyToken, setUnauthorizedHandler } from './api';
import { setIdbUser } from './idb';
import { runDeviceClear, scheduleDeviceClear } from './device';
import { backupPending } from './templateOps';
import { useTemplates } from '../store/templates';
import { useConnection } from '../store/connection';
import { confirmDialog } from '../components/ui';

/*
 * 로그인
 * ──────
 *  · 로그인은 서버가 HttpOnly 쿠키로 유지한다 (자바스크립트로 읽을 수 없음)
 *  · 서버에 연결할 수 없을 때도 개인 공간을 쓸 수 있도록, 마지막 로그인 정보를 이 기기에 남겨 둔다
 *  · 개인 공간 저장소는 계정마다 따로 쓴다 (같은 브라우저에서 다른 계정으로 로그인해도 섞이지 않게)
 */

const CACHE_KEY = 'lt.account';

type Cached = { user: PublicUser; account: AccountInfo | null };

function readCache(): Cached | null {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null') as Cached | null;
    return c?.user?.id ? c : null;
  } catch {
    return null;
  }
}

function writeCache(c: Cached | null): void {
  try {
    if (c) localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    /* 저장소를 쓸 수 없는 환경 */
  }
}

function enter(user: PublicUser, account: AccountInfo | null, offline = false): void {
  setIdbUser(user.id);
  writeCache({ user, account });
  useSession.getState().setAuthed(user, account, offline);
}

/** 앱 시작: 로그인 상태 확인 */
export async function bootSession(): Promise<void> {
  // 로그아웃하면서 예약해 둔 이 기기 데이터 정리 (저장소를 열기 전에)
  await runDeviceClear();
  try {
    const me = await api<{ user: PublicUser; account: AccountInfo }>('GET', '/me');
    enter(me.user, me.account);
  } catch (err) {
    const cached = readCache();
    // 네트워크 문제로 확인하지 못했을 때만 저장된 정보로 시작 (로그인이 풀린 경우는 다시 로그인)
    if (cached && (err as { status?: number }).status === 0) enter(cached.user, cached.account, true);
    else {
      writeCache(null);
      useSession.getState().setAnon();
    }
  }
}

/** 로그인(또는 가입)을 마친 직후 */
export async function completeLogin(user: PublicUser): Promise<void> {
  const me = await api<{ user: PublicUser; account: AccountInfo }>('GET', '/me').catch(() => ({ user, account: null }));
  enter(me.user, me.account);
}

/** 로그인 기능 이전에 이 브라우저로 참여한 협업 템플릿을 로그인한 계정으로 옮긴다 (한 번만) */
export async function claimLegacyAccount(): Promise<boolean> {
  const token = legacyToken();
  if (!token) {
    clearLegacy();
    return false;
  }
  try {
    const r = await api<{ merged: boolean; templates: number }>('POST', '/auth/claim', { token });
    clearLegacy();
    if (r.merged && r.templates > 0) toast.success('예전에 참여한 협업 템플릿을 옮겼습니다', `${r.templates}개의 템플릿을 이 계정에서 계속 쓸 수 있습니다.`);
    return r.merged;
  } catch (err) {
    // 서버에 연결할 수 없으면 다음에 다시 시도
    if ((err as { status?: number }).status !== 0) clearLegacy();
    return false;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 로그아웃: 클라우드에 모두 저장된 것을 확인한 뒤 이 기기에서 계정 데이터를 지운다.
 * 아직 올라가지 않은 데이터가 있으면 알리고, 그 데이터는 이 기기에 남겨 둔다 (다음 로그인 때 자동 백업).
 */
export async function logout(): Promise<void> {
  const me = useSession.getState().user;
  // 이 기기에만 있는 개인 템플릿을 먼저 백업하고, 저장 중인 변경이 서버에 닿을 때까지 잠깐 기다린다
  await backupPending().catch(() => 0);
  for (let i = 0; i < 24 && useConnection.getState().pending > 0; i++) await sleep(250);
  const templates = Object.values(useTemplates.getState().templates);
  const local = templates.filter((t) => t.mode === 'personal');
  const unsaved = useConnection.getState().pending > 0;
  if (local.length || unsaved) {
    const ok = await confirmDialog({
      title: '아직 클라우드에 저장되지 않은 내용이 있습니다',
      message: `${local.length ? `개인 템플릿 ${local.length}개가 아직 이 기기에만 있습니다. ` : ''}${
        unsaved ? '방금 고친 내용이 아직 저장 중입니다. ' : ''
      }로그아웃해도 이 내용은 이 기기에 남겨 두었다가, 다음에 로그인하면 자동으로 저장합니다.`,
      confirmText: '로그아웃',
    });
    if (!ok) return;
  }
  await api('POST', '/auth/logout').catch(() => {});
  writeCache(null);
  // 클라우드에 안전하게 있는 사본만 이 기기에서 지운다 (저장 중인 것이 있으면 문서 사본은 남긴다)
  if (me) scheduleDeviceClear(me.id, unsaved ? [] : templates.filter((t) => t.mode === 'shared').map((t) => t.id), local.length > 0 || unsaved);
  // 열려 있는 실시간 연결 · 문서를 모두 닫기 위해 새로 불러온다 (지우기는 다음 시작 때)
  window.location.assign('/login');
}

/** 다른 기기에서 로그아웃했거나 로그인 기간이 끝났을 때 */
let expiredNotified = false;
setUnauthorizedHandler(() => {
  const s = useSession.getState();
  if (s.status !== 'authed' || expiredNotified) return;
  expiredNotified = true;
  writeCache(null);
  toast.show({ kind: 'warning', title: '로그인이 만료되었습니다', message: '다시 로그인해 주세요.', duration: 4000 });
  const next = `${window.location.pathname}${window.location.search}`;
  setTimeout(() => window.location.assign(`/login?next=${encodeURIComponent(next)}`), 1200);
});

export async function updateProfile(draft: Omit<PublicUser, 'id'>): Promise<PublicUser> {
  const res = await api<{ user: PublicUser }>('PATCH', '/me', { ...draft, name: draft.name.trim() });
  const s = useSession.getState();
  s.setUser(res.user);
  writeCache({ user: res.user, account: s.account });
  return res.user;
}

/* 로그인 화면에서 쓰는 요청 */

export const fetchAuthConfig = () => api<AuthConfig>('GET', '/auth/config');

export const startEmailLogin = (email: string) =>
  api<{ ok: true; email: string; expiresAt: number; resendAfter: number; devCode?: string }>('POST', '/auth/email/start', { email });

export const verifyEmailLogin = (email: string, code: string) =>
  api<EmailVerifyResult & { user?: PublicUser }>('POST', '/auth/email/verify', { email, code });

export const fetchSignup = () => api<SignupInfo>('GET', '/auth/signup');

export const completeSignup = (draft: Omit<PublicUser, 'id'>) => api<{ user: PublicUser }>('POST', '/auth/signup', { ...draft, name: draft.name.trim() });

/** 외부 계정 로그인은 페이지 이동으로 시작한다 (서버가 구글 · 깃허브로 보낸다) */
export function startOAuth(provider: OAuthProvider, next: string): void {
  window.location.assign(`/api/auth/oauth/${provider}${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`);
}

/** 로그인 후 돌아갈 앱 내부 경로만 허용 */
export function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/login') || value.startsWith('/signup')) return '/';
  return value;
}
