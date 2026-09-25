import { DurableObject } from 'cloudflare:workers';
import type {
  AccountInfo,
  AuthProvider,
  Feature,
  InviteInfo,
  InviteOptions,
  InvitePreview,
  JoinRequest,
  JoinStatus,
  MemberInfo,
  PublicUser,
  OAuthProvider,
  Role,
  SignupInfo,
  TemplateSummary,
} from '../../shared/types';
import type { TemplateBroadcast } from '../../shared/protocol';
import { USER_AVATARS, USER_COLORS, isHexColor } from '../../shared/colors';
import type { Env } from './env';
import { type Result, clampText, fail, isId, newId, ok, safeEqual, sha256Hex } from './util';

/*
 * Directory — 계정 · 협업 템플릿 목록 · 멤버 · 초대 링크 · 참여 요청을 관리하는 단일 Durable Object.
 * (템플릿 내용과 실시간 협업은 템플릿마다 하나씩 있는 TemplateRoom이 담당)
 */

const FEATURE_ORDER: Feature[] = ['design', 'code', 'docs'];
const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };
const ROLE_LABEL: Record<Role, string> = { owner: '소유자', editor: '편집자', viewer: '뷰어' };
export const hasRole = (role: Role, min: Role) => ROLE_RANK[role] >= ROLE_RANK[min];

/** 로그인 유지 기간 (마지막으로 사용한 날부터) */
export const SESSION_TTL_MS = 30 * 86_400_000;
/** 이메일 인증 코드: 유효 시간 · 재발송 간격 · 틀릴 수 있는 횟수 */
const CODE_TTL_MS = 10 * 60_000;
const CODE_RESEND_MS = 30_000;
const CODE_MAX_ATTEMPTS = 5;
/** 외부 로그인 왕복 · 이름 입력까지 기다리는 시간 */
const FLOW_TTL_MS = { oauth: 10 * 60_000, signup: 30 * 60_000 } as const;

/** 인증을 마친 신원 (이메일 코드 또는 외부 계정) */
export interface VerifiedIdentity {
  provider: AuthProvider;
  subject: string;
  email: string | null;
  emailVerified: boolean;
  /** 외부 계정의 이름 (가입 화면에서 미리 채워 준다) */
  name: string;
}

/** 로그인 결과: 이미 계정이 있으면 세션, 처음이면 이름을 정할 가입 티켓 */
export type AuthOutcome = { status: 'signed_in'; user: PublicUser; session: string } | { status: 'needs_name'; ticket: string };

type OAuthFlow = { provider: OAuthProvider; verifier: string; nonce: string; next: string };

/** 6자리 숫자 코드 */
function sixDigits(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
}

type UserRow = {
  id: string;
  name: string;
  color: string;
  avatar: string;
};
type TemplateRow = {
  id: string;
  name: string;
  description: string;
  emoji: string;
  features: string;
  owner_id: string;
  created_at: number;
  updated_at: number;
};
type InviteRow = {
  id: string;
  token: string;
  template_id: string;
  created_by: string;
  role: 'editor' | 'viewer';
  expires_at: number | null;
  max_uses: number | null;
  uses: number;
  require_approval: number;
  revoked: number;
  label: string;
  created_at: number;
};
type RequestRow = {
  id: string;
  template_id: string;
  user_id: string;
  invite_id: string;
  role: 'editor' | 'viewer';
  status: 'pending' | 'approved' | 'denied';
  created_at: number;
};

const toUser = (r: UserRow): PublicUser => ({ id: r.id, name: r.name, color: r.color, avatar: r.avatar });

function sanitizeFeatures(value: unknown): Feature[] | null {
  const list = Array.isArray(value) ? value : [];
  const features = FEATURE_ORDER.filter((f) => list.includes(f));
  return features.length ? features : null;
}

function sanitizeProfile(input: Partial<PublicUser>, current?: PublicUser): Omit<PublicUser, 'id'> | null {
  const name = clampText(input.name, 24) || current?.name;
  if (!name) return null;
  const color = isHexColor(input.color) ? input.color : current?.color ?? USER_COLORS[0];
  const avatar = typeof input.avatar === 'string' && input.avatar.length > 0 && input.avatar.length <= 8 ? input.avatar : current?.avatar ?? USER_AVATARS[0];
  return { name, color, avatar };
}

