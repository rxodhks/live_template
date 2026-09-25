import * as Y from 'yjs';
import { IndexeddbPersistence, storeState } from 'y-indexeddb';
import type { ActivityInput, EncryptedNote, Feature, PublicUser, ShareUpload, TemplateEntry, TimelineEvent } from '@shared/types';
import { ACTIVITY, COALESCE_WINDOW_MS } from '@shared/activity';
import { seedTemplateDoc } from '@shared/seed';
import { dispatchTimelineEvent, useTemplates } from '../store/templates';
import { deleteDocDb, docDbName, idbAll, idbByTemplate, idbDelete, idbDeleteByTemplate, idbPut } from './idb';
import { toB64 } from './crypto';
import { newId } from './util';

/*
 * 개인 공간 — 서버 없이 이 브라우저(IndexedDB)에만 저장된다.
 * 템플릿 · 타임라인 · 비밀 노트(암호화된 상태)를 모두 로컬에서 관리하고,
 * 다른 사람을 초대하는 순간 그대로 협업 공간(클라우드)으로 올린다.
 */

export interface LocalNote extends EncryptedNote {
  templateId: string;
}

const LOCAL_TIMELINE_LIMIT = 3000;

/* ───────────── 템플릿 ───────────── */

export function personalEntry(t: Omit<TemplateEntry, 'ownerId' | 'members' | 'myRole' | 'mode' | 'visibility'>, me: PublicUser): TemplateEntry {
  return { ...t, mode: 'personal', visibility: 'private', ownerId: me.id, members: [{ user: me, role: 'owner', joinedAt: t.createdAt }], myRole: 'owner' };
}

export async function createPersonalTemplate(
  input: { name: string; description: string; emoji: string; features: Feature[]; presetId: string },
  me: PublicUser,
): Promise<TemplateEntry> {
  const id = newId(16);
  const doc = new Y.Doc();
  const idb = new IndexeddbPersistence(docDbName(id), doc);
  await idb.whenSynced;
  seedTemplateDoc(doc, input.presetId, input.features, me.id, () => newId());
  await storeState(idb, true);
  await idb.destroy();
  doc.destroy();

  const now = Date.now();
  const entry = personalEntry(
    { id, name: input.name.trim().slice(0, 60), description: input.description.trim().slice(0, 200), emoji: input.emoji, features: input.features, createdAt: now, updatedAt: now },
    me,
  );
  await idbPut('templates', entry);
  useTemplates.getState().upsert(entry);
  await recordLocal(entry, me, { type: 'template.create', targetName: entry.name });
  return entry;
}

export async function saveEntry(entry: TemplateEntry): Promise<void> {
  await idbPut('templates', entry);
}

export async function loadEntries(): Promise<TemplateEntry[]> {
  return idbAll<TemplateEntry>('templates').catch(() => []);
}

/** 개인 템플릿 삭제 (내용 · 기록 · 노트 모두) */
export async function deleteLocalTemplate(id: string): Promise<void> {
  await idbDelete('templates', id);
  await idbDeleteByTemplate('timeline', id);
  await idbDeleteByTemplate('notes', id);
  recent.delete(id);
  deleteDocDb(id);
}

/* ───────────── 타임라인 ───────────── */

/** 합치기 계산용 최근 기록 (이번 세션) */
const recent = new Map<string, TimelineEvent[]>();

