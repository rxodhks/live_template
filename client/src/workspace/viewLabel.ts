import type * as Y from 'yjs';
import type { PresenceView, SecretNoteMeta, TemplateSummary, ViewModule } from '@shared/types';
import { getBoards, getDocs, getFiles } from '@shared/schema';
import { lazyText, t } from '../i18n';

export const MODULE_NAMES: Record<ViewModule, string> = lazyText(() => ({
  overview: t('개요'),
  design: t('디자인'),
  code: t('코딩'),
  docs: t('문서'),
  notes: t('비밀 노트'),
  timeline: t('타임라인'),
  members: t('멤버'),
  settings: t('설정'),
}));

export function itemName(doc: Y.Doc, notes: SecretNoteMeta[], module: ViewModule, itemId?: string | null): string | null {
  if (!itemId) return null;
  switch (module) {
    case 'code':
      return (getFiles(doc).get(itemId)?.get('name') as string) ?? null;
    case 'docs':
      return (getDocs(doc).get(itemId)?.get('title') as string) ?? null;
    case 'design':
      return (getBoards(doc).get(itemId)?.get('name') as string) ?? null;
    case 'notes':
      return notes.find((n) => n.id === itemId)?.title ?? null;
    default:
      return null;
  }
}

/** "코딩 › main.js" 같은 현재 위치 라벨 */
export function viewLabel(ws: { template: TemplateSummary; view: PresenceView; doc: Y.Doc; notes: SecretNoteMeta[] }): string {
  const base = MODULE_NAMES[ws.view.module] ?? t('개요');
  const name = itemName(ws.doc, ws.notes, ws.view.module, ws.view.itemId);
  return name ? `${base} › ${name}` : base;
}
