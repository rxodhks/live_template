import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Monitor, X } from 'lucide-react';
import { isTypingTarget } from './lib/util';
import { loadProfile, verifyAccount } from './lib/profile';
import { useSession } from './store/session';
import { useTemplates } from './store/templates';
import { toast } from './store/toasts';
import { useUI } from './store/ui';
import { ToastViewport } from './components/Toasts';
import { TooltipHost } from './components/Tooltip';
import { ConfirmHost, PromptHost } from './components/ui';
import { Onboarding } from './pages/Onboarding';
import { Dashboard } from './pages/Dashboard';
import { JoinPage } from './pages/JoinPage';
import { GlobalTimeline } from './pages/GlobalTimeline';
import { Workspace } from './workspace/Workspace';

/** 협업 템플릿 목록을 다시 확인하는 간격 */
const REFRESH_MS = 60_000;

export function App() {
  const user = useSession((s) => s.user);
  const [booted] = useState(() => {
    // 프로필은 이 브라우저에 있다 → 서버 없이 바로 시작
    useSession.getState().setUser(loadProfile());
    useSession.getState().setReady(true);
    return true;
  });

  // 프로필이 생기면(또는 협업 계정이 생겨 ID가 바뀌면) 템플릿 목록을 불러온다
  useEffect(() => {
    if (!user) return;
    void verifyAccount();
    void useTemplates.getState().load();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) return;
    const refresh = () => document.visibilityState === 'visible' && void useTemplates.getState().refreshRemote();
    const t = setInterval(refresh, REFRESH_MS);
    window.addEventListener('focus', refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener('focus', refresh);
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!booted) return null;

  return (
    <BrowserRouter>
      <Routes>
        {/* 초대 링크는 프로필이 없어도 바로 열린다 */}
        <Route path="/join/:code" element={<JoinPage />} />
        <Route path="*" element={user ? <AuthedApp /> : <Onboarding />} />
      </Routes>
      <ToastViewport />
      <TooltipHost />
      <ConfirmHost />
      <PromptHost />
      <NarrowScreenNotice />
    </BrowserRouter>
  );
}

function AuthedApp() {
  useGlobalShortcuts();
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
