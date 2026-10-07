import { Link, useNavigate } from 'react-router-dom';
import { Bell, X } from 'lucide-react';
import type { Notice } from '@shared/notices';
import { bannerOf, hideBanner, markRead, todayKST, useNotices } from '../lib/notices';
import { IconButton, Popover } from './ui';
import { cx } from '../lib/util';
import './notices.css';

/*
 * 공지 알림 두 가지 (글은 /notices 페이지)
 *  - NoticeBell: 상단 종 아이콘. 안 읽은 공지가 있으면 주황 점, 누르면 최근 공지
 *  - NoticeBanner: 홈 위쪽 한 줄 (pin 공지만). 닫으면 이 기기에서는 다시 안 뜬다
 * 첫 화면 크기를 늘리지 않도록 이 파일은 LazyNotices 로 따로 불러온다 (어차피 공지 JSON을 받은 뒤에야 보인다)
 */

/** 오늘 · 어제 · 10월 6일 */
export function noticeDay(date: string) {
  const today = todayKST();
  if (date === today) return '오늘';
  const y = new Date(Date.parse(today) - 86400_000).toISOString().slice(0, 10);
  if (date === y) return '어제';
  const [, m, d] = date.split('-').map(Number);
  return `${m}월 ${d}일`;
}

export const isUrgent = (n: Notice) => n.tag === '중요' || n.tag === '점검';

export function NoticeBell() {
  const s = useNotices();
  const navigate = useNavigate();
  const recent = (s.list ?? []).slice(0, 5);
  const unread = recent.some((n) => !s.read.has(n.id));
  return (
    <Popover
      align="end"
      width={360}
      className="notice-pop"
      label="새 소식"
      trigger={({ toggle, ref, open }) => (
        <span className="badge-anchor">
          <IconButton ref={ref} label={unread ? '새 소식 (읽지 않은 공지 있음)' : '새 소식'} active={open} onClick={toggle} aria-expanded={open}>
            <Bell size={17} />
          </IconButton>
          {unread && <span className="notice-dot" aria-hidden />}
        </span>
      )}
    >
      {(close) => (
        <>
          <div className="notice-pop-head">새 소식</div>
          {s.list === null && <p className="notice-pop-empty">{s.failed ? '공지를 불러오지 못했습니다' : '불러오는 중…'}</p>}
          {s.list?.length === 0 && <p className="notice-pop-empty">아직 공지가 없습니다</p>}
          {recent.map((n) => (
            <button
              key={n.id}
              className="notice-item"
              onClick={() => {
                markRead([n.id]);
                close();
                navigate(`/notices/${n.id}`);
              }}
            >
              <span className={cx('notice-item-dot', s.read.has(n.id) && 'is-read')} aria-label={s.read.has(n.id) ? undefined : '읽지 않음'} />
              <span className="notice-item-text">
                <b>{n.title}</b>
                <span>{n.summary}</span>
                <small>{noticeDay(n.date)}</small>
              </span>
            </button>
          ))}
          <Link className="notice-pop-all" to="/notices" onClick={close}>
            공지사항 전체 보기
          </Link>
        </>
      )}
    </Popover>
  );
}

export function NoticeBanner() {
  const s = useNotices();
  const n = bannerOf(s);
  if (!n) return null;
  return (
    <div className="notice-banner" role="status">
      <span className="notice-banner-dot" aria-hidden />
      <b>{n.title}</b>
      <span className="notice-banner-summary">{n.summary}</span>
      <Link className="notice-banner-more" to={`/notices/${n.id}`} onClick={() => markRead([n.id])}>
        자세히
      </Link>
      <IconButton className="notice-banner-close" label="이 공지 닫기" onClick={() => hideBanner(n.id)}>
        <X size={15} />
      </IconButton>
    </div>
  );
}