export async function recordLocal(template: { id: string; name: string }, user: PublicUser, input: ActivityInput): Promise<TimelineEvent> {
  const def = ACTIVITY[input.type];
  const text = def.text(input.targetName ?? '', input.detail ?? '');
  const at = Date.now();
  const list = recent.get(template.id) ?? [];
  if (def.coalesce) {
    const prev = list.find(
      (e) => e.type === input.type && e.user.id === user.id && (e.targetId ?? null) === (input.targetId ?? null) && at - e.at < COALESCE_WINDOW_MS,
    );
    if (prev) {
      Object.assign(prev, { count: prev.count + 1, at, text, targetName: input.targetName, user });
      if (input.detail) prev.detail = input.detail;
      await idbPut('timeline', prev);
      dispatchTimelineEvent({ event: { ...prev }, merged: true });
      return prev;
    }
  }
  const event: TimelineEvent = {
    id: newId(),
    templateId: template.id,
    templateName: template.name,
    user,
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
  recent.set(template.id, [event, ...list].slice(0, 30));
  await idbPut('timeline', event);
  dispatchTimelineEvent({ event, merged: false });
  if (Math.random() < 0.02) void pruneTimeline(template.id);
  return event;
}

async function pruneTimeline(templateId: string) {
  const events = await idbByTemplate<TimelineEvent>('timeline', templateId);
  if (events.length <= LOCAL_TIMELINE_LIMIT) return;
  events.sort((a, b) => b.at - a.at);
  await Promise.all(events.slice(LOCAL_TIMELINE_LIMIT).map((e) => idbDelete('timeline', e.id)));
}

export interface TimelineQuery {
  before?: number;
  limit?: number;
  userId?: string;
  module?: string;
  q?: string;
}

export async function queryLocalTimeline(templateIds: string[], q: TimelineQuery): Promise<{ events: TimelineEvent[]; hasMore: boolean }> {
  const limit = q.limit ?? 50;
  const needle = q.q?.trim().toLowerCase();
  const names = useTemplates.getState().templates;
  const all = (await Promise.all(templateIds.map((id) => idbByTemplate<TimelineEvent>('timeline', id)))).flat();
  const filtered = all
    .filter((e) => e.at < (q.before ?? Number.MAX_SAFE_INTEGER))
    .filter((e) => !q.userId || e.user.id === q.userId)
    .filter((e) => !q.module || e.module === q.module)
    .map((e) => ({ ...e, templateName: names[e.templateId]?.name ?? e.templateName }))
    .filter((e) => !needle || `${e.user.name} ${e.text} ${e.targetName ?? ''} ${e.templateName}`.toLowerCase().includes(needle))
    .sort((a, b) => b.at - a.at);
  return { events: filtered.slice(0, limit), hasMore: filtered.length > limit };
}

/* ───────────── 비밀 노트 (로컬, 암호화된 상태로만 저장) ───────────── */

export const listLocalNotes = (templateId: string) => idbByTemplate<LocalNote>('notes', templateId);
export const putLocalNote = (note: LocalNote) => idbPut('notes', note);
export const deleteLocalNote = (id: string) => idbDelete('notes', id);

/* ───────────── 협업 공간으로 올리기 ───────────── */

/** 이 브라우저에 있는 템플릿 전체(문서 · 기록 · 암호화된 노트)를 서버로 올릴 형태로 묶는다 */
export async function buildShareUpload(entry: TemplateEntry, openDoc?: Y.Doc): Promise<ShareUpload> {
  let state: Uint8Array;
  if (openDoc) state = Y.encodeStateAsUpdate(openDoc);
  else {
    const doc = new Y.Doc();
    const idb = new IndexeddbPersistence(docDbName(entry.id), doc);
    await idb.whenSynced;
    state = Y.encodeStateAsUpdate(doc);
    await idb.destroy();
    doc.destroy();
  }
  const timeline = await idbByTemplate<TimelineEvent>('timeline', entry.id);
  const notes = (await listLocalNotes(entry.id)).map(({ templateId: _t, ...n }) => n);
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    emoji: entry.emoji,
    features: entry.features,
    createdAt: entry.createdAt,
    state: toB64(state),
    timeline: timeline.sort((a, b) => a.at - b.at),
    notes,
  };
}

/**
 * 올리기가 끝나면 로컬 기록·노트는 정리 (이제 서버가 원본). 문서 사본은 오프라인 편집용으로 유지.
 * 올린 뒤에 생기거나 바뀐 항목은 지우지 않는다 — 올라가지 않은 데이터가 사라지지 않도록.
 */
export async function clearSharedLocalData(upload: ShareUpload): Promise<void> {
  const events = new Set(upload.timeline.map((e) => e.id));
  const notes = new Map(upload.notes.map((n) => [n.id, n.updatedAt]));
  for (const e of await idbByTemplate<TimelineEvent>('timeline', upload.id)) if (events.has(e.id)) await idbDelete('timeline', e.id);
  for (const n of await listLocalNotes(upload.id)) if (notes.get(n.id) === n.updatedAt) await idbDelete('notes', n.id);
  recent.delete(upload.id);
}
