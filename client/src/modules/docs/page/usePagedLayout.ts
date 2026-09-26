import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import type { Editor } from '@tiptap/core';
import type { PageSetup } from '@shared/schema';
import { pagePx } from './pageSizes';

/*
 * 크기가 정해진 문서(A4 · 기기 화면 …)의 화면 배치
 *  - 너비가 화면보다 넓으면 맞춤 배율로 줄인다 (transform — ProseMirror가 배율을 알아서 계산한다)
 *  - 블록 높이를 재서 인쇄할 때 쪽이 나뉘는 위치를 계산한다 (쪽을 넘는 블록은 통째로 다음 쪽으로,
 *    한 쪽보다 긴 블록은 중간에서 나뉜다 — 인쇄 CSS의 break-inside: avoid와 같은 규칙)
 */

export type Zoom = 'fit' | number;

export interface PageBreakMark {
  /** 페이지 위쪽 테두리 기준 위치 (px, 배율 적용 전) */
  y: number;
  manual: boolean;
}

export interface PagedLayout {
  scale: number;
  width: number;
  height: number;
  margin: number;
  breaks: PageBreakMark[];
  pages: number;
  /** 마지막 쪽까지 채운 페이지 높이 */
  minHeight: number;
  /** 배율 적용 후 실제로 차지하는 높이 */
  stageHeight: number;
}

/** 손잡이(+ ⋮⋮)가 들어갈 좌우 여유 */
export const STAGE_GUTTER = 64;

export function usePagedLayout(page: PageSetup | null, zoom: Zoom, editor: Editor | null, scrollRef: RefObject<HTMLElement | null>, pageRef: RefObject<HTMLElement | null>): PagedLayout | null {
  const [avail, setAvail] = useState(0);
  const [measure, setMeasure] = useState<{ breaks: PageBreakMark[]; lastStart: number; height: number }>({ breaks: [], lastStart: 0, height: 0 });
  const size = page ? pagePx(page) : null;

  // 쓸 수 있는 너비 (맞춤 배율 계산용)
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !page) return;
    const update = () => setAvail(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef, page]);

  // 쪽 나뉨 위치 계산 (내용 · 크기가 바뀔 때마다, 한 프레임에 한 번)
  useEffect(() => {
    const pageEl = pageRef.current;
    if (!page || !size || !editor || !pageEl) return;
    const root = editor.view.dom as HTMLElement;
    const contentH = Math.max(40, size.height - 2 * size.margin);
    let raf = 0;
    const compute = () => {
      raf = 0;
      const padTop = size.margin;
      const items: { top: number; bottom: number; manual: boolean }[] = [];
      const header = pageEl.querySelector<HTMLElement>(':scope > .doc-header');
      if (header && header.offsetHeight) items.push({ top: header.offsetTop - padTop, bottom: header.offsetTop + header.offsetHeight - padTop, manual: false });
      for (const child of Array.from(root.children) as HTMLElement[]) {
        if (!child.offsetHeight || child.classList.contains('ProseMirror-gapcursor')) continue;
        const top = root.offsetTop + child.offsetTop - padTop;
        items.push({ top, bottom: top + child.offsetHeight, manual: child.hasAttribute('data-page-break') });
      }
      const breaks: PageBreakMark[] = [];
      let start = 0;
      for (const it of items) {
        if (it.manual) {
          if (it.bottom > start) {
            breaks.push({ y: padTop + it.bottom, manual: true });
            start = it.bottom;
          }
          continue;
        }
        let guard = 0;
        while (it.bottom - start > contentH && guard++ < 500) {
          if (it.top > start + 1 && it.bottom - it.top <= contentH) {
            start = it.top;
          } else {
            start += contentH;
          }
          breaks.push({ y: padTop + start, manual: false });
        }
      }
      setMeasure((m) => {
        const same = m.lastStart === start && m.breaks.length === breaks.length && m.breaks.every((b, i) => b.y === breaks[i].y && b.manual === breaks[i].manual) && m.height === pageEl.offsetHeight;
        return same ? m : { breaks, lastStart: start, height: pageEl.offsetHeight };
      });
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(compute);
    };
    schedule();
    editor.on('update', schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(root);
    ro.observe(pageEl);
    return () => {
      cancelAnimationFrame(raf);
      editor.off('update', schedule);
      ro.disconnect();
    };
  }, [page, size?.width, size?.height, size?.margin, editor, pageRef]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!page || !size) return null;
  const fit = avail > 0 ? Math.min(1, (avail - STAGE_GUTTER * 2) / size.width) : 1;
  const scale = Math.max(0.1, zoom === 'fit' ? fit : zoom / 100);
  const minHeight = Math.max(size.height, size.margin + measure.lastStart + (size.height - 2 * size.margin) + size.margin);
  return {
    scale,
    width: size.width,
    height: size.height,
    margin: size.margin,
    breaks: measure.breaks,
    pages: measure.breaks.length + 1,
    minHeight,
    stageHeight: Math.max(minHeight, measure.height) * scale,
  };
}
