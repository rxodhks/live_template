import { Node, mergeAttributes } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    columns: {
      /** 빈 단(2 · 3단) 넣기 */
      insertColumns: (count: 2 | 3) => ReturnType;
      /** 단을 풀어 안의 블록을 위아래로 늘어놓는다 */
      unsetColumns: (pos: number) => ReturnType;
    };
  }
}

/** 단 하나 (안에 여러 블록) */
export const Column = Node.create({
  name: 'column',
  content: 'block+',
  isolating: true,
  defining: true,
  parseHTML() {
    return [{ tag: 'div[data-column]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-column': '', class: 'doc-column' }), 0];
  },
});

/** 다단 레이아웃: 블록을 2~3개의 단으로 나란히 */
export const Columns = Node.create({
  name: 'columns',
  group: 'block',
  content: 'column{2,3}',
  isolating: true,
  defining: true,
  draggable: false,
  parseHTML() {
    return [{ tag: 'div[data-columns]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-columns': node.childCount, class: 'doc-columns' }), 0];
  },
  addCommands() {
    return {
      insertColumns:
        (count) =>
        ({ chain }) =>
          chain()
            .insertContent([
              { type: this.name, content: Array.from({ length: count }, () => ({ type: 'column', content: [{ type: 'paragraph' }] })) },
              { type: 'paragraph' },
            ])
            // 첫 단에서 바로 쓰기 시작하도록
            .command(({ tr }) => {
              let at = -1;
              tr.doc.nodesBetween(0, tr.selection.from, (n, pos) => {
                if (n.type.name === this.name) at = pos;
              });
              if (at >= 0) tr.setSelection(TextSelection.create(tr.doc, at + 3));
              return true;
            })
            .run(),
      unsetColumns:
        (pos) =>
        ({ tr, state, dispatch }) => {
          const node = state.doc.nodeAt(pos);
          if (!node || node.type.name !== this.name) return false;
          const blocks: Node[] = [];
          node.forEach((col) => col.forEach((b) => void blocks.push(b as never)));
          if (dispatch) tr.replaceWith(pos, pos + node.nodeSize, Fragment.fromArray(blocks as never));
          return true;
        },
    };
  },
});
