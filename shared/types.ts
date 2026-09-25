// 서버(Cloudflare Worker)와 클라이언트가 함께 사용하는 타입 정의

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

/* ───────────── 로그인 ───────────── */

export type OAuthProvider = 'google' | 'github' | 'apple';
export type AuthProvider = 'email' | OAuthProvider;

/** 로그인 화면 구성: 서버에 설정된 로그인 방법만 보여 준다 */
export interface AuthConfig {
  email: boolean;
  providers: Record<OAuthProvider, boolean>;
  /** 로컬 개발 모드: 인증 코드를 메일 대신 응답과 서버 로그로 준다 */
  devMode: boolean;
}

/** 로그인한 계정 정보 (본인에게만 보인다) */
export interface AccountInfo {
  email: string | null;
  providers: OAuthProvider[];
}

/** 인증을 마치고 이름을 정하기 전의 가입 정보 */
export interface SignupInfo {
  email: string | null;
  provider: AuthProvider;
  suggestedName: string;
}

export type EmailVerifyResult = { status: 'signed_in'; user: PublicUser } | { status: 'needs_name' };

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
}

/**
 * 템플릿이 어디에 있는지
 *  - personal: 이 브라우저에만 저장된 개인 공간 (서버 불필요)
 *  - shared  : 초대를 통해 협업 공간으로 전환된 템플릿 (클라우드플레어에 저장, 실시간 협업)
 */
export type TemplateMode = 'personal' | 'shared';

export interface TemplateEntry extends TemplateSummary {
  mode: TemplateMode;
}

/* ───────────── 초대 ───────────── */

export type InviteRole = 'editor' | 'viewer';

/** 초대 링크 하나. 링크마다 권한·만료·사용 횟수·승인 여부를 따로 정한다 */
export interface InviteInfo {
  id: string;
  token: string;
  role: InviteRole;
  createdBy: PublicUser | null;
  createdAt: number;
  /** null이면 만료 없음 */
  expiresAt: number | null;
  /** null이면 횟수 제한 없음 */
  maxUses: number | null;
  uses: number;
  requireApproval: boolean;
  label: string;
}

export interface InviteOptions {
  role: InviteRole;
  /** 일 단위, null이면 만료 없음 */
  expiresInDays: number | null;
  maxUses: number | null;
  requireApproval: boolean;
  label?: string;
}

export interface InvitePreview {
  valid: boolean;
  /** valid=false일 때 이유 */
  reason?: string;
  template: { id: string; name: string; emoji: string; description: string; features: Feature[]; memberCount: number } | null;
  inviter: PublicUser | null;
  role: InviteRole;
  requireApproval: boolean;
  expiresAt: number | null;
}

export type JoinStatus = 'joined' | 'member' | 'pending' | 'approved' | 'denied';

export interface JoinRequest {
  id: string;
  templateId: string;
  user: PublicUser;
  role: InviteRole;
  status: 'pending' | 'approved' | 'denied';
  createdAt: number;
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
  | 'template.share'
  | 'invite.create'
  | 'invite.revoke'
  | 'member.request'
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

/** 비밀번호에서 키를 만드는 방식 (공개 정보) */
export interface NoteKdf {
  salt: string;
  iterations: number;
}

export interface SecretNoteMeta {
  id: string;
  title: string;
  hint: string;
  createdBy: PublicUser;
  createdAt: number;
  updatedAt: number;
  kdf: NoteKdf;
}

/**
 * 비밀 노트는 브라우저에서 암호화된다 (종단 간 암호화).
 * 서버는 암호문과 비밀번호 확인값의 해시만 알고, 내용을 복호화할 수 없다.
 */
export interface EncryptedNote extends SecretNoteMeta {
  /** SHA-256(확인값) — 비밀번호 확인용 */
  verifierHash: string;
  /** 암호화된 Y.Doc 전체 상태 (iv + 암호문, base64) */
  snapshot: string;
}

export interface UnlockResult {
  ticket: string;
  expiresAt: number;
}

/** 개인 공간 → 협업 공간 전환 시 서버로 올리는 내용 */
export interface ShareUpload {
  id: string;
  name: string;
  description: string;
  emoji: string;
  features: Feature[];
  createdAt: number;
  /** Y.Doc 전체 상태 (base64) */
  state: string;
  timeline: TimelineEvent[];
  notes: EncryptedNote[];
}

export interface ApiError {
  error: string;
  retryAfter?: number;
}
