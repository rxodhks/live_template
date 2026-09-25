import type * as Y from 'yjs';
import type { Feature, TemplateEntry, TemplateSummary } from '@shared/types';
import { FEATURE_INFO, FEATURE_ORDER } from '@shared/presets';
import { useSession } from '../store/session';
import { useTemplates } from '../store/templates';
import { api } from './api';
import { buildShareUpload, clearSharedLocalData, deleteLocalTemplate, recordLocal } from './local';
import { ensureAccount } from './profile';

/*
 * 템플릿 단위 작업 — 개인 공간이면 브라우저에서, 협업 공간이면 서버에서 처리한다.
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

export async function deleteTemplate(t: TemplateEntry): Promise<void> {
  if (t.mode === 'shared') await api('DELETE', `/templates/${t.id}`);
  else await deleteLocalTemplate(t.id);
  useTemplates.getState().remove(t.id, { dropLocalCopy: true });
}

export async function leaveTemplate(t: TemplateEntry): Promise<void> {
  const me = useSession.getState().user!;
  await api('DELETE', `/templates/${t.id}/members/${me.id}`);
  useTemplates.getState().remove(t.id, { dropLocalCopy: true });
}

/**
 * 개인 공간 → 협업 공간 전환.
 * 템플릿 ID와 브라우저의 문서 사본은 그대로 유지되므로, 전환 후에도 같은 주소에서 이어서 작업한다.
 */
export async function shareTemplate(t: TemplateEntry, openDoc?: Y.Doc): Promise<TemplateEntry> {
  if (t.mode === 'shared') return t;
  await ensureAccount();
  const upload = await buildShareUpload(t, openDoc);
  const res = await api<{ template: TemplateSummary }>('POST', `/templates/${t.id}/share`, upload);
  const shared = useTemplates.getState().upsertShared(res.template);
  await clearSharedLocalData(t.id);
  return shared;
}
