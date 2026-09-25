import { Code2, FileText, HardDrive, Lock, MousePointer2, Palette, Sparkles, UserPlus } from 'lucide-react';
import { createLocalProfile } from '../lib/profile';
import { toast } from '../store/toasts';
import { Button } from '../components/ui';
import { BRAND, BrandMark } from '../components/Brand';
import { ProfileForm, useProfileDraft } from '../components/ProfileForm';

const FEATURES = [
  { icon: <MousePointer2 size={18} />, title: '실시간 커서와 행동 표시', text: '누가 어디서 무엇을 하는지 커서 옆에 바로 보입니다.' },
  { icon: <Palette size={18} />, title: '디자인 캔버스', text: '도형·스티키 노트·펜으로 함께 그립니다.' },
  { icon: <Code2 size={18} />, title: '코드 에디터', text: '24개 언어, 실행과 미리보기까지.' },
  { icon: <FileText size={18} />, title: '문서 작성', text: '리치 텍스트 문서를 동시에 편집합니다.' },
  { icon: <Lock size={18} />, title: '비밀 노트', text: '브라우저에서 AES-256으로 암호화 — 서버도 읽을 수 없습니다.' },
];

const STEPS = [
  { icon: <HardDrive size={16} />, title: '개인 공간에서 시작', text: '가입 없이 바로. 작업은 이 브라우저에 자동 저장됩니다.' },
  { icon: <UserPlus size={16} />, title: '필요할 때 초대', text: '초대 링크를 만들면 그 템플릿만 협업 공간으로 전환됩니다.' },
];

/** 처음 방문한 사용자의 프로필 만들기 — 가입 없이 이 브라우저에만 저장 */
export function Onboarding() {
  const [draft, setDraft] = useProfileDraft();

  const submit = () => {
    if (!draft.name.trim()) return;
    const user = createLocalProfile(draft);
    toast.success(`환영합니다, ${user.name} 님!`, '첫 템플릿을 만들어 보세요.');
  };

  return (
    <div className="onboarding">
      <section className="onboarding-hero">
        <div className="onboarding-brand">
          <BrandMark size={36} />
          <span>
            {BRAND} <small className="brand-ko">마당</small>
          </span>
        </div>
        <p className="onboarding-tagline">내 방에서 시작해, 마당에서 함께.</p>
        <h1>
          디자인 · 코딩 · 문서를
          <br />한 화면에서 <em>함께</em>.
        </h1>
        <p>템플릿 하나에 필요한 기능만 골라 담고, 혼자 시작해서 필요할 때 팀원을 초대해 실시간으로 함께 작업하세요. 모든 변경은 자동 저장됩니다.</p>
        <ol className="onboarding-steps">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="onboarding-step-num">{i + 1}</span>
              <div>
                <b>
                  {s.icon} {s.title}
                </b>
                <span>{s.text}</span>
              </div>
            </li>
          ))}
        </ol>
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
            <Sparkles size={20} /> 시작하기
          </h2>
          <p className="muted">가입은 필요 없습니다. 나중에 함께 작업할 때 표시될 이름과 커서 색상을 정해 주세요. 언제든 바꿀 수 있습니다.</p>
          <ProfileForm draft={draft} onChange={setDraft} onSubmit={submit} />
          <Button variant="primary" size="lg" className="w-full" onClick={submit} disabled={!draft.name.trim()}>
            내 공간 만들기
          </Button>
        </div>
      </section>
    </div>
  );
}
