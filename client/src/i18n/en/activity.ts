import type { ActivityType } from '@shared/types';

/** shared/activity.ts의 영어판 — 타임라인 · 알림 문장과 커서 옆 라벨. 문장은 "이름 + 동사구"로 읽힌다 (예: Mina created the file “main.js”) */
const q = (s: string) => (s ? ` “${s}”` : '');
const tail = (d: string) => (d ? ` · ${d}` : '');

export const ACTIVITY_EN: Record<ActivityType, { label: string; text: (target: string, detail: string) => string }> = {
  'presence.join': { label: 'Joined', text: () => 'joined the template' },
  'presence.leave': { label: 'Left', text: () => 'left the template' },
  'template.create': { label: 'Created template', text: (t) => `created the template${q(t)}` },
  'template.update': { label: 'Changed settings', text: (_t, d) => `changed the template settings${tail(d)}` },
  'template.share': { label: 'Made shared', text: () => 'turned this personal space into a shared space' },
  'template.trash': { label: 'Moved to Trash', text: () => 'moved the template to Trash' },
  'template.restore': { label: 'Restored', text: () => 'restored the template from Trash' },
  'template.copy': { label: 'Restored version', text: (t, d) => `made a copy of${q(t) || ' the template'} from an earlier version${tail(d)}` },
  'invite.create': { label: 'Invite link', text: (_t, d) => `created an invite link${tail(d)}` },
  'invite.revoke': { label: 'Revoked invite', text: (_t, d) => `revoked an invite link${tail(d)}` },
  'member.request': { label: 'Requested to join', text: () => 'asked to join via an invite link' },
  'member.join': { label: 'Joined', text: () => 'joined the template via an invite link' },
  'member.leave': { label: 'Left', text: () => 'left the template' },
  'member.role': { label: 'Changed role', text: (t, d) => `changed ${t}’s role · ${d}` },
  'member.remove': { label: 'Removed member', text: (t) => `removed ${t} from the template` },

  'code.create': { label: 'Created file', text: (t) => `created the file${q(t)}` },
  'code.delete': { label: 'Deleted file', text: (t) => `deleted the file${q(t)}` },
  'code.rename': { label: 'Renamed', text: (_t, d) => `renamed a file · ${d}` },
  'code.language': { label: 'Changed language', text: (t, d) => `changed the language of${q(t) || ' a file'} → ${d}` },
  'code.edit': { label: 'Editing code', text: (t) => `edited the file${q(t)}` },
  'code.run': { label: 'Ran code', text: (t) => `ran the file${q(t)}` },

  'docs.create': { label: 'Created doc', text: (t) => `created the doc${q(t)}` },
  'docs.delete': { label: 'Deleted doc', text: (t) => `deleted the doc${q(t)}` },
  'docs.rename': { label: 'Renamed doc', text: (_t, d) => `renamed a doc · ${d}` },
  'docs.edit': { label: 'Writing', text: (t) => `edited the doc${q(t)}` },

  'design.create': { label: 'Created board', text: (t) => `created the board${q(t)}` },
  'design.delete': { label: 'Deleted board', text: (t) => `deleted the board${q(t)}` },
  'design.rename': { label: 'Renamed', text: (_t, d) => `renamed a board · ${d}` },
  'design.shape.add': { label: 'Added shape', text: (t, d) => `added a shape to${q(t) || ' a board'}${tail(d)}` },
  'design.shape.delete': { label: 'Deleted shape', text: (t) => `deleted a shape from${q(t) || ' a board'}` },
  'design.edit': { label: 'Editing design', text: (t) => `edited the board${q(t)}` },

  'notes.create': { label: 'Created secret note', text: (t) => `created the secret note${q(t)}` },
  'notes.delete': { label: 'Deleted secret note', text: (t) => `deleted the secret note${q(t)}` },
  'notes.unlock': { label: 'Opened secret note', text: (t) => `opened the secret note${q(t)}` },
  'notes.unlock_fail': { label: 'Unlock failed', text: (t) => `entered the wrong password for the secret note${q(t)}` },
  'notes.password': { label: 'Changed password', text: (t) => `changed the password for the secret note${q(t)}` },
  'notes.edit': { label: 'Editing secret note', text: (t) => `edited the secret note${q(t)}` },

  'section.create': { label: 'Added folder', text: (t) => `created the folder${q(t)}` },
  'section.rename': { label: 'Renamed folder', text: (_t, d) => `renamed a folder · ${d}` },
  'section.delete': { label: 'Deleted folder', text: (t, d) => `deleted the folder${q(t)}${tail(d)}` },
  'page.move': { label: 'Moved page', text: (t, d) => `moved the page${q(t)}${tail(d)}` },
};
