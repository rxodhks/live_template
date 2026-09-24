import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import type {
  ActivityInput,
  ChatMessage,
  CursorPoint,
  PresenceState,
  SecretNoteMeta,
  TemplateSummary,
  UnlockResult,
  ViewModule,
} from '@shared/types';
import { getSocket, request } from '../lib/socket';
import { SocketYProvider } from '../lib/yprovider';
import { throttle } from '../lib/util';
import { usePresence, useUserPresence } from '../store/presence';
import { useTemplates } from '../store/templates';
import { toast } from '../store/toasts';
import { useSession } from '../store/session';
import { WorkspaceContext, type WorkspaceValue, parseView, sameView, viewPath } from './context';
import { AppShell } from '../components/AppShell';
import { Explorer } from './Explorer';
import { ChatPanel } from '../components/ChatPanel';
import { FollowBanner } from '../components/FollowBanner';
import { Overview } from './Overview';
import { TemplateTimeline } from './TemplateTimeline';
import { Members } from './Members';
import { Settings } from './Settings';

// 에디터 모듈은 필요할 때 불러온다 (초기 로딩 경량화)
const CodeModule = lazy(() => import('../modules/code/CodeModule').then((m) => ({ default: m.CodeModule })));
const DocsModule = lazy(() => import('../modules/docs/DocsModule').then((m) => ({ default: m.DocsModule })));
const DesignModule = lazy(() => import('../modules/design/DesignModule').then((m) => ({ default: m.DesignModule })));
const NotesModule = lazy(() => import('../modules/notes/NotesModule').then((m) => ({ default: m.NotesModule })));
import { EmptyState, Spinner, Button } from '../components/ui';
import { ShieldAlert } from 'lucide-react';

/** 잦은 편집 활동은 대상별로 이 간격에 한 번만 보고 (서버에서도 5분 단위로 합침) */
const EDIT_REPORT_INTERVAL = 20_000;
const IDLE_AFTER_MS = 90_000;

