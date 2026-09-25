import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Code2, FileText, Lock, Mail, MousePointer2, Palette, RotateCw, ShieldCheck, UserPlus, UserRound } from 'lucide-react';
import type { AuthConfig, OAuthProvider, SignupInfo } from '@shared/types';
import { USER_AVATARS, USER_COLORS } from '@shared/colors';
import { ApiError, errorMessage, legacyProfile } from '../lib/api';
import { completeLogin, completeSignup, fetchAuthConfig, fetchSignup, safeNext, startEmailLogin, startOAuth, verifyEmailLogin } from '../lib/auth';
import { cx } from '../lib/util';
import { useSession } from '../store/session';
import { toast } from '../store/toasts';
import { useTick } from '../hooks/useInterval';
import { Button, Field, Spinner } from '../components/ui';
import { BRAND, BrandMark } from '../components/Brand';
import { ProfileForm, type ProfileDraft } from '../components/ProfileForm';

/*
 * 로그인 · 가입
 *  1) 외부 계정(구글 · 깃허브) 또는 이메일 인증 코드로 본인 확인
 *  2) 처음이면 사이트에서 표시될 이름(과 커서 색상 · 아바타)을 정한다
 *  3) 메인 화면으로 (초대 링크로 왔다면 초대장으로)
 */

const FEATURES = [
  { icon: <MousePointer2 size={18} />, title: '실시간 커서와 행동 표시', text: '누가 어디서 무엇을 하는지 커서 옆에 바로 보입니다.' },
  { icon: <Palette size={18} />, title: '디자인 캔버스', text: '도형·스티키 노트·펜으로 함께 그립니다.' },
  { icon: <Code2 size={18} />, title: '코드 에디터', text: '24개 언어, 실행과 미리보기까지.' },
  { icon: <FileText size={18} />, title: '문서 작성', text: '리치 텍스트 문서를 동시에 편집합니다.' },
  { icon: <Lock size={18} />, title: '비밀 노트', text: '브라우저에서 AES-256으로 암호화 — 서버도 읽을 수 없습니다.' },
];

const PROVIDERS: { id: OAuthProvider; label: string; icon: ReactNode }[] = [
  { id: 'google', label: 'Google로 계속하기', icon: <GoogleLogo /> },
  { id: 'github', label: 'GitHub로 계속하기', icon: <GitHubLogo /> },
];

const PROVIDER_NAME: Record<string, string> = { google: 'Google', github: 'GitHub', email: '이메일' };

const LOGIN_ERRORS: Record<string, string> = {
  cancelled: '로그인을 취소했습니다. 다른 방법으로 계속할 수 있습니다.',
  expired: '로그인 시간이 지났습니다. 다시 시도해 주세요.',
  failed: '외부 계정으로 로그인하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  unavailable: '지금은 사용할 수 없는 로그인 방법입니다.',
  signup: '가입 절차가 만료되었습니다. 다시 로그인해 주세요.',
};

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="onboarding auth-page">
      <section className="onboarding-hero">
        <div className="onboarding-brand">
          <BrandMark size={36} />
          <span>
            {BRAND} <small className="brand-ko">마당</small>
          </span>
        </div>
        <p className="onboarding-tagline">내 방에서 시작해, 마당에서 함께.</p>
        <h1>
          디자인 · 코딩 · 문서를
          <br />한 화면에서 <em>함께</em>.
        </h1>
        <p>템플릿 하나에 필요한 기능만 골라 담고, 혼자 시작해서 필요할 때 팀원을 초대해 실시간으로 함께 작업하세요. 모든 변경은 자동 저장됩니다.</p>
        <ul className="onboarding-features">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <span className="onboarding-feature-icon">{f.icon}</span>
              <div>
                <b>{f.title}</b>
                <span>{f.text}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="onboarding-card">
        <div className="onboarding-card-inner">{children}</div>
      </section>
    </div>
  );
}

