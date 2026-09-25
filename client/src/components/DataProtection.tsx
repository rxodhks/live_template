import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArchiveRestore, Copy, History, Trash2 } from 'lucide-react';
import type { TemplateEntry, TrashEntry, VersionInfo } from '@shared/types';
import { errorMessage } from '../lib/api';
import { copyVersion, deleteTemplate, listTrash, listVersions, purgeFromTrash, restoreFromTrash } from '../lib/templateOps';
import { formatDate, formatTime, relativeTime } from '../lib/time';
import { isPrivate } from '../store/templates';
import { toast } from '../store/toasts';
import { Button, EmptyState, Modal, Spinner, confirmDialog } from './ui';

/*
 * 데이터 보호 화면
 *  · 휴지통: 삭제한 템플릿은 30일 동안 보관 — 소유자가 그대로 복원할 수 있다
 *  · 버전 기록: 문서 전체가 1시간마다 저장되고, 이전 버전으로 사본을 만들 수 있다
 */

/** 삭제 확인 — 휴지통으로 이동한다는 것을 알려 준다 */
export function confirmTrash(t: TemplateEntry): Promise<boolean> {
  return confirmDialog({
    title: '템플릿을 휴지통으로 옮길까요?',
    message: isPrivate(t)
      ? '휴지통에서 30일 동안 그대로 복원할 수 있고, 그 뒤 영구 삭제됩니다.'
      : '접속 중인 멤버도 모두 나가게 되고, 휴지통에 있는 동안은 아무도 열 수 없습니다. 30일 안에 그대로 복원할 수 있고, 그 뒤 영구 삭제됩니다.',
    confirmText: '휴지통으로 이동',
    danger: true,
  });
}

export async function trashTemplate(t: TemplateEntry): Promise<boolean> {
  try {
    await deleteTemplate(t);
    toast.show({ kind: 'danger', title: '휴지통으로 옮겼습니다', message: `${t.emoji} ${t.name} · 30일 안에 대시보드의 휴지통에서 복원할 수 있습니다.` });
    return true;
  } catch (err) {
    toast.error('삭제하지 못했습니다', errorMessage(err));
    return false;
  }
}

const DAY = 86_400_000;

