import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Filter, History, Search, Star } from 'lucide-react';
import type { ActivityModule, PublicUser, TimelineEvent } from '@shared/types';
import { MODULE_LABEL } from '@shared/activity';
import { errorMessage } from '../lib/api';
import { queryTimeline } from '../lib/timeline';
import { dayKey, dayLabel, formatTime, relativeTime } from '../lib/time';
import { onTimelineEvent } from '../store/templates';
import { useTick } from '../hooks/useInterval';
import { Avatar, Button, EmptyState, Spinner } from './ui';
import { cx } from '../lib/util';

const MODULE_ICON: Record<ActivityModule, string> = {
  presence: '🟢',
  template: '🗂️',
  member: '👥',
  design: '🎨',
  code: '💻',
  docs: '📝',
  notes: '🔒',
};

interface Props {
  /** 지정하면 해당 템플릿의 기록만 */
  templateId?: string;
  /** 필터에 표시할 사용자 목록 */
  people: PublicUser[];
  /** 템플릿 이름 표시 여부 (전체 타임라인) */
  showTemplate?: boolean;
}

const PAGE = 60;

/**
 * 누가 언제 무엇을 했는지 기록하는 타임라인.
 * 실시간으로 새 활동이 위에 추가되며, 반복 편집은 ×N으로 합쳐진다.
 */
