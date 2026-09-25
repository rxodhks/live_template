/*
 * 협업 공간의 실시간 연결(WebSocket) 메시지 형식.
 * 템플릿 하나마다 클라우드플레어 Durable Object 하나가 "방"이 되어 이 메시지를 주고받는다.
 * 이진 데이터(Yjs 업데이트, 암호문)는 base64 문자열로 보낸다.
 */
import type {
  ActivityInput,
  ChatMessage,
  CursorPoint,
  JoinRequest,
  PresenceState,
  PresenceView,
  Role,
  SecretNoteMeta,
  TemplateSummary,
  TimelineEvent,
  ToastPayload,
  Viewport,
} from './types';

export interface PresencePatch {
  view?: PresenceView;
  viewport?: Viewport | null;
  selection?: string[];
  idle?: boolean;
}

/** 브라우저 → 서버 */
export type ClientMessage =
  | { t: 'sync'; id: number; sv: string }
  | { t: 'update'; id: number; u: string }
  | { t: 'aw'; u: string }
  | { t: 'presence'; patch: PresencePatch }
  | { t: 'cursor'; c: CursorPoint | null }
  | { t: 'action'; label: string }
  | { t: 'activity'; input: ActivityInput }
  | { t: 'chat'; id: number; text: string }
  | { t: 'note:join'; id: number; noteId: string; ticket: string }
  | { t: 'note:leave'; noteId: string }
  | { t: 'note:update'; id: number; noteId: string; data: string }
  | { t: 'note:aw'; noteId: string; data: string }
  | { t: 'note:snapshot'; id: number; noteId: string; data: string; upto: number };

export type TemplateBroadcast = Omit<TemplateSummary, 'myRole'>;

/** 서버 → 브라우저 */
export type ServerMessage =
  | { t: 'welcome'; sid: string; role: Role; presence: PresenceState[]; chat: ChatMessage[]; notes: SecretNoteMeta[]; requests: JoinRequest[] }
  | { t: 'ack'; id: number; ok: boolean; error?: string; status?: number; data?: unknown }
  | { t: 'update'; u: string }
  | { t: 'aw'; u: string }
  | { t: 'aw:query' }
  | { t: 'presence'; state: PresenceState }
  | { t: 'presence:leave'; sid: string; clients: number[] }
  | { t: 'cursor'; sid: string; c: CursorPoint | null }
  | { t: 'action'; sid: string; label: string }
  | { t: 'timeline'; event: TimelineEvent; merged: boolean }
  | { t: 'toast'; toast: ToastPayload }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'notes'; notes: SecretNoteMeta[] }
  | { t: 'note:update'; noteId: string; data: string; uid: number }
  | { t: 'note:aw'; noteId: string; data: string }
  | { t: 'note:locked'; noteId: string; reason: 'password' | 'deleted' | 'expired' }
  | { t: 'template'; template: TemplateBroadcast }
  | { t: 'role'; role: Role }
  | { t: 'requests'; requests: JoinRequest[] }
  | { t: 'kicked'; reason: 'removed' | 'deleted' | 'left'; by?: string };

export interface NoteJoinData {
  snapshot: string;
  updates: { uid: number; data: string }[];
}
