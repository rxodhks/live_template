import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { ShieldAlert, SearchX } from 'lucide-react';
import type { ActivityInput, ChatMessage, CursorPoint, JoinRequest, SecretNoteMeta, TemplateEntry, TemplateSummary, ViewModule } from '@shared/types';
import type { LivePen, PresencePatch } from '@shared/protocol';
import { RoomConnection } from '../lib/room';
import { type DocProvider, LocalProvider, RoomProvider } from '../lib/yprovider';
import { createNotesApi, type UnlockedNote } from '../lib/notes';
import { recordLocal } from '../lib/local';
import { docDbName } from '../lib/idb';
import { api } from '../lib/api';
import { throttle } from '../lib/util';
import { usePresence, useUserPresence } from '../store/presence';
import { dispatchTimelineEvent, isPrivate, useTemplates } from '../store/templates';
import { backupPending, setOpenTemplate } from '../lib/templateOps';
import { useConnection } from '../store/connection';
import { useLive } from '../store/live';
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
import { EmptyState, Spinner, Button } from '../components/ui';

// 에디터 모듈은 필요할 때 불러온다 (초기 로딩 경량화)
const CodeModule = lazy(() => import('../modules/code/CodeModule').then((m) => ({ default: m.CodeModule })));
const DocsModule = lazy(() => import('../modules/docs/DocsModule').then((m) => ({ default: m.DocsModule })));
const DesignModule = lazy(() => import('../modules/design/DesignModule').then((m) => ({ default: m.DesignModule })));
const NotesModule = lazy(() => import('../modules/notes/NotesModule').then((m) => ({ default: m.NotesModule })));

/** 잦은 편집 활동은 대상별로 이 간격에 한 번만 보고 (서버에서도 5분 단위로 합침) */
const EDIT_REPORT_INTERVAL = 20_000;
const IDLE_AFTER_MS = 90_000;
/** 커서 위치 전송 간격 — 받는 쪽에서 이 간격을 부드럽게 이어 그린다 (CSS 보간) */
const CURSOR_MS = 100;
/** 같은 행동 라벨 재전송 간격 (말풍선이 3.5초 유지되므로 그 안에서 한 번이면 계속 보인다) */
const ACTION_REPEAT_MS = 3000;

const ROLE_LABEL = { owner: '소유자', editor: '편집자', viewer: '뷰어' } as const;

/**
 * 템플릿 화면.
 * 개인 공간과 협업 공간은 같은 화면·같은 문서를 쓰고, 연결 방식만 다르다.
 * 초대해서 협업 공간으로 바뀌면 그 자리에서 실시간 협업 모드로 다시 연결된다.
 */
export function Workspace() {
  const { tid = '' } = useParams();
  const entry = useTemplates((s) => s.templates[tid]);
  const loaded = useTemplates((s) => s.loaded);
  const [lookup, setLookup] = useState<'idle' | 'loading' | 'missing'>('idle');
  const navigate = useNavigate();

  // 목록에 없는 협업 템플릿 링크로 바로 들어온 경우 (다른 기기에서 참여한 템플릿 등)
  useEffect(() => {
    if (!loaded || entry || lookup !== 'idle') return;
    setLookup('loading');
    api<{ template: TemplateSummary }>('GET', `/templates/${tid}`)
      .then((r) => useTemplates.getState().upsertShared(r.template))
      .catch(() => setLookup('missing'));
  }, [loaded, entry, lookup, tid]);

  useEffect(() => setLookup('idle'), [tid]);

  // 열려 있는 동안은 자동 백업에서 빼고, 닫히면 이 기기에만 있던 내용을 바로 백업한다
  useEffect(() => {
    setOpenTemplate(tid);
    return () => {
      setOpenTemplate(null);
      void backupPending();
    };
  }, [tid]);

  if (!entry) {
    return (
      <AppShell>
        {lookup === 'missing' ? (
          <EmptyState
            icon={<SearchX size={36} />}
            title="템플릿을 찾을 수 없습니다"
            action={
              <Button variant="primary" onClick={() => navigate('/')}>
                대시보드로 이동
              </Button>
            }
          >
            이 브라우저에 없는 템플릿이거나, 삭제되었거나, 접근 권한이 없습니다.
          </EmptyState>
        ) : (
          <div className="center-fill">
            <Spinner size={28} />
          </div>
        )}
      </AppShell>
    );
  }
  // 모드가 바뀌면(개인 → 협업) 연결을 새로 구성한다
  return <WorkspaceInner key={`${entry.id}:${entry.mode}`} entry={entry} />;
}

