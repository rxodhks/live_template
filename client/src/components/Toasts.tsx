import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { type Toast, TOAST_FADE_MS, useToasts } from '../store/toasts';
import { Avatar } from './ui';
import { cx } from '../lib/util';

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

/**
 * 휘발성 토스트.
 * - 일정 시간 뒤 자동으로 페이드 아웃되며 사라진다 (마우스를 올리면 일시 정지)
 * - 여러 개가 쌓이면 가장 오래된 것부터 사라진다
 */
export function ToastViewport() {
  const toasts = useToasts((s) => s.toasts);
  return createPortal(
    <div className="toast-viewport" role="region" aria-label="알림" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>,
    document.body,
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (paused || toast.leaving) return;
    startedAt.current = Date.now();
    const timer = setTimeout(() => dismiss(toast.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, toast.leaving, toast.id, dismiss]);

  const Icon = ICONS[toast.kind];
  return (
    <div
      className={cx('toast', `toast-${toast.kind}`, toast.leaving && 'is-leaving')}
      style={{ ['--toast-duration' as string]: `${toast.duration}ms`, ['--toast-fade' as string]: `${TOAST_FADE_MS}ms` }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="status"
    >
      <div className="toast-lead">
        {toast.user ? (
          <Avatar user={toast.user} size={30} tooltip={false} />
        ) : (
          <span className="toast-icon">
            <Icon size={18} />
          </span>
        )}
      </div>
      <div className="toast-body">
        <div className="toast-title">
          {toast.user && <Icon size={13} className="toast-kind-icon" />}
          {toast.title}
        </div>
        {toast.message && <div className="toast-message">{toast.message}</div>}
      </div>
      <button className="toast-close" aria-label="알림 닫기" onClick={() => dismiss(toast.id)}>
        <X size={14} />
      </button>
      <span className={cx('toast-progress', paused && 'is-paused')} />
    </div>
  );
}