/** 가입 단계 표시: 본인 확인 → 이름 → 시작 */
function Steps({ current }: { current: 1 | 2 }) {
  const steps = ['본인 확인', '이름 정하기', '시작'];
  return (
    <ol className="auth-steps" aria-label="가입 단계">
      {steps.map((s, i) => (
        <li key={s} className={cx(i + 1 < current && 'is-done', i + 1 === current && 'is-current')} aria-current={i + 1 === current ? 'step' : undefined}>
          <span className="auth-step-dot">{i + 1 < current ? <CheckCircle2 size={14} /> : i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  );
}

/** 로그인한 상태로 로그인 · 가입 화면에 오면 원래 가려던 곳으로 */
function useSignedInRedirect(): ReactNode {
  const status = useSession((s) => s.status);
  const [params] = useSearchParams();
  return status === 'authed' ? <Navigate to={safeNext(params.get('next'))} replace /> : null;
}

/* ───────────────────────── 로그인 ───────────────────────── */

export function LoginPage() {
  const redirect = useSignedInRedirect();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [step, setStep] = useState<'start' | 'code'>('start');
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(() => LOGIN_ERRORS[params.get('error') ?? ''] ?? null);
  const [codeError, setCodeError] = useState<string | null>(null);
  useTick(step === 'code' ? 1000 : 0);

  useEffect(() => {
    fetchAuthConfig()
      .then(setConfig)
      .catch((err) => setConfigError(errorMessage(err)));
  }, []);

  if (redirect) return redirect;

  const oauth = PROVIDERS.filter((p) => config?.providers[p.id]);
  const invited = next.startsWith('/join/');

  const sendCode = async (address = email) => {
    setBusy('email');
    setNotice(null);
    setCodeError(null);
    try {
      const res = await startEmailLogin(address);
      setSentTo(res.email);
      setDevCode(res.devCode ?? null);
      setResendAt(Date.now() + res.resendAfter * 1000);
      setCode('');
      setStep('code');
    } catch (err) {
      if (err instanceof ApiError && typeof err.data.retryAfter === 'number') setResendAt(Date.now() + err.data.retryAfter * 1000);
      if (step === 'code') setCodeError(errorMessage(err));
      else setNotice(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const verify = async (value = code) => {
    if (value.length !== 6 || busy) return;
    setBusy('verify');
    setCodeError(null);
    try {
      const res = await verifyEmailLogin(sentTo, value);
      if (res.status === 'needs_name') {
        navigate(`/signup${next === '/' ? '' : `?next=${encodeURIComponent(next)}`}`, { replace: true });
        return;
      }
      await completeLogin(res.user!);
      toast.success(`다시 오셨네요, ${res.user!.name} 님!`);
    } catch (err) {
      setCodeError(errorMessage(err));
      if (err instanceof ApiError && err.data.reason === 'expired') setCode('');
      setBusy(null);
    }
  };

  const wait = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));

  return (
    <AuthLayout>
      {step === 'start' ? (
        <>
          <div className="auth-head">
            <h2>{BRAND} 시작하기</h2>
            <p className="muted">로그인하거나 새 계정을 만드세요. 처음이라면 본인 확인 후 이름만 정하면 가입이 끝납니다.</p>
          </div>
          {invited && (
            <div className="auth-callout">
              <UserPlus size={16} /> 초대 링크로 오셨네요. 로그인하면 바로 참여할 수 있습니다.
            </div>
          )}
          {notice && (
            <div className="auth-alert" role="alert">
              {notice}
            </div>
          )}
          {configError && (
            <div className="auth-alert" role="alert">
              {configError}
            </div>
          )}
          {!config && !configError ? (
            <div className="auth-loading">
              <Spinner size={22} />
            </div>
          ) : (
            <>
              {oauth.length > 0 && (
                <div className="auth-providers">
                  {oauth.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={cx('auth-provider', `is-${p.id}`)}
                      disabled={busy !== null}
                      onClick={() => {
                        setBusy(p.id);
                        startOAuth(p.id, next);
                      }}
                    >
                      {busy === p.id ? <Spinner size={16} /> : p.icon}
                      <span>{p.label}</span>
                    </button>
                  ))}
                </div>
              )}
              {oauth.length > 0 && config?.email && (
                <div className="auth-divider">
                  <span>또는 이메일로</span>
                </div>
              )}
              {config?.email ? (
                <form
                  className="auth-email"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (email.trim()) void sendCode(email.trim());
                  }}
                >
                  <Field label="이메일">
                    <input
                      className="input input-lg"
                      type="email"
                      autoComplete="email"
                      placeholder="name@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoFocus={oauth.length === 0}
                      required
                    />
                  </Field>
                  <Button type="submit" variant="primary" size="lg" className="w-full" icon={<Mail size={16} />} loading={busy === 'email'} disabled={!email.trim() || busy !== null}>
                    이메일로 계속하기
                  </Button>
                </form>
              ) : (
                oauth.length === 0 && (
                  <div className="auth-alert" role="alert">
                    아직 사용할 수 있는 로그인 방법이 없습니다. 관리자가 로그인 설정을 마치면 이용할 수 있습니다.
                  </div>
                )
              )}
              <p className="auth-foot muted small">
                <ShieldCheck size={13} /> 비밀번호 없이 로그인합니다. 이메일은 로그인 확인에만 쓰이고 다른 사용자에게는 표시되지 않습니다.
              </p>
            </>
          )}
        </>
      ) : (
        <>
          <button type="button" className="auth-back" onClick={() => setStep('start')}>
            <ArrowLeft size={15} /> 다른 방법으로 로그인
          </button>
          <div className="auth-head">
            <h2>메일을 확인해 주세요</h2>
            <p className="muted">
              <b className="auth-email-addr">{sentTo}</b>로 6자리 인증 코드를 보냈습니다. 코드는 10분 동안 쓸 수 있습니다.
            </p>
          </div>
          {devCode && (
            <div className="auth-dev" role="note">
              개발 모드 · 메일 대신 코드를 바로 보여 줍니다: <b>{devCode}</b>
              <button type="button" className="link small" onClick={() => (setCode(devCode), void verify(devCode))}>
                입력하기
              </button>
            </div>
          )}
          <form
            className="auth-code-form"
            onSubmit={(e) => {
              e.preventDefault();
              void verify();
            }}
          >
            <CodeInput
              value={code}
              invalid={Boolean(codeError)}
              disabled={busy === 'verify'}
              onChange={(v) => {
                setCode(v);
                setCodeError(null);
                if (v.length === 6) void verify(v);
              }}
            />
            {codeError && (
              <div className="auth-alert" role="alert">
                {codeError}
              </div>
            )}
            <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy === 'verify'} disabled={code.length !== 6}>
              확인
            </Button>
          </form>
          <div className="auth-resend">
            <span className="muted small">메일이 오지 않았나요? 스팸함도 확인해 주세요.</span>
            <button type="button" className="link small" disabled={wait > 0 || busy !== null} onClick={() => void sendCode(sentTo)}>
              <RotateCw size={13} /> {wait > 0 ? `${wait}초 후 다시 보내기` : '코드 다시 보내기'}
            </button>
          </div>
        </>
      )}
    </AuthLayout>
  );
}

