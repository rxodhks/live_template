import { useEffect, useState } from 'react';
import { LogOut, MonitorSmartphone } from 'lucide-react';
import type { SessionInfo } from '@shared/types';
import { useSession } from '../store/session';
import { toast } from '../store/toasts';
import { api, errorMessage } from '../lib/api';
import { formatDate } from '../lib/time';
import { Button, IconButton, Spinner, confirmDialog } from './ui';

const listSessions = () => api<{ sessions: SessionInfo[] }>('GET', '/me/sessions').then((r) => r.sessions);
const revokeSession = (id: string) => api('DELETE', `/me/sessions/${encodeURIComponent(id)}`);
const logoutOthers = () => api<{ removed: number }>('POST', '/me/sessions/logout-others').then((r) => r.removed);

/** 로그인된 기기: 목록 · 하나씩 로그아웃 · 이 기기만 남기고 모두 로그아웃 */
export function SessionSection() {
  const offline = useSession((s) => s.offline);
  const [list, setList] = useState<SessionInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (offline) return;
    listSessions()
      .then(setList)
      .catch((err) => setError(errorMessage(err)));
  }, [offline]);

  const others = (list ?? []).filter((s) => !s.current);

  const revoke = async (s: SessionInfo) => {
    const ok = await confirmDialog({
      title: '이 기기를 로그아웃할까요?',
      message: `${s.name}에서 로그아웃됩니다. 다시 로그인하면 새 기기 로그인 알림 메일이 갑니다.`,
      confirmText: '로그아웃',
      danger: true,
    });
    if (!ok) return;
    try {
      await revokeSession(s.id);
      setList((prev) => (prev ?? []).filter((x) => x.id !== s.id));
    } catch (err) {
      toast.error('로그아웃하지 못했습니다', errorMessage(err));
    }
  };

  const revokeAll = async () => {
    const ok = await confirmDialog({
      title: '다른 기기를 모두 로그아웃할까요?',
      message: '지금 쓰는 이 기기만 로그인된 상태로 남습니다. 내가 로그인한 적 없는 기기가 보였다면 메일 계정의 비밀번호도 바꿔 주세요.',
      confirmText: '모두 로그아웃',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const removed = await logoutOthers();
      setList((prev) => (prev ?? []).filter((x) => x.current));
      toast.success('다른 기기를 로그아웃했습니다', removed > 0 ? `${removed}개 기기에서 로그아웃했습니다.` : undefined);
    } catch (err) {
      toast.error('로그아웃하지 못했습니다', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="passkey-section">
      <div className="passkey-head">
        <div>
          <b>
            <MonitorSmartphone size={15} /> 로그인된 기기
          </b>
          <p className="muted small">처음 보는 기기에서 로그인하면 메일로 알려 드립니다.</p>
        </div>
        {!offline && others.length > 0 && (
          <Button size="sm" variant="danger" onClick={() => void revokeAll()} loading={busy}>
            다른 기기 모두 로그아웃
          </Button>
        )}
      </div>
      {offline ? (
        <p className="muted small">서버에 연결되면 관리할 수 있습니다.</p>
      ) : error ? (
        <p className="muted small">{error}</p>
      ) : list === null ? (
        <Spinner size={16} />
      ) : (
        <ul className="session-list">
          {list.map((s) => (
            <li key={s.id}>
              <MonitorSmartphone size={16} />
              <div>
                <b>
                  {s.name}
                  {s.current && <span className="session-current">이 기기</span>}
                </b>
                <span className="muted small">
                  {formatDate(s.createdAt)} 로그인 · {formatDate(s.lastSeenAt)} 마지막 사용
                </span>
              </div>
              {!s.current && (
                <IconButton label="이 기기 로그아웃" onClick={() => void revoke(s)}>
                  <LogOut size={15} />
                </IconButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
