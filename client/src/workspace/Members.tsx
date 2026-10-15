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
import { isDemoId } from '../lib/demo';
import { CursorPage } from '../components/Cursors';
import { Requests } from '../components/InviteDialog';
import { Avatar, Button, EmptyState, IconButton, confirmDialog } from '../components/ui';
import { t } from '../i18n';

const ROLE_INFO: Record<Role, { label: string; desc: string }> = {
  owner: { label: t('소유자'), desc: t('모든 권한 · 멤버 관리 · 템플릿 삭제') },
  editor: { label: t('편집자'), desc: t('디자인/코드/문서/비밀 노트 편집 · 초대 링크 만들기') },
  viewer: { label: t('뷰어'), desc: t('읽기 전용 · 커서 공유와 채팅은 사용 가능') },
};

export function Members() {
  const ws = useWorkspace();
  if (isDemoId(ws.template.id)) return <DemoMembers />;
  return ws.isPrivate ? <PersonalMembers /> : <SharedMembers />;
}

/** 둘러보기 예시: 만든 사람만 보여 주고, 초대는 가입한 뒤 내 템플릿에서 */
function DemoMembers() {
  const ws = useWorkspace();
  return (
    <CursorPage>
      <header className="page-header">
        <h1>
          <Users size={22} /> {t('멤버')}
        </h1>
      </header>
      <ul className="member-list">
        {ws.template.members.map((m) => (
          <li key={m.user.id} className="member-row">
            <Avatar user={m.user} size={38} />
            <div className="member-info">
              <b>{m.user.name}</b>
              <span className="muted small">{t('예시를 만든 사람')}</span>
            </div>
            <span className={`role-chip role-${m.role}`}>{ROLE_INFO[m.role].label}</span>
          </li>
        ))}
      </ul>
      <EmptyState icon={<Users size={30} />} title={t('예시 템플릿에는 멤버를 초대할 수 없습니다')}>
        {t('가입하고 내 템플릿을 만들면 초대 링크로 팀원과 함께 편집할 수 있습니다. 권한(편집자/뷰어)은 링크마다 정할 수 있습니다.')}
      </EmptyState>
    </CursorPage>
  );
}

function PersonalMembers() {
  const setShareOpen = useUI((s) => s.setShareOpen);
  const me = useSession((s) => s.user)!;
  return (
    <CursorPage>
      <header className="page-header">
        <h1>
          <Users size={22} /> {t('멤버')}
        </h1>
      </header>
      <ul className="member-list">
        <li className="member-row">
          <Avatar user={me} size={38} />
          <div className="member-info">
            <b>
              {me.name} <span className="muted">{t('(나)')}</span>
            </b>
            <span className="muted small">{t('나만 볼 수 있는 개인 공간')}</span>
          </div>
          <span className="role-chip role-owner">{t('소유자')}</span>
        </li>
      </ul>
      <EmptyState
        icon={<HardDrive size={30} />}
        title={t('혼자 작업 중인 개인 공간입니다')}
        action={
          <Button variant="primary" icon={<UserPlus size={15} />} onClick={() => setShareOpen(true)}>
            {t('팀원 초대하기')}
          </Button>
        }
      >
        {t('초대 링크를 만들면 이 템플릿이 협업 공간으로 전환되고, 참여한 사람들이 여기에 표시됩니다. 권한(편집자/뷰어)은 링크마다 정할 수 있습니다.')}
      </EmptyState>
    </CursorPage>
  );
}

