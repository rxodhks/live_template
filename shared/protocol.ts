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

/**
 * 화면(클라이언트) 호환 버전 — 문서에 예전 화면이 모르는 요소(새 블록 · 글자 색 등)가 생기면 올린다.
 * 예전 화면은 모르는 블록을 만나면 문서에서 지워 버리므로(y-prosemirror), 서버는 이보다 낮은 화면의 연결을 받지 않고
 * 새로고침을 안내한다.
 *  1: 처음
 *  2: 노션식 문서 블록 (토글 · 콜아웃 · 이미지 · 임베드 · 수식 · 다단 · 목차 · 멘션 · 글자 색)
 */
export const CLIENT_VERSION = 2;
/** 화면 버전을 싣는 요청 헤더 · 실시간 연결 주소의 쿼리 이름 */
export const CLIENT_VERSION_HEADER = 'x-lt-client';
export const CLIENT_VERSION_PARAM = 'cv';

export interface PresencePatch {
  view?: PresenceView;
  viewport?: Viewport | null;
  selection?: string[];
  idle?: boolean;
}

/** 브라우저 → 서버 */
export type ClientMessage =
  | { t: 'sync'; id: number; sv: string }
  /** 문서 변경. aw: 같은 순간의 텍스트 커서(awareness) 변경을 한 메시지에 함께 싣는다 */
  | { t: 'update'; id: number; u: string; aw?: string }
  | { t: 'aw'; u: string }
  /** 저장하지 않고 다른 사람에게만 보내는 순간 정보 (예: 그리고 있는 펜 선) */
  | { t: 'live'; k: string; d: unknown }
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
  | { t: 'update'; u: string; aw?: string }
  | { t: 'aw'; u: string }
  | { t: 'live'; sid: string; k: string; d: unknown }
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

/** 펜으로 그리는 중인 선 (저장하지 않고 중계만) */
export interface LivePen {
  /** 완성되면 저장될 도형 ID */
  id: string;
  board: string;
  /** 새로 추가된 점들 (월드 좌표 x, y 반복) */
  pts: number[];
  /** 처음 보낼 때만: 선 스타일 */
  style?: { stroke: string; strokeWidth: number; opacity: number };
  /** 그리기가 끝났거나 취소됨 */
  end?: 'commit' | 'cancel';
}
