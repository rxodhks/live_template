import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import type { PublicUser, TemplateSummary, TimelineEvent, ToastPayload } from '@shared/types';
import { api, getToken, setToken } from './lib/api';
import { getSocket, resetSocket } from './lib/socket';
import { isTypingTarget } from './lib/util';
import { ROUTER_BASENAME, SERVER_URL, appPathname, checkServer, isExternalServer, needsServerSetup } from './lib/server';
import { ServerSetup } from './pages/ServerSetup';
import { useSession } from './store/session';
import { dispatchTimelineEvent, useTemplates } from './store/templates';
import { toast } from './store/toasts';
import { useUI } from './store/ui';
import { ToastViewport } from './components/Toasts';
import { TooltipHost } from './components/Tooltip';
import { ConfirmHost, PromptHost, Spinner } from './components/ui';
import { Onboarding } from './pages/Onboarding';
import { Dashboard } from './pages/Dashboard';
import { JoinPage } from './pages/JoinPage';
import { GlobalTimeline } from './pages/GlobalTimeline';
import { Workspace } from './workspace/Workspace';

export function App() {
  const ready = useSession((s) => s.ready);
  const user = useSession((s) => s.user);
  const [server, setServer] = useState<'ok' | 'setup' | 'down'>(() => (needsServerSetup() ? 'setup' : 'ok'));

  useEffect(() => {
    const { setUser, setReady } = useSession.getState();
    if (needsServerSetup()) {
      setReady(true);
      return;
    }
    const start = async () => {
      // 다른 주소의 서버(GitHub Pages → Codespaces 등)는 먼저 살아 있는지 확인
      if (isExternalServer() && !(await checkServer(SERVER_URL))) {
        setServer('down');
        setReady(true);
        return;
      }
      if (!getToken()) {
        setReady(true);
        return;
      }
      await loadMe();
    };
    const loadMe = () =>
      api<{ user: PublicUser }>('GET', '/me')
      .then((res) => setUser(res.user))
      .catch((err) => {
        if (err.status === 401) setToken(null);
        else toast.error('서버에 연결할 수 없습니다', '잠시 후 새로고침해 주세요.');
      })
      .finally(() => setReady(true));
    void start();
  }, []);

  if (!ready) {
    return (
      <div className="center-fill full">
        <Spinner size={28} />
      </div>
    );
  }

  if (server !== 'ok') {
    return (
      <>
        <ServerSetup reason={server} />
        <TooltipHost />
      </>
    );
  }

  return (
    <BrowserRouter basename={ROUTER_BASENAME}>
      {user ? <AuthedApp /> : <Onboarding />}
      <ToastViewport />
      <TooltipHost />
      <ConfirmHost />
      <PromptHost />
    </BrowserRouter>
  );
}

function AuthedApp() {
  useGlobalSocket();
  useGlobalShortcuts();
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/timeline" element={<GlobalTimeline />} />
      <Route path="/join/:code" element={<JoinPage />} />
      <Route path="/t/:tid/*" element={<Workspace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function clearLocalCopy(templateId: string) {
  try {
    indexedDB.deleteDatabase(`lt:tpl:${templateId}`);
  } catch {
    /* 무시 */
  }
}

/** 앱 전역 실시간 이벤트: 토스트, 템플릿 변경/삭제, 접속자 수, 타임라인 */
function useGlobalSocket() {
  const navigate = useNavigate();

  useEffect(() => {
    const s = getSocket();
    const store = useTemplates.getState();
    store.load().catch(() => toast.error('템플릿 목록을 불러오지 못했습니다'));

    const inside = (id: string) => appPathname().startsWith(`/t/${id}`);

    const onToast = (t: ToastPayload) => toast.show(t);
    const onUpdated = (t: TemplateSummary) => useTemplates.getState().upsert(t);
    const onDeleted = (p: { templateId: string; name: string; by: PublicUser }) => {
      useTemplates.getState().remove(p.templateId);
      clearLocalCopy(p.templateId);
      if (p.by.id !== useSession.getState().user?.id) {
        toast.show({ kind: 'danger', title: '템플릿이 삭제되었습니다', message: `${p.by.name} 님이 ‘${p.name}’ 템플릿을 삭제했습니다.`, user: p.by });
      }
      if (inside(p.templateId)) navigate('/');
    };
    const onRemoved = (p: { templateId: string; name: string; self: boolean }) => {
      useTemplates.getState().remove(p.templateId);
      clearLocalCopy(p.templateId);
      if (!p.self) toast.warning('템플릿에서 제외되었습니다', `‘${p.name}’ 템플릿에 더 이상 접근할 수 없습니다.`);
      if (inside(p.templateId)) navigate('/');
    };
    const onOnline = (p: { templateId: string; userIds: string[] }) => useTemplates.getState().setOnline(p.templateId, p.userIds);
    const onTouched = (p: { templateId: string; updatedAt: number }) => useTemplates.getState().touch(p.templateId, p.updatedAt);
    const onTimeline = (p: { event: TimelineEvent; merged: boolean }) => dispatchTimelineEvent(p);
    const onConnectError = (err: Error) => {
      if (err.message === 'unauthorized') {
        setToken(null);
        resetSocket();
        useSession.getState().setUser(null);
      }
    };
    const onReconnect = () => useTemplates.getState().load().catch(() => {});

    s.on('toast', onToast);
    s.on('template:updated', onUpdated);
    s.on('template:deleted', onDeleted);
    s.on('template:removed', onRemoved);
    s.on('online', onOnline);
    s.on('template:touched', onTouched);
    s.on('timeline:event', onTimeline);
    s.on('connect_error', onConnectError);
    s.io.on('reconnect', onReconnect);
    return () => {
      s.off('toast', onToast);
      s.off('template:updated', onUpdated);
      s.off('template:deleted', onDeleted);
      s.off('template:removed', onRemoved);
      s.off('online', onOnline);
      s.off('template:touched', onTouched);
      s.off('timeline:event', onTimeline);
      s.off('connect_error', onConnectError);
      s.io.off('reconnect', onReconnect);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
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
