import { useEffect, useState } from 'react';
import { Check, CheckCircle2, Clock, Cloud, Copy, Link2, MessageSquareText, ShieldCheck, Trash2, UserCheck, UserPlus, X } from 'lucide-react';
import type { InviteInfo, InviteOptions, InviteRole, JoinRequest } from '@shared/types';
import { useUI } from '../store/ui';
import { useSession } from '../store/session';
import { toast } from '../store/toasts';
import { errorMessage } from '../lib/api';
import { copyText, cx } from '../lib/util';
import { relativeTime } from '../lib/time';
import { shareTemplate } from '../lib/templateOps';
import {
  DEFAULT_INVITE,
  EXPIRY_CHOICES,
  USES_CHOICES,
  createInvite,
  decideRequest,
  inviteLink,
  inviteMessage,
  inviteSummary,
  useInvites,
} from '../lib/invites';
import { useOptionalWorkspace, type WorkspaceValue } from '../workspace/context';
import { Avatar, Button, IconButton, Modal, Spinner, confirmDialog } from './ui';

const ROLE_CHOICES: { role: InviteRole; label: string; desc: string }[] = [
  { role: 'editor', label: '편집자', desc: '디자인 · 코드 · 문서 · 비밀 노트 편집' },
  { role: 'viewer', label: '뷰어', desc: '읽기 전용 · 커서 공유와 채팅은 가능' },
];

export function InviteDialog() {
  const open = useUI((s) => s.shareOpen);
  const ws = useOptionalWorkspace();
  if (!open || !ws || !ws.canEdit) return null;
  return <InviteDialog_ ws={ws} />;
}

