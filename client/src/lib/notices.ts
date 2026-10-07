import { useEffect, useSyncExternalStore } from 'react';
import type { Notice } from '@shared/notices';

/*
 * 공지사항 — 빌드 때 만든 /notices.json 을 한 번 받아 쓴다 (서버 API 없음)
 *  - 날짜가 아직 오지 않은 글은 숨긴다 (예약 게시, 한국 시간 기준)
 *  - 읽은 글 · 닫은 배너는 이 기기에만 기억한다
 */

const READ_KEY = 'lt.notices.read';
const HIDDEN_KEY = 'lt.notices.hidden';
/** 처음 쓰는 기기에서는 이보다 오래된 글을 읽은 것으로 본다 (새 소식 점이 옛 글로 켜지지 않게) */
const FRESH_DAYS = 14;

/** 오늘 날짜 (한국 시간) YYYY-MM-DD */
export const todayKST = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

function readSet(key: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? new Set(JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}
function writeSet(key: string, s: Set<string>) {
  try {
    localStorage.setItem(key, JSON.stringify([...s].slice(-200)));
  } catch {
    /* 저장 못 해도 이번 화면에서는 기억한다 */
  }
}

interface State {
  list: Notice[] | null;
  failed: boolean;
  read: Set<string>;
  hidden: Set<string>;
}
let state: State = { list: null, failed: false, read: readSet(READ_KEY) ?? new Set(), hidden: readSet(HIDDEN_KEY) ?? new Set() };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));

let loading: Promise<void> | null = null;
export function loadNotices(): Promise<void> {
  loading ??= fetch('/notices.json')
    .then((r) => (r.ok ? (r.json() as Promise<Notice[]>) : Promise.reject(new Error(String(r.status)))))
    .then((all) => {
      const today = todayKST();
      const list = all.filter((n) => n.date <= today);
      // 이 기기에서 처음이면 오래된 글은 읽은 것으로
      if (readSet(READ_KEY) === null) {
        const cut = new Date(Date.now() + 9 * 3600_000 - FRESH_DAYS * 86400_000).toISOString().slice(0, 10);
        const read = new Set(list.filter((n) => n.date < cut).map((n) => n.id));
        writeSet(READ_KEY, read);
        set({ list, read });
      } else set({ list });
    })
    .catch(() => {
      loading = null;
      set({ failed: true });
    });
  return loading;
}

/** 공지 목록 · 읽음 상태. 처음 쓰일 때 받아 온다 */
export function useNotices() {
  const s = useSyncExternalStore(subscribe, () => state);
  useEffect(() => void loadNotices(), []);
  return s;
}

export function markRead(ids: string[]) {
  if (ids.every((id) => state.read.has(id))) return;
  const read = new Set(state.read);
  for (const id of ids) read.add(id);
  writeSet(READ_KEY, read);
  set({ read });
}

export function hideBanner(id: string) {
  const hidden = new Set(state.hidden);
  hidden.add(id);
  writeSet(HIDDEN_KEY, hidden);
  set({ hidden });
}

/** 홈에 띄울 배너 (가장 최근 하나) */
export function bannerOf(s: State): Notice | undefined {
  const today = todayKST();
  return s.list?.find((n) => n.pin && !s.hidden.has(n.id) && (!n.until || today <= n.until));
}
