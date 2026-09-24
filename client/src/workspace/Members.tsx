import { useNavigate } from 'react-router-dom';
import { Copy, DoorOpen, Share2, UserMinus, Users } from 'lucide-react';
import type { Role, TemplateSummary } from '@shared/types';
import { useWorkspace } from './context';
import { useTemplates } from '../store/templates';
import { useSession } from '../store/session';
import { useUI } from '../store/ui';
import { toast } from '../store/toasts';
import { usePresence } from '../store/presence';
import { api, errorMessage } from '../lib/api';
import { copyText } from '../lib/util';
import { formatDate } from '../lib/time';
import { CursorPage } from '../components/Cursors';
import { Avatar, Button, IconButton, confirmDialog } from '../components/ui';
import { inviteUrl } from '../components/Dialogs';

const ROLE_INFO: Record<Role, { label: string; desc: string }> = {
  owner: { label: '소유자', desc: '모든 권한 · 멤버 관리 · 템플릿 삭제' },
  editor: { label: '편집자', desc: '디자인/코드/문서/비밀 노트 편집' },
  viewer: { label: '뷰어', desc: '읽기 전용 · 커서/채팅은 사용 가능' },
};

export function Members() {
  const ws = useWorkspace();
  const t = ws.template;
  const me = useSession((s) => s.user)!;
  const others = usePresence((s) => s.others);
  const onlineIds = new Set(Object.values(others).map((p) => p.user.id));
  const setShareOpen = useUI((s) => s.setShareOpen);
  const navigate = useNavigate();
  const isOwner = t.myRole === 'owner';

  const setRole = async (userId: string, role: Role) => {
    try {
      const res = await api<{ template: TemplateSummary }>('PATCH', `/templates/${t.id}/members/${userId}`, { role });
      useTemplates.getState().upsert(res.template);
      toast.success('권한을 변경했습니다', ROLE_INFO[role].label);
    } catch (err) {
      toast.error('권한을 변경하지 못했습니다', errorMessage(err));
    }
  };

  const remove = async (userId: string, name: string) => {
    const self = userId === me.id;
    const ok = await confirmDialog({
      title: self ? '템플릿에서 나갈까요?' : `${name} 님을 내보낼까요?`,
      message: self ? '다시 참여하려면 초대 링크가 필요합니다.' : '이 사람은 더 이상 템플릿에 접근할 수 없습니다.',
      confirmText: self ? '나가기' : '내보내기',
      danger: true,
    });
    if (!ok) return;
    try {
      await api('DELETE', `/templates/${t.id}/members/${userId}`);
      if (self) {
        useTemplates.getState().remove(t.id);
        navigate('/');
        toast.info('템플릿에서 나왔습니다', t.name);
      } else toast.show({ kind: 'warning', title: '멤버를 내보냈습니다', message: name });
    } catch (err) {
      toast.error('실패했습니다', errorMessage(err));
    }
  };

  return (
    <CursorPage>
      <header className="page-header">
        <h1>
          <Users size={22} /> 멤버 <span className="muted">{t.members.length}</span>
        </h1>
        <p className="muted">권한에 따라 편집 가능 여부가 달라집니다. 뷰어는 읽기 전용이지만 커서 공유와 채팅은 사용할 수 있습니다.</p>
      </header>

      {t.inviteCode && (
        <div className="invite-box">
          <div>
            <b>초대 링크</b>
            <span className="muted small">링크를 받은 사람은 편집자로 참여합니다</span>
          </div>
          <code className="invite-code">{inviteUrl(t.inviteCode)}</code>
          <Button
            icon={<Copy size={14} />}
            onClick={async () => (await copyText(inviteUrl(t.inviteCode!))) && toast.success('초대 링크를 복사했습니다')}
          >
            복사
          </Button>
          <Button variant="ghost" icon={<Share2 size={14} />} onClick={() => setShareOpen(true)}>
            공유
          </Button>
        </div>
      )}

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
                <IconButton
                  label={m.user.id === me.id ? '템플릿 나가기' : '내보내기'}
                  size="sm"
                  onClick={() => remove(m.user.id, m.user.name)}
                >
                  {m.user.id === me.id ? <DoorOpen size={16} /> : <UserMinus size={16} />}
                </IconButton>
              ) : (
                <span className="icon-btn-placeholder" />
              )}
            </li>
          );
        })}
      </ul>

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
