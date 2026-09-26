import { useNavigate } from 'react-router-dom';
import { ChevronDown, Eye, EyeOff, MapPin, UserPlus } from 'lucide-react';
import { useWorkspace, viewPath } from '../workspace/context';
import { MODULE_NAMES, itemName } from '../workspace/viewLabel';
import { usePresence, uniqueUsers, type RemotePresence } from '../store/presence';
import { useSession } from '../store/session';
import { useUI } from '../store/ui';
import { useTick } from '../hooks/useInterval';
import { ACTION_BUBBLE_MS } from './Cursors';
import { Avatar, IconButton, Popover } from './ui';
import { cx } from '../lib/util';

/** 한 줄에 겹쳐 보여 줄 최대 인원 (나머지는 +N) */
const STACK_MAX = 4;

/**
 * 상단 바의 접속자 표시.
 * 평소에는 프로필을 살짝 겹친 한 줄로만 보여 주고, 화살표를 누르면 전체 접속자(위치 · 방금 한 행동 · 따라가기)를 펼친다.
 */
export function PresenceBar() {
  const ws = useWorkspace();
  const me = useSession((s) => s.user)!;
  const others = usePresence((s) => s.others);
  // 내 다른 탭은 '다른 사람'이 아니므로 뺀다
  const people = uniqueUsers(others, me.id);
  const stack = people.slice(0, STACK_MAX);
  const extra = people.length - stack.length;
  const total = people.length + 1;

  return (
    <Popover
      align="end"
      width={330}
      className="presence-panel"
      label="접속 중인 사람"
      trigger={({ open, toggle, ref }) => (
        <button
          ref={ref}
          type="button"
          className={cx('presence-bar', open && 'is-open')}
          onClick={toggle}
          aria-expanded={open}
          aria-label={`접속 중 ${total}명 · 목록 ${open ? '접기' : '펼치기'}`}
          data-tip={open ? undefined : people.length ? `${people.map((p) => p.user.name).join(', ')} 님과 함께 작업 중` : '지금은 혼자 작업 중입니다'}
        >
          <span className="presence-stack">
            {stack.map((p) => (
              <span
                key={p.user.id}
                className={cx('presence-stack-item', ws.follow === p.user.id && 'is-following')}
                style={{ ['--user-color' as string]: p.user.color }}
              >
                <Avatar user={p.user} size={26} status={p.idle ? 'idle' : 'online'} tooltip={false} />
              </span>
            ))}
            {extra > 0 && <span className="presence-stack-more">+{extra}</span>}
            {people.length === 0 && (
              <span className="presence-stack-item">
                <Avatar user={me} size={26} status="online" tooltip={false} />
              </span>
            )}
          </span>
          <ChevronDown size={15} className="presence-chevron" />
        </button>
      )}
    >
      {(close) => <PresenceList people={people} close={close} />}
    </Popover>
  );
}

function PresenceList({ people, close }: { people: RemotePresence[]; close: () => void }) {
  const ws = useWorkspace();
  const me = useSession((s) => s.user)!;
  const setShareOpen = useUI((s) => s.setShareOpen);
  useTick(5000);
  return (
    <div className="presence-list">
      <div className="presence-list-head">
        <span className="live-dot" /> 접속 중 <b>{people.length + 1}</b>
      </div>
      <div className="presence-row is-me">
        <Avatar user={me} size={30} status="online" tooltip={false} />
        <div className="presence-row-text">
          <b>{me.name} (나)</b>
          <span>{MODULE_NAMES[ws.view.module]}</span>
        </div>
      </div>
      {people.map((p) => (
        <PersonRow key={p.socketId} p={p} close={close} />
      ))}
      {people.length === 0 && (
        <div className="presence-empty">
          <span>다른 멤버가 들어오면 여기에 위치와 하고 있는 일이 표시됩니다.</span>
          {ws.canEdit && (
            <button
              type="button"
              className="link small"
              onClick={() => {
                close();
                setShareOpen(true);
              }}
            >
              <UserPlus size={13} /> 팀원 초대
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function PersonRow({ p, close }: { p: RemotePresence; close: () => void }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const where = itemName(ws.doc, ws.notes, p.view.module, p.view.itemId);
  const recentAction = p.actionLabel && p.actionAt && Date.now() - p.actionAt < ACTION_BUBBLE_MS * 3 ? p.actionLabel : null;
  const following = ws.follow === p.user.id;
  const goTo = () => {
    close();
    navigate(viewPath(ws.template.id, p.view.module, p.view.itemId));
  };
  return (
    <div className={cx('presence-row', following && 'is-following')} style={{ ['--user-color' as string]: p.user.color }}>
      <button type="button" className="presence-row-main" onClick={goTo} data-tip="이 사람의 위치로 이동">
        <Avatar user={p.user} size={30} status={p.idle ? 'idle' : 'online'} tooltip={false} />
        <div className="presence-row-text">
          <b>{p.user.name}</b>
          <span>
            {p.idle ? '자리 비움 · ' : ''}
            {MODULE_NAMES[p.view.module]}
            {where ? ` › ${where}` : ''}
          </span>
          {recentAction && <span className="presence-row-action">{recentAction}</span>}
        </div>
      </button>
      <IconButton label="위치로 이동" size="sm" onClick={goTo}>
        <MapPin size={14} />
      </IconButton>
      <IconButton label={following ? '따라가기 중지' : '따라가기'} size="sm" active={following} onClick={() => ws.setFollow(following ? null : p.user.id)}>
        {following ? <EyeOff size={14} /> : <Eye size={14} />}
      </IconButton>
    </div>
  );
}
