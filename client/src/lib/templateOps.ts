import type * as Y from 'yjs';
import type { Feature, TemplateEntry, TemplateSummary, TrashEntry, VersionInfo } from '@shared/types';
import { FEATURE_INFO, FEATURE_ORDER } from '@shared/presets';
import { useSession } from '../store/session';
import { useTemplates } from '../store/templates';
import { ApiError, api } from './api';
import { buildShareUpload, clearSharedLocalData, recordLocal } from './local';

/*
 * 템플릿 단위 작업 — 아직 이 기기에만 있는 템플릿은 브라우저에서, 클라우드에 있는 템플릿은 서버에서 처리한다.
 * 개인 공간도 만들자마자 클라우드에 (나만 볼 수 있게) 백업해서, 브라우저 데이터가 지워지거나 기기가 바뀌어도 잃지 않는다.
 */

export type TemplatePatch = Partial<{ name: string; description: string; emoji: string; features: Feature[] }>;

export async function updateTemplate(t: TemplateEntry, patch: TemplatePatch): Promise<TemplateEntry> {
  const store = useTemplates.getState();
  if (t.mode === 'shared') {
    const res = await api<{ template: TemplateSummary }>('PATCH', `/templates/${t.id}`, patch);
    return store.upsertShared(res.template);
  }
  const next = { ...t };
  const changes: string[] = [];
  if (patch.name !== undefined && patch.name.trim() && patch.name.trim() !== t.name) {
    next.name = patch.name.trim().slice(0, 60);
    changes.push(`이름 → ${next.name}`);
  }
  if (patch.description !== undefined && patch.description.trim() !== t.description) {
    next.description = patch.description.trim().slice(0, 200);
    changes.push('설명 수정');
  }
  if (patch.emoji && patch.emoji !== t.emoji) {
    next.emoji = patch.emoji;
    changes.push(`아이콘 → ${patch.emoji}`);
  }
  if (patch.features) {
    const f = FEATURE_ORDER.filter((x) => patch.features!.includes(x));
    if (!f.length) throw new Error('기능은 하나 이상 필요합니다.');
    if (f.join() !== t.features.join()) {
      next.features = f;
      changes.push(`기능 → ${f.map((x) => FEATURE_INFO[x].name).join(', ')}`);
    }
  }
  if (!changes.length) return t;
  next.updatedAt = Date.now();
  store.upsert(next);
  await recordLocal(next, useSession.getState().user!, { type: 'template.update', detail: changes.join(', ') });
  return next;
}

/** 삭제 = 휴지통으로 이동 (30일 동안 복원 가능). 이 기기에만 있던 템플릿은 먼저 백업해서 복원할 수 있게 한다 */
export async function deleteTemplate(t: TemplateEntry): Promise<void> {
  const saved = t.mode === 'personal' ? await backupTemplate(t) : t;
  await api('DELETE', `/templates/${saved.id}`);
  useTemplates.getState().remove(saved.id, { dropLocalCopy: true });
}

export async function leaveTemplate(t: TemplateEntry): Promise<void> {
  const me = useSession.getState().user!;
  await api('DELETE', `/templates/${t.id}/members/${me.id}`);
  useTemplates.getState().remove(t.id, { dropLocalCopy: true });
}

/**
 * 이 기기에만 있는 템플릿을 클라우드에 올린다 (같은 ID · 같은 주소로 이어서 작업).
 *  · private: 개인 공간 백업 — 나만 볼 수 있다
 *  · shared : 첫 초대와 함께 협업 공간으로
 * 이미 클라우드에 있는 개인 템플릿은 초대 링크를 만들 때 서버가 협업 공간으로 바꾼다.
 */
async function upload(t: TemplateEntry, visibility: 'private' | 'shared', openDoc?: Y.Doc): Promise<TemplateEntry> {
  if (t.mode === 'shared') return t;
  const body = await buildShareUpload(t, openDoc);
  const res = await api<{ template: TemplateSummary }>('POST', `/templates/${t.id}/${visibility === 'private' ? 'backup' : 'share'}`, body);
  const saved = useTemplates.getState().upsertShared(res.template);
  await clearSharedLocalData(body);
  return saved;
}

export const backupTemplate = (t: TemplateEntry, openDoc?: Y.Doc) => upload(t, 'private', openDoc);
export const shareTemplate = (t: TemplateEntry, openDoc?: Y.Doc) => upload(t, 'shared', openDoc);

/** 지금 편집 화면에 열려 있는 템플릿 (백업 중에 바뀐 내용이 섞이지 않도록 닫힌 뒤에 백업한다) */
let openTemplateId: string | null = null;
export const setOpenTemplate = (id: string | null) => void (openTemplateId = id);

let backupRun: Promise<number> | null = null;

/** 아직 이 기기에만 있는 개인 템플릿을 모두 클라우드에 백업 (오프라인이면 다음에 다시) */
export function backupPending(): Promise<number> {
  backupRun ??= (async () => {
    let done = 0;
    try {
      for (const t of Object.values(useTemplates.getState().templates)) {
        if (t.mode !== 'personal' || t.id === openTemplateId) continue;
        try {
          await backupTemplate(t);
          done++;
        } catch (err) {
          if (err instanceof ApiError && err.status === 0) break;
          console.warn('개인 템플릿 백업 실패', t.id, err);
        }
      }
    } finally {
      backupRun = null;
    }
    return done;
  })();
  return backupRun;
}

/** 아직 백업되지 않은 개인 템플릿 수 */
export const unbackedCount = () => Object.values(useTemplates.getState().templates).filter((t) => t.mode === 'personal').length;

/* ───────────── 휴지통 ───────────── */

export const listTrash = () => api<{ trash: TrashEntry[]; ttlDays: number }>('GET', '/trash');

export async function restoreFromTrash(id: string): Promise<TemplateEntry> {
  const res = await api<{ template: TemplateSummary }>('POST', `/trash/${id}/restore`);
  return useTemplates.getState().upsertShared(res.template);
}

export const purgeFromTrash = (id: string) => api('DELETE', `/trash/${id}`);

/* ───────────── 버전 기록 ───────────── */

export const listVersions = (templateId: string) => api<{ versions: VersionInfo[] }>('GET', `/templates/${templateId}/versions`);

/** 이전 버전으로 나만 보는 사본 만들기 (지금 문서는 그대로) */
export async function copyVersion(t: TemplateEntry, v: VersionInfo, label: string): Promise<TemplateEntry> {
  const name = `${t.name} (${label} 버전)`.slice(0, 60);
  const res = await api<{ template: TemplateSummary }>('POST', `/templates/${t.id}/versions/${v.id}/copy`, { name, label });
  return useTemplates.getState().upsertShared(res.template);
}
