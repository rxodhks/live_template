import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Cloud, DoorOpen, HardDrive, History, Hourglass, LogIn, MoreHorizontal, Plus, Search, Settings, Trash2, UserPlus } from 'lucide-react';
import type { Feature, TemplateEntry, TemplateMode, TimelineEvent } from '@shared/types';
import { FEATURE_INFO, FEATURE_ORDER, PRESETS } from '@shared/presets';
import { AppShell } from '../components/AppShell';
import { NoticeBanner } from '../components/LazyNotices';
import { Avatar, AvatarStack, Button, EmptyState, IconButton, Menu, Spinner, confirmDialog, promptDialog } from '../components/ui';
import { isPrivate, useTemplates, onTimelineEvent } from '../store/templates';
import { useSession } from '../store/session';
import { useUI } from '../store/ui';
import { toast } from '../store/toasts';
import { errorMessage } from '../lib/api';
import { leaveTemplate } from '../lib/templateOps';
import { TrashDialog, confirmTrash, trashTemplate } from '../components/DataProtection';
import { isPresenceEvent, queryTimeline } from '../lib/timeline';
import { usePendingWatcher } from '../lib/pending';
import { relativeTime } from '../lib/time';
import { useTick } from '../hooks/useInterval';
import { cx } from '../lib/util';
import { CreateTemplateModal } from './CreateTemplateModal';
import { activityText, lazyText, t } from '../i18n';

type SpaceFilter = 'all' | TemplateMode;
type FeatureFilter = 'all' | Feature;

const SPACE_TABS: { id: SpaceFilter; label: string; icon?: typeof Cloud }[] = lazyText(() => [
  { id: 'all', label: t('전체') },
  { id: 'personal', label: t('개인 공간'), icon: HardDrive },
  { id: 'shared', label: t('협업 공간'), icon: Cloud },
], []);

