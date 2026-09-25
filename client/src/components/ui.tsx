import {
  type ButtonHTMLAttributes,
  type ReactNode,
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { PublicUser } from '@shared/types';
import { cx } from '../lib/util';

/* ───────────── 버튼 ───────────── */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cx('btn', `btn-${variant}`, `btn-${size}`, !children && 'btn-icon-only', className)}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : icon}
      {children && <span>{children}</span>}
    </button>
  );
});

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  tipSide?: 'top' | 'bottom' | 'right' | 'left';
  size?: 'sm' | 'md';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, active, tipSide = 'bottom', size = 'md', className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      data-tip={label}
      data-tip-side={tipSide}
      aria-pressed={active}
      className={cx('icon-btn', `icon-btn-${size}`, active && 'is-active', className)}
      {...rest}
    >
      {children}
    </button>
  );
});

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="로딩 중" />;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

/* ───────────── 아바타 ───────────── */

interface AvatarProps {
  user: PublicUser;
  size?: number;
  status?: 'online' | 'idle' | null;
  tooltip?: string | false;
  className?: string;
  onClick?: () => void;
}

export function Avatar({ user, size = 28, status, tooltip, className, onClick }: AvatarProps) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      className={cx('avatar', status && `avatar-${status}`, onClick && 'avatar-btn', className)}
      style={{ width: size, height: size, fontSize: size * 0.52, ['--user-color' as string]: user.color }}
      data-tip={tooltip === false ? undefined : tooltip ?? user.name}
      aria-label={user.name}
      onClick={onClick}
    >
      <span aria-hidden>{user.avatar}</span>
    </Tag>
  );
}

export function AvatarStack({ users, max = 4, size = 26 }: { users: PublicUser[]; max?: number; size?: number }) {
  const shown = users.slice(0, max);
  const rest = users.length - shown.length;
  return (
    <span className="avatar-stack">
      {shown.map((u) => (
        <Avatar key={u.id} user={u} size={size} />
      ))}
      {rest > 0 && (
        <span className="avatar avatar-more" style={{ width: size, height: size }} data-tip={`외 ${rest}명`}>
          +{rest}
        </span>
      )}
    </span>
  );
}

/* ───────────── 모달 ───────────── */

interface ModalProps {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  icon?: ReactNode;
}

