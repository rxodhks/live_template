import * as Y from 'yjs';

/** Y.XmlElement 안의 순수 텍스트 */
export function xmlText(node: Y.XmlElement | Y.XmlText | Y.XmlFragment): string {
  if (node instanceof Y.XmlText) {
    return (node.toDelta() as { insert: unknown }[]).map((d) => (typeof d.insert === 'string' ? d.insert : '')).join('');
  }
  return node
    .toArray()
    .map((child) => xmlText(child as Y.XmlElement | Y.XmlText))
    .join('');
}

export interface OutlineEntry {
  index: number;
  level: number;
  text: string;
}

/** 문서의 제목(heading)들을 순서대로 */
export function outlineOf(fragment: Y.XmlFragment): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  let index = 0;
  for (const node of fragment.toArray()) {
    if (node instanceof Y.XmlElement && node.nodeName === 'heading') {
      out.push({ index: index++, level: Number(node.getAttribute('level') ?? 1), text: xmlText(node) });
    }
  }
  return out;
}

export function countText(fragment: Y.XmlFragment): { chars: number; words: number } {
  const text = xmlText(fragment);
  return { chars: text.replace(/\s/g, '').length, words: text.trim() ? text.trim().split(/\s+/).length : 0 };
}