export function Dashboard() {
  const user = useSession((s) => s.user)!;
  const { templates, online, requests, loaded } = useTemplates();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(params.get('new') === '1');
  /** 첫 화면의 프리셋 카드로 열었으면 그 프리셋을 미리 골라 둔다 */
  const [startPreset, setStartPreset] = useState<string>();
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
  const counts = { all: all.length, personal: all.filter(isPrivate).length, shared: all.filter((tpl) => !isPrivate(tpl)).length };
  const list = useMemo(
    () =>
      Object.values(templates)
        .filter((tpl) => space === 'all' || (space === 'personal') === isPrivate(tpl))
        .filter((tpl) => feature === 'all' || tpl.features.includes(feature))
        .filter((tpl) => !q.trim() || `${tpl.name} ${tpl.description}`.toLowerCase().includes(q.trim().toLowerCase()))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [templates, space, feature, q],
  );

  const onlineCount = new Set(Object.values(online).flat().filter((id) => id !== user.id)).size;
  const requestTotal = Object.values(requests).reduce((a, b) => a + b, 0);
  const hour = new Date().getHours();
  const greeting = hour < 6 ? t('늦은 밤이에요') : hour < 12 ? t('좋은 아침이에요') : hour < 18 ? t('좋은 오후예요') : t('좋은 저녁이에요');

  // 복원한 템플릿이 필터에 가려지지 않게 풀고, 카드가 보이도록 스크롤한다
  const showRestored = (tpl: TemplateEntry) => {
    setSpace('all');
    setFeature('all');
    setQ('');
    requestAnimationFrame(() => document.querySelector(`[data-template-id="${tpl.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };

  const joinByLink = async () => {
    const input = await promptDialog({
      title: t('초대 링크로 참여'),
      label: t('받은 초대 링크'),
      placeholder: 'https://…/join/…',
      confirmText: t('열기'),
    });
    if (!input) return;
    const token = input.trim().split('/join/').pop()!.split(/[?#]/)[0].trim();
    if (token) navigate(`/join/${token}`);
  };

  return (
    <AppShell>
      <div className="page-scroll">
        <div className="page page-wide dashboard">
          <NoticeBanner />
          <header className="dash-header">
            <div>
              <h1>
                {t('{greeting}, {name} 님', { greeting, name: user.name })} <span aria-hidden>{user.avatar}</span>
              </h1>
              <p className="muted">
                {t('개인 공간 {personal}개 · 협업 공간 {shared}개', { personal: counts.personal, shared: counts.shared })}
                {onlineCount > 0 && (
                  <>
                    {' · '}
                    <span className="live-dot" /> {t('지금 {n}명이 작업 중', { n: onlineCount })}
                  </>
                )}
                {requestTotal > 0 && <span className="request-pill">{t('참여 요청 {n}건', { n: requestTotal })}</span>}
              </p>
            </div>
            <div className="dash-actions">
              <Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => setTrashOpen(true)}>
                {t('휴지통')}
              </Button>
              <Button icon={<LogIn size={15} />} onClick={joinByLink}>
                {t('초대 링크로 참여')}
              </Button>
              <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
                {t('새 템플릿')}
              </Button>
            </div>
          </header>

          {pending.length > 0 && (
            <div className="pending-joins">
              {pending.map((p) => (
                <div key={p.templateId} className="pending-join">
                  <Hourglass size={16} className="pulse" />
                  <span>
                    {p.emoji} <b>{t(p.name)}</b> — {t('참여 승인을 기다리는 중 ({when} 요청)', { when: relativeTime(p.requestedAt) })}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="dash-grid">
            <section>
              <div className="dash-toolbar">
                <div className="segmented" role="tablist" aria-label={t('공간')}>
                  {SPACE_TABS.map(({ id, label, icon: Icon }) => (
                    <button key={id} role="tab" aria-selected={space === id} className={cx(space === id && 'is-active')} onClick={() => setSpace(id)}>
                      {Icon && <Icon size={14} />} {label} <span className="seg-count">{counts[id]}</span>
                    </button>
                  ))}
                </div>
                <div className="segmented segmented-quiet" role="tablist" aria-label={t('기능')}>
                  {(['all', ...FEATURE_ORDER] as FeatureFilter[]).map((f) => (
                    <button key={f} role="tab" aria-selected={feature === f} className={cx(feature === f && 'is-active')} onClick={() => setFeature(f)}>
                      {f === 'all' ? t('모든 기능') : `${FEATURE_INFO[f].emoji} ${t(FEATURE_INFO[f].name)}`}
                    </button>
                  ))}
                </div>
                <label className="search-input">
                  <Search size={15} />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('템플릿 검색')} />
                </label>
              </div>

              {!loaded ? (
                <div className="center-fill pad">
                  <Spinner size={24} />
                </div>
              ) : all.length === 0 ? (
                <FirstRun
                  onCreate={(presetId) => {
                    setStartPreset(presetId);
                    setCreating(true);
                  }}
                />
              ) : list.length === 0 ? (
                <EmptyState title={t('조건에 맞는 템플릿이 없습니다')}>{t('필터나 검색어를 바꿔 보세요.')}</EmptyState>
              ) : (
                <div className="template-grid">
                  {list.map((tpl) => (
                    <TemplateCard key={tpl.id} template={tpl} onlineIds={online[tpl.id] ?? []} requestCount={requests[tpl.id] ?? 0} />
                  ))}
                  <button className="template-card template-card-new" onClick={() => setCreating(true)}>
                    <Plus size={22} />
                    <span>{t('새 템플릿')}</span>
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
      {trashOpen && <TrashDialog onClose={() => setTrashOpen(false)} onRestored={showRestored} />}
      {creating && (
        <CreateTemplateModal
          initialPresetId={startPreset}
          onClose={() => {
            setCreating(false);
            setStartPreset(undefined);
          }}
          onCreated={(tpl) => {
            setCreating(false);
            navigate(`/t/${tpl.id}`);
          }}
        />
      )}
    </AppShell>
  );
}

function FirstRun({ onCreate }: { onCreate: (presetId?: string) => void }) {
  return (
    <div className="first-run">
      <h2>{t('첫 템플릿을 만들어 보세요')}</h2>
      <p className="muted">{t('디자인·코딩·문서 중 필요한 기능을 골라 개인 공간에서 시작하고, 필요할 때 팀원을 초대하세요.')}</p>
      <div className="first-run-presets">
        {PRESETS.slice(1, 5).map((p) => (
          <button key={p.id} className="preset" onClick={() => onCreate(p.id)}>
            <span className="preset-emoji">{p.emoji}</span>
            <span className="preset-text">
              <b>{t(p.name)}</b>
              <span>{t(p.description)}</span>
            </span>
          </button>
        ))}
      </div>
      <Button variant="primary" icon={<Plus size={15} />} onClick={() => onCreate()}>
        {t('템플릿 만들기')}
      </Button>
    </div>
  );
}

function TemplateCard({ template: tpl, onlineIds, requestCount }: { template: TemplateEntry; onlineIds: string[]; requestCount: number }) {
  const navigate = useNavigate();
  const user = useSession((s) => s.user)!;
  const setShareOpen = useUI((s) => s.setShareOpen);
  const onlineMembers = tpl.members.filter((m) => onlineIds.includes(m.user.id) && m.user.id !== user.id).map((m) => m.user);
  const personal = isPrivate(tpl);
  const local = tpl.mode === 'personal';

  const remove = async () => {
    if (await confirmTrash(tpl)) await trashTemplate(tpl);
  };

  const leave = async () => {
    const ok = await confirmDialog({ title: t('템플릿에서 나갈까요?'), message: t('다시 참여하려면 새 초대 링크가 필요합니다.'), confirmText: t('나가기'), danger: true });
    if (!ok) return;
    try {
      await leaveTemplate(tpl);
      toast.info(t('템플릿에서 나왔습니다'), tpl.name);
    } catch (err) {
      toast.error(t('실패했습니다'), errorMessage(err));
    }
  };

  const invite = () => {
    navigate(`/t/${tpl.id}`);
    setShareOpen(true);
  };

  return (
    <article
      data-template-id={tpl.id}
      className={cx('template-card', `is-${personal ? 'personal' : 'shared'}`)}
      onClick={() => navigate(`/t/${tpl.id}`)}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/t/${tpl.id}`)}
    >
      <div className="template-card-top">
        <span className="template-emoji">{tpl.emoji}</span>
        <div className="template-features">
          {tpl.features.map((f) => (
            <span key={f} className={`feature-pill feature-${f}`}>
              {FEATURE_INFO[f].emoji} {t(FEATURE_INFO[f].name)}
            </span>
          ))}
        </div>
        <span onClick={(e) => e.stopPropagation()}>
          <Menu
            align="end"
            items={[
              { label: t('열기'), icon: <ArrowRight size={15} />, onSelect: () => navigate(`/t/${tpl.id}`) },
              ...(tpl.myRole !== 'viewer'
                ? [{ label: personal ? t('팀원 초대 (협업 공간으로 전환)') : t('팀원 초대'), icon: <UserPlus size={15} />, onSelect: invite }]
                : []),
              { label: t('설정'), icon: <Settings size={15} />, onSelect: () => navigate(`/t/${tpl.id}/settings`) },
              { divider: true, label: '' },
              tpl.myRole === 'owner'
                ? { label: t('템플릿 삭제'), icon: <Trash2 size={15} />, danger: true, onSelect: remove }
                : { label: t('템플릿 나가기'), icon: <DoorOpen size={15} />, danger: true, onSelect: leave },
            ]}
            trigger={({ toggle, ref }) => (
              <IconButton ref={ref} label={t('더 보기')} size="sm" onClick={toggle}>
                <MoreHorizontal size={16} />
              </IconButton>
            )}
          />
        </span>
      </div>
      <h3>{tpl.name}</h3>
      <p className="template-desc">{tpl.description}</p>
      <div className="template-card-bottom">
        {personal ? (
          <span
            className="space-chip is-personal"
            data-tip={local ? t('아직 이 기기에만 있습니다 · 인터넷에 연결되면 자동으로 백업됩니다') : t('나만 볼 수 있는 개인 공간 · 클라우드에 자동 백업')}
          >
            <HardDrive size={12} /> {local ? t('개인 · 백업 대기') : t('개인')}
          </span>
        ) : (
          <span className="space-chip is-shared" data-tip={t('클라우드에 저장되는 협업 공간입니다')}>
            <Cloud size={12} /> {t('협업')}
          </span>
        )}
        {requestCount > 0 ? (
          <span className="request-pill" data-tip={t('템플릿을 열어 승인하거나 거절하세요')}>
            {t('참여 요청 {n}', { n: requestCount })}
          </span>
        ) : onlineMembers.length > 0 ? (
          <span className="online-pill" data-tip={onlineMembers.map((u) => u.name).join(', ')}>
            <span className="live-dot" /> {t('{n}명 작업 중', { n: onlineMembers.length })}
          </span>
        ) : (
          <span className="muted small">{t('{when} 수정', { when: relativeTime(tpl.updatedAt) })}</span>
        )}
        {!personal && requestCount === 0 && onlineMembers.length === 0 && <AvatarStack users={tpl.members.map((m) => m.user)} max={3} size={22} />}
        {!personal && <span className={`role-chip role-${tpl.myRole}`}>{tpl.myRole === 'owner' ? t('소유자') : tpl.myRole === 'editor' ? t('편집자') : t('뷰어')}</span>}
      </div>
    </article>
  );
}

