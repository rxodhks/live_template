import { Extension } from '@tiptap/core';
import type { JSONContent } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggleBlock: {
      /** 선택한 블록을 토글로: 첫 줄은 토글 제목, 나머지는 토글 안으로 (펼친 상태로 만든다) */
      setToggle: () => ReturnType;
    };
  }
}

/** 노션처럼 '글을 토글로 바꾸면 그 글이 토글 제목'이 되게 한다 (기본 setDetails는 글을 안쪽으로 넣는다) */
export const ToggleCommands = Extension.create({
  name: 'toggleBlock',
  addCommands() {
    return {
      setToggle:
        () =>
        ({ state, chain }) => {
          const { $from, $to } = state.selection;
          const range = $from.blockRange($to);
          if (!range) return false;
          const blocks: JSONContent[] = (state.doc.slice(range.start, range.end).content.toJSON() as JSONContent[] | null) ?? [];
          const first = blocks[0];
          const titleFromFirst = first && (first.type === 'paragraph' || first.type === 'heading');
          const summary: JSONContent = { type: 'detailsSummary', content: titleFromFirst ? first.content : undefined };
          const rest = titleFromFirst ? blocks.slice(1) : blocks;
          const size = titleFromFirst ? state.doc.slice(range.start, range.end).content.firstChild!.content.size : 0;
          return chain()
            .insertContentAt(
              { from: range.start, to: range.end },
              { type: 'details', attrs: { open: true }, content: [summary, { type: 'detailsContent', content: rest.length ? rest : [{ type: 'paragraph' }] }] },
            )
            .setTextSelection(range.start + 2 + size)
            .run();
        },
    };
  },
});