function InviteDialog_({ ws }: { ws: WorkspaceValue }) {
  const setOpen = useUI((s) => s.setShareOpen);
  const me = useSession((s) => s.user)!;
  const t = ws.template;
  const personal = ws.mode === 'personal';
  const [opts, setOpts] = useState<InviteOptions>(DEFAULT_INVITE);
  const busy = useUI((s) => s.inviteBusy);
  const setBusy = useUI((s) => s.setInviteBusy);
  const created = useUI((s) => s.createdInvite);
  const setCreated = useUI((s) => s.setCreatedInvite);
  const { invites, revoke, setInvites } = useInvites(t.id, !personal);
  const set = (patch: Partial<InviteOptions>) => setOpts((o) => ({ ...o, ...patch }));

  // 전환 중에 목록을 먼저 불러왔다면 방금 만든 링크를 끼워 넣는다
  useEffect(() => {
    if (created && invites && !invites.some((i) => i.id === created.id)) setInvites([created, ...invites]);
  }, [created, invites, setInvites]);

  const create = async () => {
    setBusy(true);
    try {
      let templateId = t.id;
      if (personal) {
        // 첫 초대: 개인 공간을 협업 공간으로 전환 (같은 ID · 같은 주소로 이어서 작업)
        const shared = await shareTemplate(t, ws.doc);
        templateId = shared.id;
        toast.success('협업 공간으로 전환했습니다', '이제 초대한 사람과 실시간으로 함께 작업할 수 있습니다.');
      }
      const invite = await createInvite(templateId, { ...opts, label: opts.label?.trim() });
      setCreated(invite);
      setInvites((prev) => [invite, ...(prev ?? []).filter((i) => i.id !== invite.id)]);
      if (await copyText(inviteLink(invite.token))) toast.success('초대 링크를 만들고 복사했습니다', inviteSummary(invite));
    } catch (err) {
      toast.error(personal ? '협업 공간으로 전환하지 못했습니다' : '초대 링크를 만들지 못했습니다', errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (i: InviteInfo) => {
    const ok = await confirmDialog({
      title: '이 초대 링크를 취소할까요?',
      message: `${i.label || inviteSummary(i)}\n취소하면 이 링크로는 더 이상 참여할 수 없습니다. 이미 참여한 멤버에게는 영향이 없습니다.`,
      confirmText: '링크 취소',
      danger: true,
    });
    if (!ok) return;
    try {
      await revoke(i.id);
      if (created?.id === i.id) setCreated(null);
      toast.info('초대 링크를 취소했습니다');
    } catch (err) {
      toast.error('취소하지 못했습니다', errorMessage(err));
    }
  };

  return (
    <Modal
      title="팀원 초대"
      description={`${t.emoji} ${t.name}`}
      icon={<UserPlus size={18} />}
      onClose={() => setOpen(false)}
      width={680}
    >
      <div className="invite">
        {personal && (
          <div className="invite-convert">
            <Cloud size={18} />
            <div>
              <b>초대하면 협업 공간으로 전환됩니다</b>
              <span>
                지금까지의 내용 · 타임라인 · 비밀 노트(암호화된 그대로)가 클라우드로 옮겨지고, 실시간 커서 · 채팅 · 멤버 관리가 켜집니다. 주소와 작업
                내용은 그대로 이어집니다.
              </span>
            </div>
          </div>
        )}

        {created ? (
          <CreatedLink invite={created} templateName={t.name} inviter={me.name} onNew={() => setCreated(null)} />
        ) : (
          <section className="invite-form">
            <div className="invite-row">
              <span className="field-label">권한</span>
              <div className="invite-roles" role="radiogroup" aria-label="초대 권한">
                {ROLE_CHOICES.map((r) => (
                  <button
                    key={r.role}
                    type="button"
                    role="radio"
                    aria-checked={opts.role === r.role}
                    className={cx('invite-role', opts.role === r.role && 'is-selected')}
                    onClick={() => set({ role: r.role })}
                  >
                    <b>{r.label}</b>
                    <span>{r.desc}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="invite-grid">
              <label className="invite-row">
                <span className="field-label">
                  <Clock size={13} /> 유효 기간
                </span>
                <select className="input" value={String(opts.expiresInDays)} onChange={(e) => set({ expiresInDays: e.target.value === 'null' ? null : Number(e.target.value) })}>
                  {EXPIRY_CHOICES.map((c) => (
                    <option key={String(c.days)} value={String(c.days)}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="invite-row">
                <span className="field-label">
                  <UserCheck size={13} /> 사용 인원
                </span>
                <select className="input" value={String(opts.maxUses)} onChange={(e) => set({ maxUses: e.target.value === 'null' ? null : Number(e.target.value) })}>
                  {USES_CHOICES.map((c) => (
                    <option key={String(c.uses)} value={String(c.uses)}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="invite-row">
                <span className="field-label">메모 (선택)</span>
                <input className="input" value={opts.label ?? ''} maxLength={40} placeholder="예) 디자인팀 단톡방" onChange={(e) => set({ label: e.target.value })} />
              </label>
            </div>
            <label className="invite-approval">
              <input type="checkbox" checked={opts.requireApproval} onChange={(e) => set({ requireApproval: e.target.checked })} />
              <span>
                <b>
                  <ShieldCheck size={14} /> 참여 전에 승인 받기
                </b>
                <span className="muted small">링크가 다른 곳으로 퍼져도 내가(또는 편집자가) 승인한 사람만 들어올 수 있습니다.</span>
              </span>
            </label>
            <div className="invite-actions">
              <Button variant="primary" icon={<Link2 size={15} />} onClick={create} loading={busy}>
                {personal ? '협업 공간으로 전환하고 링크 만들기' : '초대 링크 만들기'}
              </Button>
            </div>
          </section>
        )}

        {!personal && <Requests requests={ws.requests} templateId={t.id} />}

        {!personal && (
          <section className="invite-list">
            <h4>
              사용 중인 초대 링크 <span className="muted">{invites?.length ?? ''}</span>
            </h4>
            {!invites ? (
              <Spinner />
            ) : invites.length === 0 ? (
              <p className="muted small">사용 중인 링크가 없습니다. 만료되었거나 인원이 다 찬 링크는 자동으로 사라집니다.</p>
            ) : (
              <ul>
                {invites.map((i) => (
                  <li key={i.id} className={cx('invite-item', created?.id === i.id && 'is-new')}>
                    <span className={`role-chip role-${i.role}`}>{i.role === 'viewer' ? '뷰어' : '편집자'}</span>
                    <div className="invite-item-text">
                      <b>{i.label || inviteLink(i.token).replace(/^https?:\/\//, '')}</b>
                      <span className="muted small">
                        {inviteSummary(i)} · {i.createdBy?.name ?? '멤버'} · {relativeTime(i.createdAt)}
                      </span>
                    </div>
                    <IconButton
                      label="링크 복사"
                      size="sm"
                      onClick={async () => (await copyText(inviteLink(i.token))) && toast.success('초대 링크를 복사했습니다', inviteSummary(i))}
                    >
                      <Copy size={15} />
                    </IconButton>
                    <IconButton label="링크 취소" size="sm" onClick={() => remove(i)}>
                      <Trash2 size={15} />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <p className="invite-tip muted small">
          권한이나 대상이 다르면 링크를 따로 만드세요. 링크마다 조건이 달라서, 하나가 유출되어도 그 링크만 취소하면 됩니다.
        </p>
      </div>
    </Modal>
  );
}

function CreatedLink({ invite, templateName, inviter, onNew }: { invite: InviteInfo; templateName: string; inviter: string; onNew: () => void }) {
  const url = inviteLink(invite.token);
  return (
    <section className="invite-created">
      <div className="invite-created-head">
        <CheckCircle2 size={18} />
        <b>초대 링크가 준비되었습니다</b>
        <span className="muted small">{inviteSummary(invite)}</span>
      </div>
      <div className="share-link">
        <Link2 size={16} />
        <input className="input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
        <Button variant="primary" icon={<Copy size={14} />} onClick={async () => (await copyText(url)) && toast.success('초대 링크를 복사했습니다')}>
          복사
        </Button>
      </div>
      <div className="invite-created-actions">
        <Button
          size="sm"
          variant="ghost"
          icon={<MessageSquareText size={14} />}
          onClick={async () => (await copyText(inviteMessage(templateName, invite, inviter))) && toast.success('초대 메시지를 복사했습니다', '메신저에 붙여넣어 보내세요.')}
        >
          안내 문구와 함께 복사
        </Button>
        <Button size="sm" variant="ghost" icon={<Link2 size={14} />} onClick={onNew}>
          다른 조건으로 새 링크
        </Button>
      </div>
    </section>
  );
}

export function Requests({ requests, templateId }: { requests: JoinRequest[]; templateId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!requests.length) return null;
  const decide = async (r: JoinRequest, approve: boolean) => {
    setBusy(r.id);
    try {
      await decideRequest(templateId, r.id, approve);
      if (approve) toast.success('참여를 승인했습니다', `${r.user.name} 님이 ${r.role === 'viewer' ? '뷰어' : '편집자'}로 참여합니다.`);
      else toast.info('참여 요청을 거절했습니다', r.user.name);
    } catch (err) {
      toast.error('처리하지 못했습니다', errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="invite-requests">
      <h4>
        참여 요청 <span className="badge-count static">{requests.length}</span>
      </h4>
      <ul>
        {requests.map((r) => (
          <li key={r.id} className="request-item">
            <Avatar user={r.user} size={30} />
            <div className="invite-item-text">
              <b>{r.user.name}</b>
              <span className="muted small">
                {r.role === 'viewer' ? '뷰어' : '편집자'}로 참여 요청 · {relativeTime(r.createdAt)}
              </span>
            </div>
            <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => decide(r, false)} disabled={busy === r.id}>
              거절
            </Button>
            <Button size="sm" variant="primary" icon={<Check size={14} />} onClick={() => decide(r, true)} loading={busy === r.id}>
              승인
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