export class Directory extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, avatar TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, emoji TEXT NOT NULL,
        features TEXT NOT NULL, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS members (template_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, joined_at INTEGER NOT NULL,
        PRIMARY KEY (template_id, user_id));
      CREATE INDEX IF NOT EXISTS members_by_user ON members(user_id);
      CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, token TEXT NOT NULL UNIQUE, template_id TEXT NOT NULL, created_by TEXT NOT NULL,
        role TEXT NOT NULL, expires_at INTEGER, max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0, require_approval INTEGER NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0, label TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS invites_by_template ON invites(template_id);
      CREATE TABLE IF NOT EXISTS join_requests (id TEXT PRIMARY KEY, template_id TEXT NOT NULL, user_id TEXT NOT NULL, invite_id TEXT NOT NULL,
        role TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, decided_at INTEGER, decided_by TEXT);
      CREATE INDEX IF NOT EXISTS requests_by_template ON join_requests(template_id, status);
      CREATE TABLE IF NOT EXISTS online (template_id TEXT PRIMARY KEY, user_ids TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS identities (provider TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL, email TEXT,
        created_at INTEGER NOT NULL, PRIMARY KEY (provider, subject));
      CREATE INDEX IF NOT EXISTS identities_by_user ON identities(user_id);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL, seen_at INTEGER NOT NULL, agent TEXT NOT NULL DEFAULT '');
      CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS email_codes (email TEXT PRIMARY KEY, hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, sent_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_flows (id TEXT PRIMARY KEY, kind TEXT NOT NULL, data TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS rate (key TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL, expires_at INTEGER NOT NULL,
        PRIMARY KEY (key, bucket));
    `);
    // 로그인 기능 이전에 만든 저장소에는 이메일 칸이 없다
    try {
      this.sql.exec('ALTER TABLE users ADD COLUMN email TEXT');
    } catch {
      /* 이미 있음 */
    }
    this.sql.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_by_email ON users(email)');
  }

  /* ───────────── 계정 ───────────── */

  /*
   * 로그인
   * ──────
   *  · 이메일: 6자리 코드를 메일로 보내고 확인하면 로그인 (비밀번호 없음)
   *  · 외부 계정(구글 · 깃허브): 같은 외부 계정 → 같은 (확인된) 이메일의 계정 순으로 찾는다
   *  · 처음이면 가입 티켓을 주고, 이름을 정하면 계정을 만든다
   *  · 세션 토큰은 해시만 저장한다
   */

  /** 고정 구간 요청 제한. 넘으면 다시 시도할 수 있을 때까지 남은 초 */
  private limit(key: string, max: number, windowMs: number): number | null {
    const now = Date.now();
    const bucket = Math.floor(now / windowMs);
    const row = this.sql.exec<{ count: number }>('SELECT count FROM rate WHERE key = ? AND bucket = ?', key, bucket).toArray()[0];
    if (row && row.count >= max) return Math.ceil(((bucket + 1) * windowMs - now) / 1000);
    this.sql.exec(
      'INSERT INTO rate (key, bucket, count, expires_at) VALUES (?, ?, 1, ?) ON CONFLICT(key, bucket) DO UPDATE SET count = count + 1',
      key,
      bucket,
      (bucket + 1) * windowMs,
    );
    return null;
  }

  /** 만료된 로그인 기록 정리 (가끔만) */
  private sweep(): void {
    if (Math.random() > 0.05) return;
    const now = Date.now();
    for (const table of ['sessions', 'auth_flows', 'email_codes', 'rate']) this.sql.exec(`DELETE FROM ${table} WHERE expires_at < ?`, now);
  }

  private putFlow(id: string, kind: keyof typeof FLOW_TTL_MS, data: unknown): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO auth_flows (id, kind, data, expires_at) VALUES (?, ?, ?, ?)',
      id,
      kind,
      JSON.stringify(data),
      Date.now() + FLOW_TTL_MS[kind],
    );
  }

  private readFlow<T>(id: string, kind: keyof typeof FLOW_TTL_MS): T | null {
    const row = this.sql
      .exec<{ data: string }>('SELECT data FROM auth_flows WHERE id = ? AND kind = ? AND expires_at > ?', id, kind, Date.now())
      .toArray()[0];
    return row ? (JSON.parse(row.data) as T) : null;
  }

  private async createSession(userId: string, agent: string): Promise<string> {
    const token = newId(40);
    const now = Date.now();
    this.sql.exec(
      'INSERT INTO sessions (hash, user_id, created_at, expires_at, seen_at, agent) VALUES (?, ?, ?, ?, ?, ?)',
      await sha256Hex(token),
      userId,
      now,
      now + SESSION_TTL_MS,
      now,
      agent.slice(0, 200),
    );
    this.sql.exec('UPDATE users SET last_seen_at = ? WHERE id = ?', now, userId);
    this.sweep();
    return token;
  }

  private linkIdentity(userId: string, id: VerifiedIdentity): void {
    if (id.provider === 'email') return;
    this.sql.exec(
      'INSERT OR IGNORE INTO identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)',
      id.provider,
      id.subject,
      userId,
      id.email,
      Date.now(),
    );
  }

  /** 이미 있는 계정: 같은 외부 계정 → 같은 (확인된) 이메일. 이메일로 찾았으면 외부 계정을 연결해 둔다 */
  private findAccount(id: VerifiedIdentity): PublicUser | null {
    if (id.provider !== 'email') {
      const row = this.sql
        .exec<{ user_id: string }>('SELECT user_id FROM identities WHERE provider = ? AND subject = ?', id.provider, id.subject)
        .toArray()[0];
      const linked = row ? this.user(row.user_id) : null;
      if (linked) return linked;
    }
    if (!id.email || !id.emailVerified) return null;
    const row = this.sql.exec<UserRow>('SELECT id, name, color, avatar FROM users WHERE email = ?', id.email).toArray()[0];
    if (!row) return null;
    this.linkIdentity(row.id, id);
    return toUser(row);
  }

  private async signIn(id: VerifiedIdentity, agent: string): Promise<AuthOutcome> {
    const user = this.findAccount(id);
    if (user) return { status: 'signed_in', user, session: await this.createSession(user.id, agent) };
    const ticket = newId(40);
    this.putFlow(await sha256Hex(ticket), 'signup', id);
    return { status: 'needs_name', ticket };
  }

  /** 이메일 인증 코드 발급 (메일 발송은 Worker가 한다) */
  async startEmailCode(email: string, ip: string): Promise<Result<{ code: string; expiresAt: number }>> {
    const now = Date.now();
    const prev = this.sql.exec<{ sent_at: number }>('SELECT sent_at FROM email_codes WHERE email = ?', email).toArray()[0];
    if (prev && now - prev.sent_at < CODE_RESEND_MS) {
      const retryAfter = Math.ceil((CODE_RESEND_MS - (now - prev.sent_at)) / 1000);
      return fail(429, `${retryAfter}초 후에 다시 받을 수 있습니다.`, { retryAfter });
    }
    const wait = this.limit(`ip:${ip}`, 20, 3_600_000) ?? this.limit(`mail:${email}`, 8, 3_600_000);
    if (wait) return fail(429, '인증 코드를 너무 많이 요청했습니다. 잠시 후 다시 시도해 주세요.', { retryAfter: wait });
    const code = sixDigits();
    this.sql.exec(
      'INSERT OR REPLACE INTO email_codes (email, hash, expires_at, attempts, sent_at) VALUES (?, ?, ?, 0, ?)',
      email,
      await sha256Hex(`${email}:${code}`),
      now + CODE_TTL_MS,
      now,
    );
    this.sweep();
    return ok({ code, expiresAt: now + CODE_TTL_MS });
  }

  /** 메일을 보내지 못했으면 코드를 지워 바로 다시 요청할 수 있게 한다 */
  async dropEmailCode(email: string): Promise<void> {
    this.sql.exec('DELETE FROM email_codes WHERE email = ?', email);
  }

  async verifyEmailCode(email: string, code: string, agent: string): Promise<Result<AuthOutcome>> {
    const row = this.sql
      .exec<{ hash: string; expires_at: number; attempts: number }>('SELECT hash, expires_at, attempts FROM email_codes WHERE email = ?', email)
      .toArray()[0];
    if (!row || row.expires_at < Date.now()) return fail(400, '인증 코드가 만료되었습니다. 코드를 다시 받아 주세요.', { reason: 'expired' });
    if (!safeEqual(row.hash, await sha256Hex(`${email}:${code}`))) {
      const attempts = row.attempts + 1;
      if (attempts >= CODE_MAX_ATTEMPTS) {
        this.sql.exec('DELETE FROM email_codes WHERE email = ?', email);
        return fail(400, '인증 코드를 여러 번 잘못 입력했습니다. 코드를 다시 받아 주세요.', { reason: 'expired' });
      }
      this.sql.exec('UPDATE email_codes SET attempts = ? WHERE email = ?', attempts, email);
      const remaining = CODE_MAX_ATTEMPTS - attempts;
      return fail(400, `인증 코드가 올바르지 않습니다. (남은 시도 ${remaining}회)`, { reason: 'mismatch', remaining });
    }
    this.sql.exec('DELETE FROM email_codes WHERE email = ?', email);
    return ok(await this.signIn({ provider: 'email', subject: email, email, emailVerified: true, name: '' }, agent));
  }

  /** 외부 로그인 시작: 요청 위조를 막는 state · PKCE 검증값 · nonce를 만들어 둔다 */
  async startOAuth(provider: OAuthProvider, next: string): Promise<{ state: string; verifier: string; nonce: string }> {
    const flow = { state: newId(32), verifier: newId(64), nonce: newId(24) };
    this.putFlow(await sha256Hex(flow.state), 'oauth', { provider, verifier: flow.verifier, nonce: flow.nonce, next } satisfies OAuthFlow);
    this.sweep();
    return flow;
  }

  /** 외부 로그인에서 돌아왔을 때: 한 번만 쓸 수 있다 */
  async consumeOAuth(state: string, provider: OAuthProvider): Promise<Result<OAuthFlow>> {
    const id = await sha256Hex(state);
    const flow = this.readFlow<OAuthFlow>(id, 'oauth');
    this.sql.exec('DELETE FROM auth_flows WHERE id = ?', id);
    if (!flow || flow.provider !== provider) return fail(400, '로그인 요청이 만료되었습니다. 다시 시도해 주세요.');
    return ok(flow);
  }

  async oauthSignIn(id: VerifiedIdentity, agent: string): Promise<AuthOutcome> {
    return this.signIn(id, agent);
  }

  /** 이름 입력 화면에 보여 줄 가입 정보 */
  async signupInfo(ticket: string | null): Promise<SignupInfo | null> {
    if (!ticket || ticket.length > 100) return null;
    const id = this.readFlow<VerifiedIdentity>(await sha256Hex(ticket), 'signup');
    return id ? { email: id.email, provider: id.provider, suggestedName: id.name } : null;
  }

  /** 이름(과 커서 색상 · 아바타)을 정하면 계정을 만들고 로그인한다 */
  async completeSignup(ticket: string | null, input: Partial<PublicUser>, agent: string): Promise<Result<{ user: PublicUser; session: string }>> {
    const hash = ticket && ticket.length <= 100 ? await sha256Hex(ticket) : null;
    const id = hash ? this.readFlow<VerifiedIdentity>(hash, 'signup') : null;
    if (!hash || !id) return fail(401, '가입 절차가 만료되었습니다. 처음부터 다시 로그인해 주세요.', { reason: 'expired' });
    const profile = sanitizeProfile(input);
    if (!profile) return fail(400, '이름을 입력해 주세요.');
    this.sql.exec('DELETE FROM auth_flows WHERE id = ?', hash);
    // 그사이 같은 계정으로 가입을 마쳤다면(다른 탭 등) 그 계정으로 로그인
    const existing = this.findAccount(id);
    if (existing) return ok({ user: existing, session: await this.createSession(existing.id, agent) });
    const user: PublicUser = { id: newId(), ...profile };
    const now = Date.now();
    this.sql.exec(
      'INSERT INTO users (id, name, color, avatar, token_hash, email, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      user.id,
      user.name,
      user.color,
      user.avatar,
      // 로그인 이전 방식의 토큰 칸 (고유 값만 채운다 — 이 값으로는 로그인할 수 없다)
      `account:${user.id}`,
      id.emailVerified ? id.email : null,
      now,
      now,
    );
    this.linkIdentity(user.id, id);
    return ok({ user, session: await this.createSession(user.id, agent) });
  }

  async authenticate(token: string | null): Promise<PublicUser | null> {
    if (!token || token.length < 20 || token.length > 100) return null;
    const hash = await sha256Hex(token);
    const row = this.sql
      .exec<UserRow & { expires_at: number; seen_at: number }>(
        'SELECT u.id, u.name, u.color, u.avatar, s.expires_at, s.seen_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ?',
        hash,
      )
      .toArray()[0];
    if (!row) return null;
    const now = Date.now();
    if (row.expires_at < now) {
      this.sql.exec('DELETE FROM sessions WHERE hash = ?', hash);
      return null;
    }
    // 쓰는 동안은 로그인을 계속 유지 (쓰기 횟수를 아끼려고 하루에 한 번만 연장)
    if (now - row.seen_at > 86_400_000) {
      this.sql.exec('UPDATE sessions SET seen_at = ?, expires_at = ? WHERE hash = ?', now, now + SESSION_TTL_MS, hash);
      this.sql.exec('UPDATE users SET last_seen_at = ? WHERE id = ?', now, row.id);
    }
    return toUser(row);
  }

  async logout(token: string | null): Promise<void> {
    if (token && token.length <= 100) this.sql.exec('DELETE FROM sessions WHERE hash = ?', await sha256Hex(token));
  }

  async account(userId: string): Promise<AccountInfo> {
    const email = this.sql.exec<{ email: string | null }>('SELECT email FROM users WHERE id = ?', userId).toArray()[0]?.email ?? null;
    const providers = this.sql
      .exec<{ provider: OAuthProvider }>('SELECT provider FROM identities WHERE user_id = ? ORDER BY created_at', userId)
      .toArray()
      .map((r) => r.provider);
    return { email, providers };
  }

  /**
   * 로그인 기능 이전(가입 없이 쓰던 때)의 브라우저 계정을 로그인한 계정으로 합친다.
   * 협업 템플릿 멤버십 · 소유권 · 초대 링크 · 참여 요청을 옮기고 예전 계정은 지운다.
   * (예전 토큰은 해시로만 저장되어 있어 새 계정의 값과는 절대 겹치지 않는다)
   */
  async claimLegacy(token: unknown, intoUserId: string): Promise<{ merged: boolean; broadcasts: TemplateBroadcast[] }> {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return { merged: false, broadcasts: [] };
    const legacy = this.sql.exec<{ id: string }>('SELECT id FROM users WHERE token_hash = ?', await sha256Hex(token)).toArray()[0];
    if (!legacy || legacy.id === intoUserId) return { merged: false, broadcasts: [] };
    const from = legacy.id;
    const templateIds = this.templateIdsOf(from);
    for (const templateId of templateIds) {
      const mine = this.roleOf(templateId, intoUserId);
      const theirs = this.roleOf(templateId, from)!;
      if (!mine) {
        this.sql.exec('UPDATE members SET user_id = ? WHERE template_id = ? AND user_id = ?', intoUserId, templateId, from);
        continue;
      }
      if (ROLE_RANK[theirs] > ROLE_RANK[mine]) this.sql.exec('UPDATE members SET role = ? WHERE template_id = ? AND user_id = ?', theirs, templateId, intoUserId);
      this.sql.exec('DELETE FROM members WHERE template_id = ? AND user_id = ?', templateId, from);
    }
    this.sql.exec('UPDATE templates SET owner_id = ? WHERE owner_id = ?', intoUserId, from);
    this.sql.exec('UPDATE invites SET created_by = ? WHERE created_by = ?', intoUserId, from);
    this.sql.exec('UPDATE join_requests SET user_id = ? WHERE user_id = ?', intoUserId, from);
    this.sql.exec('DELETE FROM users WHERE id = ?', from);
    const broadcasts = templateIds.flatMap((id) => {
      const t = this.template(id);
      return t ? [this.broadcastSummary(t)] : [];
    });
    return { merged: true, broadcasts };
  }

  async updateUser(userId: string, patch: Partial<PublicUser>): Promise<Result<{ user: PublicUser; templateIds: string[] }>> {
    const current = this.user(userId);
    if (!current) return fail(404, '사용자를 찾을 수 없습니다.');
    const profile = sanitizeProfile(patch, current);
    if (!profile) return fail(400, '이름을 입력해 주세요.');
    this.sql.exec('UPDATE users SET name = ?, color = ?, avatar = ? WHERE id = ?', profile.name, profile.color, profile.avatar, userId);
    return ok({ user: { id: userId, ...profile }, templateIds: this.templateIdsOf(userId) });
  }

  private user(id: string): PublicUser | null {
    const row = this.sql.exec<UserRow>('SELECT id, name, color, avatar FROM users WHERE id = ?', id).toArray()[0];
    return row ? toUser(row) : null;
  }

  private templateIdsOf(userId: string): string[] {
    return this.sql.exec<{ template_id: string }>('SELECT template_id FROM members WHERE user_id = ?', userId).toArray().map((r) => r.template_id);
  }

  /* ───────────── 템플릿 ───────────── */

  private template(id: string): TemplateRow | null {
    return this.sql.exec<TemplateRow>('SELECT * FROM templates WHERE id = ?', id).toArray()[0] ?? null;
  }

  private roleOf(templateId: string, userId: string): Role | null {
    return this.sql.exec<{ role: Role }>('SELECT role FROM members WHERE template_id = ? AND user_id = ?', templateId, userId).toArray()[0]?.role ?? null;
  }

  private members(templateId: string): MemberInfo[] {
    return this.sql
      .exec<UserRow & { role: Role; joined_at: number }>(
        `SELECT u.id, u.name, u.color, u.avatar, m.role, m.joined_at FROM members m JOIN users u ON u.id = m.user_id
         WHERE m.template_id = ? ORDER BY m.joined_at`,
        templateId,
      )
      .toArray()
      .map((r) => ({ user: toUser(r), role: r.role, joinedAt: r.joined_at }));
  }

  private broadcastSummary(t: TemplateRow): TemplateBroadcast {
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      emoji: t.emoji,
      features: JSON.parse(t.features) as Feature[],
      ownerId: t.owner_id,
      members: this.members(t.id),
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    };
  }

  private summary(t: TemplateRow, forUserId: string): TemplateSummary {
    return { ...this.broadcastSummary(t), myRole: this.roleOf(t.id, forUserId) ?? 'viewer' };
  }

  /** 멤버 권한 확인 */
  private check(templateId: string, userId: string, min: Role): Result<{ t: TemplateRow; role: Role }> {
    const t = this.template(templateId);
    if (!t) return fail(404, '템플릿을 찾을 수 없습니다.');
    const role = this.roleOf(templateId, userId);
    if (!role) return fail(403, '이 템플릿의 멤버가 아닙니다.');
    if (!hasRole(role, min)) return fail(403, '권한이 부족합니다.');
    return ok({ t, role });
  }

  async access(templateId: string, userId: string, min: Role = 'viewer'): Promise<Result<{ template: TemplateSummary; role: Role; broadcast: TemplateBroadcast }>> {
    const r = this.check(templateId, userId, min);
    if (!r.ok) return r;
    return ok({ template: this.summary(r.data.t, userId), role: r.data.role, broadcast: this.broadcastSummary(r.data.t) });
  }

  async listTemplates(userId: string): Promise<{ templates: TemplateSummary[]; online: Record<string, string[]>; requests: Record<string, number> }> {
    const rows = this.sql
      .exec<TemplateRow>(
        'SELECT t.* FROM templates t JOIN members m ON m.template_id = t.id WHERE m.user_id = ? ORDER BY t.updated_at DESC',
        userId,
      )
      .toArray();
    const online: Record<string, string[]> = {};
    const requests: Record<string, number> = {};
    const templates = rows.map((r) => this.summary(r, userId));
    for (const t of templates) {
      const o = this.sql.exec<{ user_ids: string }>('SELECT user_ids FROM online WHERE template_id = ?', t.id).toArray()[0];
      online[t.id] = o ? (JSON.parse(o.user_ids) as string[]) : [];
      if (t.myRole !== 'viewer') {
        const c = this.sql.exec<{ c: number }>("SELECT count(*) AS c FROM join_requests WHERE template_id = ? AND status = 'pending'", t.id).one().c;
        if (c) requests[t.id] = c;
      }
    }
    return { templates, online, requests };
  }

  /** 개인 공간의 템플릿을 협업 공간으로 등록 (ID는 브라우저에서 만든 것을 그대로 사용) */
  async createTemplate(
    userId: string,
    input: { id?: unknown; name?: unknown; description?: unknown; emoji?: unknown; features?: unknown; createdAt?: unknown },
  ): Promise<Result<TemplateSummary>> {
    if (!isId(input.id, 8, 40)) return fail(400, '잘못된 템플릿 ID입니다.');
    const existing = this.template(input.id);
    if (existing) {
      // 같은 사람이 다시 올리는 경우(재시도)는 허용
      return existing.owner_id === userId ? ok(this.summary(existing, userId)) : fail(409, '이미 사용 중인 템플릿 ID입니다.');
    }
    const name = clampText(input.name, 60);
    if (!name) return fail(400, '템플릿 이름을 입력해 주세요.');
    const features = sanitizeFeatures(input.features);
    if (!features) return fail(400, '기능을 하나 이상 선택해 주세요.');
    const now = Date.now();
    const createdAt = typeof input.createdAt === 'number' && input.createdAt > 0 && input.createdAt <= now ? input.createdAt : now;
    const emoji = typeof input.emoji === 'string' && input.emoji && input.emoji.length <= 8 ? input.emoji : '🗂️';
    this.sql.exec(
      'INSERT INTO templates (id, name, description, emoji, features, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      input.id,
      name,
      clampText(input.description, 200),
      emoji,
      JSON.stringify(features),
      userId,
      createdAt,
      now,
    );
    this.sql.exec('INSERT INTO members (template_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', input.id, userId, 'owner', now);
    return ok(this.summary(this.template(input.id)!, userId));
  }

  async updateTemplate(
    templateId: string,
    userId: string,
    patch: { name?: unknown; description?: unknown; emoji?: unknown; features?: unknown },
  ): Promise<Result<{ template: TemplateSummary; broadcast: TemplateBroadcast; changes: string[] }>> {
    const r = this.check(templateId, userId, 'editor');
    if (!r.ok) return r;
    const t = r.data.t;
    const changes: string[] = [];
    if (patch.name !== undefined) {
      const name = clampText(patch.name, 60);
      if (!name) return fail(400, '템플릿 이름을 입력해 주세요.');
      if (name !== t.name) {
        t.name = name;
        changes.push(`이름 → ${name}`);
      }
    }
    if (patch.description !== undefined) {
      const d = clampText(patch.description, 200);
      if (d !== t.description) {
        t.description = d;
        changes.push('설명 수정');
      }
    }
    if (typeof patch.emoji === 'string' && patch.emoji && patch.emoji.length <= 8 && patch.emoji !== t.emoji) {
      t.emoji = patch.emoji;
      changes.push(`아이콘 → ${patch.emoji}`);
    }
    if (patch.features !== undefined) {
      const f = sanitizeFeatures(patch.features);
      if (!f) return fail(400, '기능은 하나 이상 필요합니다.');
      if (JSON.stringify(f) !== t.features) {
        t.features = JSON.stringify(f);
        const names = { design: '디자인', code: '코딩', docs: '문서' } as const;
        changes.push(`기능 → ${f.map((x) => names[x]).join(', ')}`);
      }
    }
    if (changes.length) {
      t.updated_at = Date.now();
      this.sql.exec(
        'UPDATE templates SET name = ?, description = ?, emoji = ?, features = ?, updated_at = ? WHERE id = ?',
        t.name,
        t.description,
        t.emoji,
        t.features,
        t.updated_at,
        t.id,
      );
    }
    return ok({ template: this.summary(t, userId), broadcast: this.broadcastSummary(t), changes });
  }

  /** 실시간 방에서 편집이 있을 때 마지막 수정 시각 갱신 (방에서 몇 분에 한 번만 호출) */
  async touch(templateId: string): Promise<void> {
    this.sql.exec('UPDATE templates SET updated_at = ? WHERE id = ?', Date.now(), templateId);
  }

  async deleteTemplate(templateId: string, userId: string): Promise<Result<{ name: string }>> {
    const r = this.check(templateId, userId, 'owner');
    if (!r.ok) return r;
    for (const table of ['members', 'invites', 'join_requests', 'online']) this.sql.exec(`DELETE FROM ${table} WHERE template_id = ?`, templateId);
    this.sql.exec('DELETE FROM templates WHERE id = ?', templateId);
    return ok({ name: r.data.t.name });
  }

  async setOnline(templateId: string, userIds: string[]): Promise<void> {
    if (!this.template(templateId)) return;
    this.sql.exec(
      'INSERT INTO online (template_id, user_ids) VALUES (?, ?) ON CONFLICT(template_id) DO UPDATE SET user_ids = excluded.user_ids',
      templateId,
      JSON.stringify(userIds.slice(0, 100)),
    );
  }

  /* ───────────── 멤버 ───────────── */

  async setRole(
    templateId: string,
    actorId: string,
    targetId: string,
    role: unknown,
  ): Promise<Result<{ broadcast: TemplateBroadcast; target: PublicUser; role: Role; label: string }>> {
    if (role !== 'editor' && role !== 'viewer') return fail(400, '올바른 권한이 아닙니다.');
    const r = this.check(templateId, actorId, 'owner');
    if (!r.ok) return r;
    const current = this.roleOf(templateId, targetId);
    const target = this.user(targetId);
    if (!current || !target) return fail(404, '멤버를 찾을 수 없습니다.');
    if (current === 'owner') return fail(400, '소유자 권한은 변경할 수 없습니다.');
    this.sql.exec('UPDATE members SET role = ? WHERE template_id = ? AND user_id = ?', role, templateId, targetId);
    return ok({ broadcast: this.broadcastSummary(r.data.t), target, role, label: ROLE_LABEL[role] });
  }

  async removeMember(
    templateId: string,
    actorId: string,
    targetId: string,
  ): Promise<Result<{ broadcast: TemplateBroadcast; target: PublicUser; self: boolean }>> {
    const self = actorId === targetId;
    const r = this.check(templateId, actorId, self ? 'viewer' : 'owner');
    if (!r.ok) return r;
    const target = this.user(targetId);
    const role = this.roleOf(templateId, targetId);
    if (!target || !role) return fail(404, '멤버를 찾을 수 없습니다.');
    if (role === 'owner') return fail(400, '소유자는 템플릿을 떠날 수 없습니다.');
    this.sql.exec('DELETE FROM members WHERE template_id = ? AND user_id = ?', templateId, targetId);
    return ok({ broadcast: this.broadcastSummary(r.data.t), target, self });
  }

  /* ───────────── 초대 링크 ───────────── */

  private inviteInfo(row: InviteRow): InviteInfo {
    return {
      id: row.id,
      token: row.token,
      role: row.role,
      createdBy: this.user(row.created_by),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      maxUses: row.max_uses,
      uses: row.uses,
      requireApproval: row.require_approval === 1,
      label: row.label,
    };
  }

  private inviteProblem(row: InviteRow | undefined): string | null {
    if (!row || row.revoked) return '취소되었거나 존재하지 않는 초대 링크입니다.';
    if (row.expires_at !== null && row.expires_at < Date.now()) return '기간이 만료된 초대 링크입니다.';
    if (row.max_uses !== null && row.uses >= row.max_uses) return '사용 가능 횟수를 모두 사용한 초대 링크입니다.';
    return null;
  }

  async createInvite(templateId: string, actorId: string, opts: Partial<InviteOptions>): Promise<Result<InviteInfo>> {
    const r = this.check(templateId, actorId, 'editor');
    if (!r.ok) return r;
    const role = opts.role === 'viewer' ? 'viewer' : 'editor';
    const days = typeof opts.expiresInDays === 'number' && opts.expiresInDays > 0 ? Math.min(opts.expiresInDays, 365) : null;
    const maxUses = typeof opts.maxUses === 'number' && opts.maxUses > 0 ? Math.min(Math.floor(opts.maxUses), 1000) : null;
    const active = this.sql.exec<{ c: number }>('SELECT count(*) AS c FROM invites WHERE template_id = ? AND revoked = 0', templateId).one().c;
    if (active >= 50) return fail(400, '활성 초대 링크가 너무 많습니다. 사용하지 않는 링크를 취소해 주세요.');
    const now = Date.now();
    const row: InviteRow = {
      id: newId(),
      token: newId(24),
      template_id: templateId,
      created_by: actorId,
      role,
      expires_at: days ? now + days * 86_400_000 : null,
      max_uses: maxUses,
      uses: 0,
      require_approval: opts.requireApproval ? 1 : 0,
      revoked: 0,
      label: clampText(opts.label, 40),
      created_at: now,
    };
    this.sql.exec(
      `INSERT INTO invites (id, token, template_id, created_by, role, expires_at, max_uses, uses, require_approval, revoked, label, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?)`,
      row.id,
      row.token,
      row.template_id,
      row.created_by,
      row.role,
      row.expires_at,
      row.max_uses,
      row.require_approval,
      row.label,
      row.created_at,
    );
    return ok(this.inviteInfo(row));
  }

  async listInvites(templateId: string, actorId: string): Promise<Result<InviteInfo[]>> {
    const r = this.check(templateId, actorId, 'editor');
    if (!r.ok) return r;
    const rows = this.sql.exec<InviteRow>('SELECT * FROM invites WHERE template_id = ? AND revoked = 0 ORDER BY created_at DESC', templateId).toArray();
    // 만료·소진된 링크는 목록에서 정리
    const alive = rows.filter((row) => !this.inviteProblem(row));
    return ok(alive.map((row) => this.inviteInfo(row)));
  }

  async revokeInvite(templateId: string, actorId: string, inviteId: string): Promise<Result<InviteInfo>> {
    const r = this.check(templateId, actorId, 'editor');
    if (!r.ok) return r;
    const row = this.sql.exec<InviteRow>('SELECT * FROM invites WHERE id = ? AND template_id = ?', inviteId, templateId).toArray()[0];
    if (!row) return fail(404, '초대 링크를 찾을 수 없습니다.');
    this.sql.exec('UPDATE invites SET revoked = 1 WHERE id = ?', inviteId);
    return ok(this.inviteInfo(row));
  }

  private inviteByToken(token: string): InviteRow | undefined {
    if (!isId(token, 16, 64)) return undefined;
    return this.sql.exec<InviteRow>('SELECT * FROM invites WHERE token = ?', token).toArray()[0];
  }

  async previewInvite(token: string, userId: string | null): Promise<InvitePreview & { alreadyMember: boolean }> {
    const row = this.inviteByToken(token);
    const problem = this.inviteProblem(row);
    const t = row ? this.template(row.template_id) : null;
    const alreadyMember = !!(t && userId && this.roleOf(t.id, userId));
    return {
      valid: !problem && !!t,
      reason: problem ?? (t ? undefined : '템플릿이 삭제되었습니다.'),
      template: t
        ? {
            id: t.id,
            name: t.name,
            emoji: t.emoji,
            description: t.description,
            features: JSON.parse(t.features) as Feature[],
            memberCount: this.sql.exec<{ c: number }>('SELECT count(*) AS c FROM members WHERE template_id = ?', t.id).one().c,
          }
        : null,
      inviter: row ? this.user(row.created_by) : null,
      role: row?.role ?? 'editor',
      requireApproval: row?.require_approval === 1,
      expiresAt: row?.expires_at ?? null,
      alreadyMember,
    };
  }

  private requestInfo(row: RequestRow): JoinRequest | null {
    const user = this.user(row.user_id);
    return user ? { id: row.id, templateId: row.template_id, user, role: row.role, status: row.status, createdAt: row.created_at } : null;
  }

  async acceptInvite(
    token: string,
    userId: string,
  ): Promise<
    Result<{ status: JoinStatus; templateId: string; template?: TemplateSummary; broadcast?: TemplateBroadcast; request?: JoinRequest; created?: boolean; user: PublicUser }>
  > {
    const row = this.inviteByToken(token);
    const user = this.user(userId);
    if (!user) return fail(401, '로그인이 필요합니다.');
    if (!row) return fail(404, '취소되었거나 존재하지 않는 초대 링크입니다.');
    const t = this.template(row.template_id);
    if (!t) return fail(404, '템플릿이 삭제되었습니다.');
    if (this.roleOf(t.id, userId)) return ok({ status: 'member', templateId: t.id, template: this.summary(t, userId), user });
    const pending = this.sql
      .exec<RequestRow>("SELECT * FROM join_requests WHERE template_id = ? AND user_id = ? AND status = 'pending'", t.id, userId)
      .toArray()[0];
    if (pending) return ok({ status: 'pending', templateId: t.id, request: this.requestInfo(pending) ?? undefined, user });
    const problem = this.inviteProblem(row);
    if (problem) return fail(410, problem);

    this.sql.exec('UPDATE invites SET uses = uses + 1 WHERE id = ?', row.id);
    const now = Date.now();
    if (row.require_approval) {
      const req: RequestRow = { id: newId(), template_id: t.id, user_id: userId, invite_id: row.id, role: row.role, status: 'pending', created_at: now };
      this.sql.exec(
        'INSERT INTO join_requests (id, template_id, user_id, invite_id, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        req.id,
        req.template_id,
        req.user_id,
        req.invite_id,
        req.role,
        req.status,
        req.created_at,
      );
      return ok({ status: 'pending', templateId: t.id, request: this.requestInfo(req) ?? undefined, created: true, user });
    }
    this.sql.exec('INSERT INTO members (template_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', t.id, userId, row.role, now);
    return ok({ status: 'joined', templateId: t.id, template: this.summary(t, userId), broadcast: this.broadcastSummary(t), user });
  }

  /** 승인 대기 중인 사람이 결과를 확인 */
  async joinStatus(templateId: string, userId: string): Promise<Result<{ status: JoinStatus; template?: TemplateSummary }>> {
    const t = this.template(templateId);
    if (!t) return fail(404, '템플릿이 삭제되었습니다.');
    if (this.roleOf(templateId, userId)) return ok({ status: 'approved', template: this.summary(t, userId) });
    const last = this.sql
      .exec<RequestRow>('SELECT * FROM join_requests WHERE template_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 1', templateId, userId)
      .toArray()[0];
    if (!last) return fail(404, '참여 요청이 없습니다.');
    return ok({ status: last.status === 'approved' ? 'approved' : last.status });
  }

  /* ───────────── 참여 요청 ───────────── */

  async listRequests(templateId: string, actorId: string): Promise<Result<JoinRequest[]>> {
    const r = this.check(templateId, actorId, 'editor');
    if (!r.ok) return r;
    return ok(this.pendingRequests(templateId));
  }

  async pendingRequestsFor(templateId: string): Promise<JoinRequest[]> {
    return this.pendingRequests(templateId);
  }

  private pendingRequests(templateId: string): JoinRequest[] {
    return this.sql
      .exec<RequestRow>("SELECT * FROM join_requests WHERE template_id = ? AND status = 'pending' ORDER BY created_at", templateId)
      .toArray()
      .map((row) => this.requestInfo(row))
      .filter((x): x is JoinRequest => x !== null);
  }

  async decideRequest(
    templateId: string,
    actorId: string,
    requestId: string,
    approve: boolean,
  ): Promise<Result<{ request: JoinRequest; broadcast: TemplateBroadcast; pending: JoinRequest[] }>> {
    const r = this.check(templateId, actorId, 'editor');
    if (!r.ok) return r;
    const row = this.sql.exec<RequestRow>('SELECT * FROM join_requests WHERE id = ? AND template_id = ?', requestId, templateId).toArray()[0];
    if (!row) return fail(404, '참여 요청을 찾을 수 없습니다.');
    if (row.status !== 'pending') return fail(409, '이미 처리된 요청입니다.');
    const status = approve ? 'approved' : 'denied';
    this.sql.exec('UPDATE join_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?', status, Date.now(), actorId, requestId);
    if (approve && !this.roleOf(templateId, row.user_id)) {
      this.sql.exec('INSERT INTO members (template_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)', templateId, row.user_id, row.role, Date.now());
    }
    const request = this.requestInfo({ ...row, status })!;
    return ok({ request, broadcast: this.broadcastSummary(r.data.t), pending: this.pendingRequests(templateId) });
  }
}
