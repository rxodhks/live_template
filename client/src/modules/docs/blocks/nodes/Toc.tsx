import { useEffect, useState } from 'react';
import { Node, mergeAttributes, type Editor } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { ListTree } from 'lucide-react';
import { cx } from '../../../../lib/util';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableOfContents: {
      insertTableOfContents: () => ReturnType;
    };
  }
}

export interface HeadingEntry {
  level: number;
  text: string;
}

/** 문서의 제목들 (토글 · 콜아웃 · 단 안의 제목까지 화면 순서대로) */
export function headingsOf(editor: Editor): HeadingEntry[] {
  const out: HeadingEntry[] = [];
  editor.state.doc.descendants((n) => {
    if (n.type.name === 'heading') out.push({ level: Number(n.attrs.level) || 1, text: n.textContent });
    return n.type.name !== 'heading';
  });
  return out;
}

/** 목차 블록: 문서의 제목을 모아 보여 주고, 누르면 그 제목으로 이동 */
export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'nav[data-toc]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['nav', mergeAttributes(HTMLAttributes, { 'data-toc': '', class: 'doc-toc' })];
  },
  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(TocView);
  },
});

function TocView({ editor, selected }: ReactNodeViewProps) {
  const [items, setItems] = useState<HeadingEntry[]>(() => headingsOf(editor));
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(t);
      t = setTimeout(() => setItems(headingsOf(editor)), 150);
    };
    editor.on('update', update);
    return () => {
      clearTimeout(t);
      editor.off('update', update);
    };
  }, [editor]);
  const jump = (index: number) => {
    const el = editor.view.dom.querySelectorAll('h1, h2, h3, h4, h5, h6')[index] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const minLevel = Math.min(...items.map((i) => i.level), 3);
  return (
    <NodeViewWrapper className={cx('doc-toc', selected && 'is-selected')} contentEditable={false}>
      <div className="doc-toc-head" data-drag-handle>
        <ListTree size={14} /> 목차
      </div>
      {items.length === 0 ? (
        <p className="doc-toc-empty">제목(H1~H3)을 추가하면 여기에 목차가 만들어집니다.</p>
      ) : (
        <ol>
          {items.map((h, i) => (
            <li key={i} style={{ paddingLeft: (h.level - minLevel) * 16 }}>
              <button type="button" className={`toc-level-${h.level}`} onMouseDown={(e) => e.preventDefault()} onClick={() => jump(i)}>
                {h.text || '(빈 제목)'}
              </button>
            </li>
          ))}
        </ol>
      )}
    </NodeViewWrapper>
  );
}
