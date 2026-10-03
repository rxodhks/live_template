import { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Monitor, X } from 'lucide-react';
import { isTypingTarget } from './lib/util';
import { lazyWithPreload, whenIdle } from './lib/lazy';
import { bootSession, claimLegacyAccount } from './lib/auth';
import { backupPending } from './lib/templateOps';
import { useSession } from './store/session';
import { useTemplates } from './store/templates';
import { toast } from './store/toasts';
import { useUI } from './store/ui';
import { ToastViewport } from './components/Toasts';
import { TooltipHost } from './components/Tooltip';
import { ConfirmHost, PromptHost } from './components/ui';
import { BootScreen } from './pages/BootScreen';
import { ServerDownScreen } from './pages/OutageScreen';
import { Dashboard } from './pages/Dashboard';
import { GlobalTimeline } from './pages/GlobalTimeline';

// 처음 화면에 필요 없는 페이지는 들어갈 때 불러온다
const LoginPage = lazy(() => import('./pages/Auth').then((m) => ({ default: m.LoginPage })));
const SignupPage = lazy(() => import('./pages/Auth').then((m) => ({ default: m.SignupPage })));
const PrivacyPage = lazy(() => import('./pages/Legal').then((m) => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import('./pages/Legal').then((m) => ({ default: m.TermsPage })));
const JoinPage = lazy(() => import('./pages/JoinPage').then((m) => ({ default: m.JoinPage })));
// 둘 다 Suspense 없이 불러온다 (lib/lazy.ts) — Suspense 대체 화면이 한 번 나오면 그 뒤 300ms 동안 다른 화면 전환도 늦어진다
const Workspace = lazyWithPreload(() => import('./workspace/Workspace').then((m) => m.Workspace), BootScreen);
const PageSetupHost = lazyWithPreload(() => import('./modules/docs/page/PageSetupDialog').then((m) => m.PageSetupHost));

// 템플릿 주소로 바로 들어왔다면(새로고침 · 링크) 로그인 확인과 함께 템플릿 화면도 받기 시작한다
if (window.location.pathname.startsWith('/t/')) Workspace.preload();
// 주소가 가리키는 에디터도 함께 받는다 — 템플릿 화면 파일을 받은 뒤에야 받기 시작하면 그만큼 늦게 열린다
const EDITORS: Record<string, () => Promise<unknown>> = {
  docs: () => import('./modules/docs/DocsModule'),
  code: () => import('./modules/code/CodeModule'),
  design: () => import('./modules/design/DesignModule'),
  notes: () => import('./modules/notes/NotesModule'),
};
const editor = /^\/t\/[^/]+\/([^/]+)/.exec(window.location.pathname)?.[1];
if (editor && Object.hasOwn(EDITORS, editor)) void EDITORS[editor]().catch(() => {});

/** 협업 템플릿 목록을 다시 확인하는 간격 */
const REFRESH_MS = 60_000;

export function App() {
  const status = useSession((s) => s.status);
  const userId = useSession((s) => s.user?.id);

  // 로그인 상태 확인
  useEffect(() => {
    void bootSession();
  }, []);

  // 로그인하면 이 계정의 템플릿 목록을 불러오고, 이 기기에만 있는 개인 템플릿은 클라우드에 백업한다
  useEffect(() => {
    if (status !== 'authed' || !userId) return;
    void useTemplates.getState().load().then(backupAndNotify);
    if (useSession.getState().offline) return;
    // 가입 없이 쓰던 때 참여한 협업 템플릿이 있으면 이 계정으로 옮긴다
    void claimLegacyAccount().then((merged) => {
      if (merged) void useTemplates.getState().refreshRemote();
    });
  }, [status, userId]);

  useEffect(() => {
    if (status !== 'authed') return;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      void useTemplates.getState().refreshRemote();
      void backupAndNotify();
    };
    const t = setInterval(refresh, REFRESH_MS);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [status]);

  if (status === 'loading') return <BootScreen />;
  if (status === 'down') return <ServerDownScreen />;

  return (
    <BrowserRouter>
      <Suspense fallback={<BootScreen />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          {/* 약관 · 개인정보처리방침은 누구나 볼 수 있다 */}
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          {/* 초대장은 로그인하지 않아도 볼 수 있다 (참여하려면 로그인) */}
          <Route path="/join/:code" element={<JoinPage />} />
          <Route path="*" element={status === 'authed' ? <AuthedApp /> : <ToLogin />} />
        </Routes>
      </Suspense>
      <ToastViewport />
      <TooltipHost />
      <ConfirmHost />
      <PromptHost />
      <PageSetupHost />
      <NarrowScreenNotice />
      {IS_STAGING && (
        <div className="staging-badge" role="note">
          테스트 사이트 · 실제 사이트와 계정 · 데이터가 분리되어 있습니다
        </div>
      )}
    </BrowserRouter>
  );
}

/** 테스트 사이트(staging.madang.party): main에 합치기 전의 브랜치를 띄워 보는 곳 */
const IS_STAGING = window.location.hostname.startsWith('staging.');

async function backupAndNotify() {
  const n = await backupPending();
  if (n > 0) toast.success('개인 템플릿을 클라우드에 백업했습니다', `${n}개 · 이제 다른 기기에서도 이어서 작업할 수 있습니다.`);
}

/** 로그인하지 않았으면 로그인 화면으로 (로그인 후 원래 가려던 곳으로 돌아온다) */
function ToLogin() {
  const { pathname, search } = useLocation();
  const next = `${pathname}${search}`;
  return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />;
}

function AuthedApp() {
  useGlobalShortcuts();
  // 템플릿을 열기 전에 템플릿 화면을 미리 받아 둔다 → 열 때 기다리지 않는다
  useEffect(() => whenIdle(Workspace.preload), []);
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/timeline" element={<GlobalTimeline />} />
      <Route path="/t/:tid/*" element={<Workspace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const ui = useUI.getState();
        ui.setPaletteOpen(!ui.paletteOpen);
      } else if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        toast.show({ id: 'autosave', kind: 'success', title: '자동 저장 중입니다', message: '모든 변경 사항은 입력 즉시 저장되니 따로 저장하지 않아도 됩니다.', duration: 2500 });
      } else if (e.key === '?' && !isTypingTarget(e.target)) {
        useUI.getState().setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** 데스크톱 전용 안내 — 모바일은 별도 앱으로 출시 예정 */
function NarrowScreenNotice() {
  const [narrow, setNarrow] = useState(() => window.innerWidth < 960);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('lt.narrowOk') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 960);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  if (!narrow || dismissed) return null;
  return (
    <div className="narrow-notice" role="status">
      <Monitor size={16} />
      <span>
        Madang은 <b>데스크톱 화면</b>에 맞춰져 있습니다. 창을 넓히면 모든 기능을 편하게 쓸 수 있어요. 모바일은 전용 앱으로 준비 중입니다.
      </span>
      <button
        className="icon-btn"
        aria-label="안내 닫기"
        onClick={() => {
          setDismissed(true);
          try {
            sessionStorage.setItem('lt.narrowOk', '1');
          } catch {
            /* 무시 */
          }
        }}
      >
        <X size={15} />
      </button>
    </div>
  );
}
