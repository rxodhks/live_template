import { Cloud, CloudOff, HardDrive, Loader2, RefreshCw } from 'lucide-react';
import type { TemplateMode } from '@shared/types';
import { useConnection } from '../store/connection';
import { useTick } from '../hooks/useInterval';
import { formatTime, relativeTime } from '../lib/time';
import { cx } from '../lib/util';

/** 자동 저장 상태 표시 */
export function SaveIndicator({ synced, mode }: { synced: boolean; mode: TemplateMode }) {
  const { status, pending, lastSavedAt, offlineChanges, saveError } = useConnection();
  useTick(15_000);

  if (mode === 'personal') {
    // 아직 클라우드에 올라가지 않은 템플릿 (오프라인에서 만든 경우) — 연결되면 자동으로 백업된다
    return (
      <span
        className="save-indicator is-warn"
        data-tip="이 기기에 자동 저장되어 있습니다. 인터넷에 연결되면 클라우드에 자동으로 백업됩니다."
        role="status"
      >
        <HardDrive size={15} />
        <span className="save-text">이 기기에 저장 · 백업 대기</span>
      </span>
    );
  }

  let icon = <Cloud size={15} />;
  let text = '자동 저장됨';
  let tip = '모든 변경 사항은 입력 즉시 클라우드에 자동 저장됩니다.';
  let tone = 'ok';

  if (status !== 'online') {
    icon = <CloudOff size={15} />;
    text = offlineChanges ? '오프라인 · 로컬 보관 중' : status === 'connecting' ? '연결 중…' : '오프라인';
    tip = '연결이 끊겨도 편집은 이 기기에 보관되며, 다시 연결되면 자동으로 병합됩니다.';
    tone = 'warn';
  } else if (!synced) {
    icon = <Loader2 size={15} className="spin" />;
    text = '동기화 중…';
    tone = 'busy';
  } else if (pending > 0) {
    icon = <Loader2 size={15} className="spin" />;
    text = '저장 중…';
    tone = 'busy';
  } else if (saveError) {
    icon = <RefreshCw size={15} />;
    text = '다시 동기화 중';
    tip = saveError;
    tone = 'warn';
  } else if (lastSavedAt) {
    text = `저장됨 · ${relativeTime(lastSavedAt)}`;
    tip = `마지막 저장 ${formatTime(lastSavedAt)} · 모든 변경 사항은 자동 저장됩니다.`;
  }

  return (
    <span className={cx('save-indicator', `is-${tone}`)} data-tip={tip} role="status">
      {icon}
      <span className="save-text">{text}</span>
    </span>
  );
}
