import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { cx } from '../../../../lib/util';
import { DOC_COLORS } from '../colors';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** 선택한 블록을 콜아웃으로 감싼다 */
      setCallout: (attrs?: { emoji?: string; color?: string }) => ReturnType;
    };
  }
}

export const CALLOUT_EMOJIS = ['💡', '📌', '⚠️', '✅', '❗', 'ℹ️', '🔥', '🎯', '📝', '🚀', '💬', '❓', '🧪', '🔒', '📣', '🗓️'];

/** 콜아웃: 아이콘 + 색 배경 상자 (안에 여러 블록) */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      emoji: { default: '💡', parseHTML: (el) => el.getAttribute('data-emoji') || '💡', renderHTML: (a) => ({ 'data-emoji': a.emoji }) },
      color: { default: 'gray', parseHTML: (el) => el.getAttribute('data-color') || 'gray', renderHTML: (a) => ({ 'data-color': a.color }) },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-callout]', contentElement: '.callout-body' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'callout' }),
      ['span', { class: 'callout-emoji', contenteditable: 'false' }, node.attrs.emoji],
      ['div', { class: 'callout-body' }, 0],
    ];
  },

  addCommands() {
    return {
      setCallout:
        (attrs) =>
        ({ commands }) =>
          commands.wrapIn(this.name, attrs),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});

function CalloutView({ node, updateAttributes, editor }: ReactNodeViewProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as HTMLElement) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const editable = editor.isEditable;
  return (
    <NodeViewWrapper className="callout" data-color={node.attrs.color}>
      <div className="callout-icon" contentEditable={false} ref={ref}>
        <button
          type="button"
          className="callout-emoji"
          disabled={!editable}
          aria-label="콜아웃 아이콘 · 색 바꾸기"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((o) => !o)}
        >
          {node.attrs.emoji}
        </button>
        {open && (
          <div className="callout-picker" role="dialog" aria-label="콜아웃 꾸미기">
            <div className="callout-picker-label">아이콘</div>
            <div className="callout-emojis">
              {CALLOUT_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className={cx(e === node.attrs.emoji && 'is-selected')}
                  onClick={() => {
                    updateAttributes({ emoji: e });
                    setOpen(false);
                  }}
                >
                  {e}
                </button>
              ))}
            </div>
            <div className="callout-picker-label">배경</div>
            <div className="callout-colors">
              {DOC_COLORS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={cx('swatch-bg', c.key === node.attrs.color && 'is-selected')}
                  style={{ background: `var(--dcb-${c.key})` }}
                  aria-label={c.name}
                  data-tip={c.name}
                  onClick={() => updateAttributes({ color: c.key })}
                />
              ))}
            </div>
          </div>
        )}
      </div>
      <NodeViewContent className="callout-body" />
    </NodeViewWrapper>
  );
}
