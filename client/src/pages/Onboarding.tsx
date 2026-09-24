import { useState } from 'react';
import { Code2, FileText, Lock, MousePointer2, Palette, Sparkles } from 'lucide-react';
import type { PublicUser } from '@shared/types';
import { api, errorMessage, setToken } from '../lib/api';
import { useSession } from '../store/session';
import { toast } from '../store/toasts';
import { Button } from '../components/ui';
import { ProfileForm, useProfileDraft } from '../components/ProfileForm';

const FEATURES = [
  { icon: <MousePointer2 size={18} />, title: '실시간 커서와 행동 표시', text: '누가 어디서 무엇을 하는지 커서 옆에 바로 보입니다.' },
  { icon: <Palette size={18} />, title: '디자인 캔버스', text: '도형·스티키 노트·펜으로 함께 그립니다.' },
  { icon: <Code2 size={18} />, title: '코드 에디터', text: '24개 언어, 실행과 미리보기까지.' },
  { icon: <FileText size={18} />, title: '문서 작성', text: '리치 텍스트 문서를 동시에 편집합니다.' },
  { icon: <Lock size={18} />, title: '비밀 노트', text: '비밀번호로 잠그고 AES-256으로 암호화합니다.' },
];

/** 처음 방문한 사용자의 프로필 만들기 (별도 가입 없이 이 브라우저에 토큰 저장) */
export function Onboarding() {
  const [draft, setDraft] = useProfileDraft();
  const [saving, setSaving] = useState(false);
  const setUser = useSession((s) => s.setUser);
  const joining = location.pathname.startsWith('/join/');

  const submit = async () => {
    if (!draft.name.trim() || saving) return;
    setSaving(true);
    try {
      const res = await api<{ user: PublicUser; token: string }>('POST', '/users', draft);
      setToken(res.token);
      setUser(res.user);
      toast.success(`환영합니다, ${res.user.name} 님!`, joining ? '초대받은 템플릿을 확인해 보세요.' : '첫 템플릿을 만들어 보세요.');
    } catch (err) {
      toast.error('프로필을 만들지 못했습니다', errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="onboarding">
      <section className="onboarding-hero">
        <div className="onboarding-brand">
          <svg viewBox="0 0 32 32" width="36" height="36" aria-hidden>
            <rect width="32" height="32" rx="8" fill="var(--accent)" />
            <path d="M9 8v13a3 3 0 0 0 3 3h11" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
            <circle cx="21" cy="11" r="3.5" fill="#ffd166" />
          </svg>
          <span>LiveTemplate</span>
        </div>
        <h1>
          디자인 · 코딩 · 문서를
          <br />한 화면에서 <em>함께</em>.
        </h1>
        <p>템플릿 하나에 필요한 기능만 골라 담고, 팀원들과 실시간으로 동시에 작업하세요. 모든 변경은 자동 저장됩니다.</p>
        <ul className="onboarding-features">
          {FEATURES.map((f) => (
            <li key={f.title}>
              <span className="onboarding-feature-icon">{f.icon}</span>
              <div>
                <b>{f.title}</b>
                <span>{f.text}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="onboarding-card">
        <div className="onboarding-card-inner">
          <h2>
            <Sparkles size={20} /> {joining ? '초대를 받으셨네요!' : '시작하기'}
          </h2>
          <p className="muted">협업할 때 표시될 이름과 커서 색상을 정해 주세요. 나중에 언제든 바꿀 수 있습니다.</p>
          <ProfileForm draft={draft} onChange={setDraft} onSubmit={submit} />
          <Button variant="primary" size="lg" className="w-full" onClick={submit} loading={saving} disabled={!draft.name.trim()}>
            {joining ? '프로필 만들고 참여하기' : '프로필 만들고 시작하기'}
          </Button>
        </div>
      </section>
    </div>
  );
}
