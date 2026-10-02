import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Clock, Hourglass, LogIn, ShieldCheck, Users, XCircle } from 'lucide-react';
import type { InvitePreview, JoinRequest, JoinStatus, TemplateSummary } from '@shared/types';
import { FEATURE_INFO } from '@shared/presets';
import { AppShell } from '../components/AppShell';
import { Avatar, Button, EmptyState, Spinner } from '../components/ui';
import { api, errorMessage } from '../lib/api';
import { expiryText } from '../lib/invites';
import { addPending, checkPending, usePendingJoins } from '../lib/pending';
import { useSession } from '../store/session';
import { useTemplates } from '../store/templates';
import { toast } from '../store/toasts';

type Preview = InvitePreview & { alreadyMember: boolean };

/**
 * 초대 링크로 들어온 화면.
 * 초대장은 로그인하지 않아도 볼 수 있고, 참여하려면 로그인(처음이면 가입)한다.
 * 승인이 필요한 링크면 승인될 때까지 기다린다.
 */
export function JoinPage() {
  // 로그인하지 않은 사람은 앱 틀 없이 초대장만 보여 준다
  const [standalone] = useState(() => useSession.getState().status !== 'authed');
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
  const pendingJoins = usePendingJoins();
  const location = useLocation();
  const autoJoin = useRef((location.state as { autoJoin?: boolean } | null)?.autoJoin === true);

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
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(`/join/${code}`)}`);
      return;
    }
    setJoining(true);
    try {
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

  // 초대 링크에서 시작한 로그인 · 가입을 막 마치고 돌아왔다면 한 번 더 누르지 않아도 바로 참여한다
  // (이미 로그인한 채로 링크를 연 경우에는 직접 확인하고 누르도록 둔다)
  useEffect(() => {
    if (!autoJoin.current || !user || !preview?.valid || !preview.template || pending || denied) return;
    autoJoin.current = false;
    // 새로고침해도 다시 참여하지 않도록 기록에서 지운다
    navigate(location.pathname, { replace: true, state: null });
    void join();
  }, [user, preview, pending, denied]); // eslint-disable-line react-hooks/exhaustive-deps

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
        {onPhone() && (
          <p className="join-pc-hint" role="note">
            Madang은 PC 화면용입니다. 휴대폰에서는 화면이 잘려 보일 수 있으니 이 링크를 <b>PC 브라우저</b>에서 열어 주세요.
          </p>
        )}
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
            {!user && <p className="muted join-login-hint">로그인하면 이 템플릿에 참여할 수 있습니다. 처음이라면 인증 후 이름만 정하면 가입이 끝납니다.</p>}
            <Button variant="primary" size="lg" onClick={join} loading={joining} icon={user ? undefined : <LogIn size={16} />}>
              {!user ? '로그인하고 참여하기' : preview.requireApproval ? '참여 요청 보내기' : '참여하기'}
            </Button>
            {preview.requireApproval && <p className="muted small">이 링크는 멤버의 승인이 필요합니다.</p>}
          </>
        )}
      </div>
    </div>
  );
}

/** 휴대폰(터치 · 작은 화면)에서 열었는지 — 앱은 데스크톱 폭에 맞춰져 있어 안내한다 */
function onPhone(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches && Math.min(window.screen.width, window.screen.height) < 820;
  } catch {
    return false;
  }
}
