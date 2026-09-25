import { createContext, useContext } from 'react';
import type * as Y from 'yjs';
import type {
  ActivityInput,
  ChatMessage,
  CursorPoint,
  JoinRequest,
  PresenceState,
  PresenceView,
  Role,
  SecretNoteMeta,
  TemplateEntry,
  TemplateMode,
  ViewModule,
} from '@shared/types';
import type { DocProvider } from '../lib/yprovider';
import type { RoomConnection } from '../lib/room';
import type { NotesApi, UnlockedNote } from '../lib/notes';

export interface WorkspaceValue {
  template: TemplateEntry;
  /** 저장 위치 — personal: 아직 이 기기에만 있음 (백업 대기) / shared: 클라우드에 저장 · 실시간 동기화 */
  mode: TemplateMode;
  /** 나만 보는 개인 공간인지 (false면 초대한 멤버와 함께 쓰는 협업 공간) */
  isPrivate: boolean;
  role: Role;
  canEdit: boolean;
  doc: Y.Doc;
  provider: DocProvider;
  /** 협업 공간의 실시간 연결 (개인 공간이면 null) */
  room: RoomConnection | null;
  notesApi: NotesApi;
  /** 승인 대기 중인 참여 요청 (편집자 이상에게만) */
  requests: JoinRequest[];
  synced: boolean;
  view: PresenceView;
  notes: SecretNoteMeta[];
  chat: ChatMessage[];
  chatOpen: boolean;
  setChatOpen(open: boolean): void;
  unread: number;
  /** 타임라인에 남는 활동 보고 (편집 등 잦은 활동은 알아서 조절) */
  report(input: ActivityInput): void;
  /** 커서 옆 말풍선으로만 보여줄 짧은 행동 */
  action(label: string): void;
  publishCursor(cursor: CursorPoint | null): void;
  updatePresence(patch: Partial<Pick<PresenceState, 'viewport' | 'selection' | 'idle'>>): void;
  /** 저장하지 않고 다른 사람에게만 보내는 순간 정보 (보는 사람이 있을 때만 전송) */
  live(kind: string, data: unknown): void;
  /** 지금 같은 템플릿에 다른 사람이 있는지 */
  hasAudience(): boolean;
  /** 따라가는 사용자 ID */
  follow: string | null;
  setFollow(userId: string | null): void;
  /** 잠금 해제한 비밀 노트의 키 (메모리에만 보관) */
  tickets: Record<string, UnlockedNote>;
  setTicket(noteId: string, ticket: UnlockedNote | null): void;
  go(module: ViewModule, itemId?: string | null): void;
  panelOpen: boolean;
  setPanelOpen(open: boolean): void;
}

export const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('WorkspaceContext 밖에서 사용할 수 없습니다');
  return ctx;
}

export function useOptionalWorkspace(): WorkspaceValue | null {
  return useContext(WorkspaceContext);
}

export function parseView(pathname: string): { templateId: string | null; view: PresenceView } {
  const m = /^\/t\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?/.exec(pathname);
  if (!m) return { templateId: null, view: { module: 'overview', itemId: null } };
  const module = (m[2] ?? 'overview') as ViewModule;
  return { templateId: m[1], view: { module, itemId: m[3] ? decodeURIComponent(m[3]) : null } };
}

export function viewPath(templateId: string, module: ViewModule, itemId?: string | null): string {
  if (module === 'overview') return `/t/${templateId}`;
  return `/t/${templateId}/${module}${itemId ? `/${encodeURIComponent(itemId)}` : ''}`;
}

export const sameView = (a: PresenceView, b: PresenceView) => a.module === b.module && (a.itemId ?? null) === (b.itemId ?? null);