function RecentActivity() {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const loaded = useTemplates((s) => s.loaded);
  useTick(30_000);
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    setFailed(false);
    setEvents(null);
    // 접속·퇴장 기록은 빼고 보여 주므로 넉넉히 받아 온다
    queryTimeline(undefined, { limit: 40 })
      .then((r) => !cancelled && setEvents(r.events.filter((e) => !isPresenceEvent(e)).slice(0, 12)))
      .catch(() => !cancelled && setFailed(true));
    const off = onTimelineEvent(({ event }) => {
      if (!isPresenceEvent(event)) setEvents((prev) => (prev ? [event, ...prev.filter((e) => e.id !== event.id)].slice(0, 12) : prev));
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [loaded, attempt]);
  return (
    <section className="dash-activity">
      <div className="dash-activity-head">
        <h2>
          <History size={16} /> {t('최근 활동')}
        </h2>
        <Link to="/timeline" className="link small">
          {t('전체 보기')} <ArrowRight size={13} />
        </Link>
      </div>
      {failed ? (
        <p className="muted small">
          {t('활동을 불러오지 못했습니다.')}{' '}
          <button className="link small" onClick={() => setAttempt((n) => n + 1)}>
            {t('다시 시도')}
          </button>
        </p>
      ) : !events ? (
        <Spinner />
      ) : events.length === 0 ? (
        <p className="muted small">{t('아직 활동이 없습니다.')}</p>
      ) : (
        <ul className="mini-timeline">
          {events.map((e) => (
            <li key={e.id}>
              <Avatar user={e.user} size={24} />
              <div>
                <span>
                  <b>{e.user.name}</b> {activityText(e)}
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
      <h2>{t('공간 안내')}</h2>
      <div className="spaces-guide-item">
        <span className="space-chip is-personal">
          <HardDrive size={12} /> {t('개인')}
        </span>
        <span className="muted small">{t('나만 볼 수 있음 · 클라우드에 자동 백업 · 여러 기기에서 이어서 작업')}</span>
      </div>
      <div className="spaces-guide-item">
        <span className="space-chip is-shared">
          <Cloud size={12} /> {t('협업')}
        </span>
        <span className="muted small">{t('초대하면 전환 · 초대한 멤버만 · 실시간 커서·채팅·멤버 관리')}</span>
      </div>
    </section>
  );
}
