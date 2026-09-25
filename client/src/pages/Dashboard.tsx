import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Cloud, DoorOpen, HardDrive, History, Hourglass, LogIn, MoreHorizontal, Plus, Search, Settings, Trash2, UserPlus } from 'lucide-react';
import type { Feature, TemplateEntry, TemplateMode, TimelineEvent } from '@shared/types';
import { FEATURE_INFO, FEATURE_ORDER, PRESETS } from '@shared/presets';
import { AppShell } from '../components/AppShell';
import { Avatar, AvatarStack, Button, EmptyState, IconButton, Menu, Spinner, confirmDialog, promptDialog } from '../components/ui';
import { isPrivate, useTemplates, onTimelineEvent } from '../store/templates';
import { useSession } from '../store/session';
import { useUI } from '../store/ui';
import { toast } from '../store/toasts';
import { errorMessage } from '../lib/api';
import { leaveTemplate } from '../lib/templateOps';
import { TrashDialog, confirmTrash, trashTemplate } from '../components/DataProtection';
import { queryTimeline } from '../lib/timeline';
import { usePendingWatcher } from '../lib/pending';
import { relativeTime } from '../lib/time';
import { useTick } from '../hooks/useInterval';
import { cx } from '../lib/util';
import { CreateTemplateModal } from './CreateTemplateModal';

type SpaceFilter = 'all' | TemplateMode;
type FeatureFilter = 'all' | Feature;

const SPACE_TABS: { id: SpaceFilter; label: string; icon?: typeof Cloud }[] = [
  { id: 'all', label: '전체' },
  { id: 'personal', label: '개인 공간', icon: HardDrive },
  { id: 'shared', label: '협업 공간', icon: Cloud },
];

