import express, { type NextFunction, type Request, type Response } from 'express';
import type { PublicUser, Role } from '../../shared/types.js';
import {
  type UserRecord,
  addMember,
  createTemplate,
  createUser,
  deleteTemplate,
  findTemplateByInvite,
  findUserByToken,
  getUser,
  listTemplatesFor,
  regenerateInvite,
  removeMember,
  requireMember,
  setMemberRole,
  summarize,
  toPublicUser,
  updateTemplate,
  updateUser,
} from './db.js';
import { DocManager } from './docs.js';
import { seedTemplateDoc } from './seed.js';
import { deleteTimeline, queryTimeline, renameTemplateInTimeline, recordActivity } from './timeline.js';
import { deleteChat } from './chat.js';
import {
  changeNotePassword,
  createNote,
  deleteAllNotes,
  deleteNote,
  getNoteMeta,
  listNotes,
  revokeTicket,
  unlockNote,
} from './secrets.js';
import {
  closeTemplate,
  docs,
  emitNotesChanged,
  emitTemplateUpdated,
  emitToUser,
  kickNote,
  kickUserFromTemplate,
  onlineMapFor,
  record,
  refreshUserPresence,
} from './realtime.js';
import { HttpError } from './util.js';

declare module 'express-serve-static-core' {
  interface Request {
    user?: UserRecord;
  }
}

const ROLE_LABEL: Record<Role, string> = { owner: '소유자', editor: '편집자', viewer: '뷰어' };

function auth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : undefined;
  const user = findUserByToken(token);
  if (!user) return next(new HttpError(401, '로그인이 필요합니다.'));
  req.user = user;
  next();
}

const me = (req: Request): PublicUser => toPublicUser(req.user!);
const param = (req: Request, key: string) => String(req.params[key] ?? '');

