import { Link } from 'react-router-dom';
import { FEATURE_INFO } from '@shared/presets';
import { DEMO_PRESETS, demoPath } from '../lib/demo';
import { useSession } from '../store/session';
import { BRAND, BrandMark } from '../components/Brand';
import { LegalLinks } from './Legal';

/**
 * 가입 전 둘러보기 — 예시 템플릿 목록.
 * 누르면 그 예시를 실제 편집 화면에서 읽기 전용으로 연다 (코드 실행 · 미리보기는 그대로 된다)
 */
export function ExplorePage() {
  const authed = useSession((s) => s.status === 'authed');
  return (
    <main className="explore-page">
      <header className="explore-head">
        <Link to={authed ? '/' : '/login'} className="onboarding-brand" aria-label={`${BRAND} 처음 화면`}>
          <BrandMark size={30} />
          <span>{BRAND}</span>
        </Link>
        <div className="explore-actions">
          {authed ? (
            <Link className="btn btn-secondary btn-sm" to="/">
              내 대시보드
            </Link>
          ) : (
            <Link className="btn btn-primary btn-sm" to="/login">
              로그인 · 가입
            </Link>
          )}
        </div>
      </header>
      <h1>예시 템플릿 체험하기</h1>
      <p className="muted">가입하지 않아도 예시를 열어 직접 고쳐 볼 수 있습니다. 문서를 쓰고, 보드에 그리고, 코드를 실행해 보세요. 바뀐 내용은 저장되지 않으니, 내 작업을 남기려면 가입해 주세요.</p>
      <div className="explore-grid">
        {DEMO_PRESETS.map((p) => (
          <Link key={p.id} className="explore-card" to={demoPath(p.id)}>
            <span className="explore-card-title">
              <span className="explore-card-emoji" aria-hidden>
                {p.emoji}
              </span>
              <b>{p.name}</b>
            </span>
            <span className="muted small">{p.description}</span>
            <span className="explore-card-features">
              {p.features.map((f) => (
                <span key={f} className={`feature-pill feature-${f}`}>
                  {FEATURE_INFO[f].emoji} {FEATURE_INFO[f].name}
                </span>
              ))}
            </span>
          </Link>
        ))}
      </div>
      <LegalLinks className="legal-links auth-legal" />
    </main>
  );
}
