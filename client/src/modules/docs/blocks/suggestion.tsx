import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { ReactRenderer, type Editor } from '@tiptap/react';
import type { SuggestionKeyDownProps, SuggestionOptions, SuggestionProps } from '@tiptap/suggestion';
import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom';
import { cx } from '../../../lib/util';

/*
 * '/' 블록 메뉴 · '@' 멘션 목록이 함께 쓰는 팝업 목록
 * ↑ ↓ 로 고르고 Enter(또는 Tab)로 넣는다. Esc로 닫는다.
 */

export interface ListItem {
  key: string;
  label: string;
  group: string;
  icon: ReactNode;
  hint?: string;
}

interface ListProps<T extends ListItem> {
  items: T[];
  command: (item: T) => void;
  empty: string;
}

export interface ListHandle {
  onKeyDown: (e: KeyboardEvent) => boolean;
}

export const SuggestionList = forwardRef<ListHandle, ListProps<ListItem>>(function SuggestionList({ items, command, empty }, ref) {
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => setIndex(0), [items]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [index]);
  useImperativeHandle(ref, () => ({
    onKeyDown: (e) => {
      if (!items.length) return false;
      if (e.key === 'ArrowDown') {
        setIndex((i) => (i + 1) % items.length);
        return true;
      }
      if (e.key === 'ArrowUp') {
        setIndex((i) => (i - 1 + items.length) % items.length);
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const item = items[index];
        if (item) command(item);
        return true;
      }
      return false;
    },
  }));
  if (!items.length) return <div className="suggest-list is-empty">{empty}</div>;
  let lastGroup = '';
  return (
    <div className="suggest-list" role="listbox" ref={listRef}>
      {items.map((item, i) => {
        const head = item.group !== lastGroup;
        lastGroup = item.group;
        return (
          <div key={item.key}>
            {head && <div className="suggest-group">{item.group}</div>}
            <button
              type="button"
              role="option"
              aria-selected={i === index}
              data-index={i}
              className={cx('suggest-item', i === index && 'is-active')}
              onMouseEnter={() => setIndex(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => command(item)}
            >
              <span className="suggest-icon">{item.icon}</span>
              <span className="suggest-label">{item.label}</span>
              {item.hint && <span className="suggest-hint">{item.hint}</span>}
            </button>
          </div>
        );
      })}
    </div>
  );
});

/** Suggestion 플러그인의 render — 글자 위치 아래에 목록을 띄운다 */
export function popupRenderer<T extends ListItem>(empty: string): SuggestionOptions<T>['render'] {
  return () => {
    let renderer: ReactRenderer<ListHandle, ListProps<ListItem>> | null = null;
    let stop: (() => void) | null = null;
    let rect: (() => DOMRect | null) | null | undefined = null;

    const place = () => {
      const el = renderer?.element as HTMLElement | undefined;
      if (!el || !rect) return;
      const reference = { getBoundingClientRect: () => rect?.() ?? new DOMRect() };
      stop?.();
      stop = autoUpdate(reference as never, el, () => {
        void computePosition(reference as never, el, {
          placement: 'bottom-start',
          strategy: 'fixed',
          middleware: [
            offset(6),
            flip({ padding: 8 }),
            shift({ padding: 8 }),
            size({
              padding: 8,
              apply: ({ availableHeight }) => {
                el.style.maxHeight = `${Math.max(160, Math.min(380, availableHeight))}px`;
              },
            }),
          ],
        }).then(({ x, y }) => {
          el.style.left = `${x}px`;
          el.style.top = `${y}px`;
        });
      });
    };

    const toListProps = (p: SuggestionProps<T>): ListProps<ListItem> => ({ items: p.items, command: (item) => p.command(item as T), empty });

    return {
      onStart: (props: SuggestionProps<T>) => {
        rect = props.clientRect;
        renderer = new ReactRenderer(SuggestionList, { props: toListProps(props), editor: props.editor as Editor });
        const el = renderer.element as HTMLElement;
        el.classList.add('suggest-popup');
        document.body.appendChild(el);
        place();
      },
      onUpdate: (props: SuggestionProps<T>) => {
        rect = props.clientRect;
        renderer?.updateProps(toListProps(props));
        place();
      },
      onKeyDown: (props: SuggestionKeyDownProps) => {
        if (props.event.key === 'Escape') {
          stop?.();
          renderer?.element.remove();
          return true;
        }
        return renderer?.ref?.onKeyDown(props.event) ?? false;
      },
      onExit: () => {
        stop?.();
        stop = null;
        renderer?.element.remove();
        renderer?.destroy();
        renderer = null;
      },
    };
  };
}

/** 한글 · 영문 검색: 공백 무시, 대소문자 무시 */
export const matches = (query: string, ...words: string[]) => {
  const q = query.toLowerCase().replace(/\s+/g, '');
  return !q || words.some((w) => w.toLowerCase().replace(/\s+/g, '').includes(q));
};
