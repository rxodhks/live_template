import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface TipState {
  text: string;
  x: number;
  y: number;
  side: 'top' | 'bottom' | 'left' | 'right';
}

/**
 * data-tip 속성을 가진 요소에 마우스를 올리면 보여주는 전역 툴팁.
 * 포털로 body에 그려서 스크롤 패널의 overflow에 잘리지 않는다.
 */
export function TooltipHost() {
  const [tip, setTip] = useState<TipState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const current = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const hide = () => {
      clearTimeout(timer.current);
      current.current = null;
      setTip(null);
    };
    // 손가락으로 누를 때 생기는 mouseover에는 툴팁을 띄우지 않는다
    let lastPointer = 'mouse';
    const onPointer = (e: PointerEvent) => {
      lastPointer = e.pointerType;
      hide();
    };
    const onOver = (e: MouseEvent) => {
      if (lastPointer === 'touch') return;
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-tip]');
      if (el === current.current) return;
      hide();
      if (!el || !el.dataset.tip) return;
      current.current = el;
      timer.current = setTimeout(() => {
        if (!el.isConnected || !el.dataset.tip) return;
        const r = el.getBoundingClientRect();
        const side = (el.dataset.tipSide as TipState['side']) ?? 'bottom';
        const pos =
          side === 'right'
            ? { x: r.right + 8, y: r.top + r.height / 2 }
            : side === 'left'
              ? { x: r.left - 8, y: r.top + r.height / 2 }
              : side === 'top'
                ? { x: r.left + r.width / 2, y: r.top - 8 }
                : { x: r.left + r.width / 2, y: r.bottom + 8 };
        setTip({ text: el.dataset.tip, side, ...pos });
      }, 380);
    };
    document.addEventListener('mouseover', onOver);
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  if (!tip) return null;
  return createPortal(
    <div className={`tooltip tooltip-${tip.side}`} style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.text}
    </div>,
    document.body,
  );
}
