import { useEffect, useReducer } from 'react';
import { Mention } from '@tiptap/extension-mention';
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import { cx } from '../../../../lib/util';
import { type DocEnv, EMPTY_ENV, PAGE_MODULE_NAME, dateLabel, parseMentionId } from '../env';

/** 멘션 (@사람 · @페이지 · @날짜) — 저장은 id와 입력할 때의 이름, 화면에는 지금 이름을 보여 준다 */
export const DocMention = Mention.extend<{ env: DocEnv } & Record<string, unknown>>({
  addOptions() {
    return { ...this.parent?.(), env: EMPTY_ENV } as never;
  },
  addNodeView() {
    return ReactNodeViewRenderer(MentionView, { as: 'span', className: 'mention-host' });
  },
});

function MentionView({ node, extension }: ReactNodeViewProps) {
  const env = (extension.options as { env: DocEnv }).env;
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => env.subscribe(force), [env]);
  const ref = parseMentionId(node.attrs.id as string);
  const fallback = String(node.attrs.label ?? '');
  if (ref?.kind === 'user') {
    const u = env.users().find((x) => x.id === ref.id);
    return (
      <NodeViewWrapper as="span" className="mention mention-user" data-tip={u ? undefined : '템플릿에 없는 사람'}>
        @{u?.name ?? fallback}
      </NodeViewWrapper>
    );
  }
  if (ref?.kind === 'page') {
    const p = env.pages().find((x) => x.module === ref.module && x.id === ref.id);
    return (
      <NodeViewWrapper
        as="span"
        className={cx('mention mention-page', !p && 'is-missing')}
        role="link"
        tabIndex={0}
        data-tip={p ? `${PAGE_MODULE_NAME[ref.module]} 열기` : '삭제된 페이지'}
        onClick={() => p && env.openPage(ref.module, ref.id)}
        onKeyDown={(e: React.KeyboardEvent) => e.key === 'Enter' && p && env.openPage(ref.module, ref.id)}
      >
        <span className="mention-emoji">{p?.emoji ?? '📄'}</span>
        {p?.title ?? fallback}
      </NodeViewWrapper>
    );
  }
  if (ref?.kind === 'date') {
    return (
      <NodeViewWrapper as="span" className="mention mention-date">
        @{dateLabel(ref.date)}
      </NodeViewWrapper>
    );
  }
  return (
    <NodeViewWrapper as="span" className="mention">
      @{fallback}
    </NodeViewWrapper>
  );
}
