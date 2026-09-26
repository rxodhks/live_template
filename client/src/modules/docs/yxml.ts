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

/** 문서의 제목(heading)들을 화면 순서대로 — 토글 · 콜아웃 · 단 안의 제목도 (화면의 h1~h4 순서와 같다) */
export function outlineOf(fragment: Y.XmlFragment): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  const walk = (parent: Y.XmlFragment | Y.XmlElement) => {
    for (const node of parent.toArray()) {
      if (!(node instanceof Y.XmlElement)) continue;
      if (node.nodeName === 'heading') out.push({ index: out.length, level: Number(node.getAttribute('level') ?? 1), text: xmlText(node) });
      else walk(node);
    }
  };
  walk(fragment);
  return out;
}

export function countText(fragment: Y.XmlFragment): { chars: number; words: number } {
  const text = xmlText(fragment);
  return { chars: text.replace(/\s/g, '').length, words: text.trim() ? text.trim().split(/\s+/).length : 0 };
}
