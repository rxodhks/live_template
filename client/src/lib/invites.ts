import { useCallback, useEffect, useState } from 'react';
import type { InviteInfo, InviteOptions, JoinRequest, TemplateSummary } from '@shared/types';
import { useTemplates } from '../store/templates';
import { api, appUrl, errorMessage } from './api';
import { lazyText, t } from '../i18n';

/*
 * 초대 방식 — "링크마다 조건이 다른 초대 링크"
 *  · 권한(편집자/뷰어) · 유효 기간 · 사용 인원 · 승인 여부를 링크마다 정한다
 *  · 링크는 하나씩 취소할 수 있고, 이미 참여한 멤버에게는 영향이 없다
 *  · 워크스페이스 공용 초대 코드 하나를 돌려 쓰는 방식보다 유출·권한 관리가 안전하다
 */

export const inviteLink = (token: string) => appUrl(`/join/${token}`);

export const EXPIRY_CHOICES: { days: number | null; label: string }[] = lazyText(() => [
  { days: 1, label: t('1일') },
  { days: 7, label: t('7일') },
  { days: 30, label: t('30일') },
  { days: null, label: t('만료 없음') },
], []);

export const USES_CHOICES: { uses: number | null; label: string }[] = lazyText(() => [
  { uses: 1, label: t('1명만') },
  { uses: 5, label: t('5명까지') },
  { uses: 20, label: t('20명까지') },
  { uses: null, label: t('제한 없음') },
], []);

export const DEFAULT_INVITE: InviteOptions = { role: 'editor', expiresInDays: 7, maxUses: null, requireApproval: false, label: '' };

export function expiryText(expiresAt: number | null, now = Date.now()): string {
  if (!expiresAt) return t('만료 없음');
  const ms = expiresAt - now;
  if (ms <= 0) return t('만료됨');
  const hours = Math.ceil(ms / 3_600_000);
  return hours < 24 ? t('{hours}시간 남음', { hours }) : t('{x}일 남음', { x: Math.ceil(hours / 24) });
}

export function inviteSummary(i: InviteInfo): string {
  const parts = [i.role === 'viewer' ? t('뷰어') : t('편집자'), expiryText(i.expiresAt)];
  parts.push(i.maxUses ? t('{uses}/{maxUses}명 사용', { uses: i.uses, maxUses: i.maxUses }) : t('{uses}명 사용', { uses: i.uses }));
  if (i.requireApproval) parts.push(t('승인 필요'));
  return parts.join(' · ');
}

/** 메신저로 보내기 좋은 초대 문구 */
export function inviteMessage(templateName: string, i: InviteInfo, inviter: string): string {
  const role = i.role === 'viewer' ? t('뷰어(읽기 전용)') : t('편집자');
  const until = i.expiresAt ? ` (${expiryText(i.expiresAt)})` : '';
  return t('{inviter} 님이 Madang의 ‘{templateName}’ 템플릿에 {role}로 초대했습니다{until}.\n{link}\n(PC 브라우저에서 열어 주세요. 휴대폰 화면은 아직 지원하지 않습니다.)', { inviter, templateName, role, until, link: inviteLink(i.token) });
}

export function useInvites(templateId: string, enabled: boolean) {
  const [invites, setInvites] = useState<InviteInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) return setInvites([]);
    try {
      const res = await api<{ invites: InviteInfo[] }>('GET', `/templates/${templateId}/invites`);
      setInvites(res.invites);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
      setInvites((prev) => prev ?? []);
    }
  }, [templateId, enabled]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const revoke = useCallback(
    async (id: string) => {
      await api('DELETE', `/templates/${templateId}/invites/${id}`);
      setInvites((prev) => prev?.filter((i) => i.id !== id) ?? null);
    },
    [templateId],
  );

  return { invites, error, reload, revoke, setInvites };
}

/** 초대 링크 만들기 — 개인 공간이었다면 서버가 협업 공간으로 바꾸고 바뀐 템플릿 정보를 함께 준다 */
export async function createInvite(templateId: string, opts: InviteOptions): Promise<InviteInfo> {
  const res = await api<{ invite: InviteInfo; template: TemplateSummary | null }>('POST', `/templates/${templateId}/invites`, opts);
  if (res.template) useTemplates.getState().upsertShared(res.template);
  return res.invite;
}

export async function decideRequest(templateId: string, requestId: string, approve: boolean): Promise<JoinRequest> {
  return (await api<{ request: JoinRequest }>('POST', `/templates/${templateId}/requests/${requestId}`, { approve })).request;
}
