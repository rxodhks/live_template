import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Lock, LockOpen, Plus, ShieldCheck, Trash2, Timer } from 'lucide-react';
import type { SecretNoteMeta } from '@shared/types';
import { NOTE_FRAGMENT } from '@shared/schema';
import { useWorkspace, viewPath } from '../../workspace/context';
import { useSession } from '../../store/session';
import { useUI } from '../../store/ui';
import { toast } from '../../store/toasts';
import { useTick } from '../../hooks/useInterval';
import { ApiError, errorMessage } from '../../lib/api';
import type { NoteSession, UnlockedNote as Unlocked } from '../../lib/notes';
import { formatDate, relativeTime } from '../../lib/time';
import { cx } from '../../lib/util';
import { Avatar, Button, EmptyState, Field, IconButton, Modal, Spinner } from '../../components/ui';
import { CursorPage, useViewers } from '../../components/Cursors';
import { DocEditor } from '../docs/DocEditor';

/** 편집이 없으면 자동으로 잠그는 시간 */
const IDLE_LOCK_MS = 10 * 60 * 1000;

export function NotesModule() {
  const ws = useWorkspace();
  const newNoteOpen = useUI((s) => s.newNoteOpen);
  const setNewNoteOpen = useUI((s) => s.setNewNoteOpen);
  const note = ws.view.itemId ? ws.notes.find((n) => n.id === ws.view.itemId) : undefined;

  return (
    <>
      {ws.view.itemId ? note ? <NoteView key={note.id} note={note} /> : <NoteMissing /> : <NotesList />}
      {newNoteOpen && <NewNoteModal onClose={() => setNewNoteOpen(false)} />}
    </>
  );
}

function NoteMissing() {
  const ws = useWorkspace();
  return (
    <EmptyState icon={<Lock size={32} />} title="비밀 노트를 찾을 수 없습니다" action={<Button onClick={() => ws.go('notes')}>목록으로</Button>}>
      삭제되었거나 아직 목록을 불러오는 중입니다.
    </EmptyState>
  );
}

function NotesList() {
  const ws = useWorkspace();
  const setNewNoteOpen = useUI((s) => s.setNewNoteOpen);
  return (
    <CursorPage>
      <header className="page-header">
        <h1>
          <Lock size={22} /> 비밀 노트
        </h1>
        <p className="muted">이 템플릿의 멤버 중 비밀번호를 아는 사람만 열어 볼 수 있는 숨겨진 노트입니다. 여러 명이 동시에 열어 실시간으로 함께 편집할 수 있습니다.</p>
      </header>
      <div className="security-note">
        <ShieldCheck size={18} />
        <div>
          <b>어떻게 보호되나요?</b>
          <span>
            비밀번호는 어디에도 저장되지 않습니다. 브라우저에서 비밀번호로 만든 키(PBKDF2 60만 회)로 본문을 <b>AES-256-GCM</b> 암호화하므로,{' '}
            {ws.mode === 'shared' ? '클라우드에는 암호문만 저장되어 서버 운영자도 읽을 수 없습니다.' : '이 브라우저에도 암호문으로만 저장됩니다.'} 5회 연속 틀리면 5분간 잠깁니다.
          </span>
        </div>
      </div>
      {ws.canEdit && (
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setNewNoteOpen(true)}>
          새 비밀 노트
        </Button>
      )}
      {ws.notes.length === 0 ? (
        <EmptyState icon={<KeyRound size={30} />} title="아직 비밀 노트가 없습니다">
          API 키, 계정 정보, 민감한 회의 내용처럼 팀 안에서만 공유할 내용을 적어 두세요.
        </EmptyState>
      ) : (
        <div className="note-grid">
          {ws.notes.map((n) => (
            <NoteCard key={n.id} note={n} />
          ))}
        </div>
      )}
    </CursorPage>
  );
}

function NoteCard({ note }: { note: SecretNoteMeta }) {
  const ws = useWorkspace();
  const unlocked = !!ws.tickets[note.id];
  const viewers = useViewers({ module: 'notes', itemId: note.id });
  return (
    <button className={cx('note-card', unlocked && 'is-unlocked')} onClick={() => ws.go('notes', note.id)}>
      <span className="note-lock">{unlocked ? <LockOpen size={20} /> : <Lock size={20} />}</span>
      <b>{note.title}</b>
      <span className="muted small">
        <Avatar user={note.createdBy} size={18} /> {note.createdBy.name} · {formatDate(note.createdAt)}
      </span>
      {note.hint && <span className="note-hint">힌트: {note.hint}</span>}
      <span className="note-card-foot">
        {unlocked ? '잠금 해제됨' : '비밀번호 필요'}
        {viewers.length > 0 && ` · ${viewers.length}명 열람 중`}
      </span>
    </button>
  );
}

