import { useState } from 'react';
import { Copy, Keyboard, Link2, RefreshCw, Share2, UserRound } from 'lucide-react';
import { useUI } from '../store/ui';
import { useSession } from '../store/session';
import { useTemplates } from '../store/templates';
import { toast } from '../store/toasts';
import { api, errorMessage } from '../lib/api';
import { copyText, modKey } from '../lib/util';
import type { PublicUser, TemplateSummary } from '@shared/types';
import { useOptionalWorkspace } from '../workspace/context';
import { Avatar, Button, Kbd, Modal, confirmDialog } from './ui';
import { ProfileForm, useProfileDraft } from './ProfileForm';

export function ProfileDialog() {
  const open = useUI((s) => s.profileOpen);
  if (!open) return null;
  return <ProfileDialog_ />;
}

function ProfileDialog_() {
  const setOpen = useUI((s) => s.setProfileOpen);
  const user = useSession((s) => s.user)!;
  const setUser = useSession((s) => s.setUser);
  const [draft, setDraft] = useProfileDraft(user);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!draft.name.trim()) return;
    setSaving(true);
    try {
      const res = await api<{ user: PublicUser }>('PATCH', '/me', draft);
      setUser(res.user);
      toast.success('프로필을 저장했습니다');
      setOpen(false);
    } catch (err) {
      toast.error('저장하지 못했습니다', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      title="프로필 수정"
      icon={<UserRound size={18} />}
      onClose={() => setOpen(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            취소
          </Button>
          <Button variant="primary" onClick={save} loading={saving} disabled={!draft.name.trim()}>
            저장
          </Button>
        </>
      }
    >
      <ProfileForm draft={draft} onChange={setDraft} onSubmit={save} />
    </Modal>
  );
}

export function inviteUrl(code: string): string {
  return `${location.origin}/join/${code}`;
}

export function ShareDialog() {
  const open = useUI((s) => s.shareOpen);
  const ws = useOptionalWorkspace();
  if (!open || !ws) return null;
  return <ShareDialog_ template={ws.template} />;
}

function ShareDialog_({ template }: { template: TemplateSummary }) {
  const setOpen = useUI((s) => s.setShareOpen);
  const upsert = useTemplates((s) => s.upsert);
  const url = template.inviteCode ? inviteUrl(template.inviteCode) : '';
  const copy = async () => {
    if (await copyText(url)) toast.success('초대 링크를 복사했습니다', '받은 사람은 편집자로 참여합니다.');
  };
  const regenerate = async () => {
    const ok = await confirmDialog({
      title: '초대 링크를 새로 만들까요?',
      message: '기존 링크는 더 이상 사용할 수 없게 됩니다. 이미 참여한 멤버에게는 영향이 없습니다.',
      confirmText: '새 링크 만들기',
    });
    if (!ok) return;
    try {
      const res = await api<{ template: TemplateSummary }>('POST', `/templates/${template.id}/invite/regenerate`);
      upsert(res.template);
      toast.success('새 초대 링크를 만들었습니다');
    } catch (err) {
      toast.error('실패했습니다', errorMessage(err));
    }
  };
  return (
    <Modal title="팀원 초대" description={`${template.emoji} ${template.name}`} icon={<Share2 size={18} />} onClose={() => setOpen(false)} width={520}>
      <div className="share">
        <label className="field-label">초대 링크</label>
        <div className="share-link">
          <Link2 size={16} />
          <input className="input" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
          <Button variant="primary" icon={<Copy size={14} />} onClick={copy}>
            복사
          </Button>
        </div>
        <p className="muted small">링크를 받은 사람은 프로필을 만든 뒤 편집자로 참여합니다. 권한은 멤버 화면에서 바꿀 수 있습니다.</p>
        {template.myRole === 'owner' && (
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} />} onClick={regenerate}>
            링크 재발급
          </Button>
        )}
        <div className="share-members">
          <label className="field-label">멤버 {template.members.length}명</label>
          {template.members.map((m) => (
            <div className="share-member" key={m.user.id}>
              <Avatar user={m.user} size={28} />
              <span>{m.user.name}</span>
              <span className={`role-chip role-${m.role}`}>{m.role === 'owner' ? '소유자' : m.role === 'editor' ? '편집자' : '뷰어'}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

const SHORTCUTS: [string, [string, string][]][] = [
  [
    '전역',
    [
      [`${modKey} K`, '명령 팔레트 (검색 · 이동 · 만들기)'],
      ['?', '단축키 도움말'],
      ['Esc', '따라가기 중지 · 대화상자 닫기'],
      [`${modKey} S`, '자동 저장 확인 (별도 저장 불필요)'],
    ],
  ],
  [
    '디자인',
    [
      ['V / H', '선택 / 손(이동) 도구'],
      ['R · O · D', '사각형 · 원 · 마름모'],
      ['L · A · P', '선 · 화살표 · 펜'],
      ['T · S', '텍스트 · 스티키 노트'],
      ['Space + 드래그', '캔버스 이동'],
      [`${modKey} + 휠`, '확대 / 축소'],
      [`${modKey} Z / ${modKey} Shift Z`, '실행 취소 / 다시 실행 (내 변경만)'],
      [`${modKey} D · ${modKey} C/V`, '복제 · 복사/붙여넣기'],
      ['Delete', '선택 삭제'],
      ['Shift 1', '화면에 맞추기'],
    ],
  ],
  [
    '코드 · 문서',
    [
      [`${modKey} Enter`, '코드 실행 (JavaScript) / 미리보기 (HTML)'],
      [`${modKey} F`, '찾기'],
      [`${modKey} B / I / U`, '굵게 / 기울임 / 밑줄'],
      ['# + 공백', '제목 (마크다운 단축 입력)'],
      ['[] + 공백', '체크리스트'],
    ],
  ],
];

export function ShortcutsDialog() {
  const open = useUI((s) => s.shortcutsOpen);
  const setOpen = useUI((s) => s.setShortcutsOpen);
  if (!open) return null;
  return (
    <Modal title="키보드 단축키" icon={<Keyboard size={18} />} onClose={() => setOpen(false)} width={640}>
      <div className="shortcuts">
        {SHORTCUTS.map(([group, list]) => (
          <section key={group}>
            <h4>{group}</h4>
            {list.map(([keys, desc]) => (
              <div className="shortcut-row" key={keys}>
                <span>{desc}</span>
                <Kbd>{keys}</Kbd>
              </div>
            ))}
          </section>
        ))}
      </div>
    </Modal>
  );
}