export function Modal({ title, description, onClose, children, footer, width = 480, icon }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const prev = document.activeElement as HTMLElement | null;
    // 첫 입력 요소로 포커스
    requestAnimationFrame(() => {
      const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, select, button.btn-primary');
      first?.focus();
    });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" style={{ maxWidth: width }} ref={ref}>
        <header className="modal-header">
          {icon && <span className="modal-icon">{icon}</span>}
          <div className="modal-titles">
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <IconButton label="닫기" onClick={onClose} size="sm">
            <X size={16} />
          </IconButton>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

/* ───────────── 드롭다운 메뉴 ───────────── */

export interface MenuItem {
  label: ReactNode;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  hint?: ReactNode;
  checked?: boolean;
  divider?: boolean;
  /** 누를 수 없는 소제목 */
  heading?: boolean;
}

interface MenuProps {
  trigger: (props: { open: boolean; toggle: () => void; ref: React.Ref<HTMLButtonElement> }) => ReactNode;
  items: MenuItem[] | (() => MenuItem[]);
  align?: 'start' | 'end';
  header?: ReactNode;
  width?: number;
}

export function Menu({ trigger, items, align = 'start', header, width = 220 }: MenuProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const left = align === 'end' ? r.right - width : r.left;
    const top = r.bottom + 6;
    const maxLeft = window.innerWidth - width - 8;
    setPos({ top, left: Math.max(8, Math.min(left, maxLeft)) });
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const list = open ? (typeof items === 'function' ? items() : items) : [];

  return (
    <>
      {trigger({ open, toggle: () => setOpen((o) => !o), ref: btnRef })}
      {open &&
        pos &&
        createPortal(
          <div className="menu" ref={menuRef} style={{ top: pos.top, left: pos.left, width }} role="menu">
            {header && <div className="menu-header">{header}</div>}
            {list.map((item, i) =>
              item.divider ? (
                <div className="menu-divider" key={i} />
              ) : item.heading ? (
                <div className="menu-heading" key={i}>
                  {item.label}
                </div>
              ) : (
                <button
                  key={i}
                  type="button"
                  role="menuitem"
                  className={cx('menu-item', item.danger && 'is-danger', item.checked && 'is-checked')}
                  disabled={item.disabled}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect?.();
                  }}
                >
                  <span className="menu-icon">{item.icon}</span>
                  <span className="menu-label">{item.label}</span>
                  {item.hint && <span className="menu-hint">{item.hint}</span>}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

interface PopoverProps {
  trigger: (props: { open: boolean; toggle: () => void; ref: React.Ref<HTMLButtonElement> }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  width?: number;
  className?: string;
  label?: string;
}

/** 버튼 아래에 여는 자유 형식 패널 (바깥 클릭 · Esc로 닫힘) */
export function Popover({ trigger, children, align = 'start', width = 300, className, label }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const left = align === 'end' ? r.right - width : r.left;
    setPos({ top: r.bottom + 8, left: Math.max(8, Math.min(left, window.innerWidth - width - 8)) });
  }, [open, align, width]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);
  return (
    <>
      {trigger({ open, toggle: () => setOpen((o) => !o), ref: btnRef })}
      {open &&
        pos &&
        createPortal(
          <div className={cx('popover', className)} ref={panelRef} style={{ top: pos.top, left: pos.left, width }} role="dialog" aria-label={label}>
            {children(close)}
          </div>,
          document.body,
        )}
    </>
  );
}

/* ───────────── 입력 ───────────── */

export function Field({ label, hint, error, children }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

/** 클릭하면 이름을 바꿀 수 있는 텍스트 (Enter/blur 시 저장, Esc 취소) */
export function InlineEdit({
  value,
  onCommit,
  disabled,
  className,
  placeholder,
  editing: controlledEditing,
  onEditingChange,
}: {
  value: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  editing?: boolean;
  onEditingChange?: (v: boolean) => void;
}) {
  const [localEditing, setLocalEditing] = useState(false);
  const editing = controlledEditing ?? localEditing;
  const setEditing = (v: boolean) => {
    setLocalEditing(v);
    onEditingChange?.(v);
  };
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  if (!editing) {
    return (
      <span
        className={cx('inline-edit', !disabled && 'is-editable', className)}
        onDoubleClick={() => !disabled && setEditing(true)}
        title={disabled ? undefined : '더블클릭하여 이름 변경'}
      >
        {value || <span className="muted">{placeholder}</span>}
      </span>
    );
  }
  const commit = () => {
    setEditing(false);
    const v = draft.trim();
    if (v && v !== value) onCommit(v);
    else setDraft(value);
  };
  return (
    <input
      className={cx('inline-edit-input', className)}
      value={draft}
      autoFocus
      onFocus={(e) => {
        const dot = e.currentTarget.value.lastIndexOf('.');
        e.currentTarget.setSelectionRange(0, dot > 0 ? dot : e.currentTarget.value.length);
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
    />
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/* ───────────── 확인 대화상자 (Promise 기반) ───────────── */

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  danger?: boolean;
  /** 입력해야 확인 가능한 문자열 (예: 템플릿 이름) */
  requireText?: string;
}

type ConfirmRequest = ConfirmOptions & { resolve: (ok: boolean) => void };
let pushConfirm: ((r: ConfirmRequest) => void) | null = null;

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!pushConfirm) return resolve(window.confirm(opts.title));
    pushConfirm({ ...opts, resolve });
  });
}

export function ConfirmHost() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const [typed, setTyped] = useState('');
  useEffect(() => {
    pushConfirm = (r) => {
      setTyped('');
      setReq(r);
    };
    return () => {
      pushConfirm = null;
    };
  }, []);
  if (!req) return null;
  const close = (ok: boolean) => {
    req.resolve(ok);
    setReq(null);
  };
  const blocked = req.requireText !== undefined && typed !== req.requireText;
  return (
    <Modal
      title={req.title}
      onClose={() => close(false)}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)}>
            취소
          </Button>
          <Button variant={req.danger ? 'danger' : 'primary'} onClick={() => close(true)} disabled={blocked} data-autofocus>
            {req.confirmText ?? '확인'}
          </Button>
        </>
      }
    >
      {req.message && <div className="confirm-message">{req.message}</div>}
      {req.requireText !== undefined && (
        <Field label={<>확인을 위해 <b>{req.requireText}</b> 을(를) 입력하세요</>}>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </Field>
      )}
    </Modal>
  );
}

/* ───────────── 프롬프트 (이름 입력) ───────────── */

interface PromptOptions {
  title: string;
  label?: string;
  placeholder?: string;
  initial?: string;
  confirmText?: string;
  validate?: (v: string) => string | null;
}
type PromptRequest = PromptOptions & { resolve: (v: string | null) => void };
let pushPrompt: ((r: PromptRequest) => void) | null = null;

export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    if (!pushPrompt) return resolve(window.prompt(opts.title, opts.initial ?? ''));
    pushPrompt({ ...opts, resolve });
  });
}

export function PromptHost() {
  const [req, setReq] = useState<PromptRequest | null>(null);
  const [value, setValue] = useState('');
  useEffect(() => {
    pushPrompt = (r) => {
      setValue(r.initial ?? '');
      setReq(r);
    };
    return () => {
      pushPrompt = null;
    };
  }, []);
  if (!req) return null;
  const error = value.trim() ? req.validate?.(value.trim()) ?? null : null;
  const close = (v: string | null) => {
    req.resolve(v);
    setReq(null);
  };
  const submit = () => {
    const v = value.trim();
    if (!v || error) return;
    close(v);
  };
  return (
    <Modal
      title={req.title}
      onClose={() => close(null)}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(null)}>
            취소
          </Button>
          <Button variant="primary" onClick={submit} disabled={!value.trim() || !!error}>
            {req.confirmText ?? '확인'}
          </Button>
        </>
      }
    >
      <Field label={req.label ?? '이름'} error={error}>
        <input
          className="input"
          value={value}
          placeholder={req.placeholder}
          data-autofocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </Field>
    </Modal>
  );
}
