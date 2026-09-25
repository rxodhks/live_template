import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Clock, Hourglass, ShieldCheck, Users, XCircle } from 'lucide-react';
import type { InvitePreview, JoinRequest, JoinStatus, TemplateSummary } from '@shared/types';
import { FEATURE_INFO } from '@shared/presets';
import { AppShell } from '../components/AppShell';
import { Avatar, Button, EmptyState, Spinner } from '../components/ui';
import { ProfileForm, useProfileDraft } from '../components/ProfileForm';
import { api, errorMessage } from '../lib/api';
import { createLocalProfile, ensureAccount } from '../lib/profile';
import { expiryText } from '../lib/invites';
import { addPending, checkPending, usePendingJoins } from '../lib/pending';
import { useSession } from '../store/session';
import { useTemplates } from '../store/templates';
import { toast } from '../store/toasts';

type Preview = InvitePreview & { alreadyMember: boolean };

/**
 * 초대 링크로 들어온 화면.
 * 가입 절차 없이 이름·색상만 정하면 바로 참여하고, 승인이 필요한 링크면 승인될 때까지 기다린다.
 */
export function JoinPage() {
  // 처음 방문한 사람은 앱 틀 없이 초대장만 보여 준다 (참여 중에 프로필이 생겨도 화면 구조는 유지)
  const [standalone] = useState(() => !useSession.getState().user);
  return standalone ? (
    <div className="join-standalone">
      <JoinCard />
    </div>
  ) : (
    <AppShell>
      <JoinCard />
    </AppShell>
  );
}

function JoinCard() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const user = useSession((s) => s.user);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [pending, setPending] = useState<{ templateId: string } | null>(null);
  const [denied, setDenied] = useState(false);
  const [draft, setDraft] = useProfileDraft();
  const pendingJoins = usePendingJoins();

  useEffect(() => {
    api<Preview>('GET', `/invites/${encodeURIComponent(code)}`)
      .then((p) => {
        setPreview(p);
        // 이미 참여를 요청해 둔 링크라면 대기 화면으로
        if (p.template && pendingJoins.some((x) => x.templateId === p.template!.id)) setPending({ templateId: p.template.id });
      })
      .catch((err) => setError(errorMessage(err)));
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  // 승인 대기 중이면 주기적으로 확인
  useEffect(() => {
    if (!pending || !preview?.template) return;
    const p = { templateId: pending.templateId, name: preview.template.name, emoji: preview.template.emoji, requestedAt: Date.now() };
    const tick = async () => {
      const s = await checkPending(p);
      if (s === 'approved') {
        toast.success('참여가 승인되었습니다', `${p.emoji} ${p.name}`);
        navigate(`/t/${p.templateId}`, { replace: true });
      } else if (s === 'denied' || s === 'gone') setDenied(true);
    };
    const t = setInterval(tick, 4000);
    return () => clearInterval(t);
  }, [pending, preview, navigate]);

  const open = (t: TemplateSummary) => {
    useTemplates.getState().upsertShared(t);
    navigate(`/t/${t.id}`, { replace: true });
  };

  const join = async () => {
    if (!preview?.template) return;
    if (!user && !draft.name.trim()) return;
    setJoining(true);
    try {
      if (!user) createLocalProfile(draft);
      await ensureAccount();
      const res = await api<{ status: JoinStatus; templateId: string; template: TemplateSummary | null; request: JoinRequest | null }>(
        'POST',
        `/invites/${encodeURIComponent(code)}/accept`,
      );
      if (res.status === 'pending') {
        addPending({ templateId: res.templateId, name: preview.template.name, emoji: preview.template.emoji, requestedAt: Date.now() });
        setPending({ templateId: res.templateId });
      } else if (res.template) {
        toast.success(res.status === 'member' ? '이미 참여한 템플릿입니다' : '템플릿에 참여했습니다', `${res.template.emoji} ${res.template.name}`);
        open(res.template);
      }
    } catch (err) {
      toast.error('참여하지 못했습니다', errorMessage(err));
    } finally {
      setJoining(false);
    }
  };

  if (error) {
    return (
      <div className="center-fill">
        <EmptyState icon={<XCircle size={34} />} title="초대 링크를 확인할 수 없습니다" action={<Button onClick={() => navigate('/')}>내 공간으로</Button>}>
          {error}
        </EmptyState>
      </div>
    );
  }
  if (!preview) {
    return (
      <div className="center-fill">
        <Spinner size={26} />
      </div>
    );
  }
  if (!preview.valid || !preview.template) {
    return (
      <div className="center-fill">
        <EmptyState icon={<XCircle size={34} />} title="사용할 수 없는 초대 링크입니다" action={<Button onClick={() => navigate('/')}>내 공간으로</Button>}>
          {preview.reason ?? '초대한 사람에게 새 링크를 요청해 주세요.'}
        </EmptyState>
      </div>
    );
  }

  const t = preview.template;
  const roleLabel = preview.role === 'viewer' ? '뷰어 (읽기 전용)' : '편집자';

  return (
    <div className="center-fill">
      <div className="join-card">
        <span className="join-emoji">{t.emoji}</span>
        {preview.inviter && (
          <p className="muted">
            <Avatar user={preview.inviter} size={20} /> <b>{preview.inviter.name}</b> 님이 초대했습니다
          </p>
        )}
        <h1>{t.name}</h1>
        {t.description && <p>{t.description}</p>}
        <div className="template-features center">
          {t.features.map((f) => (
            <span key={f} className={`feature-pill feature-${f}`}>
              {FEATURE_INFO[f].emoji} {FEATURE_INFO[f].name}
            </span>
          ))}
        </div>
        <div className="join-facts">
          <span>
            <Users size={13} /> 멤버 {t.memberCount}명
          </span>
          <span>
            <ShieldCheck size={13} /> {roleLabel}로 참여
          </span>
          {preview.expiresAt && (
            <span>
              <Clock size={13} /> {expiryText(preview.expiresAt)}
            </span>
          )}
        </div>

        {denied ? (
          <div className="join-status is-denied">
            <XCircle size={18} /> 참여 요청이 거절되었거나 템플릿이 삭제되었습니다.
          </div>
        ) : pending ? (
          <div className="join-status">
            <Hourglass size={18} className="pulse" />
            <div>
              <b>승인을 기다리는 중입니다</b>
              <span className="muted small">템플릿 멤버가 승인하면 자동으로 열립니다. 이 창을 닫아도 내 공간에서 계속 확인합니다.</span>
            </div>
          </div>
        ) : preview.alreadyMember ? (
          <Button variant="primary" size="lg" onClick={() => navigate(`/t/${t.id}`)}>
            이미 멤버입니다 · 열기
          </Button>
        ) : (
          <>
            {!user && (
              <div className="join-profile">
                <p className="muted small">가입은 필요 없습니다. 함께 작업할 때 표시될 이름과 커서 색상만 정해 주세요.</p>
                <ProfileForm draft={draft} onChange={setDraft} onSubmit={join} />
              </div>
            )}
            <Button variant="primary" size="lg" onClick={join} loading={joining} disabled={!user && !draft.name.trim()}>
              {preview.requireApproval ? '참여 요청 보내기' : user ? '참여하기' : '프로필 만들고 참여하기'}
            </Button>
            {preview.requireApproval && <p className="muted small">이 링크는 멤버의 승인이 필요합니다.</p>}
          </>
        )}
      </div>
    </div>
  );
}
