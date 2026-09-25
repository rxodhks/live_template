import type { TimelineEvent } from '@shared/types';
import { useSession } from '../store/session';
import { useTemplates } from '../store/templates';
import { api } from './api';
import { type TimelineQuery, queryLocalTimeline } from './local';

type Page = { events: TimelineEvent[]; hasMore: boolean };

function params(q: TimelineQuery): string {
  const p = new URLSearchParams({ limit: String(q.limit ?? 50) });
  if (q.userId) p.set('userId', q.userId);
  if (q.module) p.set('module', q.module);
  if (q.q?.trim()) p.set('q', q.q.trim());
  if (q.before) p.set('before', String(q.before));
  return p.toString();
}

/**
 * 타임라인 조회
 *  · 템플릿 하나: 개인 공간이면 브라우저 기록, 협업 공간이면 서버 기록
 *  · 전체: 개인 공간 기록 + 협업 공간 기록을 시간순으로 합친다
 */
export async function queryTimeline(templateId: string | undefined, q: TimelineQuery): Promise<Page> {
  const templates = useTemplates.getState().templates;
  if (templateId) {
    if (templates[templateId]?.mode === 'shared') return api<Page>('GET', `/templates/${templateId}/timeline?${params(q)}`);
    return queryLocalTimeline([templateId], q);
  }
  const limit = q.limit ?? 50;
  const personal = Object.values(templates)
    .filter((t) => t.mode === 'personal')
    .map((t) => t.id);
  const [local, remote] = await Promise.all([
    queryLocalTimeline(personal, q),
    useSession.getState().hasAccount ? api<Page>('GET', `/timeline?${params(q)}`).catch(() => ({ events: [], hasMore: false })) : { events: [], hasMore: false },
  ]);
  const merged = [...local.events, ...remote.events].sort((a, b) => b.at - a.at);
  return { events: merged.slice(0, limit), hasMore: local.hasMore || remote.hasMore || merged.length > limit };
}
