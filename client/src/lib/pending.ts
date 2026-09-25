import { useEffect, useSyncExternalStore } from 'react';
import type { JoinStatus, TemplateSummary } from '@shared/types';
import { useTemplates } from '../store/templates';
import { toast } from '../store/toasts';
import { api, ApiError } from './api';

/*
 * 승인이 필요한 초대 링크로 참여를 요청한 뒤 기다리는 목록.
 * 페이지를 닫아도 기억해 두었다가, 승인되면 대시보드에 바로 나타나게 한다.
 */

export interface PendingJoin {
  templateId: string;
  name: string;
  emoji: string;
  requestedAt: number;
}

const KEY = 'lt.pendingJoins';
const listeners = new Set<() => void>();
let cache: PendingJoin[] = read();

function read(): PendingJoin[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as PendingJoin[];
  } catch {
    return [];
  }
}

function write(list: PendingJoin[]) {
  cache = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 무시 */
  }
  listeners.forEach((fn) => fn());
}

export function addPending(p: PendingJoin) {
  write([p, ...cache.filter((x) => x.templateId !== p.templateId)]);
}

export function removePending(templateId: string) {
  write(cache.filter((x) => x.templateId !== templateId));
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

/** 승인 여부 확인. 승인되면 템플릿 목록에 추가 */
export async function checkPending(p: PendingJoin): Promise<JoinStatus | 'gone'> {
  try {
    const res = await api<{ status: JoinStatus }>('GET', `/templates/${p.templateId}/join-status`);
    if (res.status === 'approved') {
      const t = await api<{ template: TemplateSummary }>('GET', `/templates/${p.templateId}`);
      useTemplates.getState().upsertShared(t.template);
      removePending(p.templateId);
    } else if (res.status === 'denied') removePending(p.templateId);
    return res.status;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      removePending(p.templateId);
      return 'gone';
    }
    return 'pending';
  }
}

/** 대시보드에서 주기적으로 확인 */
export function usePendingWatcher() {
  const pending = usePendingJoins();
  useEffect(() => {
    if (!pending.length) return;
    const run = () =>
      pending.forEach((p) =>
        void checkPending(p).then((s) => {
          if (s === 'approved') toast.success('참여가 승인되었습니다', `${p.emoji} ${p.name}`);
          else if (s === 'denied') toast.warning('참여 요청이 거절되었습니다', `${p.emoji} ${p.name}`);
        }),
      );
    run();
    const t = setInterval(run, 15_000);
    return () => clearInterval(t);
  }, [pending]);
  return pending;
}