export function Workspace() {
  const { tid = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { view } = parseView(location.pathname);
  const me = useSession((s) => s.user)!;

  const cached = useTemplates((s) => s.templates[tid]);
  const [template, setTemplate] = useState<TemplateSummary | null>(cached ?? null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<SecretNoteMeta[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [chatOpen, setChatOpenState] = useState(false);
  const [unread, setUnread] = useState(0);
  const [follow, setFollow] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Record<string, UnlockResult>>({});
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth > 900);
  const [synced, setSynced] = useState(false);

  const viewRef = useRef(view);
  viewRef.current = view;
  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;

  /* ── Y.Doc + 프로바이더 (IndexedDB에 로컬 사본 보관 → 오프라인에서도 편집 가능) ── */
  const [yjs, setYjs] = useState<{ doc: Y.Doc; provider: SocketYProvider } | null>(null);
  useEffect(() => {
    const doc = new Y.Doc();
    const idb = new IndexeddbPersistence(`lt:tpl:${tid}`, doc);
    const whenReady = Promise.race([idb.whenSynced, new Promise((r) => setTimeout(r, 1500))]);
    const provider = new SocketYProvider(getSocket(), `tpl:${tid}`, doc, {
      whenReady,
      onError: (message, status) => {
        if (status === 403 || status === 404) setError(message);
      },
    });
    const update = () => setSynced(provider.synced);
    const unsub = provider.subscribe(update);
    update();
    setYjs({ doc, provider });
    return () => {
      unsub();
      setYjs(null);
      provider.destroy();
      void idb.destroy();
      doc.destroy();
    };
  }, [tid]);

  /* ── 템플릿 입장 + 실시간 이벤트 ── */
  useEffect(() => {
    const s = getSocket();
    const presence = usePresence.getState();

    const enter = async () => {
      const res = await request<{
        template: TemplateSummary;
        presence: PresenceState[];
        chat: ChatMessage[];
        notes: SecretNoteMeta[];
      }>('template:enter', { templateId: tid, view: viewRef.current });
      if (!res.ok) {
        if (res.status === 403 || res.status === 404) setError(res.error ?? '템플릿을 열 수 없습니다.');
        return;
      }
      setError(null);
      setTemplate(res.template);
      useTemplates.getState().upsert(res.template);
      usePresence.getState().reset(res.presence, s.id ?? null);
      setNotes(res.notes);
      setChat(res.chat);
    };

    const onPresenceUpdate = (p: PresenceState) => usePresence.getState().upsert(p);
    const onPresenceLeave = ({ socketId }: { socketId: string }) => {
      usePresence.getState().remove(socketId);
    };
    const onCursor = ({ socketId, cursor }: { socketId: string; cursor: CursorPoint | null }) =>
      usePresence.getState().setCursor(socketId, cursor);
    const onAction = ({ socketId, label }: { socketId: string; label: string }) =>
      usePresence.getState().setAction(socketId, label);
    const onNotes = (p: { templateId: string; notes: SecretNoteMeta[] }) => {
      if (p.templateId === tid) setNotes(p.notes);
    };
    const onChat = (p: { templateId: string; message: ChatMessage }) => {
      if (p.templateId !== tid) return;
      setChat((c) => [...c.slice(-299), p.message]);
      if (p.message.user.id !== useSession.getState().user?.id && !chatOpenRef.current) {
        setUnread((n) => n + 1);
        toast.show({
          kind: 'info',
          title: `${p.message.user.name} · 채팅`,
          message: p.message.text.length > 80 ? `${p.message.text.slice(0, 80)}…` : p.message.text,
          user: p.message.user,
        });
      }
    };
    const onTemplateUpdated = (t: TemplateSummary) => {
      if (t.id === tid) setTemplate(t);
    };

    s.on('connect', enter);
    s.on('presence:update', onPresenceUpdate);
    s.on('presence:leave', onPresenceLeave);
    s.on('presence:cursor', onCursor);
    s.on('presence:action', onAction);
    s.on('notes:changed', onNotes);
    s.on('chat:message', onChat);
    s.on('template:updated', onTemplateUpdated);
    if (s.connected) void enter();

    return () => {
      s.off('connect', enter);
      s.off('presence:update', onPresenceUpdate);
      s.off('presence:leave', onPresenceLeave);
      s.off('presence:cursor', onCursor);
      s.off('presence:action', onAction);
      s.off('notes:changed', onNotes);
      s.off('chat:message', onChat);
      s.off('template:updated', onTemplateUpdated);
      if (s.connected) s.emit('template:leave', {});
      presence.clear();
    };
  }, [tid]);

  /* ── 내가 보고 있는 화면을 알림 ── */
  useEffect(() => {
    getSocket().emit('presence:update', { view });
  }, [view.module, view.itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── 자리 비움 감지 ── */
  useEffect(() => {
    let idle = false;
    let timer: ReturnType<typeof setTimeout>;
    const setIdle = (v: boolean) => {
      if (idle === v) return;
      idle = v;
      getSocket().emit('presence:update', { idle: v });
    };
    const activity = () => {
      setIdle(document.hidden);
      clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), IDLE_AFTER_MS);
    };
    const events = ['pointermove', 'keydown', 'wheel', 'visibilitychange'] as const;
    events.forEach((e) => window.addEventListener(e, activity, { passive: true }));
    activity();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, activity));
    };
  }, [tid]);

  /* ── 따라가기: 상대가 보는 화면으로 이동 ── */
  // 소켓이 아니라 사용자를 따라가므로 상대가 새로고침/재접속해도 계속 따라간다
  const followed = useUserPresence(follow);
  useEffect(() => {
    if (!follow) return;
    if (!followed) {
      const t = setTimeout(() => {
        setFollow(null);
        toast.info('따라가기를 중지했습니다', '따라가던 사용자가 템플릿을 떠났습니다.');
      }, 6000);
      return () => clearTimeout(t);
    }
    if (!sameView(followed.view, viewRef.current)) {
      navigate(viewPath(tid, followed.view.module, followed.view.itemId));
    }
  }, [follow, followed?.view.module, followed?.view.itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!follow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFollow(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [follow]);

  /* ── 컨텍스트 함수들 ── */
  const lastReport = useRef(new Map<string, number>());
  const report = useCallback((input: ActivityInput) => {
    const frequent = input.type.endsWith('.edit') || input.type === 'design.shape.add' || input.type === 'design.shape.delete';
    if (frequent) {
      const key = `${input.type}:${input.targetId}`;
      const now = Date.now();
      if (now - (lastReport.current.get(key) ?? 0) < EDIT_REPORT_INTERVAL) return;
      lastReport.current.set(key, now);
    }
    getSocket().emit('activity', input, () => {});
  }, []);

  const action = useMemo(() => {
    let lastLabel = '';
    let lastAt = 0;
    return (label: string) => {
      const now = Date.now();
      if (label === lastLabel && now - lastAt < 1500) return;
      lastLabel = label;
      lastAt = now;
      getSocket().emit('presence:action', { label });
    };
  }, []);

  const publishCursor = useMemo(
    () => throttle((cursor: CursorPoint | null) => getSocket().volatile.emit('presence:cursor', { cursor }), 40),
    [],
  );

  const updatePresence = useMemo(() => {
    const send = throttle((patch: Record<string, unknown>) => getSocket().emit('presence:update', patch), 80);
    return (patch: Record<string, unknown>) => send(patch);
  }, []);

  const setTicket = useCallback((noteId: string, t: UnlockResult | null) => {
    setTickets((prev) => {
      const next = { ...prev };
      if (t) next[noteId] = t;
      else delete next[noteId];
      return next;
    });
  }, []);

  const go = useCallback(
    (module: ViewModule, itemId?: string | null) => navigate(viewPath(tid, module, itemId)),
    [navigate, tid],
  );

  const setChatOpen = useCallback((open: boolean) => {
    setChatOpenState(open);
    if (open) setUnread(0);
  }, []);

  // 템플릿 전환 시 상태 초기화
  useEffect(() => {
    setTickets({});
    setFollow(null);
    setUnread(0);
    setError(null);
    setTemplate(useTemplates.getState().templates[tid] ?? null);
  }, [tid]);

  if (error) {
    return (
      <AppShell>
        <EmptyState
          icon={<ShieldAlert size={36} />}
          title="템플릿을 열 수 없습니다"
          action={
            <Button variant="primary" onClick={() => navigate('/')}>
              대시보드로 이동
            </Button>
          }
        >
          {error}
        </EmptyState>
      </AppShell>
    );
  }

  if (!template || !yjs) {
    return (
      <AppShell>
        <div className="center-fill">
          <Spinner size={28} />
        </div>
      </AppShell>
    );
  }

  const value: WorkspaceValue = {
    template,
    role: template.myRole,
    canEdit: template.myRole !== 'viewer',
    doc: yjs.doc,
    provider: yjs.provider,
    synced,
    view,
    notes,
    chat,
    chatOpen,
    setChatOpen,
    unread,
    report,
    action,
    publishCursor,
    updatePresence,
    follow,
    setFollow,
    tickets,
    setTicket,
    go,
    panelOpen,
    setPanelOpen,
  };

  const featureOff = (['design', 'code', 'docs'] as const).includes(view.module as 'design') && !template.features.includes(view.module as 'design');

  return (
    <WorkspaceContext.Provider value={value}>
      <AppShell panel={<Explorer />} panelOpen={panelOpen} drawer={chatOpen ? <ChatPanel /> : null}>
        {follow && followed && <FollowBanner presence={followed} onStop={() => setFollow(null)} />}
        {featureOff ? (
          <EmptyState title="이 템플릿에서 사용하지 않는 기능입니다" action={<Button onClick={() => go('settings')}>설정에서 기능 켜기</Button>}>
            템플릿 설정에서 기능을 추가하면 바로 사용할 수 있습니다.
          </EmptyState>
        ) : (
          <Suspense
            fallback={
              <div className="center-fill">
                <Spinner size={24} />
              </div>
            }
          >
            <ModuleView module={view.module} key={`${view.module}`} />
          </Suspense>
        )}
      </AppShell>
      <MeWatermark name={me.name} />
    </WorkspaceContext.Provider>
  );
}

function ModuleView({ module }: { module: ViewModule }) {
  switch (module) {
    case 'code':
      return <CodeModule />;
    case 'docs':
      return <DocsModule />;
    case 'design':
      return <DesignModule />;
    case 'notes':
      return <NotesModule />;
    case 'timeline':
      return <TemplateTimeline />;
    case 'members':
      return <Members />;
    case 'settings':
      return <Settings />;
    default:
      return <Overview />;
  }
}

/** 스크린 리더용: 현재 사용자 표시 */
function MeWatermark({ name }: { name: string }) {
  return <span className="sr-only">{name} 님으로 접속 중</span>;
}
