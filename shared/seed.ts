import type * as Y from 'yjs';
import type { Feature } from './types';
import type { SeedBlock } from './schema';
import { BLANK_CONTENT, getPreset } from './presets';
import { addBoard, addCodeFile, addDocument } from './create';

/**
 * 프리셋 + 선택한 기능으로 새 템플릿의 초기 내용을 만든다
 * tr: 화면 언어로 옮기기 (영어 화면이면 클라이언트의 t — 프리셋 문구는 영어 사전에 있다)
 */
export function seedTemplateDoc(doc: Y.Doc, presetId: string, features: Feature[], createdBy: string, newId: () => string, tr: (s: string) => string = (s) => s): void {
  const preset = getPreset(presetId);
  const block = (b: SeedBlock): SeedBlock => {
    if ('items' in b) return { ...b, items: b.items.map((i) => (typeof i === 'string' ? tr(i) : { ...i, text: tr(i.text) })) } as SeedBlock;
    if ('text' in b) return { ...b, text: tr(b.text) };
    return b;
  };
  let t = Date.now();
  const nextTime = () => t++;

  doc.transact(() => {
    if (features.includes('code')) {
      for (const f of preset.code ?? BLANK_CONTENT.code) {
        addCodeFile(doc, { id: newId(), name: f.name, language: f.language, content: tr(f.content), createdBy, createdAt: nextTime() });
      }
    }
    if (features.includes('docs')) {
      for (const d of preset.docs ?? BLANK_CONTENT.docs) {
        addDocument(doc, { id: newId(), title: tr(d.title), emoji: d.emoji, blocks: d.blocks.map(block), createdBy, createdAt: nextTime() });
      }
    }
    if (features.includes('design')) {
      for (const b of preset.design ?? BLANK_CONTENT.design) {
        addBoard(doc, {
          id: newId(),
          name: tr(b.name),
          createdBy,
          createdAt: nextTime(),
          shapes: b.shapes.map((s, i) => ({ ...s, ...(s.text ? { text: tr(s.text) } : {}), id: newId(), z: i + 1, createdBy })),
        });
      }
    }
  });
}
