import { useNavigate } from 'react-router-dom';
import { DoorOpen, HardDrive, Link2, UserMinus, UserPlus, Users } from 'lucide-react';
import type { Role } from '@shared/types';
import { useWorkspace } from './context';
import { useSession } from '../store/session';
import { useUI } from '../store/ui';
import { toast } from '../store/toasts';
import { usePresence } from '../store/presence';
import { api, errorMessage } from '../lib/api';
import { leaveTemplate } from '../lib/templateOps';
import { inviteSummary, useInvites } from '../lib/invites';
import { formatDate } from '../lib/time';
import { CursorPage } from '../components/Cursors';
import { Requests } from '../components/InviteDialog';
import { Avatar, Button, EmptyState, IconButton, confirmDialog } from '../components/ui';

const ROLE_INFO: Record<Role, { label: string; desc: string }> = {
  owner: { label: '소유자', desc: '모든 권한 · 멤버 관리 · 템플릿 삭제' },
  editor: { label: '편집자', desc: '디자인/코드/문서/비밀 노트 편집 · 초대 링크 만들기' },
  viewer: { label: '뷰어', desc: '읽기 전용 · 커서 공유와 채팅은 사용 가능' },
};

export function Members() {
  const ws = useWorkspace();
  return ws.isPrivate ? <PersonalMembers /> : <SharedMembers />;
}

function PersonalMembers() {
  const setShareOpen = useUI((s) => s.setShareOpen);
  const me = useSession((s) => s.user)!;
  return (
    <CursorPage>
      <header className="page-header">
        <h1>
          <Users size={22} /> 멤버
        </h1>
      </header>
      <ul className="member-list">
        <li className="member-row">
          <Avatar user={me} size={38} />
          <div className="member-info">
            <b>
              {me.name} <span className="muted">(나)</span>
            </b>
            <span className="muted small">나만 볼 수 있는 개인 공간</span>
          </div>
          <span className="role-chip role-owner">소유자</span>
        </li>
      </ul>
      <EmptyState
        icon={<HardDrive size={30} />}
        title="혼자 작업 중인 개인 공간입니다"
        action={
          <Button variant="primary" icon={<UserPlus size={15} />} onClick={() => setShareOpen(true)}>
            팀원 초대하기
          </Button>
        }
      >
        초대 링크를 만들면 이 템플릿이 협업 공간으로 전환되고, 참여한 사람들이 여기에 표시됩니다. 권한(편집자/뷰어)은 링크마다 정할 수 있습니다.
      </EmptyState>
    </CursorPage>
  );
}

function SharedMembers() {
  const ws = useWorkspace();
  const t = ws.template;
  const me = useSession((s) => s.user)!;
  const others = usePresence((s) => s.others);
  const onlineIds = new Set(Object.values(others).map((p) => p.user.id));
  const setShareOpen = useUI((s) => s.setShareOpen);
  const navigate = useNavigate();
  const isOwner = t.myRole === 'owner';
  const { invites } = useInvites(t.id, ws.canEdit);

  const setRole = async (userId: string, role: Role) => {
    try {
      await api('PATCH', `/templates/${t.id}/members/${userId}`, { role });
      toast.success('권한을 변경했습니다', ROLE_INFO[role].label);
    } catch (err) {
      toast.error('권한을 변경하지 못했습니다', errorMessage(err));
    }
  };

  const remove = async (userId: string, name: string) => {
    const self = userId === me.id;
    const ok = await confirmDialog({
      title: self ? '템플릿에서 나갈까요?' : `${name} 님을 내보낼까요?`,
      message: self ? '다시 참여하려면 새 초대 링크가 필요합니다.' : '이 사람은 즉시 연결이 끊기고 더 이상 템플릿에 접근할 수 없습니다.',
      confirmText: self ? '나가기' : '내보내기',
      danger: true,
    });
    if (!ok) return;
    try {
      if (self) {
        await leaveTemplate(t);
        navigate('/');
        toast.info('템플릿에서 나왔습니다', t.name);
      } else {
        await api('DELETE', `/templates/${t.id}/members/${userId}`);
        toast.show({ kind: 'warning', title: '멤버를 내보냈습니다', message: name });
      }
    } catch (err) {
      toast.error('실패했습니다', errorMessage(err));
    }
  };

  return (
    <CursorPage>
      <header className="page-header page-header-row">
        <div>
          <h1>
            <Users size={22} /> 멤버 <span className="muted">{t.members.length}</span>
          </h1>
          <p className="muted">권한에 따라 편집 가능 여부가 달라집니다. 뷰어는 읽기 전용이지만 커서 공유와 채팅은 사용할 수 있습니다.</p>
        </div>
        {ws.canEdit && (
          <Button variant="primary" icon={<UserPlus size={15} />} onClick={() => setShareOpen(true)}>
            초대
          </Button>
        )}
      </header>

      {ws.canEdit && <Requests requests={ws.requests} templateId={t.id} />}

      <ul className="member-list">
        {t.members.map((m) => {
          const online = m.user.id === me.id || onlineIds.has(m.user.id);
          return (
            <li key={m.user.id} className="member-row">
              <Avatar user={m.user} size={38} status={online ? 'online' : null} />
              <div className="member-info">
                <b>
                  {m.user.name}
                  {m.user.id === me.id && <span className="muted"> (나)</span>}
                </b>
                <span className="muted small">
                  {online ? '접속 중' : '오프라인'} · {formatDate(m.joinedAt)} 참여
                </span>
              </div>
              {isOwner && m.role !== 'owner' ? (
                <select className="input select-sm" value={m.role} onChange={(e) => setRole(m.user.id, e.target.value as Role)} aria-label={`${m.user.name} 권한`}>
                  <option value="editor">편집자</option>
                  <option value="viewer">뷰어</option>
                </select>
              ) : (
                <span className={`role-chip role-${m.role}`} data-tip={ROLE_INFO[m.role].desc}>
                  {ROLE_INFO[m.role].label}
                </span>
              )}
              {m.role !== 'owner' && (isOwner || m.user.id === me.id) ? (
                <IconButton label={m.user.id === me.id ? '템플릿 나가기' : '내보내기'} size="sm" onClick={() => remove(m.user.id, m.user.name)}>
                  {m.user.id === me.id ? <DoorOpen size={16} /> : <UserMinus size={16} />}
                </IconButton>
              ) : (
                <span className="icon-btn-placeholder" />
              )}
            </li>
          );
        })}
      </ul>

      {ws.canEdit && invites && invites.length > 0 && (
        <section className="members-invites">
          <h4>
            <Link2 size={15} /> 사용 중인 초대 링크 {invites.length}개
          </h4>
          <ul>
            {invites.slice(0, 5).map((i) => (
              <li key={i.id} className="muted small">
                <span className={`role-chip role-${i.role}`}>{i.role === 'viewer' ? '뷰어' : '편집자'}</span> {i.label ? `${i.label} · ` : ''}
                {inviteSummary(i)}
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" onClick={() => setShareOpen(true)}>
            초대 링크 관리
          </Button>
        </section>
      )}

      <div className="role-legend">
        {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
          <div key={r}>
            <span className={`role-chip role-${r}`}>{ROLE_INFO[r].label}</span>
            <span className="muted small">{ROLE_INFO[r].desc}</span>
          </div>
        ))}
      </div>
    </CursorPage>
  );
}
