import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AppShell } from '../components/AppShell';
import { BRAND, BrandMark } from '../components/Brand';
import { isUrgent } from '../components/Notices';
import { LegalLinks } from './Legal';
import { deployLabel, markRead, useNotices } from '../lib/notices';
import { noticeKey } from '@shared/notices';
import { useSession } from '../store/session';
import { cx } from '../lib/util';
import { Spinner } from '../components/ui';
import './notices.css';

/*
 * 공지사항 (/notices, /notices/:id) — 로그인하지 않아도 볼 수 있다
 *  - 로그인했으면 앱 화면(상단 바 · 레일) 안에, 아니면 약관 페이지와 같은 단독 화면
 *  - 글을 고르면 그 줄 아래에 본문이 펼쳐진다. 이 페이지를 열면 보이는 공지는 모두 읽은 것으로 본다
 */

function Frame({ children }: { children: ReactNode }) {
  const authed = useSession((s) => s.status === 'authed');
  if (authed)
    return (
      <AppShell>
        <div className="page-scroll">{children}</div>
      </AppShell>
    );
  return (
    <div className="legal-page">
      <header className="legal-header">
        <Link to="/explore" className="legal-brand">
          <BrandMark size={26} /> {BRAND}
        </Link>
        <Link to="/login" className="legal-back">
          <ArrowLeft size={15} /> 로그인 화면으로
        </Link>
      </header>
      {children}
      <LegalLinks />
    </div>
  );
}

export function NoticesPage() {
  const { id } = useParams();
  const s = useNotices();
  const openRef = useRef<HTMLElement>(null);
  const open = s.list?.find((n) => n.id === id);

  useEffect(() => {
    const prev = document.title;
    document.title = `${open ? open.title : '공지사항'} · ${BRAND}`;
    return () => void (document.title = prev);
  }, [open]);
  useEffect(() => {
    if (s.list?.length) markRead(s.list.map(noticeKey));
  }, [s.list]);
  useEffect(() => {
    if (open) openRef.current?.scrollIntoView({ block: 'start' });
  }, [open]);

  return (
    <Frame>
      <main className="notices-page">
        <h1>공지사항</h1>
        <p className="notices-lead">{BRAND}의 새 기능, 점검, 정책 변경을 알려 드려요.</p>
        {s.list === null &&
          (s.failed ? <p className="notices-empty">공지를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</p> : <div className="notices-empty"><Spinner /></div>)}
        {s.list?.length === 0 && <p className="notices-empty">아직 공지가 없습니다.</p>}
        {id && s.list && !open && <p className="notices-empty">찾는 공지가 없습니다. 아래 목록에서 골라 주세요.</p>}
        <ol className="notices-list">
          {s.list?.map((n) => {
            const isOpen = n.id === id;
            return (
              <li key={n.id} className={cx('notice-row', isOpen && 'is-open')} ref={isOpen ? (openRef as React.Ref<HTMLLIElement>) : undefined}>
                <time dateTime={n.date}>{n.date.replaceAll('-', '.')}</time>
                <div>
                  <Link className="notice-row-title" to={isOpen ? '/notices' : `/notices/${n.id}`} aria-expanded={isOpen}>
                    {n.title}
                    <span className={cx('notice-tag', isUrgent(n) && 'is-urgent')}>{n.tag}</span>
                    {deployLabel(n) && <span className={cx('notice-tag', n.deployedAt ? 'is-done' : 'is-urgent')}>{deployLabel(n)}</span>}
                  </Link>
                  {isOpen ? (
                    <article className="notice-body" dangerouslySetInnerHTML={{ __html: n.html }} />
                  ) : (
                    <p className="notice-row-summary">{n.summary}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </main>
    </Frame>
  );
}
