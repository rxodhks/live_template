import { create } from 'zustand';
import type { TemplateSummary, TimelineEvent } from '@shared/types';
import { api } from '../lib/api';

interface TemplatesState {
  templates: Record<string, TemplateSummary>;
  online: Record<string, string[]>;
  loaded: boolean;
  load(): Promise<void>;
  upsert(t: TemplateSummary): void;
  remove(id: string): void;
  setOnline(templateId: string, userIds: string[]): void;
  touch(templateId: string, updatedAt: number): void;
}

export const useTemplates = create<TemplatesState>((set) => ({
  templates: {},
  online: {},
  loaded: false,
  load: async () => {
    const res = await api<{ templates: TemplateSummary[]; online: Record<string, string[]> }>('GET', '/templates');
    set({ templates: Object.fromEntries(res.templates.map((t) => [t.id, t])), online: res.online, loaded: true });
  },
  upsert: (t) => set((s) => ({ templates: { ...s.templates, [t.id]: t } })),
  remove: (id) =>
    set((s) => {
      const templates = { ...s.templates };
      delete templates[id];
      return { templates };
    }),
  setOnline: (templateId, userIds) => set((s) => ({ online: { ...s.online, [templateId]: userIds } })),
  touch: (templateId, updatedAt) =>
    set((s) => {
      const t = s.templates[templateId];
      return t ? { templates: { ...s.templates, [templateId]: { ...t, updatedAt } } } : s;
    }),
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