function SharedMembers() {
  const ws = useWorkspace();
  const tpl = ws.template;
  const me = useSession((s) => s.user)!;
  const others = usePresence((s) => s.others);
  const onlineIds = new Set(Object.values(others).map((p) => p.user.id));
  const setShareOpen = useUI((s) => s.setShareOpen);
  const navigate = useNavigate();
  const isOwner = tpl.myRole === 'owner';
  const { invites } = useInvites(tpl.id, ws.canEdit);

  const setRole = async (userId: string, role: Role) => {
    try {
      await api('PATCH', `/templates/${tpl.id}/members/${userId}`, { role });
      toast.success(t('권한을 변경했습니다'), ROLE_INFO[role].label);
    } catch (err) {
      toast.error(t('권한을 변경하지 못했습니다'), errorMessage(err));
    }
  };

  const remove = async (userId: string, name: string) => {
    const self = userId === me.id;
    const ok = await confirmDialog({
      title: self ? t('템플릿에서 나갈까요?') : t('{name} 님을 내보낼까요?', { name }),
      message: self ? t('다시 참여하려면 새 초대 링크가 필요합니다.') : t('이 사람은 즉시 연결이 끊기고 더 이상 템플릿에 접근할 수 없습니다.'),
      confirmText: self ? t('나가기') : t('내보내기'),
      danger: true,
    });
    if (!ok) return;
    try {
      if (self) {
        await leaveTemplate(tpl);
        navigate('/');
        toast.info(t('템플릿에서 나왔습니다'), tpl.name);
      } else {
        await api('DELETE', `/templates/${tpl.id}/members/${userId}`);
        toast.show({ kind: 'warning', title: t('멤버를 내보냈습니다'), message: name });
      }
    } catch (err) {
      toast.error(t('실패했습니다'), errorMessage(err));
    }
  };

  return (
    <CursorPage>
      <header className="page-header page-header-row">
        <div>
          <h1>
            <Users size={22} /> {t('멤버')} <span className="muted">{tpl.members.length}</span>
          </h1>
          <p className="muted">{t('권한에 따라 편집 가능 여부가 달라집니다. 뷰어는 읽기 전용이지만 커서 공유와 채팅은 사용할 수 있습니다.')}</p>
        </div>
        {ws.canEdit && (
          <Button variant="primary" icon={<UserPlus size={15} />} onClick={() => setShareOpen(true)}>
            {t('초대')}
          </Button>
        )}
      </header>

      {ws.canEdit && <Requests requests={ws.requests} templateId={tpl.id} />}

      <ul className="member-list">
        {tpl.members.map((m) => {
          const online = m.user.id === me.id || onlineIds.has(m.user.id);
          return (
            <li key={m.user.id} className="member-row">
              <Avatar user={m.user} size={38} status={online ? 'online' : null} />
              <div className="member-info">
                <b>
                  {m.user.name}
                  {m.user.id === me.id && <span className="muted">{t('(나)')}</span>}
                </b>
                <span className="muted small">
                  {online ? t('접속 중') : t('오프라인')} · {t('{date} 참여', { date: formatDate(m.joinedAt) })}
                </span>
              </div>
              {isOwner && m.role !== 'owner' ? (
                <select className="input select-sm" value={m.role} onChange={(e) => setRole(m.user.id, e.target.value as Role)} aria-label={t('{name} 권한', { name: m.user.name })}>
                  <option value="editor">{t('편집자')}</option>
                  <option value="viewer">{t('뷰어')}</option>
                </select>
              ) : (
                <span className={`role-chip role-${m.role}`} data-tip={ROLE_INFO[m.role].desc}>
                  {ROLE_INFO[m.role].label}
                </span>
              )}
              {m.role !== 'owner' && (isOwner || m.user.id === me.id) ? (
                <IconButton label={m.user.id === me.id ? t('템플릿 나가기') : t('내보내기')} size="sm" onClick={() => remove(m.user.id, m.user.name)}>
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
            <Link2 size={15} /> {t('사용 중인 초대 링크 {n}개', { n: invites.length })}
          </h4>
          <ul>
            {invites.slice(0, 5).map((i) => (
              <li key={i.id} className="muted small">
                <span className={`role-chip role-${i.role}`}>{i.role === 'viewer' ? t('뷰어') : t('편집자')}</span> {i.label ? `${i.label} · ` : ''}
                {inviteSummary(i)}
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" onClick={() => setShareOpen(true)}>
            {t('초대 링크 관리')}
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
