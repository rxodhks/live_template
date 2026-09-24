// 서버와 클라이언트가 함께 사용하는 타입 정의

export type Feature = 'design' | 'code' | 'docs';
export type Role = 'owner' | 'editor' | 'viewer';

/** 사용자가 현재 보고 있는 화면 단위 (프레즌스/커서 공유 범위) */
export type ViewModule =
  | 'overview'
  | Feature
  | 'notes'
  | 'timeline'
  | 'members'
  | 'settings';

export interface PublicUser {
  id: string;
  name: string;
  color: string;
  avatar: string;
}

export interface MemberInfo {
  user: PublicUser;
  role: Role;
  joinedAt: number;
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  emoji: string;
  features: Feature[];
  ownerId: string;
  members: MemberInfo[];
  createdAt: number;
  updatedAt: number;
  myRole: Role;
  /** 소유자/편집자에게만 전달 */
  inviteCode?: string;
}

export interface PresenceView {
  module: ViewModule;
  itemId?: string | null;
}

export interface CursorPoint {
  /** design: 월드 좌표 / 그 외: x는 너비 대비 비율(0~1), y는 콘텐츠 상단 기준 px */
  x: number;
  y: number;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface PresenceState {
  socketId: string;
  user: PublicUser;
  view: PresenceView;
  cursor: CursorPoint | null;
  viewport?: Viewport | null;
  selection?: string[];
  idle?: boolean;
  /** 마지막으로 보여준 행동 라벨 */
  action?: { label: string; at: number } | null;
}

export type ActivityModule =
  | 'presence'
  | 'template'
  | 'member'
  | Feature
  | 'notes';

export type ActivityType =
  | 'presence.join'
  | 'presence.leave'
  | 'template.create'
  | 'template.update'
  | 'member.join'
  | 'member.leave'
  | 'member.role'
  | 'member.remove'
  | 'code.create'
  | 'code.delete'
  | 'code.rename'
  | 'code.language'
  | 'code.edit'
  | 'code.run'
  | 'docs.create'
  | 'docs.delete'
  | 'docs.rename'
  | 'docs.edit'
  | 'design.create'
  | 'design.delete'
  | 'design.rename'
  | 'design.shape.add'
  | 'design.shape.delete'
  | 'design.edit'
  | 'notes.create'
  | 'notes.delete'
  | 'notes.unlock'
  | 'notes.unlock_fail'
  | 'notes.password'
  | 'notes.edit';

/** 클라이언트가 서버에 보고하는 활동 */
export interface ActivityInput {
  type: ActivityType;
  targetId?: string;
  targetName?: string;
  detail?: string;
}

export interface TimelineEvent {
  id: string;
  templateId: string;
  templateName: string;
  user: PublicUser;
  type: ActivityType;
  module: ActivityModule;
  targetId?: string;
  targetName?: string;
  detail?: string;
  /** 사람이 읽을 수 있는 요약 (예: ‘main.js’ 파일을 만들었습니다) */
  text: string;
  at: number;
  /** 연속된 동일 행동은 하나로 합쳐 횟수로 기록 */
  count: number;
  important: boolean;
}

export type ToastKind = 'info' | 'success' | 'warning' | 'danger';

export interface ToastPayload {
  id?: string;
  kind: ToastKind;
  title: string;
  message?: string;
  user?: PublicUser;
  icon?: string;
  /** 표시 시간(ms) */
  duration?: number;
}

export interface ChatMessage {
  id: string;
  user: PublicUser;
  text: string;
  at: number;
}

export interface SecretNoteMeta {
  id: string;
  title: string;
  hint: string;
  createdBy: PublicUser;
  createdAt: number;
  updatedAt: number;
}

export interface UnlockResult {
  ticket: string;
  expiresAt: number;
}

export interface ApiError {
  error: string;
  retryAfter?: number;
}
