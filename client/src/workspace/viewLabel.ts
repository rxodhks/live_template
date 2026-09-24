import type * as Y from 'yjs';
import type { PresenceView, SecretNoteMeta, TemplateSummary, ViewModule } from '@shared/types';
import { getBoards, getDocs, getFiles } from '@shared/schema';

export const MODULE_NAMES: Record<ViewModule, string> = {
  overview: '개요',
  design: '디자인',
  code: '코딩',
  docs: '문서',
  notes: '비밀 노트',
  timeline: '타임라인',
  members: '멤버',
  settings: '설정',
};

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
  const base = MODULE_NAMES[ws.view.module] ?? '개요';
  const name = itemName(ws.doc, ws.notes, ws.view.module, ws.view.itemId);
  return name ? `${base} › ${name}` : base;
}
