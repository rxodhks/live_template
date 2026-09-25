import { DurableObject } from 'cloudflare:workers';
import type {
  Feature,
  InviteInfo,
  InviteOptions,
  InvitePreview,
  JoinRequest,
  JoinStatus,
  MemberInfo,
  PublicUser,
  Role,
  TemplateSummary,
} from '../../shared/types';
import type { TemplateBroadcast } from '../../shared/protocol';
import { USER_AVATARS, USER_COLORS, isHexColor } from '../../shared/colors';
import type { Env } from './env';
import { type Result, clampText, fail, isId, newId, ok, sha256Hex } from './util';

/*
 * Directory — 계정 · 협업 템플릿 목록 · 멤버 · 초대 링크 · 참여 요청을 관리하는 단일 Durable Object.
 * (템플릿 내용과 실시간 협업은 템플릿마다 하나씩 있는 TemplateRoom이 담당)
 */

const FEATURE_ORDER: Feature[] = ['design', 'code', 'docs'];
const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };
const ROLE_LABEL: Record<Role, string> = { owner: '소유자', editor: '편집자', viewer: '뷰어' };
export const hasRole = (role: Role, min: Role) => ROLE_RANK[role] >= ROLE_RANK[min];

/** IP당 시간당 계정 생성 수 (무료 사용량 보호) */
const SIGNUPS_PER_HOUR = 30;

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
      CREATE TABLE IF NOT EXISTS signups (ip TEXT NOT NULL, hour INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (ip, hour));
    `);
  }

  /* ───────────── 계정 ───────────── */

  async createUser(input: Partial<PublicUser>, ip: string): Promise<Result<{ user: PublicUser; token: string }>> {
    const profile = sanitizeProfile(input);
    if (!profile) return fail(400, '이름을 입력해 주세요.');
    const hour = Math.floor(Date.now() / 3_600_000);
    const row = this.sql.exec<{ count: number }>('SELECT count FROM signups WHERE ip = ? AND hour = ?', ip, hour).toArray()[0];
    if (row && row.count >= SIGNUPS_PER_HOUR) return fail(429, '잠시 후 다시 시도해 주세요.');
    this.sql.exec(
      'INSERT INTO signups (ip, hour, count) VALUES (?, ?, 1) ON CONFLICT(ip, hour) DO UPDATE SET count = count + 1',
      ip,
      hour,
    );
    this.sql.exec('DELETE FROM signups WHERE hour < ?', hour - 24);

    const token = newId(40);
    const user: PublicUser = { id: newId(), ...profile };
    const now = Date.now();
    this.sql.exec(
      'INSERT INTO users (id, name, color, avatar, token_hash, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      user.id,
      user.name,
      user.color,
      user.avatar,
      await sha256Hex(token),
      now,
      now,
    );
    return ok({ user, token });
  }

  async authenticate(token: string | null): Promise<PublicUser | null> {
    if (!token || token.length < 20 || token.length > 100) return null;
    const hash = await sha256Hex(token);
    const row = this.sql.exec<UserRow & { last_seen_at: number }>('SELECT * FROM users WHERE token_hash = ?', hash).toArray()[0];
    if (!row) return null;
    // 하루에 한 번만 접속 시각 갱신 (쓰기 횟수 절약)
    if (Date.now() - row.last_seen_at > 86_400_000) this.sql.exec('UPDATE users SET last_seen_at = ? WHERE id = ?', Date.now(), row.id);
    return toUser(row);
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