function strength(pw: string): { score: number; label: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const label = pw.length < 4 ? '너무 짧음' : score <= 1 ? '약함' : score <= 3 ? '보통' : '강함';
  return { score: Math.min(score, 4), label };
}

function NewNoteModal({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [hint, setHint] = useState('');
  const [saving, setSaving] = useState(false);
  const s = strength(pw);
  const mismatch = pw2.length > 0 && pw !== pw2;
  const valid = title.trim() && pw.length >= 4 && pw === pw2;

  const create = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      // 만든 사람은 바로 열 수 있도록 잠금 해제된 상태로
      const { meta, unlocked } = await ws.notesApi.create({ title, hint, password: pw });
      ws.setTicket(meta.id, unlocked);
      toast.success(
        '비밀 노트를 만들었습니다',
        ws.mode === 'shared' ? `‘${meta.title}’ · 비밀번호를 팀원에게 안전하게 전달하세요.` : `‘${meta.title}’ · 비밀번호를 잊으면 누구도 열 수 없습니다.`,
      );
      onClose();
      navigate(viewPath(ws.template.id, 'notes', meta.id));
    } catch (err) {
      toast.error('비밀 노트를 만들지 못했습니다', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="새 비밀 노트"
      description="템플릿 멤버 중 비밀번호를 아는 사람만 열 수 있습니다."
      icon={<Lock size={18} />}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" onClick={create} loading={saving} disabled={!valid}>
            만들기
          </Button>
        </>
      }
    >
      <div className="form-stack" onKeyDown={(e) => e.key === 'Enter' && void create()}>
        <Field label="제목" hint="제목은 멤버 모두에게 보입니다. 내용만 암호화됩니다.">
          <input className="input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder="예) 배포 서버 계정" data-autofocus />
        </Field>
        <Field label="비밀번호" hint={pw ? `강도: ${s.label}` : '4자 이상'}>
          <input className="input" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          <span className="strength">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={cx('strength-bar', i < s.score && `on-${s.score}`)} />
            ))}
          </span>
        </Field>
        <Field label="비밀번호 확인" error={mismatch ? '비밀번호가 일치하지 않습니다' : undefined}>
          <input className="input" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </Field>
        <Field label="힌트 (선택)" hint="잠금 화면에 표시됩니다. 비밀번호 자체는 넣을 수 없습니다.">
          <input className="input" value={hint} maxLength={80} onChange={(e) => setHint(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function NoteView({ note }: { note: SecretNoteMeta }) {
  const ws = useWorkspace();
  const ticket = ws.tickets[note.id];
  if (ticket && ticket.expiresAt > Date.now()) return <UnlockedNote key={`${ticket.ticket}:${ticket.expiresAt}`} note={note} ticket={ticket} />;
  return <LockScreen note={note} />;
}

function LockScreen({ note }: { note: SecretNoteMeta }) {
  const ws = useWorkspace();
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  useTick(1000);
  const remainingLock = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));

  const unlock = async () => {
    if (!pw || busy || remainingLock) return;
    setBusy(true);
    try {
      ws.setTicket(note.id, await ws.notesApi.unlock(note, pw));
      toast.success('잠금을 해제했습니다', `‘${note.title}’`);
    } catch (err) {
      setPw('');
      setShake((n) => n + 1);
      if (err instanceof ApiError && err.status === 429) setLockedUntil(Date.now() + Number(err.data.retryAfter ?? 60) * 1000);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CursorPage className="lock-page" cursors={false}>
      <div className="lock-card" key={shake} data-shake={shake > 0}>
        <div className="lock-icon">
          <Lock size={30} />
        </div>
        <h1>{note.title}</h1>
        <p className="muted small">
          <Avatar user={note.createdBy} size={18} /> {note.createdBy.name} 님이 {relativeTime(note.createdAt)} 만든 비밀 노트
        </p>
        {note.hint && <p className="note-hint">💡 힌트: {note.hint}</p>}
        <form
          className="lock-form"
          onSubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
        >
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            placeholder="비밀번호"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            disabled={remainingLock > 0}
            autoFocus
          />
          <Button variant="primary" type="submit" loading={busy} disabled={!pw || remainingLock > 0} icon={<LockOpen size={15} />}>
            열기
          </Button>
        </form>
        {remainingLock > 0 ? (
          <p className="lock-error">너무 많이 틀렸습니다. {remainingLock}초 후 다시 시도하세요.</p>
        ) : (
          error && <p className="lock-error">{error}</p>
        )}
        <p className="muted small">비밀번호 입력 실패도 타임라인에 기록됩니다.</p>
      </div>
    </CursorPage>
  );
}

function UnlockedNote({ note, ticket }: { note: SecretNoteMeta; ticket: Unlocked }) {
  const ws = useWorkspace();
  const me = useSession((s) => s.user)!;
  const [state, setState] = useState<{ doc: Y.Doc; session: NoteSession } | null>(null);
  const [status, setStatus] = useState<NoteSession['status']>('loading');
  const [changePw, setChangePw] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const lastEdit = useRef(Date.now());
  /** 내가 비밀번호를 바꾸거나 지우는 중에는 "잠김" 알림을 띄우지 않는다 */
  const selfChange = useRef(false);
  const viewers = useViewers(ws.view);
  useTick(15_000);

  const lock = async (reason?: string) => {
    ws.setTicket(note.id, null);
    if (reason) toast.show({ kind: 'warning', title: '비밀 노트가 잠겼습니다', message: reason });
  };

  // 암호화된 노트 문서 열기 (복호화한 내용은 메모리에만 둔다)
  useEffect(() => {
    const doc = new Y.Doc();
    const session = ws.notesApi.open(note, ticket, doc, {
      canEdit: ws.canEdit,
      onLocked: (reason) => {
        if (selfChange.current) return;
        ws.setTicket(note.id, null);
        const msg =
          reason === 'password' ? '다른 멤버가 비밀번호를 변경했습니다. 새 비밀번호로 다시 여세요.' : reason === 'deleted' ? '노트가 삭제되었습니다.' : '잠금 해제 시간이 만료되었습니다.';
        toast.show({ kind: 'warning', title: `‘${note.title}’ 잠김`, message: msg });
      },
      onError: (message, code) => {
        if (code === 401) {
          ws.setTicket(note.id, null);
          toast.warning('다시 잠금 해제가 필요합니다', message);
        } else toast.error('노트를 열 수 없습니다', message);
      },
    });
    const unsub = session.subscribe(() => setStatus(session.status));
    setStatus(session.status);
    setState({ doc, session });
    return () => {
      unsub();
      session.destroy();
      doc.destroy();
      setState(null);
    };
  }, [note.id, ticket]); // eslint-disable-line react-hooks/exhaustive-deps

  // 편집이 없으면 자동 잠금
  useEffect(() => {
    const t = setInterval(() => {
      if (Date.now() - lastEdit.current > IDLE_LOCK_MS) void lock('10분 동안 활동이 없어 자동으로 잠갔습니다.');
      else if (ticket.expiresAt < Date.now()) void lock('잠금 해제 유지 시간(30분)이 지났습니다.');
    }, 10_000);
    const bumpActivity = () => (lastEdit.current = Date.now());
    window.addEventListener('keydown', bumpActivity);
    window.addEventListener('pointerdown', bumpActivity);
    return () => {
      clearInterval(t);
      window.removeEventListener('keydown', bumpActivity);
      window.removeEventListener('pointerdown', bumpActivity);
    };
  }, [ticket.expiresAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const minutesLeft = Math.max(0, Math.ceil((ticket.expiresAt - Date.now()) / 60_000));

  return (
    <div className="notes-module">
      <div className="module-toolbar note-toolbar">
        <LockOpen size={16} className="note-open-icon" />
        <span className="toolbar-title-text">{note.title}</span>
        <span className="note-badge" data-tip="브라우저에서 AES-256-GCM으로 암호화한 뒤 저장합니다 (종단 간 암호화)">
          <ShieldCheck size={13} /> 암호화됨
        </span>
        {viewers.length > 0 && (
          <span className="toolbar-viewers">
            {viewers.map((v) => (
              <Avatar key={v.socketId} user={v.user} size={22} tooltip={`${v.user.name} 님도 열람 중`} />
            ))}
          </span>
        )}
        <span className="toolbar-spacer" />
        <span className="note-timer" data-tip="잠금 해제는 최대 30분 유지되며, 10분간 활동이 없으면 자동으로 잠깁니다">
          <Timer size={13} /> {minutesLeft}분 남음
        </span>
        {ws.canEdit && (
          <Button size="sm" variant="ghost" icon={<KeyRound size={14} />} onClick={() => setChangePw(true)}>
            비밀번호 변경
          </Button>
        )}
        {ws.canEdit && (
          <IconButton label="노트 삭제" onClick={() => setDeleting(true)}>
            <Trash2 size={16} />
          </IconButton>
        )}
        <Button size="sm" icon={<Lock size={14} />} onClick={() => void lock()}>
          잠그기
        </Button>
      </div>
      {!state || (status !== 'ready' && status !== 'offline') ? (
        <div className="center-fill">
          {status === 'error' ? <span className="muted">노트를 열 수 없습니다.</span> : <Spinner size={24} />}
        </div>
      ) : (
        <DocEditor
          fragment={state.doc.getXmlFragment(NOTE_FRAGMENT)}
          awareness={state.session.awareness}
          user={me}
          readOnly={!ws.canEdit}
          docKey={`note:${note.id}`}
          placeholder="여기에 적은 내용은 암호화되어 저장되고, 비밀번호를 아는 멤버에게만 보입니다."
          onLocalEdit={() => {
            lastEdit.current = Date.now();
            ws.action('🔒 비밀 노트 편집 중');
            ws.report({ type: 'notes.edit', targetId: note.id, targetName: note.title });
          }}
          header={
            <div className="doc-title-row">
              <span className="doc-emoji">🔐</span>
              <span className="doc-title as-text">{note.title}</span>
            </div>
          }
        />
      )}
      {changePw && state && <ChangePasswordModal note={note} doc={state.doc} selfChange={selfChange} onClose={() => setChangePw(false)} />}
      {deleting && <DeleteNoteModal note={note} selfChange={selfChange} onClose={() => setDeleting(false)} />}
    </div>
  );
}

function ChangePasswordModal({ note, doc, selfChange, onClose }: { note: SecretNoteMeta; doc: Y.Doc; selfChange: { current: boolean }; onClose: () => void }) {
  const ws = useWorkspace();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [hint, setHint] = useState(note.hint);
  const [saving, setSaving] = useState(false);
  const valid = current && next.length >= 4 && next === next2;
  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      selfChange.current = true;
      const unlocked = await ws.notesApi.changePassword(note, current, next, hint, doc);
      ws.setTicket(note.id, unlocked);
      toast.success('비밀번호를 변경했습니다', ws.mode === 'shared' ? '내용을 새 키로 다시 암호화했습니다. 열람 중이던 다른 멤버는 새 비밀번호로 다시 열어야 합니다.' : '내용을 새 키로 다시 암호화했습니다.');
      onClose();
    } catch (err) {
      selfChange.current = false;
      toast.error('변경하지 못했습니다', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title="비밀번호 변경"
      description={note.title}
      icon={<KeyRound size={18} />}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" onClick={submit} loading={saving} disabled={!valid}>
            변경
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <Field label="현재 비밀번호">
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} data-autofocus />
        </Field>
        <Field label="새 비밀번호" hint="4자 이상 · 변경 즉시 내용이 새 키로 다시 암호화됩니다">
          <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="새 비밀번호 확인" error={next2 && next !== next2 ? '비밀번호가 일치하지 않습니다' : undefined}>
          <input className="input" type="password" autoComplete="new-password" value={next2} onChange={(e) => setNext2(e.target.value)} />
        </Field>
        <Field label="힌트 (선택)">
          <input className="input" value={hint} maxLength={80} onChange={(e) => setHint(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function DeleteNoteModal({ note, selfChange, onClose }: { note: SecretNoteMeta; selfChange: { current: boolean }; onClose: () => void }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const isOwner = ws.role === 'owner';
  const submit = async () => {
    setBusy(true);
    try {
      selfChange.current = true;
      await ws.notesApi.remove(note, pw, isOwner && force);
      ws.setTicket(note.id, null);
      toast.show({ kind: 'danger', title: '비밀 노트를 삭제했습니다', message: note.title });
      onClose();
      navigate(viewPath(ws.template.id, 'notes'));
    } catch (err) {
      selfChange.current = false;
      toast.error('삭제하지 못했습니다', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="비밀 노트를 삭제할까요?"
      description={`‘${note.title}’의 암호화된 내용이 영구 삭제됩니다.`}
      icon={<Trash2 size={18} />}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="danger" onClick={submit} loading={busy} disabled={!pw && !(isOwner && force)}>
            영구 삭제
          </Button>
        </>
      }
    >
      <div className="form-stack">
        <Field label="비밀번호 확인">
          <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} disabled={force} data-autofocus />
        </Field>
        {isOwner && (
          <label className="check">
            <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> 소유자 권한으로 비밀번호 없이 삭제
          </label>
        )}
      </div>
    </Modal>
  );
}
