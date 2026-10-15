import { Eye, X } from 'lucide-react';
import type { RemotePresence } from '../store/presence';
import { t, tr } from '../i18n';

/** 다른 사용자를 따라가는 중일 때 화면 테두리와 배너 */
export function FollowBanner({ presence, onStop }: { presence: RemotePresence; onStop: () => void }) {
  return (
    <>
      <div className="follow-frame" style={{ ['--user-color' as string]: presence.user.color }} />
      <div className="follow-banner" style={{ ['--user-color' as string]: presence.user.color }}>
        <Eye size={14} />
        <span>
          {tr('{name} 님의 화면을 따라가는 중', { name: <b>{presence.user.name}</b> })}
        </span>
        <button onClick={onStop} aria-label={t('따라가기 중지')}>
          <X size={14} /> {t('중지')} <kbd className="kbd">Esc</kbd>
        </button>
      </div>
    </>
  );
}