export function TrashDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<TrashEntry[] | null>(null);
  const [ttl, setTtl] = useState(30);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    listTrash()
      .then((r) => {
        setItems(r.trash);
        setTtl(r.ttlDays);
      })
      .catch((err) => {
        setItems([]);
        toast.error('휴지통을 불러오지 못했습니다', errorMessage(err));
      });
  }, []);
  useEffect(load, [load]);

  const restore = async (e: TrashEntry) => {
    setBusy(e.template.id);
    try {
      const t = await restoreFromTrash(e.template.id);
      toast.success('템플릿을 복원했습니다', `${t.emoji} ${t.name} · 내용과 멤버가 그대로 돌아왔습니다.`);
      setItems((list) => list?.filter((x) => x.template.id !== e.template.id) ?? null);
      onClose();
      navigate(`/t/${t.id}`);
    } catch (err) {
      toast.error('복원하지 못했습니다', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const purge = async (e: TrashEntry) => {
    const ok = await confirmDialog({
      title: '영구 삭제할까요?',
      message: '디자인 · 코드 · 문서 · 비밀 노트 · 채팅 · 타임라인 · 버전 기록이 모두 지워지며 되돌릴 수 없습니다.',
      confirmText: '영구 삭제',
      danger: true,
      requireText: e.template.name,
    });
    if (!ok) return;
    setBusy(e.template.id);
    try {
      await purgeFromTrash(e.template.id);
      toast.show({ kind: 'danger', title: '영구 삭제했습니다', message: e.template.name });
      setItems((list) => list?.filter((x) => x.template.id !== e.template.id) ?? null);
    } catch (err) {
      toast.error('삭제하지 못했습니다', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title="휴지통"
      icon={<Trash2 size={18} />}
      description={`삭제한 템플릿은 ${ttl}일 동안 보관됩니다. 내가 소유한 템플릿만 보이며, 복원하면 내용 · 멤버 · 기록이 그대로 돌아옵니다.`}
      onClose={onClose}
      width={560}
    >
      {items === null ? (
        <div className="center-fill trash-loading">
          <Spinner size={22} />
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={<Trash2 size={28} />} title="휴지통이 비어 있습니다">
          삭제한 템플릿이 여기에 {ttl}일 동안 보관됩니다.
        </EmptyState>
      ) : (
        <ul className="trash-list">
          {items.map((e) => {
            const days = Math.max(0, Math.ceil((e.purgeAt - Date.now()) / DAY));
            return (
              <li key={e.template.id} className="trash-item">
                <span className="trash-emoji">{e.template.emoji}</span>
                <div className="trash-info">
                  <b>{e.template.name}</b>
                  <span className="muted small">
                    {relativeTime(e.deletedAt)} 삭제{e.deletedBy ? ` · ${e.deletedBy.name}` : ''} · <b className="trash-days">{days}일 뒤 영구 삭제</b>
                  </span>
                </div>
                <Button size="sm" variant="primary" icon={<ArchiveRestore size={14} />} loading={busy === e.template.id} onClick={() => void restore(e)}>
                  복원
                </Button>
                <Button size="sm" variant="ghost" disabled={busy === e.template.id} onClick={() => void purge(e)}>
                  영구 삭제
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

const versionLabel = (at: number) => {
  const d = new Date(at);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** 템플릿 설정의 버전 기록 */
export function VersionHistory({ template: t }: { template: TemplateEntry }) {
  const navigate = useNavigate();
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    listVersions(t.id)
      .then((r) => setVersions(r.versions))
      .catch((err) => setError(errorMessage(err)));
  }, [t.id]);

  const copy = async (v: VersionInfo) => {
    setBusy(v.id);
    try {
      const label = versionLabel(v.at);
      const created = await copyVersion(t, v, label);
      toast.success('이전 버전으로 사본을 만들었습니다', `${created.name} · 원래 템플릿은 그대로입니다.`);
      navigate(`/t/${created.id}`);
    } catch (err) {
      toast.error('사본을 만들지 못했습니다', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const shown = versions && !showAll ? versions.slice(0, 8) : versions;

  return (
    <section className="settings-card">
      <h2>
        <History size={16} /> 버전 기록
      </h2>
      <p className="muted small">
        디자인 · 코드 · 문서 전체가 변경이 있을 때 1시간마다 자동으로 저장됩니다. 최근 48시간은 모두, 그 전은 하루에 하나씩 30일까지 보관합니다.
        되돌릴 때는 지금 템플릿을 덮어쓰지 않고, 그 버전으로 <b>나만 보는 사본</b>을 만듭니다. (비밀 노트는 버전 기록에 포함되지 않습니다)
      </p>
      {error ? (
        <p className="muted small">{error}</p>
      ) : !shown ? (
        <Spinner size={18} />
      ) : shown.length === 0 ? (
        <p className="muted small">아직 저장된 버전이 없습니다. 내용을 고치면 곧 첫 버전이 저장됩니다.</p>
      ) : (
        <ul className="version-list">
          {shown.map((v, i) => (
            <li key={v.id} className="version-item">
              <div>
                <b>
                  {formatDate(v.at)} {formatTime(v.at)}
                </b>
                <span className="muted small">
                  {i === 0 && versions![0].id === v.id ? '가장 최근 · ' : ''}
                  {relativeTime(v.at)} · {(v.size / 1024).toFixed(v.size < 10_240 ? 1 : 0)}KB
                </span>
              </div>
              <Button size="sm" icon={<Copy size={13} />} loading={busy === v.id} disabled={busy !== null} onClick={() => void copy(v)}>
                이 버전으로 사본 만들기
              </Button>
            </li>
          ))}
        </ul>
      )}
      {versions && versions.length > 8 && !showAll && (
        <button type="button" className="link small" onClick={() => setShowAll(true)}>
          전체 {versions.length}개 보기
        </button>
      )}
    </section>
  );
}
