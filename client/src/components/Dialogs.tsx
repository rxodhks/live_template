import { useState } from 'react';
import { Keyboard, UserRound } from 'lucide-react';
import { useUI } from '../store/ui';
import { useSession } from '../store/session';
import { useTemplates } from '../store/templates';
import { toast } from '../store/toasts';
import { errorMessage } from '../lib/api';
import { updateProfile } from '../lib/auth';
import { modKey } from '../lib/util';
import { Button, Kbd, Modal } from './ui';
import { ProfileForm, useProfileDraft } from './ProfileForm';

export function ProfileDialog() {
  const open = useUI((s) => s.profileOpen);
  if (!open) return null;
  return <ProfileDialog_ />;
}

function ProfileDialog_() {
  const setOpen = useUI((s) => s.setProfileOpen);
  const user = useSession((s) => s.user)!;
  const [draft, setDraft] = useProfileDraft(user);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!draft.name.trim()) return;
    setSaving(true);
    try {
      await updateProfile(draft);
      // 개인 템플릿의 멤버 표시도 새 프로필로
      const store = useTemplates.getState();
      Object.values(store.templates)
        .filter((t) => t.mode === 'personal')
        .forEach((t) => store.upsert(t));
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
