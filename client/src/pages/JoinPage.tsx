import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Users } from 'lucide-react';
import type { Feature, PublicUser, TemplateSummary } from '@shared/types';
import { FEATURE_INFO } from '@shared/presets';
import { AppShell } from '../components/AppShell';
import { Avatar, Button, EmptyState, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { useTemplates } from '../store/templates';
import { toast } from '../store/toasts';

interface Invite {
  templateId: string;
  name: string;
  emoji: string;
  description: string;
  features: Feature[];
  memberCount: number;
  owner: PublicUser | null;
  alreadyMember: boolean;
}

export function JoinPage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    api<{ invite: Invite }>('GET', `/invite/${encodeURIComponent(code)}`)
      .then((r) => setInvite(r.invite))
      .catch((err) => setError(errorMessage(err)));
  }, [code]);

  const join = async () => {
    if (!invite) return;
    if (invite.alreadyMember) return navigate(`/t/${invite.templateId}`);
    setJoining(true);
    try {
      const res = await api<{ template: TemplateSummary }>('POST', `/invite/${encodeURIComponent(code)}/join`);
      useTemplates.getState().upsert(res.template);
      toast.success('템플릿에 참여했습니다', `${res.template.emoji} ${res.template.name}`);
      navigate(`/t/${res.template.id}`, { replace: true });
    } catch (err) {
      toast.error('참여하지 못했습니다', errorMessage(err));
      setJoining(false);
    }
  };

  return (
    <AppShell>
      <div className="center-fill">
        {error ? (
          <EmptyState title="초대 링크를 확인할 수 없습니다" action={<Button onClick={() => navigate('/')}>대시보드로</Button>}>
            {error}
          </EmptyState>
        ) : !invite ? (
          <Spinner size={26} />
        ) : (
          <div className="join-card">
            <span className="join-emoji">{invite.emoji}</span>
            <p className="muted">
              {invite.owner && (
                <>
                  <Avatar user={invite.owner} size={20} /> <b>{invite.owner.name}</b> 님이 초대했습니다
                </>
              )}
            </p>
            <h1>{invite.name}</h1>
            {invite.description && <p>{invite.description}</p>}
            <div className="template-features center">
              {invite.features.map((f) => (
                <span key={f} className={`feature-pill feature-${f}`}>
                  {FEATURE_INFO[f].emoji} {FEATURE_INFO[f].name}
                </span>
              ))}
            </div>
            <p className="muted small">
              <Users size={13} /> 멤버 {invite.memberCount}명
            </p>
            <Button variant="primary" size="lg" onClick={join} loading={joining}>
              {invite.alreadyMember ? '이미 멤버입니다 · 열기' : '참여하기'}
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}
