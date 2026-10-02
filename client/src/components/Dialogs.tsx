import { useState } from 'react';
import { Keyboard, MessageSquareHeart, UserRound } from 'lucide-react';
import { useUI } from '../store/ui';
import { useSession } from '../store/session';
import { useTemplates } from '../store/templates';
import { toast } from '../store/toasts';
import { api, errorMessage } from '../lib/api';
import { recentErrors } from '../lib/errorReport';
import { CLIENT_VERSION } from '@shared/protocol';
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
      ['F', '아트보드 추가'],
      ['Space + 드래그', '캔버스 이동'],
      [`${modKey} + 휠`, '확대 / 축소'],
      ['+ / -', '확대 / 축소'],
      [`${modKey} 0`, '100%로 보기'],
      ['Shift 1', '화면에 맞추기'],
      [`${modKey} Z / ${modKey} Shift Z`, '실행 취소 / 다시 실행 (내 변경만)'],
      [`${modKey} A`, '모두 선택'],
      [`${modKey} D · ${modKey} C/V`, '복제 · 복사/붙여넣기'],
      ['] / [', '한 단계 앞으로 / 뒤로'],
      ['← ↑ → ↓', '선택 도형 1px 이동 (Shift: 10px)'],
      ['Delete', '선택 삭제'],
    ],
  ],
  [
    '코드',
    [
      [`${modKey} Enter`, '실행 / 미리보기'],
      [`${modKey} F`, '찾기'],
    ],
  ],
  [
    '문서',
    [
      ['/', '블록 메뉴'],
      ['@', '사람 · 페이지 멘션'],
      [`${modKey} Shift ↑ / ↓`, '블록 위 / 아래로 이동'],
      [`${modKey} Enter`, '쪽 나누기'],
      [`${modKey} B / I / U`, '굵게 / 기울임 / 밑줄'],
      ['# + 공백', '제목 (마크다운 단축 입력)'],
      ['[] + 공백', '체크리스트'],
    ],
  ],
  [
    '탐색기',
    [
      ['Enter', '선택한 페이지 열기'],
      ['F2', '이름 바꾸기'],
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

/** 앱 안 "피드백 보내기" — 지금 화면 주소 · 창 크기 · 최근 오류를 함께 보낸다 */
export function FeedbackDialog() {
  const open = useUI((s) => s.feedbackOpen);
  if (!open) return null;
  return <FeedbackDialog_ />;
}

function FeedbackDialog_() {
  const setOpen = useUI((s) => s.setFeedbackOpen);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const send = async () => {
    const text = message.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await api('POST', '/feedback', {
        message: text,
        context: {
          page: `${window.location.pathname}${window.location.search}`,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          clientVersion: String(CLIENT_VERSION),
          recentErrors: recentErrors(),
        },
      });
      toast.success('피드백을 보냈습니다', '소중한 의견 고맙습니다!');
      setOpen(false);
    } catch (err) {
      toast.error('보내지 못했습니다', errorMessage(err));
    } finally {
      setSending(false);
    }
  };
  return (
    <Modal
      title="피드백 보내기"
      description="불편했던 점, 버그, 바라는 기능 무엇이든 좋습니다. 지금 보고 있는 화면 주소와 브라우저 정보가 함께 전달됩니다."
      icon={<MessageSquareHeart size={18} />}
      onClose={() => setOpen(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            취소
          </Button>
          <Button variant="primary" onClick={() => void send()} loading={sending} disabled={!message.trim()}>
            보내기
          </Button>
        </>
      }
    >
      <textarea
        className="input feedback-input"
        rows={6}
        maxLength={4000}
        autoFocus
        placeholder="예) 문서에 표를 넣으면 글자가 겹쳐 보여요."
        aria-label="피드백 내용"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send();
        }}
      />
      <p className="muted small">{modKey} Enter로 보내기</p>
    </Modal>
  );
}
