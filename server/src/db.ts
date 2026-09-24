import { createHash, randomBytes } from 'node:crypto';
import type { Feature, MemberInfo, PublicUser, Role, TemplateSummary } from '../../shared/types.js';
import { USER_AVATARS, USER_COLORS, isHexColor } from '../../shared/colors.js';
import { FEATURE_ORDER } from '../../shared/presets.js';
import { JsonFile, dataPath } from './store.js';
import { HttpError, clampText, newId } from './util.js';

export interface UserRecord extends PublicUser {
  tokenHash: string;
  createdAt: number;
  lastSeenAt: number;
}

export interface MemberRecord {
  userId: string;
  role: Role;
  joinedAt: number;
}

export interface TemplateRecord {
  id: string;
  name: string;
  description: string;
  emoji: string;
  features: Feature[];
  ownerId: string;
  members: MemberRecord[];
  inviteCode: string;
  preset: string;
  createdAt: number;
  updatedAt: number;
}

interface DbShape {
  users: Record<string, UserRecord>;
  templates: Record<string, TemplateRecord>;
}

let db: JsonFile<DbShape>;

export function initDb(): void {
  db = new JsonFile<DbShape>(dataPath('db.json'), () => ({ users: {}, templates: {} }));
}

export function flushDb(): Promise<void> {
  return db.flush();
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/* ───────────── 사용자 ───────────── */

export function toPublicUser(u: UserRecord | PublicUser): PublicUser {
  return { id: u.id, name: u.name, color: u.color, avatar: u.avatar };
}

function sanitizeProfile(input: Partial<PublicUser>, current?: PublicUser): Omit<PublicUser, 'id'> {
  const name = clampText(input.name, 24) || current?.name;
  if (!name) throw new HttpError(400, '이름을 입력해 주세요.');
  const color = isHexColor(input.color) ? input.color : current?.color ?? USER_COLORS[0];
  const avatar =
    typeof input.avatar === 'string' && input.avatar.length > 0 && input.avatar.length <= 8
      ? input.avatar
      : current?.avatar ?? USER_AVATARS[0];
  return { name, color, avatar };
}

export function createUser(input: Partial<PublicUser>): { user: PublicUser; token: string } {
  const profile = sanitizeProfile(input);
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  const rec: UserRecord = { id: newId(), ...profile, tokenHash: hashToken(token), createdAt: now, lastSeenAt: now };
  db.data.users[rec.id] = rec;
  db.save();
  return { user: toPublicUser(rec), token };
}

export function findUserByToken(token: string | undefined | null): UserRecord | null {
  if (!token || typeof token !== 'string') return null;
  const h = hashToken(token);
  for (const u of Object.values(db.data.users)) if (u.tokenHash === h) return u;
  return null;
}

export function getUser(id: string): UserRecord | null {
  return db.data.users[id] ?? null;
}

export function updateUser(id: string, patch: Partial<PublicUser>): PublicUser {
  const u = db.data.users[id];
  if (!u) throw new HttpError(404, '사용자를 찾을 수 없습니다.');
  Object.assign(u, sanitizeProfile(patch, u));
  db.save();
  return toPublicUser(u);
}

export function touchUser(id: string): void {
  const u = db.data.users[id];
  if (u) {
    u.lastSeenAt = Date.now();
    db.save();
  }
}

/* ───────────── 템플릿 ───────────── */

export function sanitizeFeatures(value: unknown): Feature[] {
  const list = Array.isArray(value) ? value : [];
  const features = FEATURE_ORDER.filter((f) => list.includes(f));
  if (features.length === 0) throw new HttpError(400, '기능을 하나 이상 선택해 주세요.');
  return features;
}

export function listTemplatesFor(userId: string): TemplateRecord[] {
  return Object.values(db.data.templates)
    .filter((t) => t.members.some((m) => m.userId === userId))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function allTemplates(): TemplateRecord[] {
  return Object.values(db.data.templates);
}

export function getTemplate(id: string): TemplateRecord | null {
  return db.data.templates[id] ?? null;
}

export function roleOf(t: TemplateRecord, userId: string): Role | null {
  return t.members.find((m) => m.userId === userId)?.role ?? null;
}

/** 멤버가 아니면 403, 템플릿이 없으면 404 */
export function requireMember(templateId: string, userId: string, minRole: Role = 'viewer'): { t: TemplateRecord; role: Role } {
  const t = getTemplate(templateId);
  if (!t) throw new HttpError(404, '템플릿을 찾을 수 없습니다.');
  const role = roleOf(t, userId);
  if (!role) throw new HttpError(403, '이 템플릿의 멤버가 아닙니다.');
  if (!hasRole(role, minRole)) throw new HttpError(403, '권한이 부족합니다.');
  return { t, role };
}

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };
export const hasRole = (role: Role, min: Role) => ROLE_RANK[role] >= ROLE_RANK[min];

export function createTemplate(
  ownerId: string,
  input: { name?: unknown; description?: unknown; emoji?: unknown; features?: unknown; preset?: unknown },
): TemplateRecord {
  const name = clampText(input.name, 60);
  if (!name) throw new HttpError(400, '템플릿 이름을 입력해 주세요.');
  const now = Date.now();
  const t: TemplateRecord = {
    id: newId(),
    name,
    description: clampText(input.description, 200),
    emoji: typeof input.emoji === 'string' && input.emoji.length <= 8 && input.emoji ? input.emoji : '🗂️',
    features: sanitizeFeatures(input.features),
    ownerId,
    members: [{ userId: ownerId, role: 'owner', joinedAt: now }],
    inviteCode: newId(10),
    preset: typeof input.preset === 'string' ? input.preset : 'blank',
    createdAt: now,
    updatedAt: now,
  };
  db.data.templates[t.id] = t;
  db.save();
  return t;
}

export function updateTemplate(
  t: TemplateRecord,
  patch: { name?: unknown; description?: unknown; emoji?: unknown; features?: unknown },
): string[] {
  const changes: string[] = [];
  if (patch.name !== undefined) {
    const name = clampText(patch.name, 60);
    if (!name) throw new HttpError(400, '템플릿 이름을 입력해 주세요.');
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
    if (f.join() !== t.features.join()) {
      t.features = f;
      const names = { design: '디자인', code: '코딩', docs: '문서' } as const;
      changes.push(`기능 → ${f.map((x) => names[x]).join(', ')}`);
    }
  }
  if (changes.length) touchTemplate(t);
  return changes;
}

export function touchTemplate(t: TemplateRecord): void {
  t.updatedAt = Date.now();
  db.save();
}

export function deleteTemplate(id: string): void {
  delete db.data.templates[id];
  db.save();
}

export function findTemplateByInvite(code: string): TemplateRecord | null {
  if (!code) return null;
  return Object.values(db.data.templates).find((t) => t.inviteCode === code) ?? null;
}

export function addMember(t: TemplateRecord, userId: string, role: Role = 'editor'): boolean {
  if (t.members.some((m) => m.userId === userId)) return false;
  t.members.push({ userId, role, joinedAt: Date.now() });
  touchTemplate(t);
  return true;
}

export function setMemberRole(t: TemplateRecord, userId: string, role: Role): void {
  const m = t.members.find((x) => x.userId === userId);
  if (!m) throw new HttpError(404, '멤버를 찾을 수 없습니다.');
  if (m.role === 'owner' || role === 'owner') throw new HttpError(400, '소유자 권한은 변경할 수 없습니다.');
  m.role = role;
  touchTemplate(t);
}

export function removeMember(t: TemplateRecord, userId: string): void {
  if (userId === t.ownerId) throw new HttpError(400, '소유자는 템플릿을 떠날 수 없습니다.');
  t.members = t.members.filter((m) => m.userId !== userId);
  touchTemplate(t);
}

export function regenerateInvite(t: TemplateRecord): string {
  t.inviteCode = newId(10);
  db.save();
  return t.inviteCode;
}

export function summarize(t: TemplateRecord, forUserId: string): TemplateSummary {
  const myRole = roleOf(t, forUserId) ?? 'viewer';
  const members: MemberInfo[] = t.members
    .map((m) => {
      const u = getUser(m.userId);
      return u ? { user: toPublicUser(u), role: m.role, joinedAt: m.joinedAt } : null;
    })
    .filter((m): m is MemberInfo => m !== null);
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    emoji: t.emoji,
    features: t.features,
    ownerId: t.ownerId,
    members,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    myRole,
    inviteCode: hasRole(myRole, 'editor') ? t.inviteCode : undefined,
  };
}
