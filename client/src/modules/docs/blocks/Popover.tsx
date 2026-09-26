import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Baseline } from 'lucide-react';
import type { Editor } from '@tiptap/core';
import { cx } from '../../../lib/util';
import { DOC_COLORS, type DocColorKey, bgColor, colorKeyOf, textColor } from './colors';

/** 화면 안에 들어오도록 자리 잡는 떠 있는 상자 (바깥을 누르거나 Esc로 닫힘) */
export function Popover({ anchor, onClose, children, className, side = 'right' }: { anchor: DOMRect; onClose(): void; children: ReactNode; className?: string; side?: 'right' | 'bottom' }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = side === 'right' ? anchor.right + 6 : anchor.left;
    let top = side === 'right' ? anchor.top : anchor.bottom + 6;
    if (left + w > window.innerWidth - 8) left = Math.max(8, side === 'right' ? anchor.left - w - 6 : window.innerWidth - w - 8);
    if (top + h > window.innerHeight - 8) top = Math.max(8, side === 'right' ? window.innerHeight - h - 8 : anchor.top - h - 6);
    setPos({ left, top });
  }, [anchor, side]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as HTMLElement) && onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDown));
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);
  return createPortal(
    <div ref={ref} className={cx('doc-popover', className)} style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }} onMouseDown={(e) => e.preventDefault()}>
      {children}
    </div>,
    document.body,
  );
}

/** 글자 색 · 배경 색 고르기 */
export function ColorPalette({ editor, onPick }: { editor: Editor; onPick(kind: 'text' | 'bg', key: DocColorKey | null): void }) {
  const current = colorKeyOf(editor.getAttributes('textStyle').color as string | undefined);
  const currentBg = colorKeyOf(editor.getAttributes('highlight').color as string | undefined);
  return (
    <div className="color-palette">
      <div className="popover-label">글자 색</div>
      <div className="color-row">
        <button type="button" className={cx('swatch-text', !current && 'is-selected')} aria-label="기본 글자 색" data-tip="기본" onClick={() => onPick('text', null)}>
          <Baseline size={15} />
        </button>
        {DOC_COLORS.map((c) => (
          <button
            key={c.key}
            type="button"
            className={cx('swatch-text', current === c.key && 'is-selected')}
            style={{ color: textColor(c.key) }}
            aria-label={`${c.name} 글자`}
            data-tip={c.name}
            onClick={() => onPick('text', c.key)}
          >
            <Baseline size={15} />
          </button>
        ))}
      </div>
      <div className="popover-label">배경 색</div>
      <div className="color-row">
        <button type="button" className={cx('swatch-bg is-none', !currentBg && !editor.isActive('highlight') && 'is-selected')} aria-label="배경 없음" data-tip="없음" onClick={() => onPick('bg', null)} />
        {DOC_COLORS.map((c) => (
          <button
            key={c.key}
            type="button"
            className={cx('swatch-bg', currentBg === c.key && 'is-selected')}
            style={{ background: bgColor(c.key) }}
            aria-label={`${c.name} 배경`}
            data-tip={c.name}
            onClick={() => onPick('bg', c.key)}
          />
        ))}
      </div>
    </div>
  );
}

/** 선택한 범위에 색 적용 */
export function applyColor(editor: Editor, kind: 'text' | 'bg', key: DocColorKey | null, range?: { from: number; to: number }) {
  let c = editor.chain().focus();
  if (range) c = c.setTextSelection(range);
  if (kind === 'text') c = key ? c.setColor(textColor(key)) : c.unsetColor();
  else c = key ? c.setHighlight({ color: bgColor(key) }) : c.unsetHighlight();
  c.run();
}
