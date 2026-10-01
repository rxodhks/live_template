import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { ExternalLink, Trash2 } from 'lucide-react';
import { cx } from '../../../../lib/util';
import { isAllowedEmbedSrc } from '../embed';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    embed: {
      insertEmbed: (attrs: { src: string; url: string; provider: string; height?: number | null }) => ReturnType;
    };
  }
}

/** 동영상 · 지도 · 디자인 파일 등 외부 서비스 임베드 (허용된 서비스만) */
export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      src: { default: null },
      url: { default: '' },
      provider: { default: '' },
      height: { default: null },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-embed]',
        getAttrs: (el) => {
          const e = el as HTMLElement;
          const src = e.getAttribute('data-src');
          if (!isAllowedEmbedSrc(src)) return false;
          const h = Number(e.getAttribute('data-height'));
          return { src, url: linkOf(e.getAttribute('data-url'), src), provider: e.getAttribute('data-provider') ?? '', height: h > 0 ? h : null };
        },
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { src, url, provider, height } = node.attrs;
    const link = linkOf(url, src);
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-embed': '', 'data-src': src, 'data-url': link, 'data-provider': provider, 'data-height': height ?? '', class: 'doc-embed' }),
      ['a', { href: link }, `${provider}: ${link}`],
    ];
  },

  addCommands() {
    return {
      insertEmbed:
        (attrs) =>
        ({ commands }) =>
          isAllowedEmbedSrc(attrs.src) && commands.insertContent({ type: this.name, attrs }),
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },
});

/** 원본 링크는 http(s)만 — 붙여넣기 · 문서 변경으로 들어온 javascript: 같은 주소는 임베드 주소로 대신한다 (HTML 내보내기 포함) */
function linkOf(url: string | null | undefined, src: string): string {
  return url && /^https?:\/\//i.test(url) ? url : src;
}

function EmbedView({ node, selected, deleteNode, editor }: ReactNodeViewProps) {
  const { src, url, provider, height } = node.attrs as { src: string; url: string; provider: string; height: number | null };
  const ok = isAllowedEmbedSrc(src);
  const link = linkOf(url, src);
  return (
    <NodeViewWrapper className={cx('doc-embed', selected && 'is-selected')}>
      <div className="doc-embed-head" contentEditable={false} data-drag-handle>
        <span className="doc-embed-provider">{provider || '임베드'}</span>
        <span className="doc-embed-url">{link}</span>
        <a href={link} target="_blank" rel="noreferrer noopener" aria-label="새 탭에서 열기" onMouseDown={(e) => e.stopPropagation()}>
          <ExternalLink size={13} />
        </a>
        {editor.isEditable && (
          <button type="button" aria-label="임베드 삭제" onMouseDown={(e) => e.preventDefault()} onClick={() => deleteNode()}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {ok ? (
        <div className={cx('doc-embed-frame', !height && 'is-video')} style={height ? { height } : undefined}>
          <iframe
            src={src}
            title={`${provider} 임베드`}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-popups allow-presentation allow-forms"
            allow="fullscreen; picture-in-picture; encrypted-media; clipboard-write"
            allowFullScreen
          />
        </div>
      ) : (
        <div className="doc-image-broken">허용되지 않은 임베드 주소입니다</div>
      )}
    </NodeViewWrapper>
  );
}
