import { useEffect, useRef, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { AlignCenter, AlignLeft, AlignRight, ExternalLink, ImageOff, MessageSquareText, Trash2 } from 'lucide-react';
import { cx } from '../../../../lib/util';
import { isSafeImageSrc } from '../images';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    imageBlock: {
      insertImage: (attrs: { src: string; alt?: string; caption?: string }) => ReturnType;
    };
  }
}

type Align = 'left' | 'center' | 'right';
const clampWidth = (w: unknown) => Math.min(100, Math.max(15, Math.round(Number(w) || 100)));

/** 이미지 블록: 크기(너비 %) · 정렬 · 캡션 */
export const ImageBlock = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: '' },
      caption: { default: '' },
      width: { default: 100, parseHTML: (el) => clampWidth(el.getAttribute('data-width') ?? 100), renderHTML: (a) => ({ 'data-width': clampWidth(a.width) }) },
      align: { default: 'center', parseHTML: (el) => el.getAttribute('data-align') || 'center', renderHTML: (a) => ({ 'data-align': a.align }) },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'figure[data-image]',
        getAttrs: (el) => {
          const img = (el as HTMLElement).querySelector('img');
          const src = img?.getAttribute('src');
          if (!isSafeImageSrc(src)) return false;
          return { src, alt: img?.getAttribute('alt') ?? '', caption: (el as HTMLElement).querySelector('figcaption')?.textContent ?? '' };
        },
      },
      {
        tag: 'img[src]',
        getAttrs: (el) => {
          const src = (el as HTMLElement).getAttribute('src');
          return isSafeImageSrc(src) ? { src, alt: (el as HTMLElement).getAttribute('alt') ?? '' } : false;
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { src, alt, caption, width } = node.attrs;
    return [
      'figure',
      mergeAttributes(HTMLAttributes, { 'data-image': '', class: 'doc-image' }),
      ['img', { src, alt, style: `width:${clampWidth(width)}%` }],
      ...(caption ? [['figcaption', {}, caption]] : []),
    ] as never;
  },

  addCommands() {
    return {
      insertImage:
        (attrs) =>
        ({ commands }) =>
          isSafeImageSrc(attrs.src) && commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
});

function ImageView({ node, updateAttributes, deleteNode, selected, editor }: ReactNodeViewProps) {
  const { src, alt, caption } = node.attrs as { src: string; alt: string; caption: string };
  const width = clampWidth(node.attrs.width);
  const align = (node.attrs.align as Align) ?? 'center';
  const editable = editor.isEditable;
  const [broken, setBroken] = useState(false);
  const [draftWidth, setDraftWidth] = useState<number | null>(null);
  const [captionOpen, setCaptionOpen] = useState(Boolean(caption));
  const [captionDraft, setCaptionDraft] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => setBroken(false), [src]);
  useEffect(() => {
    if (caption) setCaptionOpen(true);
  }, [caption]);

  /** 오른쪽 · 왼쪽 모서리를 끌어 너비 조절 (가운데 정렬이면 양쪽으로 늘어난다) */
  const startResize = (e: React.PointerEvent, side: 1 | -1) => {
    const wrap = wrapRef.current;
    if (!wrap || !editable) return;
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    const full = wrap.getBoundingClientRect().width;
    const startX = e.clientX;
    const start = width;
    const factor = align === 'center' ? 2 : 1;
    let next = start;
    const move = (ev: PointerEvent) => {
      next = clampWidth(start + ((ev.clientX - startX) * side * factor * 100) / full);
      setDraftWidth(next);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      setDraftWidth(null);
      if (next !== start) updateAttributes({ width: next });
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const commitCaption = () => {
    if (captionDraft === null) return;
    const next = captionDraft.trim();
    setCaptionDraft(null);
    if (next !== caption) updateAttributes({ caption: next });
    if (!next) setCaptionOpen(false);
  };

  const shown = draftWidth ?? width;
  return (
    <NodeViewWrapper className={cx('doc-image', selected && 'is-selected')} data-align={align} ref={wrapRef}>
      <div className="doc-image-frame" style={{ width: `${shown}%` }} data-drag-handle>
        {src && !broken ? (
          <img src={src} alt={alt || caption || ''} draggable={false} onError={() => setBroken(true)} />
        ) : (
          <div className="doc-image-broken">
            <ImageOff size={20} /> 이미지를 불러오지 못했습니다
          </div>
        )}
        {editable && (
          <>
            <span className="doc-image-handle is-left" onPointerDown={(e) => startResize(e, -1)} aria-hidden />
            <span className="doc-image-handle is-right" onPointerDown={(e) => startResize(e, 1)} aria-hidden />
            <div className="doc-image-bar" contentEditable={false} onMouseDown={(e) => e.preventDefault()}>
              {(['left', 'center', 'right'] as Align[]).map((a) => (
                <button key={a} type="button" className={cx(align === a && 'is-active')} aria-label={a === 'left' ? '왼쪽 정렬' : a === 'center' ? '가운데 정렬' : '오른쪽 정렬'} onClick={() => updateAttributes({ align: a })}>
                  {a === 'left' ? <AlignLeft size={14} /> : a === 'center' ? <AlignCenter size={14} /> : <AlignRight size={14} />}
                </button>
              ))}
              <span className="bar-sep" />
              {[25, 50, 75, 100].map((w) => (
                <button key={w} type="button" className={cx('bar-text', width === w && 'is-active')} onClick={() => updateAttributes({ width: w })}>
                  {w}%
                </button>
              ))}
              <span className="bar-sep" />
              <button type="button" aria-label="캡션" className={cx(captionOpen && 'is-active')} onClick={() => setCaptionOpen(true)}>
                <MessageSquareText size={14} />
              </button>
              {/^https?:/.test(src) && (
                <a href={src} target="_blank" rel="noreferrer noopener" aria-label="원본 열기">
                  <ExternalLink size={14} />
                </a>
              )}
              <button type="button" aria-label="이미지 삭제" onClick={() => deleteNode()}>
                <Trash2 size={14} />
              </button>
            </div>
          </>
        )}
      </div>
      {(captionOpen || caption) && (
        <input
          className="doc-image-caption"
          value={captionDraft ?? caption}
          placeholder="캡션을 입력하세요"
          readOnly={!editable}
          maxLength={200}
          autoFocus={editable && captionOpen && !caption && captionDraft === null}
          onChange={(e) => setCaptionDraft(e.target.value)}
          onBlur={commitCaption}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              commitCaption();
              editor.commands.focus();
            }
          }}
        />
      )}
    </NodeViewWrapper>
  );
}
