import type { PublicUser } from '@shared/types';
import { useSession } from '../store/session';
import { ApiError, api, getToken, setToken } from './api';
import { newId } from './util';

/*
 * 프로필과 협업 계정
 * ─────────────────
 *  · 처음에는 가입 없이 이 브라우저에만 프로필을 만든다 (개인 공간은 서버가 필요 없다)
 *  · 다른 사람을 초대하거나 초대를 받는 순간, 같은 프로필로 협업 서버 계정을 자동으로 만든다
 */

const PROFILE_KEY = 'lt.profile';

export type ProfileDraft = Omit<PublicUser, 'id'>;

export function loadProfile(): PublicUser | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    const p = raw ? (JSON.parse(raw) as PublicUser) : null;
    return p && typeof p.id === 'string' && typeof p.name === 'string' ? p : null;
  } catch {
    return null;
  }
}

function saveProfile(user: PublicUser): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(user));
  } catch {
    /* 저장소를 쓸 수 없는 환경 */
  }
  useSession.getState().setUser(user);
}

export function createLocalProfile(draft: ProfileDraft): PublicUser {
  const user: PublicUser = { id: newId(), ...draft, name: draft.name.trim() };
  saveProfile(user);
  return user;
}

export async function updateProfile(draft: ProfileDraft): Promise<PublicUser> {
  const current = useSession.getState().user!;
  let user: PublicUser = { ...current, ...draft, name: draft.name.trim() };
  if (getToken()) {
    const res = await api<{ user: PublicUser }>('PATCH', '/me', draft);
    user = res.user;
  }
  saveProfile(user);
  return user;
}

let accountPromise: Promise<PublicUser> | null = null;

/** 협업 서버 계정 준비 (없으면 지금 프로필로 만든다) */
export function ensureAccount(): Promise<PublicUser> {
  if (getToken()) return Promise.resolve(useSession.getState().user!);
  accountPromise ??= (async () => {
    try {
      const profile = useSession.getState().user!;
      const res = await api<{ user: PublicUser; token: string }>('POST', '/users', { name: profile.name, color: profile.color, avatar: profile.avatar });
      setToken(res.token);
      saveProfile(res.user);
      useSession.getState().setHasAccount(true);
      return res.user;
    } finally {
      accountPromise = null;
    }
  })();
  return accountPromise;
}

/** 앱 시작 시 저장된 계정 확인 (서버에 연결할 수 없으면 오프라인으로 계속) */
export async function verifyAccount(): Promise<void> {
  if (!getToken()) return;
  useSession.getState().setHasAccount(true);
  try {
    const res = await api<{ user: PublicUser }>('GET', '/me');
    const local = useSession.getState().user;
    // 다른 기기에서 바뀐 정보가 아니라면 이 브라우저의 프로필이 기준
    if (local && (local.name !== res.user.name || local.color !== res.user.color || local.avatar !== res.user.avatar)) {
      await api('PATCH', '/me', { name: local.name, color: local.color, avatar: local.avatar }).catch(() => {});
    }
    if (local && local.id !== res.user.id) saveProfile({ ...local, id: res.user.id });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      setToken(null);
      useSession.getState().setHasAccount(false);
    }
  }
}