export function TimelineView({ templateId, people, showTemplate }: Props) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [userId, setUserId] = useState('');
  const [module, setModule] = useState<ActivityModule | ''>('');
  const [q, setQ] = useState('');
  const [importantOnly, setImportantOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const navigate = useNavigate();
  useTick(30_000);

  const query = useCallback(
    (before?: number) => queryTimeline(templateId, { limit: PAGE, userId: userId || undefined, module: module || undefined, q, before }),
    [templateId, userId, module, q],
  );

  // 필터가 바뀌면 다시 불러오기 (검색어는 살짝 늦춰서)
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      query()
        .then((res) => {
          if (cancelled) return;
          setEvents(res.events);
          setHasMore(res.hasMore);
          setError(null);
        })
        .catch((err) => !cancelled && setError(errorMessage(err)));
    }, q ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, q]);

  // 실시간 추가
  const filtersRef = useRef({ templateId, userId, module, q });
  filtersRef.current = { templateId, userId, module, q };
  useEffect(
    () =>
      onTimelineEvent(({ event }) => {
        const f = filtersRef.current;
        if (f.templateId && event.templateId !== f.templateId) return;
        if (f.userId && event.user.id !== f.userId) return;
        if (f.module && event.module !== f.module) return;
        if (f.q && !`${event.user.name} ${event.text} ${event.templateName}`.toLowerCase().includes(f.q.toLowerCase())) return;
        setEvents((prev) => (prev ? [event, ...prev.filter((e) => e.id !== event.id)] : prev));
        setFresh((s) => new Set(s).add(event.id));
        setTimeout(() => setFresh((s) => {
          const n = new Set(s);
          n.delete(event.id);
          return n;
        }), 2500);
      }),
    [],
  );

  const loadMore = async () => {
    if (!events?.length) return;
    setLoadingMore(true);
    try {
      const res = await query(events[events.length - 1].at);
      setEvents((prev) => [...(prev ?? []), ...res.events.filter((e) => !prev?.some((p) => p.id === e.id))]);
      setHasMore(res.hasMore);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
  };

  const visible = useMemo(() => (events ?? []).filter((e) => !importantOnly || e.important), [events, importantOnly]);

  const open = (e: TimelineEvent) => {
    const m = e.module;
    if ((m === 'code' || m === 'docs' || m === 'design' || m === 'notes') && e.targetId && !e.type.endsWith('.delete')) {
      navigate(`/t/${e.templateId}/${m}/${e.targetId}`);
    } else if (m === 'member') navigate(`/t/${e.templateId}/members`);
    else navigate(`/t/${e.templateId}`);
  };

  let lastDay = '';
  return (
    <div className="timeline">
      <div className="timeline-filters">
        <label className="search-input">
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="활동 검색 (이름, 파일명…)" />
        </label>
        <label className="select-wrap">
          <Filter size={14} />
          <select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="사용자 필터">
            <option value="">모든 사람</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.avatar} {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="select-wrap">
          <select value={module} onChange={(e) => setModule(e.target.value as ActivityModule | '')} aria-label="영역 필터">
            <option value="">모든 영역</option>
            {(Object.keys(MODULE_LABEL) as ActivityModule[]).map((m) => (
              <option key={m} value={m}>
                {MODULE_ICON[m]} {MODULE_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <button className={cx('chip-toggle', importantOnly && 'is-on')} onClick={() => setImportantOnly((v) => !v)} aria-pressed={importantOnly}>
          <Star size={13} /> 중요한 활동만
        </button>
      </div>

      <div className="timeline-layout">
        <div className="timeline-feed">
          {error && <div className="alert alert-danger">{error}</div>}
          {!events ? (
            <div className="center-fill pad">
              <Spinner size={22} />
            </div>
          ) : visible.length === 0 ? (
            <EmptyState icon={<History size={30} />} title="기록된 활동이 없습니다">
              필터를 바꾸거나 템플릿에서 작업을 시작해 보세요.
            </EmptyState>
          ) : (
            <ol className="timeline-list">
              {visible.map((e) => {
                const day = dayKey(e.at);
                const header = day !== lastDay ? <li className="timeline-day" key={`d-${day}`}>{dayLabel(e.at)}</li> : null;
                lastDay = day;
                return [
                  header,
                  <li key={e.id} className={cx('timeline-item', e.important && 'is-important', fresh.has(e.id) && 'is-fresh')}>
                    <span className="timeline-time" title={new Date(e.at).toLocaleString('ko-KR')}>
                      {formatTime(e.at)}
                    </span>
                    <span className="timeline-dot" style={{ ['--user-color' as string]: e.user.color }}>
                      <Avatar user={e.user} size={30} />
                    </span>
                    <button className="timeline-body" onClick={() => open(e)}>
                      <span className="timeline-text">
                        <b>{e.user.name}</b> {e.text}
                        {e.count > 1 && <span className="count-chip" data-tip={`5분 안에 ${e.count}번 반복된 활동을 합쳤습니다`}>×{e.count}</span>}
                      </span>
                      <span className="timeline-meta">
                        <span className={`module-chip module-${e.module}`}>
                          {MODULE_ICON[e.module]} {MODULE_LABEL[e.module]}
                        </span>
                        {showTemplate && <span className="muted">{e.templateName}</span>}
                        <span className="muted">{relativeTime(e.at)}</span>
                      </span>
                    </button>
                  </li>,
                ];
              })}
            </ol>
          )}
          {hasMore && (
            <div className="center-fill pad">
              <Button onClick={loadMore} loading={loadingMore}>
                이전 기록 더 보기
              </Button>
            </div>
          )}
        </div>
        {events && events.length > 0 && <ActivitySummary events={events} onPick={setUserId} selected={userId} />}
      </div>
    </div>
  );
}

/**
 * 참여자별 활동량 (불러온 기록 기준).
 * 크기 비교가 목적이므로 한 가지 색(강조색)의 가로 막대 + 막대 끝 값 라벨.
 * 사람 구분은 아바타와 이름(텍스트)이 담당한다.
 */
function ActivitySummary({ events, onPick, selected }: { events: TimelineEvent[]; onPick: (id: string) => void; selected: string }) {
  const rows = useMemo(() => {
    const map = new Map<string, { user: PublicUser; total: number; byModule: Map<ActivityModule, number> }>();
    for (const e of events) {
      if (e.module === 'presence') continue;
      const row = map.get(e.user.id) ?? { user: e.user, total: 0, byModule: new Map() };
      row.total += e.count;
      row.byModule.set(e.module, (row.byModule.get(e.module) ?? 0) + e.count);
      map.set(e.user.id, row);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 8);
  }, [events]);
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.total));
  return (
    <aside className="activity-summary" aria-label="참여자별 활동량">
      <h3>참여자별 활동량</h3>
      <p className="muted small">불러온 기록 기준 · 막대를 누르면 해당 사람만 보기</p>
      <ul>
        {rows.map((r) => {
          const tip = `${r.user.name} · 총 ${r.total}회\n${Array.from(r.byModule.entries())
            .map(([m, n]) => `${MODULE_LABEL[m]} ${n}`)
            .join(' · ')}`;
          return (
            <li key={r.user.id}>
              <button
                className={cx('bar-row', selected === r.user.id && 'is-selected')}
                onClick={() => onPick(selected === r.user.id ? '' : r.user.id)}
                data-tip={tip}
                data-tip-side="left"
              >
                <Avatar user={r.user} size={22} tooltip={false} />
                <span className="bar-name">{r.user.name}</span>
                <span className="bar-track">
                  <span className="bar-fill" style={{ width: `${Math.max(4, (r.total / max) * 100)}%` }} />
                </span>
                <span className="bar-value">{r.total}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
