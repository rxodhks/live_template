import { useEffect, useState } from 'react';
import { LogOut, MonitorSmartphone } from 'lucide-react';
import type { SessionInfo } from '@shared/types';
import { useSession } from '../store/session';
import { toast } from '../store/toasts';
import { api, errorMessage } from '../lib/api';
import { formatDate } from '../lib/time';
import { Button, IconButton, Spinner, confirmDialog } from './ui';
import { deviceName, t } from '../i18n';

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
      title: t('이 기기를 로그아웃할까요?'),
      message: t('{name}에서 로그아웃됩니다. 다시 로그인하면 새 기기 로그인 알림 메일이 갑니다.', { name: deviceName(s.name) }),
      confirmText: t('로그아웃'),
      danger: true,
    });
    if (!ok) return;
    try {
      await revokeSession(s.id);
      setList((prev) => (prev ?? []).filter((x) => x.id !== s.id));
    } catch (err) {
      toast.error(t('로그아웃하지 못했습니다'), errorMessage(err));
    }
  };

  const revokeAll = async () => {
    const ok = await confirmDialog({
      title: t('다른 기기를 모두 로그아웃할까요?'),
      message:
        t('지금 쓰는 이 기기만 로그인된 상태로 남습니다. 내가 로그인한 적 없는 기기가 보였다면 위의 패스키 목록에서 모르는 패스키도 삭제하고, 메일 계정의 비밀번호를 바꿔 주세요.'),
      confirmText: t('모두 로그아웃'),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const removed = await logoutOthers();
      setList((prev) => (prev ?? []).filter((x) => x.current));
      toast.success(
        t('다른 기기를 로그아웃했습니다'),
        [removed > 0 ? t('{removed}개 기기에서 로그아웃했습니다.', { removed }) : '', t('등록한 패스키는 그대로이니, 모르는 패스키가 있으면 위의 패스키 목록에서 삭제해 주세요.')]
          .filter(Boolean)
          .join(' '),
      );
    } catch (err) {
      toast.error(t('로그아웃하지 못했습니다'), errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="passkey-section">
      <div className="passkey-head">
        <div>
          <b>
            <MonitorSmartphone size={15} /> {t('로그인된 기기')}
          </b>
          <p className="muted small">{t('처음 보는 기기에서 로그인하면 메일로 알려 드립니다.')}</p>
        </div>
        {!offline && others.length > 0 && (
          <Button size="sm" variant="danger" onClick={() => void revokeAll()} loading={busy}>
            {t('다른 기기 모두 로그아웃')}
          </Button>
        )}
      </div>
      {offline ? (
        <p className="muted small">{t('서버에 연결되면 관리할 수 있습니다.')}</p>
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
                  {deviceName(s.name)}
                  {s.current && <span className="session-current">{t('이 기기')}</span>}
                </b>
                <span className="muted small">
                  {t('{date} 로그인', { date: formatDate(s.createdAt) })} · {t('{date} 마지막 사용', { date: formatDate(s.lastSeenAt) })}
                </span>
              </div>
              {!s.current && (
                <IconButton label={t('이 기기 로그아웃')} onClick={() => void revoke(s)}>
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
