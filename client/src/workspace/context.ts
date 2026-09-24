import { createContext, useContext } from 'react';
import type * as Y from 'yjs';
import type {
  ActivityInput,
  ChatMessage,
  CursorPoint,
  PresenceState,
  PresenceView,
  Role,
  SecretNoteMeta,
  TemplateSummary,
  UnlockResult,
  ViewModule,
} from '@shared/types';
import type { SocketYProvider } from '../lib/yprovider';

export interface WorkspaceValue {
  template: TemplateSummary;
  role: Role;
  canEdit: boolean;
  doc: Y.Doc;
  provider: SocketYProvider;
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
  follow: string | null;
  setFollow(socketId: string | null): void;
  tickets: Record<string, UnlockResult>;
  setTicket(noteId: string, ticket: UnlockResult | null): void;
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
