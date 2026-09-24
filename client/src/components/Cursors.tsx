import { type ReactNode, type RefObject, useEffect, useReducer, useRef } from 'react';
import type { PresenceView } from '@shared/types';
import { usePresence, type RemotePresence } from '../store/presence';
import { useWorkspace, sameView } from '../workspace/context';
import { cx } from '../lib/util';

/** 행동 라벨이 커서 옆에 머무는 시간 */
export const ACTION_BUBBLE_MS = 3500;

/**
 * 다른 사용자의 마우스 커서 + 이름표 + 방금 한 행동 말풍선.
 * 말풍선은 행동이 들어올 때마다 key가 바뀌어 CSS 애니메이션(나타남 → 유지 → 페이드 아웃)이 다시 재생된다.
 */
export function RemoteCursor({ presence, x, y }: { presence: RemotePresence; x: number; y: number }) {
  const color = presence.user.color;
  const showAction = presence.actionLabel && presence.actionAt && Date.now() - presence.actionAt < ACTION_BUBBLE_MS;
  return (
    <div
      className={`remote-cursor ${presence.idle ? 'is-idle' : ''}`}
      style={{ transform: `translate(${x}px, ${y}px)`, ['--user-color' as string]: color }}
    >
      <svg width="18" height="20" viewBox="0 0 18 20" className="remote-cursor-arrow" aria-hidden>
        <path d="M1.5 1.5 L1.5 16 L5.6 12.3 L8.4 18.4 L11 17.2 L8.3 11.2 L14 11.2 Z" fill={color} stroke="white" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      <div className="remote-cursor-tag">
        <span className="remote-cursor-name">
          {presence.user.avatar} {presence.user.name}
          {presence.idle && <span className="remote-cursor-idle"> · 자리 비움</span>}
        </span>
        {showAction && (
          <span className="remote-cursor-action" key={presence.actionAt}>
            {presence.actionLabel}
          </span>
        )}
      </div>
    </div>
  );
}

export function useViewers(view: PresenceView): RemotePresence[] {
  const others = usePresence((s) => s.others);
  return Object.values(others).filter((p) => sameView(p.view, view));
}

interface CursorLayerProps {
  /** 좌표 기준 요소 (문서 페이지, 코드 콘텐츠 등) */
  anchorRef: RefObject<HTMLElement | null>;
  /** 스크롤 시 다시 그리기 위한 요소 */
  scrollRef?: RefObject<HTMLElement | null>;
  /** x좌표를 기준 요소 너비 대비 비율로 공유할지(fraction), 픽셀로 공유할지(px) */
  xMode?: 'fraction' | 'px';
  /** 커서를 추적할 영역 (기본: anchor의 부모 host) */
  hostRef: RefObject<HTMLElement | null>;
}

/**
 * 흐르는 콘텐츠(문서/코드/목록 화면)용 커서 레이어.
 * host 요소는 position: relative 여야 하고, 레이어는 host를 덮는다.
 */
export function CursorLayer({ anchorRef, scrollRef, hostRef, xMode = 'fraction' }: CursorLayerProps) {
  const { view, publishCursor } = useWorkspace();
  const viewers = useViewers(view);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  // 내 커서 위치 공유
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onMove = (e: PointerEvent) => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const x = xMode === 'fraction' ? (e.clientX - r.left) / Math.max(1, r.width) : e.clientX - r.left;
      publishCursor({ x, y: e.clientY - r.top });
    };
    const onLeave = () => publishCursor(null);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    return () => {
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      publishCursor(null);
    };
  }, [hostRef, anchorRef, xMode, publishCursor]);

  // 스크롤/크기 변화 시 다시 그리기
  useEffect(() => {
    const el = scrollRef?.current;
    const onScroll = () => rerender();
    el?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    const ro = new ResizeObserver(onScroll);
    if (anchorRef.current) ro.observe(anchorRef.current);
    onScroll();
    return () => {
      el?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      ro.disconnect();
    };
  }, [scrollRef, anchorRef]);

  // 말풍선 만료 후 다시 그리기
  useEffect(() => {
    const latest = Math.max(0, ...viewers.map((v) => v.actionAt ?? 0));
    const left = latest + ACTION_BUBBLE_MS - Date.now();
    if (left <= 0) return;
    const t = setTimeout(rerender, left + 50);
    return () => clearTimeout(t);
  }, [viewers]);

  const host = hostRef.current;
  const anchor = anchorRef.current;
  if (!host || !anchor) return null;
  const hr = host.getBoundingClientRect();
  const ar = anchor.getBoundingClientRect();

  return (
    <div className="cursor-layer" aria-hidden>
      {viewers.map((p) => {
        if (!p.cursor) return null;
        const x = ar.left - hr.left + (xMode === 'fraction' ? p.cursor.x * ar.width : p.cursor.x);
        const y = ar.top - hr.top + p.cursor.y;
        if (y < -20 || y > hr.height + 10 || x < -20 || x > hr.width + 10) return null;
        return <RemoteCursor key={p.socketId} presence={p} x={x} y={y} />;
      })}
    </div>
  );
}

/** 스크롤되는 일반 페이지 + 커서 레이어 */
export function CursorPage({ children, className, wide, cursors = true }: { children: ReactNode; className?: string; wide?: boolean; cursors?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  return (
    <div className="cursor-host" ref={host}>
      <div className="page-scroll" ref={scroll}>
        <div className={cx('page', wide && 'page-wide', className)} ref={anchor}>
          {children}
        </div>
      </div>
      {cursors && <CursorLayer hostRef={host} scrollRef={scroll} anchorRef={anchor} />}
    </div>
  );
}
