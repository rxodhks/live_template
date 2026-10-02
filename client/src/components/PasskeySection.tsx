import { useEffect, useState } from 'react';
import { Fingerprint, Trash2 } from 'lucide-react';
import type { PasskeyInfo } from '@shared/types';
import { useSession } from '../store/session';
import { toast } from '../store/toasts';
import { errorMessage } from '../lib/api';
import { deletePasskey, isPasskeyCancel, listPasskeys, passkeySupported, registerPasskey, rememberLogin } from '../lib/passkey';
import { formatDate } from '../lib/time';
import { Button, IconButton, Spinner, confirmDialog } from './ui';

/** 로그인용 패스키: 등록한 기기 목록 · 추가 · 삭제 */
export function PasskeySection() {
  const offline = useSession((s) => s.offline);
  const [list, setList] = useState<PasskeyInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const supported = passkeySupported();

  useEffect(() => {
    if (offline) return;
    listPasskeys()
      .then(setList)
      .catch((err) => setError(errorMessage(err)));
  }, [offline]);

  const syncCount = (n: number) => {
    const s = useSession.getState();
    if (s.user && s.account) s.setAuthed(s.user, { ...s.account, passkeys: n }, s.offline);
  };

  const add = async () => {
    setBusy(true);
    try {
      const key = await registerPasskey();
      const next = [...(list ?? []), key];
      setList(next);
      syncCount(next.length);
      rememberLogin('passkey');
      toast.success('패스키를 등록했습니다', '다음부터 로그인 화면에서 "패스키로 로그인"을 누르면 바로 들어옵니다.');
    } catch (err) {
      if (!isPasskeyCancel(err)) toast.error('패스키를 등록하지 못했습니다', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (key: PasskeyInfo) => {
    const ok = await confirmDialog({
      title: '패스키를 삭제할까요?',
      message: `${key.name}에서 이 패스키로 더 이상 로그인할 수 없습니다. 기기에 남은 패스키는 기기 설정(암호 관리자)에서 따로 지워 주세요.`,
      confirmText: '삭제',
      danger: true,
    });
    if (!ok) return;
    try {
      await deletePasskey(key.id);
      const next = (list ?? []).filter((k) => k.id !== key.id);
      setList(next);
      syncCount(next.length);
    } catch (err) {
      toast.error('삭제하지 못했습니다', errorMessage(err));
    }
  };

  return (
    <section className="passkey-section">
      <div className="passkey-head">
        <div>
          <b>
            <Fingerprint size={15} /> 패스키 로그인
          </b>
          <p className="muted small">이메일 · 인증 코드 없이 지문 · 얼굴 · 기기 PIN으로 바로 로그인합니다.</p>
        </div>
        {supported && !offline && (
          <Button size="sm" onClick={() => void add()} loading={busy} disabled={list === null}>
            이 기기에 추가
          </Button>
        )}
      </div>
      {offline ? (
        <p className="muted small">서버에 연결되면 관리할 수 있습니다.</p>
      ) : error ? (
        <p className="muted small">{error}</p>
      ) : list === null ? (
        <Spinner size={16} />
      ) : list.length === 0 ? (
        <p className="muted small">{supported ? '아직 등록한 패스키가 없습니다.' : '이 브라우저는 패스키를 지원하지 않습니다.'}</p>
      ) : (
        <ul className="passkey-list">
          {list.map((k) => (
            <li key={k.id}>
              <Fingerprint size={16} />
              <div>
                <b>{k.name}</b>
                <span className="muted small">
                  {formatDate(k.createdAt)} 등록{k.lastUsedAt ? ` · ${formatDate(k.lastUsedAt)} 마지막 사용` : ''}
                </span>
              </div>
              <IconButton label="패스키 삭제" onClick={() => void remove(k)}>
                <Trash2 size={15} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