function WorkspaceInner({ entry }: { entry: TemplateEntry }) {
  const tid = entry.id;
  const shared = entry.mode === 'shared';
  const location = useLocation();
  const navigate = useNavigate();
  const { view } = parseView(location.pathname);
  const me = useSession((s) => s.user)!;

  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<SecretNoteMeta[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [chatOpen, setChatOpenState] = useState(false);
  const [unread, setUnread] = useState(0);
  const [follow, setFollow] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Record<string, UnlockedNote>>({});
  const [panelOpen, setPanelOpen] = useState(true);
  const [synced, setSynced] = useState(!shared);

  const viewRef = useRef(view);
  viewRef.current = view;
  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;
  const entryRef = useRef(entry);
  entryRef.current = entry;

  /* ── 연결: 개인 공간은 브라우저만, 협업 공간은 실시간 방 ── */
  const [conn, setConn] = useState<{ doc: Y.Doc; provider: DocProvider; room: RoomConnection | null } | null>(null);
  useEffect(() => {
    const doc = new Y.Doc();
    // 두 모드 모두 브라우저에 사본을 둔다 → 새로고침·오프라인에도 바로 열린다
    const idb = new IndexeddbPersistence(docDbName(tid), doc);
    const whenReady = Promise.race([idb.whenSynced, new Promise((r) => setTimeout(r, 1500))]);
    const room = shared ? new RoomConnection(tid) : null;
    const provider: DocProvider = room ? new RoomProvider(room, doc, { whenReady }) : new LocalProvider(doc);
    const update = () => setSynced(provider.synced);
    const unsub = provider.subscribe(update);
    let cancelled = false;
    void whenReady.then(() => !cancelled && setConn({ doc, provider, room }));
    return () => {
      cancelled = true;
      unsub();
      setConn(null);
      provider.destroy();
      room?.close();
      void idb.destroy();
      doc.destroy();
    };
  }, [tid, shared]);

  /* ── 개인 공간: 수정 시각 갱신 ── */
  useEffect(() => {
    if (!conn || shared) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin instanceof IndexeddbPersistence || timer) return;
      timer = setTimeout(() => {
        timer = null;
        useTemplates.getState().touch(tid);
      }, 3000);
    };
    conn.doc.on('update', onUpdate);
    return () => {
      conn.doc.off('update', onUpdate);
      if (timer) clearTimeout(timer);
    };
  }, [conn, shared, tid]);

  /* ── 협업 공간: 실시간 이벤트 ── */
  useEffect(() => {
    const room = conn?.room;
    if (!room) return;
    const presence = usePresence.getState();
    const connection = useConnection.getState();
    const setRoleInStore = (role: TemplateEntry['myRole']) => {
      const t = useTemplates.getState().templates[tid];
      if (t) useTemplates.getState().upsert({ ...t, myRole: role });
    };
    const offs = [
      room.onStatus((s) => {
        connection.setStatus(s === 'online' ? 'online' : s === 'connecting' ? 'connecting' : 'offline');
        if (s === 'denied') setError(room.deniedReason ?? '템플릿에 접근할 수 없습니다.');
        if (s !== 'online') usePresence.getState().clear();
      }),
      room.on('welcome', (m) => {
        usePresence.getState().reset(m.presence, m.sid);
        setNotes(m.notes);
        setChat(m.chat);
        setRequests(m.requests);
        useTemplates.getState().setRequests(tid, m.requests.length);
        if (m.role !== entryRef.current.myRole) setRoleInStore(m.role);
        room.send({ t: 'presence', patch: { view: viewRef.current, idle: document.hidden } });
      }),
      room.on('presence', (m) => usePresence.getState().upsert(m.state)),
      room.on('presence:leave', (m) => {
        usePresence.getState().remove(m.sid);
        useLive.getState().removeBySid(m.sid);
      }),
      room.on('live', (m) => {
        if (m.k !== 'pen') return;
        const pen = m.d as LivePen;
        useLive.getState().receivePen(m.sid, pen);
        // 그리는 동안에는 커서 메시지를 따로 보내지 않으므로 선 끝을 커서 위치로 쓴다
        const n = pen.pts?.length ?? 0;
        if (n >= 2) usePresence.getState().setCursor(m.sid, { x: pen.pts[n - 2], y: pen.pts[n - 1] });
      }),
      room.on('cursor', (m) => usePresence.getState().setCursor(m.sid, m.c)),
      room.on('action', (m) => usePresence.getState().setAction(m.sid, m.label)),
      room.on('timeline', (m) => dispatchTimelineEvent(m)),
      room.on('toast', (m) => toast.show(m.toast)),
      room.on('notes', (m) => setNotes(m.notes)),
      room.on('chat', (m) => {
        setChat((c) => [...c.slice(-299), m.message]);
        if (m.message.user.id !== useSession.getState().user?.id && !chatOpenRef.current) {
          setUnread((n) => n + 1);
          toast.show({
            kind: 'info',
            title: `${m.message.user.name} · 채팅`,
            message: m.message.text.length > 80 ? `${m.message.text.slice(0, 80)}…` : m.message.text,
            user: m.message.user,
          });
        }
      }),
      room.on('template', (m) => {
        useTemplates.getState().upsert({ ...m.template, myRole: entryRef.current.myRole, mode: 'shared' });
      }),
      room.on('role', (m) => {
        setRoleInStore(m.role);
        toast.show({ kind: 'info', title: '내 권한이 변경되었습니다', message: `이제 ${ROLE_LABEL[m.role]}입니다.${m.role === 'viewer' ? ' 읽기 전용으로 전환됩니다.' : ''}` });
      }),
      room.on('requests', (m) => {
        setRequests(m.requests);
        useTemplates.getState().setRequests(tid, m.requests.length);
      }),
      room.on('kicked', (m) => {
        const name = entryRef.current.name;
        useTemplates.getState().remove(tid, { dropLocalCopy: true });
        if (m.reason === 'deleted')
          toast.show({ kind: 'danger', title: '템플릿이 휴지통으로 이동했습니다', message: `${m.by ?? '소유자'} 님이 ‘${name}’ 템플릿을 삭제했습니다. 소유자는 30일 안에 복원할 수 있습니다.` });
        else if (m.reason === 'removed') toast.warning('템플릿에서 제외되었습니다', `‘${name}’ 템플릿에 더 이상 접근할 수 없습니다.`);
        navigate('/', { replace: true });
      }),
    ];
    return () => {
      offs.forEach((off) => off());
      presence.clear();
      useLive.getState().clear();
      connection.setStatus('online');
    };
  }, [conn, tid, navigate]);

  /* ── 개인 공간: 비밀 노트 목록 ── */
  const reloadLocalNotes = useRef<() => void>(() => {});
  const report = useCallbackReport(entry, conn?.room ?? null, shared);

  const notesApi = useMemo(
    () =>
      createNotesApi({
        mode: entry.mode,
        templateId: tid,
        me: () => useSession.getState().user!,
        room: conn?.room ?? null,
        record: (input) => void recordLocal(entryRef.current, useSession.getState().user!, input),
        changed: () => reloadLocalNotes.current(),
      }),
    [entry.mode, tid, conn?.room],
  );

  useEffect(() => {
    if (shared) return;
    let alive = true;
    reloadLocalNotes.current = () => void notesApi.list().then((list) => alive && setNotes(list));
    reloadLocalNotes.current();
    return () => {
      alive = false;
    };
  }, [notesApi, shared]);

  /* ── 내가 보고 있는 화면을 알림 ── */
  useEffect(() => {
    conn?.room?.send({ t: 'presence', patch: { view } });
  }, [view.module, view.itemId, conn]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── 자리 비움 감지 ── */
  useEffect(() => {
    const room = conn?.room;
    if (!room) return;
    let idle = false;
    let timer: ReturnType<typeof setTimeout>;
    const setIdle = (v: boolean) => {
      if (idle === v) return;
      idle = v;
      room.send({ t: 'presence', patch: { idle: v } });
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
  }, [conn]);

  /* ── 따라가기: 상대가 보는 화면으로 이동 ── */
  // 연결이 아니라 사용자를 따라가므로 상대가 새로고침/재접속해도 계속 따라간다
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
  const room = conn?.room ?? null;
  // 커서·행동 라벨·화면 위치처럼 "보는 사람"이 있어야 의미 있는 정보는 혼자일 때 보내지 않는다
  const action = useMemo(() => {
    let lastLabel = '';
    let lastAt = 0;
    return (label: string) => {
      const now = Date.now();
      if (!room || !room.audience || (label === lastLabel && now - lastAt < ACTION_REPEAT_MS)) return;
      lastLabel = label;
      lastAt = now;
      room.send({ t: 'action', label });
    };
  }, [room]);

  const publishCursor = useMemo(
    () =>
      throttle((c: CursorPoint | null) => {
        if (room?.audience) room.send({ t: 'cursor', c });
      }, CURSOR_MS),
    [room],
  );

  const live = useCallback((k: string, d: unknown) => {
    if (room?.audience) room.send({ t: 'live', k, d });
  }, [room]);

  const hasAudience = useCallback(() => !!room?.audience, [room]);

  const updatePresence = useMemo(() => {
    // 혼자일 때 바뀐 화면 위치·선택은 모아 두었다가 누가 들어오면 한 번에 보낸다
    let held: PresencePatch | null = null;
    const send = throttle((patch: PresencePatch) => room?.send({ t: 'presence', patch }), 100);
    room?.onAudience((n) => {
      if (n > 0 && held) {
        room.send({ t: 'presence', patch: held });
        held = null;
      }
    });
    return (patch: PresencePatch) => {
      if (!room) return;
      if (!room.audience) held = { ...held, ...patch };
      else send(patch);
    };
  }, [room]);

  const setTicket = useCallback((noteId: string, t: UnlockedNote | null) => {
    setTickets((prev) => {
      const next = { ...prev };
      if (t) next[noteId] = t;
      else delete next[noteId];
      return next;
    });
  }, []);

  const go = useCallback((module: ViewModule, itemId?: string | null) => navigate(viewPath(tid, module, itemId)), [navigate, tid]);

  const setChatOpen = useCallback((open: boolean) => {
    setChatOpenState(open);
    if (open) setUnread(0);
  }, []);

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

  if (!conn) {
    return (
      <AppShell>
        <div className="center-fill">
          <Spinner size={28} />
        </div>
      </AppShell>
    );
  }

  const value: WorkspaceValue = {
    template: entry,
    mode: entry.mode,
    isPrivate: isPrivate(entry),
    role: entry.myRole,
    canEdit: entry.myRole !== 'viewer',
    doc: conn.doc,
    provider: conn.provider,
    room: conn.room,
    notesApi,
    requests,
    synced,
    view,
    notes,
    chat,
    chatOpen: shared && !isPrivate(entry) && chatOpen,
    setChatOpen,
    unread,
    report,
    action,
    publishCursor,
    updatePresence,
    live,
    hasAudience,
    follow,
    setFollow,
    tickets,
    setTicket,
    go,
    panelOpen,
    setPanelOpen,
  };

  const featureOff = (['design', 'code', 'docs'] as const).includes(view.module as 'design') && !entry.features.includes(view.module as 'design');

  return (
    <WorkspaceContext.Provider value={value}>
      <AppShell panel={<Explorer />} panelOpen={panelOpen} drawer={value.chatOpen ? <ChatPanel /> : null}>
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
      <span className="sr-only">{me.name} 님으로 작업 중</span>
    </WorkspaceContext.Provider>
  );
}

/** 활동 보고: 개인 공간은 브라우저 타임라인, 협업 공간은 서버 타임라인 */
function useCallbackReport(entry: TemplateEntry, room: RoomConnection | null, shared: boolean) {
  const lastReport = useRef(new Map<string, number>());
  const entryRef = useRef(entry);
  entryRef.current = entry;
  return useCallback(
    (input: ActivityInput) => {
      const frequent = input.type.endsWith('.edit') || input.type === 'design.shape.add' || input.type === 'design.shape.delete';
      if (frequent) {
        const key = `${input.type}:${input.targetId}`;
        const now = Date.now();
        if (now - (lastReport.current.get(key) ?? 0) < EDIT_REPORT_INTERVAL) return;
        lastReport.current.set(key, now);
      }
      if (shared) room?.send({ t: 'activity', input });
      else void recordLocal(entryRef.current, useSession.getState().user!, input);
    },
    [room, shared],
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

