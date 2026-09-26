import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      /** 여기서 다음 쪽으로 (인쇄 · PDF에서도 나뉜다) */
      setPageBreak: () => ReturnType;
    };
  }
}

/** 페이지 나누기: 뒤 내용을 다음 쪽에서 시작 — 화면에는 점선, 인쇄하면 실제로 쪽이 나뉜다 */
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': '', class: 'page-break' })];
  },
  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ commands }) =>
          commands.insertContent([{ type: this.name }, { type: 'paragraph' }]),
    };
  },
  addKeyboardShortcuts() {
    return {
      // 워드 · 구글 문서처럼 Ctrl/⌘ + Enter (코드 블록 안에서는 원래대로 코드 블록 빠져나오기)
      'Mod-Enter': () => !this.editor.isActive('codeBlock') && this.editor.commands.setPageBreak(),
    };
  },
});
