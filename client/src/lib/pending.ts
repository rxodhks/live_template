import { useEffect, useSyncExternalStore } from 'react';
import type { JoinStatus, MyJoinRequest, TemplateSummary } from '@shared/types';
import { useTemplates } from '../store/templates';
import { toast } from '../store/toasts';
import { api, ApiError } from './api';

/*
 * 승인이 필요한 초대 링크로 보낸 참여 요청.
 * 서버가 계정별로 기억하므로(이 브라우저에 저장하지 않음) 다른 기기에서도, 같은 브라우저의 다른 계정과도 섞이지 않는다.
 */

export type PendingJoin = Pick<MyJoinRequest, 'templateId' | 'name' | 'emoji' | 'requestedAt'>;

const listeners = new Set<() => void>();
let cache: PendingJoin[] = [];
/** 이번 접속 중에 대기 중으로 본 요청 — 승인 · 거절로 바뀌면 알린다 */
const seenPending = new Set<string>();

function set(list: PendingJoin[]) {
  cache = list;
  listeners.forEach((fn) => fn());
}

// 예전 버전이 이 브라우저에 남긴 목록은 계정 구분이 없으므로 지운다
try {
  localStorage.removeItem('lt.pendingJoins');
} catch {
  /* 무시 */
}

/** 서버에서 내 참여 요청을 다시 받아 온다 */
export async function refreshPending(): Promise<void> {
  let requests: MyJoinRequest[];
  try {
    requests = (await api<{ requests: MyJoinRequest[] }>('GET', '/me/requests')).requests;
  } catch {
    return;
  }
  let approved = false;
  for (const r of requests) {
    if (r.status === 'pending') seenPending.add(r.templateId);
    else if (seenPending.delete(r.templateId)) {
      if (r.status === 'approved') {
        approved = true;
        toast.success('참여가 승인되었습니다', `${r.emoji} ${r.name}`);
      } else if (r.status === 'denied') toast.warning('참여 요청이 거절되었습니다', `${r.emoji} ${r.name}`);
    }
  }
  set(requests.filter((r) => r.status === 'pending'));
  if (approved) await useTemplates.getState().refreshRemote();
}

/** 방금 요청을 보냈을 때 (서버 목록을 기다리지 않고 바로 표시) */
export function addPending(p: PendingJoin) {
  seenPending.add(p.templateId);
  set([p, ...cache.filter((x) => x.templateId !== p.templateId)]);
  void refreshPending();
}

export function usePendingJoins(): PendingJoin[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => cache,
  );
}

/** 승인 여부 확인 (초대장 화면). 승인되면 템플릿 목록에 추가 */
export async function checkPending(p: PendingJoin): Promise<JoinStatus | 'gone'> {
  try {
    const res = await api<{ status: JoinStatus }>('GET', `/templates/${p.templateId}/join-status`);
    if (res.status === 'approved') {
      const t = await api<{ template: TemplateSummary }>('GET', `/templates/${p.templateId}`);
      useTemplates.getState().upsertShared(t.template);
      seenPending.delete(p.templateId);
      set(cache.filter((x) => x.templateId !== p.templateId));
    } else if (res.status === 'denied') {
      seenPending.delete(p.templateId);
      set(cache.filter((x) => x.templateId !== p.templateId));
    }
    return res.status;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      set(cache.filter((x) => x.templateId !== p.templateId));
      return 'gone';
    }
    return 'pending';
  }
}

/** 대시보드: 서버의 요청 목록을 불러오고, 대기 중인 요청이 있으면 주기적으로 확인 */
export function usePendingWatcher() {
  const pending = usePendingJoins();
  useEffect(() => {
    void refreshPending();
  }, []);
  useEffect(() => {
    if (!pending.length) return;
    const t = setInterval(() => void refreshPending(), 15_000);
    return () => clearInterval(t);
  }, [pending.length]);
  return pending;
}
