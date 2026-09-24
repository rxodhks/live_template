import type { ActivityType, PublicUser, TimelineEvent } from '../../shared/types.js';
import { ACTIVITY, COALESCE_WINDOW_MS } from '../../shared/activity.js';
import { config } from './config.js';
import { JsonFile, dataPath } from './store.js';
import { newId } from './util.js';

/* 템플릿별 활동 기록. 편집처럼 잦은 활동은 같은 사용자·대상 기준으로 5분 안에서 하나로 합친다. */

const files = new Map<string, JsonFile<TimelineEvent[]>>();

function fileFor(templateId: string): JsonFile<TimelineEvent[]> {
  let f = files.get(templateId);
  if (!f) {
    f = new JsonFile<TimelineEvent[]>(dataPath('timeline', `${templateId}.json`), () => []);
    files.set(templateId, f);
  }
  return f;
}

export interface RecordInput {
  templateId: string;
  templateName: string;
  user: PublicUser;
  type: ActivityType;
  targetId?: string;
  targetName?: string;
  detail?: string;
  at?: number;
}

/** 기록 후 { event, merged } 반환. merged=true면 기존 이벤트가 갱신된 것 */
export function recordActivity(input: RecordInput): { event: TimelineEvent; merged: boolean } {
  const def = ACTIVITY[input.type];
  const f = fileFor(input.templateId);
  const list = f.data;
  const at = input.at ?? Date.now();
  const text = def.text(input.targetName ?? '', input.detail ?? '');

  if (def.coalesce) {
    // 최근 이벤트 중 같은 사용자·타입·대상을 찾는다 (최근 30개만 확인)
    for (let i = list.length - 1; i >= Math.max(0, list.length - 30); i--) {
      const e = list[i];
      if (at - e.at > COALESCE_WINDOW_MS) break;
      if (e.user.id === input.user.id && e.type === input.type && e.targetId === input.targetId) {
        e.count += 1;
        e.at = at;
        e.text = text;
        e.user = input.user;
        e.targetName = input.targetName;
        if (input.detail) e.detail = input.detail;
        // 최신 이벤트가 목록 끝에 오도록 이동
        list.splice(i, 1);
        list.push(e);
        f.save();
        return { event: e, merged: true };
      }
    }
  }

  const event: TimelineEvent = {
    id: newId(),
    templateId: input.templateId,
    templateName: input.templateName,
    user: input.user,
    type: input.type,
    module: def.module,
    targetId: input.targetId,
    targetName: input.targetName,
    detail: input.detail,
    text,
    at,
    count: 1,
    important: Boolean(def.important),
  };
  list.push(event);
  if (list.length > config.timelineLimit) list.splice(0, list.length - config.timelineLimit);
  f.save();
  return { event, merged: false };
}

export interface TimelineQuery {
  templateIds: string[];
  userId?: string;
  module?: string;
  before?: number;
  limit?: number;
  q?: string;
}

export function queryTimeline(query: TimelineQuery): { events: TimelineEvent[]; hasMore: boolean } {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const needle = query.q?.trim().toLowerCase();
  const all: TimelineEvent[] = [];
  for (const id of query.templateIds) {
    for (const e of fileFor(id).data) {
      if (query.before && e.at >= query.before) continue;
      if (query.userId && e.user.id !== query.userId) continue;
      if (query.module && e.module !== query.module) continue;
      if (
        needle &&
        !`${e.user.name} ${e.text} ${e.templateName} ${e.targetName ?? ''}`.toLowerCase().includes(needle)
      )
        continue;
      all.push(e);
    }
  }
  all.sort((a, b) => b.at - a.at);
  return { events: all.slice(0, limit), hasMore: all.length > limit };
}

/** 템플릿 이름이 바뀌면 기록의 템플릿 이름도 맞춰 준다 */
export function renameTemplateInTimeline(templateId: string, name: string): void {
  const f = fileFor(templateId);
  for (const e of f.data) e.templateName = name;
  f.save();
}

export function deleteTimeline(templateId: string): void {
  fileFor(templateId).delete();
  files.delete(templateId);
}