export function Dashboard() {
  const user = useSession((s) => s.user)!;
  const { templates, online, requests, loaded } = useTemplates();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [trashOpen, setTrashOpen] = useState(false);
  const [space, setSpace] = useState<SpaceFilter>('all');
  const [feature, setFeature] = useState<FeatureFilter>('all');
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const pending = usePendingWatcher();
  useTick(30_000);

  useEffect(() => {
    if (params.get('new') === '1') {
      setCreating(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const all = Object.values(templates);
  const counts = { all: all.length, personal: all.filter(isPrivate).length, shared: all.filter((t) => !isPrivate(t)).length };
  const list = useMemo(
    () =>
      Object.values(templates)
        .filter((t) => space === 'all' || (space === 'personal') === isPrivate(t))
        .filter((t) => feature === 'all' || t.features.includes(feature))
        .filter((t) => !q.trim() || `${t.name} ${t.description}`.toLowerCase().includes(q.trim().toLowerCase()))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [templates, space, feature, q],
  );

  const onlineCount = new Set(Object.values(online).flat().filter((id) => id !== user.id)).size;
  const requestTotal = Object.values(requests).reduce((a, b) => a + b, 0);
  const hour = new Date().getHours();
  const greeting = hour < 6 ? '늦은 밤이에요' : hour < 12 ? '좋은 아침이에요' : hour < 18 ? '좋은 오후예요' : '좋은 저녁이에요';

  const joinByLink = async () => {
    const input = await promptDialog({
      title: '초대 링크로 참여',
      label: '받은 초대 링크',
      placeholder: 'https://…/join/…',
      confirmText: '열기',
    });
    if (!input) return;
    const token = input.trim().split('/join/').pop()!.split(/[?#]/)[0].trim();
    if (token) navigate(`/join/${token}`);
  };

  return (
    <AppShell>
      <div className="page-scroll">
        <div className="page page-wide dashboard">
          <header className="dash-header">
            <div>
              <h1>
                {greeting}, {user.name} 님 <span aria-hidden>{user.avatar}</span>
              </h1>
              <p className="muted">
                개인 공간 {counts.personal}개 · 협업 공간 {counts.shared}개
                {onlineCount > 0 && (
                  <>
                    {' · '}
                    <span className="live-dot" /> 지금 {onlineCount}명이 작업 중
                  </>
                )}
                {requestTotal > 0 && <span className="request-pill">참여 요청 {requestTotal}건</span>}
              </p>
            </div>
            <div className="dash-actions">
              <Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => setTrashOpen(true)}>
                휴지통
              </Button>
              <Button icon={<LogIn size={15} />} onClick={joinByLink}>
                초대 링크로 참여
              </Button>
              <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
                새 템플릿
              </Button>
            </div>
          </header>

          {pending.length > 0 && (
            <div className="pending-joins">
              {pending.map((p) => (
                <div key={p.templateId} className="pending-join">
                  <Hourglass size={16} className="pulse" />
                  <span>
                    {p.emoji} <b>{p.name}</b> — 참여 승인을 기다리는 중 ({relativeTime(p.requestedAt)} 요청)
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="dash-grid">
            <section>
              <div className="dash-toolbar">
                <div className="segmented" role="tablist" aria-label="공간">
                  {SPACE_TABS.map(({ id, label, icon: Icon }) => (
                    <button key={id} role="tab" aria-selected={space === id} className={cx(space === id && 'is-active')} onClick={() => setSpace(id)}>
                      {Icon && <Icon size={14} />} {label} <span className="seg-count">{counts[id]}</span>
                    </button>
                  ))}
                </div>
                <div className="segmented segmented-quiet" role="tablist" aria-label="기능">
                  {(['all', ...FEATURE_ORDER] as FeatureFilter[]).map((f) => (
                    <button key={f} role="tab" aria-selected={feature === f} className={cx(feature === f && 'is-active')} onClick={() => setFeature(f)}>
                      {f === 'all' ? '모든 기능' : `${FEATURE_INFO[f].emoji} ${FEATURE_INFO[f].name}`}
                    </button>
                  ))}
                </div>
                <label className="search-input">
                  <Search size={15} />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="템플릿 검색" />
                </label>
              </div>

              {!loaded ? (
                <div className="center-fill pad">
                  <Spinner size={24} />
                </div>
              ) : all.length === 0 ? (
                <FirstRun onCreate={() => setCreating(true)} />
              ) : list.length === 0 ? (
                <EmptyState title="조건에 맞는 템플릿이 없습니다">필터나 검색어를 바꿔 보세요.</EmptyState>
              ) : (
                <div className="template-grid">
                  {list.map((t) => (
                    <TemplateCard key={t.id} template={t} onlineIds={online[t.id] ?? []} requestCount={requests[t.id] ?? 0} />
                  ))}
                  <button className="template-card template-card-new" onClick={() => setCreating(true)}>
                    <Plus size={22} />
                    <span>새 템플릿</span>
                  </button>
                </div>
              )}
            </section>
            <aside className="dash-side">
              <RecentActivity />
              <SpacesGuide />
            </aside>
          </div>
        </div>
      </div>
      {trashOpen && <TrashDialog onClose={() => setTrashOpen(false)} />}
      {creating && (
        <CreateTemplateModal
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            setCreating(false);
            navigate(`/t/${t.id}`);
          }}
        />
      )}
    </AppShell>
  );
}

function FirstRun({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="first-run">
      <h2>첫 템플릿을 만들어 보세요</h2>
      <p className="muted">디자인·코딩·문서 중 필요한 기능을 골라 개인 공간에서 시작하고, 필요할 때 팀원을 초대하세요.</p>
      <div className="first-run-presets">
        {PRESETS.slice(1, 5).map((p) => (
          <button key={p.id} className="preset" onClick={onCreate}>
            <span className="preset-emoji">{p.emoji}</span>
            <span className="preset-text">
              <b>{p.name}</b>
              <span>{p.description}</span>
            </span>
          </button>
        ))}
      </div>
      <Button variant="primary" icon={<Plus size={15} />} onClick={onCreate}>
        템플릿 만들기
      </Button>
    </div>
  );
}

function TemplateCard({ template: t, onlineIds, requestCount }: { template: TemplateEntry; onlineIds: string[]; requestCount: number }) {
  const navigate = useNavigate();
  const user = useSession((s) => s.user)!;
  const setShareOpen = useUI((s) => s.setShareOpen);
  const onlineMembers = t.members.filter((m) => onlineIds.includes(m.user.id) && m.user.id !== user.id).map((m) => m.user);
  const personal = isPrivate(t);
  const local = t.mode === 'personal';

  const remove = async () => {
    if (await confirmTrash(t)) await trashTemplate(t);
  };

  const leave = async () => {
    const ok = await confirmDialog({ title: '템플릿에서 나갈까요?', message: '다시 참여하려면 새 초대 링크가 필요합니다.', confirmText: '나가기', danger: true });
    if (!ok) return;
    try {
      await leaveTemplate(t);
      toast.info('템플릿에서 나왔습니다', t.name);
    } catch (err) {
      toast.error('실패했습니다', errorMessage(err));
    }
  };

  const invite = () => {
    navigate(`/t/${t.id}`);
    setShareOpen(true);
  };

  return (
    <article
      className={cx('template-card', `is-${personal ? 'personal' : 'shared'}`)}
      onClick={() => navigate(`/t/${t.id}`)}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/t/${t.id}`)}
    >
      <div className="template-card-top">
        <span className="template-emoji">{t.emoji}</span>
        <div className="template-features">
          {t.features.map((f) => (
            <span key={f} className={`feature-pill feature-${f}`}>
              {FEATURE_INFO[f].emoji} {FEATURE_INFO[f].name}
            </span>
          ))}
        </div>
        <span onClick={(e) => e.stopPropagation()}>
          <Menu
            align="end"
            items={[
              { label: '열기', icon: <ArrowRight size={15} />, onSelect: () => navigate(`/t/${t.id}`) },
              ...(t.myRole !== 'viewer'
                ? [{ label: personal ? '팀원 초대 (협업 공간으로 전환)' : '팀원 초대', icon: <UserPlus size={15} />, onSelect: invite }]
                : []),
              { label: '설정', icon: <Settings size={15} />, onSelect: () => navigate(`/t/${t.id}/settings`) },
              { divider: true, label: '' },
              t.myRole === 'owner'
                ? { label: '템플릿 삭제', icon: <Trash2 size={15} />, danger: true, onSelect: remove }
                : { label: '템플릿 나가기', icon: <DoorOpen size={15} />, danger: true, onSelect: leave },
            ]}
            trigger={({ toggle, ref }) => (
              <IconButton ref={ref} label="더 보기" size="sm" onClick={toggle}>
                <MoreHorizontal size={16} />
              </IconButton>
            )}
          />
        </span>
      </div>
      <h3>{t.name}</h3>
      <p className="template-desc">{t.description || <span className="muted">설명 없음</span>}</p>
      <div className="template-card-bottom">
        {personal ? (
          <span
            className="space-chip is-personal"
            data-tip={local ? '아직 이 기기에만 있습니다 · 인터넷에 연결되면 자동으로 백업됩니다' : '나만 볼 수 있는 개인 공간 · 클라우드에 자동 백업'}
          >
            <HardDrive size={12} /> 개인{local && ' · 백업 대기'}
          </span>
        ) : (
          <span className="space-chip is-shared" data-tip="클라우드에 저장되는 협업 공간입니다">
            <Cloud size={12} /> 협업
          </span>
        )}
        {requestCount > 0 ? (
          <span className="request-pill" data-tip="템플릿을 열어 승인하거나 거절하세요">
            참여 요청 {requestCount}
          </span>
        ) : onlineMembers.length > 0 ? (
          <span className="online-pill" data-tip={onlineMembers.map((u) => u.name).join(', ')}>
            <span className="live-dot" /> {onlineMembers.length}명 작업 중
          </span>
        ) : (
          <span className="muted small">{relativeTime(t.updatedAt)} 수정</span>
        )}
        {!personal && requestCount === 0 && onlineMembers.length === 0 && <AvatarStack users={t.members.map((m) => m.user)} max={3} size={22} />}
        {!personal && <span className={`role-chip role-${t.myRole}`}>{t.myRole === 'owner' ? '소유자' : t.myRole === 'editor' ? '편집자' : '뷰어'}</span>}
      </div>
    </article>
  );
}

function RecentActivity() {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const loaded = useTemplates((s) => s.loaded);
  useTick(30_000);
  useEffect(() => {
    if (!loaded) return;
    queryTimeline(undefined, { limit: 12 })
      .then((r) => setEvents(r.events))
      .catch(() => setEvents([]));
    return onTimelineEvent(({ event }) => setEvents((prev) => (prev ? [event, ...prev.filter((e) => e.id !== event.id)].slice(0, 12) : prev)));
  }, [loaded]);
  return (
    <section className="dash-activity">
      <div className="dash-activity-head">
        <h2>
          <History size={16} /> 최근 활동
        </h2>
        <Link to="/timeline" className="link small">
          전체 보기 <ArrowRight size={13} />
        </Link>
      </div>
      {!events ? (
        <Spinner />
      ) : events.length === 0 ? (
        <p className="muted small">아직 활동이 없습니다.</p>
      ) : (
        <ul className="mini-timeline">
          {events.map((e) => (
            <li key={e.id}>
              <Avatar user={e.user} size={24} />
              <div>
                <span>
                  <b>{e.user.name}</b> {e.text}
                  {e.count > 1 && <span className="count-chip">×{e.count}</span>}
                </span>
                <span className="muted small">
                  <Link to={`/t/${e.templateId}`} className="link-quiet">
                    {e.templateName}
                  </Link>{' '}
                  · {relativeTime(e.at)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** 개인 공간과 협업 공간의 차이 안내 */
function SpacesGuide() {
  return (
    <section className="spaces-guide">
      <h2>공간 안내</h2>
      <div className="spaces-guide-item">
        <span className="space-chip is-personal">
          <HardDrive size={12} /> 개인
        </span>
        <span className="muted small">나만 볼 수 있음 · 클라우드에 자동 백업 · 여러 기기에서 이어서 작업</span>
      </div>
      <div className="spaces-guide-item">
        <span className="space-chip is-shared">
          <Cloud size={12} /> 협업
        </span>
        <span className="muted small">초대하면 전환 · 초대한 멤버만 · 실시간 커서·채팅·멤버 관리</span>
      </div>
    </section>
  );
}