/** 6칸 인증 코드 입력 — 실제 입력은 하나의 칸이 받아서 붙여넣기 · 자동 채우기(one-time-code)가 그대로 된다 */
function CodeInput({ value, onChange, invalid, disabled }: { value: string; onChange: (v: string) => void; invalid: boolean; disabled: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => ref.current?.focus(), []);
  return (
    <div className={cx('code-input', invalid && 'is-invalid')} onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        value={value}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="6자리 인증 코드"
        maxLength={6}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      />
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={cx('code-box', value[i] && 'is-filled', focused && (i === value.length || (i === 5 && value.length === 6)) && 'is-active')} aria-hidden>
          {value[i] ?? ''}
        </span>
      ))}
    </div>
  );
}

/* ───────────────────────── 이름 정하기 (가입 마무리) ───────────────────────── */

export function SignupPage() {
  const redirect = useSignedInRedirect();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const [info, setInfo] = useState<SignupInfo | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSignup()
      .then((i) => {
        // 가입 없이 쓰던 때의 프로필이 이 브라우저에 있으면 그대로 이어서 쓴다
        const legacy = legacyProfile();
        setInfo(i);
        setDraft({
          name: (i.suggestedName || legacy?.name || '').slice(0, 24),
          color: legacy?.color ?? USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)],
          avatar: legacy?.avatar ?? USER_AVATARS[Math.floor(Math.random() * USER_AVATARS.length)],
        });
      })
      .catch(() => navigate(`/login?error=signup${next === '/' ? '' : `&next=${encodeURIComponent(next)}`}`, { replace: true }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (redirect) return redirect;

  const submit = async () => {
    if (!draft?.name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { user } = await completeSignup(draft);
      await completeLogin(user);
      toast.success(`환영합니다, ${user.name} 님!`, next.startsWith('/join/') ? '초대받은 템플릿으로 이동합니다.' : '첫 템플릿을 만들어 보세요.');
    } catch (err) {
      if (err instanceof ApiError && err.data.reason === 'expired') {
        navigate(`/login?error=signup${next === '/' ? '' : `&next=${encodeURIComponent(next)}`}`, { replace: true });
        return;
      }
      setError(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <AuthLayout>
      <Steps current={2} />
      <div className="auth-head">
        <h2>
          <UserRound size={20} /> 이름을 정해 주세요
        </h2>
        <p className="muted">사이트에서 다른 사람에게 보이는 이름입니다. 함께 작업할 때 커서 옆에도 이 이름이 표시되고, 나중에 언제든 바꿀 수 있습니다.</p>
      </div>
      {!info || !draft ? (
        <div className="auth-loading">
          <Spinner size={22} />
        </div>
      ) : (
        <>
          <div className="auth-verified">
            <CheckCircle2 size={16} />
            <span>
              {info.provider === 'email' ? '이메일 인증 완료' : `${PROVIDER_NAME[info.provider]} 계정 확인 완료`}
              {info.email && <b> · {info.email}</b>}
            </span>
          </div>
          <ProfileForm draft={draft} onChange={setDraft} onSubmit={submit} />
          {error && (
            <div className="auth-alert" role="alert">
              {error}
            </div>
          )}
          <Button variant="primary" size="lg" className="w-full" onClick={submit} loading={saving} disabled={!draft.name.trim()}>
            가입 완료하고 시작하기
          </Button>
          <button type="button" className="link small auth-switch" onClick={() => navigate('/login', { replace: true })}>
            다른 계정으로 로그인
          </button>
        </>
      )}
    </AuthLayout>
  );
}

/** 로그인 확인 중 */
export function BootScreen() {
  return (
    <div className="boot-screen">
      <BrandMark size={40} />
      <Spinner size={18} />
    </div>
  );
}

/* ───────────────────────── 로고 ───────────────────────── */

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function GitHubLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
