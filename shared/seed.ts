import type * as Y from 'yjs';
import type { Feature } from './types';
import { BLANK_CONTENT, getPreset } from './presets';
import { addBoard, addCodeFile, addDocument } from './schema';

/** 프리셋 + 선택한 기능으로 새 템플릿의 초기 내용을 만든다 */
export function seedTemplateDoc(doc: Y.Doc, presetId: string, features: Feature[], createdBy: string, newId: () => string): void {
  const preset = getPreset(presetId);
  let t = Date.now();
  const nextTime = () => t++;

  doc.transact(() => {
    if (features.includes('code')) {
      for (const f of preset.code ?? BLANK_CONTENT.code) {
        addCodeFile(doc, { id: newId(), name: f.name, language: f.language, content: f.content, createdBy, createdAt: nextTime() });
      }
    }
    if (features.includes('docs')) {
      for (const d of preset.docs ?? BLANK_CONTENT.docs) {
        addDocument(doc, { id: newId(), title: d.title, emoji: d.emoji, blocks: d.blocks, createdBy, createdAt: nextTime() });
      }
    }
    if (features.includes('design')) {
      for (const b of preset.design ?? BLANK_CONTENT.design) {
        addBoard(doc, {
          id: newId(),
          name: b.name,
          createdBy,
          createdAt: nextTime(),
          shapes: b.shapes.map((s, i) => ({ ...s, id: newId(), z: i + 1, createdBy })),
        });
      }
    }
  });
}
