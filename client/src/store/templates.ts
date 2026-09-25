import { create } from 'zustand';
import type { TemplateEntry, TemplateSummary, TimelineEvent } from '@shared/types';
import { api, errorMessage } from '../lib/api';
import { deleteDocDb, idbAll, idbDelete, idbPut } from '../lib/idb';
import { useSession } from './session';

/*
 * 템플릿 목록 = 개인 공간(이 브라우저) + 협업 공간(서버).
 * 협업 공간 목록도 브라우저에 사본을 남겨 오프라인에서도 열 수 있다.
 */

interface TemplatesState {
  templates: Record<string, TemplateEntry>;
  online: Record<string, string[]>;
  /** 승인 대기 중인 참여 요청 수 (편집자 이상) */
  requests: Record<string, number>;
  loaded: boolean;
  remoteError: string | null;
  load(): Promise<void>;
  refreshRemote(): Promise<void>;
  upsert(t: TemplateEntry): void;
  upsertShared(t: TemplateSummary): TemplateEntry;
  remove(id: string, opts?: { dropLocalCopy?: boolean }): void;
  setOnline(templateId: string, userIds: string[]): void;
  setRequests(templateId: string, count: number): void;
  touch(templateId: string, updatedAt?: number): void;
}

/** 개인 템플릿의 멤버 정보는 항상 현재 프로필 기준 */
function normalize(t: TemplateEntry): TemplateEntry {
  const me = useSession.getState().user;
  if (t.mode !== 'personal' || !me) return t;
  return { ...t, ownerId: me.id, myRole: 'owner', members: [{ user: me, role: 'owner', joinedAt: t.createdAt }] };
}

const persist = (t: TemplateEntry) => void idbPut('templates', t).catch(() => {});

export const useTemplates = create<TemplatesState>((set, get) => ({
  templates: {},
  online: {},
  requests: {},
  loaded: false,
  remoteError: null,

  load: async () => {
    const entries = await idbAll<TemplateEntry>('templates').catch(() => [] as TemplateEntry[]);
    set({ templates: Object.fromEntries(entries.map((t) => [t.id, normalize(t)])), loaded: true });
    await get().refreshRemote();
  },

  refreshRemote: async () => {
    if (useSession.getState().status !== 'authed') return;
    try {
      const res = await api<{ templates: TemplateSummary[]; online: Record<string, string[]>; requests: Record<string, number> }>('GET', '/templates');
      const serverIds = new Set(res.templates.map((t) => t.id));
      const next = { ...get().templates };
      for (const t of res.templates) {
        const entry: TemplateEntry = { ...t, mode: 'shared' };
        next[t.id] = entry;
        persist(entry);
      }
      // 서버에서 사라진 협업 템플릿 (삭제되었거나 내보내짐)
      for (const t of Object.values(next)) {
        if (t.mode === 'shared' && !serverIds.has(t.id)) {
          delete next[t.id];
          void idbDelete('templates', t.id).catch(() => {});
          deleteDocDb(t.id);
        }
      }
      set({ templates: next, online: res.online, requests: res.requests ?? {}, remoteError: null });
    } catch (err) {
      set({ remoteError: errorMessage(err) });
    }
  },

  upsert: (t) => {
    const entry = normalize(t);
    persist(entry);
    set((s) => ({ templates: { ...s.templates, [t.id]: entry } }));
  },

  upsertShared: (t) => {
    const entry: TemplateEntry = { ...t, mode: 'shared' };
    get().upsert(entry);
    return entry;
  },

  remove: (id, opts = {}) => {
    void idbDelete('templates', id).catch(() => {});
    if (opts.dropLocalCopy) deleteDocDb(id);
    set((s) => {
      const templates = { ...s.templates };
      delete templates[id];
      return { templates };
    });
  },

  setOnline: (templateId, userIds) => set((s) => ({ online: { ...s.online, [templateId]: userIds } })),
  setRequests: (templateId, count) => set((s) => ({ requests: { ...s.requests, [templateId]: count } })),

  touch: (templateId, updatedAt = Date.now()) => {
    const t = get().templates[templateId];
    if (!t || updatedAt <= t.updatedAt) return;
    get().upsert({ ...t, updatedAt });
  },
}));

/* 실시간 타임라인 이벤트 구독 (타임라인 페이지/개요 화면이 사용) */
type TimelineListener = (payload: { event: TimelineEvent; merged: boolean }) => void;
const timelineListeners = new Set<TimelineListener>();

export function onTimelineEvent(fn: TimelineListener): () => void {
  timelineListeners.add(fn);
  return () => timelineListeners.delete(fn);
}

export function dispatchTimelineEvent(payload: { event: TimelineEvent; merged: boolean }): void {
  for (const fn of timelineListeners) fn(payload);
}