export function apiRouter(): express.Router {
  const r = express.Router();
  r.use(express.json({ limit: '1mb' }));

  r.get('/health', (_req, res) => {
    res.json({ ok: true, time: Date.now() });
  });

  /* ── 사용자 ── */
  r.post('/users', (req, res) => {
    res.status(201).json(createUser(req.body ?? {}));
  });

  r.get('/me', auth, (req, res) => {
    res.json({ user: me(req) });
  });

  r.patch('/me', auth, (req, res) => {
    const user = updateUser(req.user!.id, req.body ?? {});
    refreshUserPresence(user);
    for (const t of listTemplatesFor(user.id)) emitTemplateUpdated(t);
    res.json({ user });
  });

  /* ── 템플릿 ── */
  r.get('/templates', auth, (req, res) => {
    const templates = listTemplatesFor(req.user!.id).map((t) => summarize(t, req.user!.id));
    res.json({ templates, online: onlineMapFor(req.user!.id) });
  });

  r.post('/templates', auth, (req, res) => {
    const t = createTemplate(req.user!.id, req.body ?? {});
    DocManager.writeInitialTemplateDoc(t.id, (doc) => seedTemplateDoc(doc, t.preset, t.features, req.user!.id));
    recordActivity({ templateId: t.id, templateName: t.name, user: me(req), type: 'template.create', targetName: t.name });
    res.status(201).json({ template: summarize(t, req.user!.id) });
  });

  r.get('/templates/:id', auth, (req, res) => {
    const { t } = requireMember(param(req, 'id'), req.user!.id);
    res.json({ template: summarize(t, req.user!.id) });
  });

  r.patch('/templates/:id', auth, (req, res) => {
    const { t } = requireMember(param(req, 'id'), req.user!.id, 'editor');
    const before = t.name;
    const changes = updateTemplate(t, req.body ?? {});
    if (changes.length) {
      if (before !== t.name) renameTemplateInTimeline(t.id, t.name);
      record(t, me(req), { type: 'template.update', detail: changes.join(', ') });
      emitTemplateUpdated(t);
    }
    res.json({ template: summarize(t, req.user!.id) });
  });

  r.delete('/templates/:id', auth, async (req, res) => {
    const { t } = requireMember(param(req, 'id'), req.user!.id, 'owner');
    await closeTemplate(t, me(req));
    deleteTemplate(t.id);
    DocManager.removeTemplateDoc(t.id);
    deleteTimeline(t.id);
    deleteChat(t.id);
    deleteAllNotes(t.id);
    res.json({ ok: true });
  });

  r.post('/templates/:id/invite/regenerate', auth, (req, res) => {
    const { t } = requireMember(param(req, 'id'), req.user!.id, 'owner');
    regenerateInvite(t);
    emitTemplateUpdated(t);
    res.json({ template: summarize(t, req.user!.id) });
  });

  /* ── 초대 / 멤버 ── */
  r.get('/invite/:code', auth, (req, res) => {
    const t = findTemplateByInvite(param(req, 'code'));
    if (!t) throw new HttpError(404, '유효하지 않은 초대 링크입니다.');
    const owner = getUser(t.ownerId);
    res.json({
      invite: {
        templateId: t.id,
        name: t.name,
        emoji: t.emoji,
        description: t.description,
        features: t.features,
        memberCount: t.members.length,
        owner: owner ? toPublicUser(owner) : null,
        alreadyMember: t.members.some((m) => m.userId === req.user!.id),
      },
    });
  });

  r.post('/invite/:code/join', auth, (req, res) => {
    const t = findTemplateByInvite(param(req, 'code'));
    if (!t) throw new HttpError(404, '유효하지 않은 초대 링크입니다.');
    if (addMember(t, req.user!.id, 'editor')) {
      record(t, me(req), { type: 'member.join' });
      emitTemplateUpdated(t);
    }
    res.json({ template: summarize(t, req.user!.id) });
  });

  r.patch('/templates/:id/members/:userId', auth, (req, res) => {
    const { t } = requireMember(param(req, 'id'), req.user!.id, 'owner');
    const role = req.body?.role as Role;
    if (role !== 'editor' && role !== 'viewer') throw new HttpError(400, '올바른 권한이 아닙니다.');
    const target = getUser(param(req, 'userId'));
    if (!target) throw new HttpError(404, '사용자를 찾을 수 없습니다.');
    setMemberRole(t, target.id, role);
    record(t, me(req), { type: 'member.role', targetId: target.id, targetName: target.name, detail: ROLE_LABEL[role] });
    emitTemplateUpdated(t);
    res.json({ template: summarize(t, req.user!.id) });
  });

  r.delete('/templates/:id/members/:userId', auth, async (req, res) => {
    const targetId = param(req, 'userId');
    const self = targetId === req.user!.id;
    const { t } = requireMember(param(req, 'id'), req.user!.id, self ? 'viewer' : 'owner');
    const target = getUser(targetId);
    if (!target) throw new HttpError(404, '사용자를 찾을 수 없습니다.');
    removeMember(t, targetId);
    await kickUserFromTemplate(t.id, targetId);
    if (self) record(t, me(req), { type: 'member.leave' });
    else record(t, me(req), { type: 'member.remove', targetId, targetName: target.name });
    emitTemplateUpdated(t);
    emitToUser(targetId, 'template:removed', { templateId: t.id, name: t.name, self });
    res.json({ ok: true });
  });

  /* ── 타임라인 ── */
  r.get('/timeline', auth, (req, res) => {
    const mine = listTemplatesFor(req.user!.id).map((t) => t.id);
    const templateId = typeof req.query.templateId === 'string' ? req.query.templateId : '';
    if (templateId && !mine.includes(templateId)) throw new HttpError(403, '이 템플릿의 멤버가 아닙니다.');
    res.json(
      queryTimeline({
        templateIds: templateId ? [templateId] : mine,
        userId: typeof req.query.userId === 'string' && req.query.userId ? req.query.userId : undefined,
        module: typeof req.query.module === 'string' && req.query.module ? req.query.module : undefined,
        before: Number(req.query.before) || undefined,
        limit: Number(req.query.limit) || undefined,
        q: typeof req.query.q === 'string' ? req.query.q : undefined,
      }),
    );
  });

  /* ── 비밀 노트 ── */
  r.get('/templates/:id/notes', auth, (req, res) => {
    const { t } = requireMember(param(req, 'id'), req.user!.id);
    res.json({ notes: listNotes(t.id) });
  });

  r.post('/templates/:id/notes', auth, async (req, res) => {
    const { t } = requireMember(param(req, 'id'), req.user!.id, 'editor');
    const note = await createNote(t.id, req.user!.id, req.body ?? {});
    record(t, me(req), { type: 'notes.create', targetId: note.id, targetName: note.title });
    emitNotesChanged(t.id);
    res.status(201).json({ note });
  });

  r.post('/templates/:id/notes/:noteId/unlock', auth, async (req, res) => {
    const { t } = requireMember(param(req, 'id'), req.user!.id);
    const meta = getNoteMeta(t.id, param(req, 'noteId'));
    try {
      const result = await unlockNote(t.id, meta.id, req.user!.id, req.body?.password);
      record(t, me(req), { type: 'notes.unlock', targetId: meta.id, targetName: meta.title });
      res.json(result);
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) {
        record(t, me(req), { type: 'notes.unlock_fail', targetId: meta.id, targetName: meta.title });
      }
      throw err;
    }
  });

  r.post('/templates/:id/notes/:noteId/lock', auth, (req, res) => {
    requireMember(param(req, 'id'), req.user!.id);
    revokeTicket(req.body?.ticket);
    res.json({ ok: true });
  });

  r.post('/templates/:id/notes/:noteId/password', auth, async (req, res) => {
    const { t } = requireMember(param(req, 'id'), req.user!.id, 'editor');
    const noteId = param(req, 'noteId');
    const { meta, key } = await changeNotePassword(t.id, noteId, req.user!.id, req.body ?? {});
    docs.rekeyNote(t.id, noteId, key);
    await kickNote(t.id, noteId, 'password');
    record(t, me(req), { type: 'notes.password', targetId: meta.id, targetName: meta.title });
    emitNotesChanged(t.id);
    res.json({ note: meta });
  });

  r.delete('/templates/:id/notes/:noteId', auth, async (req, res) => {
    const { t, role } = requireMember(param(req, 'id'), req.user!.id, 'editor');
    const noteId = param(req, 'noteId');
    const meta = await deleteNote(t.id, noteId, req.user!.id, {
      password: req.body?.password,
      force: role === 'owner' && req.body?.force === true,
    });
    await kickNote(t.id, noteId, 'deleted');
    docs.discard(`note:${t.id}:${noteId}`);
    record(t, me(req), { type: 'notes.delete', targetId: meta.id, targetName: meta.title });
    emitNotesChanged(t.id);
    res.json({ ok: true });
  });

  r.use((_req, _res, next) => next(new HttpError(404, '요청한 API를 찾을 수 없습니다.')));

  r.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, ...err.extra });
      return;
    }
    if ((err as { type?: string })?.type === 'entity.parse.failed') {
      res.status(400).json({ error: '잘못된 요청 형식입니다.' });
      return;
    }
    console.error('[api] 처리 실패', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  });

  return r;
}
