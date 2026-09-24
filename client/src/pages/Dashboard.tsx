import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, DoorOpen, History, LogIn, MoreHorizontal, Plus, Search, Settings, Trash2 } from 'lucide-react';
import type { Feature, TemplateSummary, TimelineEvent } from '@shared/types';
import { FEATURE_INFO, FEATURE_ORDER, PRESETS } from '@shared/presets';
import { AppShell } from '../components/AppShell';
import { Avatar, AvatarStack, Button, EmptyState, IconButton, Menu, Spinner, confirmDialog, promptDialog } from '../components/ui';
import { useTemplates, onTimelineEvent } from '../store/templates';
import { useSession } from '../store/session';
import { toast } from '../store/toasts';
import { api, errorMessage } from '../lib/api';
import { relativeTime } from '../lib/time';
import { useTick } from '../hooks/useInterval';
import { cx } from '../lib/util';
import { CreateTemplateModal } from './CreateTemplateModal';

type Filter = 'all' | Feature;

export function Dashboard() {
  const user = useSession((s) => s.user)!;
  const { templates, online, loaded } = useTemplates();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(params.get('new') === '1');
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  useTick(30_000);

  useEffect(() => {
    if (params.get('new') === '1') {
      setCreating(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
  }, [params, setParams]);

  const list = useMemo(
    () =>
      Object.values(templates)
        .filter((t) => filter === 'all' || t.features.includes(filter))
        .filter((t) => !q.trim() || `${t.name} ${t.description}`.toLowerCase().includes(q.trim().toLowerCase()))
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [templates, filter, q],
  );

  const onlineCount = new Set(Object.values(online).flat().filter((id) => id !== user.id)).size;
  const hour = new Date().getHours();
  const greeting = hour < 6 ? '늦은 밤이에요' : hour < 12 ? '좋은 아침이에요' : hour < 18 ? '좋은 오후예요' : '좋은 저녁이에요';

  const joinByCode = async () => {
    const input = await promptDialog({
      title: '초대 코드로 참여',
      label: '초대 링크 또는 코드',
      placeholder: 'https://…/join/abc123 또는 abc123',
      confirmText: '다음',
    });
    if (!input) return;
    const code = input.split('/join/').pop()!.trim();
    navigate(`/join/${code}`);
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
                템플릿 {Object.keys(templates).length}개
                {onlineCount > 0 && (
                  <>
                    {' · '}
                    <span className="live-dot" /> 지금 {onlineCount}명이 작업 중
                  </>
                )}
              </p>
            </div>
            <div className="dash-actions">
              <Button icon={<LogIn size={15} />} onClick={joinByCode}>
                초대 코드로 참여
              </Button>
              <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreating(true)}>
                새 템플릿
              </Button>
            </div>
          </header>

          <div className="dash-grid">
            <section>
              <div className="dash-toolbar">
                <div className="segmented" role="tablist">
                  {(['all', ...FEATURE_ORDER] as Filter[]).map((f) => (
                    <button key={f} role="tab" aria-selected={filter === f} className={cx(filter === f && 'is-active')} onClick={() => setFilter(f)}>
                      {f === 'all' ? '전체' : `${FEATURE_INFO[f].emoji} ${FEATURE_INFO[f].name}`}
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
              ) : list.length === 0 && Object.keys(templates).length === 0 ? (
                <FirstRun onCreate={() => setCreating(true)} />
              ) : list.length === 0 ? (
                <EmptyState title="조건에 맞는 템플릿이 없습니다">필터나 검색어를 바꿔 보세요.</EmptyState>
              ) : (
                <div className="template-grid">
                  {list.map((t) => (
                    <TemplateCard key={t.id} template={t} onlineIds={online[t.id] ?? []} />
                  ))}
                  <button className="template-card template-card-new" onClick={() => setCreating(true)}>
                    <Plus size={22} />
                    <span>새 템플릿</span>
                  </button>
                </div>
              )}
            </section>
            <RecentActivity />
          </div>
        </div>
      </div>
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
      <p className="muted">디자인·코딩·문서 중 필요한 기능을 골라 한 곳에서 함께 작업할 수 있습니다.</p>
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

function TemplateCard({ template: t, onlineIds }: { template: TemplateSummary; onlineIds: string[] }) {
  const navigate = useNavigate();
  const user = useSession((s) => s.user)!;
  const onlineMembers = t.members.filter((m) => onlineIds.includes(m.user.id)).map((m) => m.user);

  const remove = async () => {
    const ok = await confirmDialog({
      title: '템플릿을 삭제할까요?',
      message: '모든 멤버에게서 디자인·코드·문서·비밀 노트·타임라인이 영구 삭제됩니다.',
      confirmText: '영구 삭제',
      danger: true,
      requireText: t.name,
    });
    if (!ok) return;
    try {
      await api('DELETE', `/templates/${t.id}`);
      useTemplates.getState().remove(t.id);
      toast.show({ kind: 'danger', title: '템플릿을 삭제했습니다', message: t.name });
    } catch (err) {
      toast.error('삭제하지 못했습니다', errorMessage(err));
    }
  };

  const leave = async () => {
    const ok = await confirmDialog({ title: '템플릿에서 나갈까요?', message: '다시 참여하려면 초대 링크가 필요합니다.', confirmText: '나가기', danger: true });
    if (!ok) return;
    try {
      await api('DELETE', `/templates/${t.id}/members/${user.id}`);
      useTemplates.getState().remove(t.id);
      toast.info('템플릿에서 나왔습니다', t.name);
    } catch (err) {
      toast.error('실패했습니다', errorMessage(err));
    }
  };

  return (
    <article className="template-card" onClick={() => navigate(`/t/${t.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/t/${t.id}`)}>
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
        <AvatarStack users={t.members.map((m) => m.user)} size={24} />
        {onlineMembers.length > 0 ? (
          <span className="online-pill" data-tip={onlineMembers.map((u) => u.name).join(', ')}>
            <span className="live-dot" /> {onlineMembers.length}명 작업 중
          </span>
        ) : (
          <span className="muted small">{relativeTime(t.updatedAt)} 수정</span>
        )}
        <span className={`role-chip role-${t.myRole}`}>{t.myRole === 'owner' ? '소유자' : t.myRole === 'editor' ? '편집자' : '뷰어'}</span>
      </div>
    </article>
  );
}

function RecentActivity() {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  useTick(30_000);
  useEffect(() => {
    api<{ events: TimelineEvent[] }>('GET', '/timeline?limit=12')
      .then((r) => setEvents(r.events))
      .catch(() => setEvents([]));
    return onTimelineEvent(({ event }) => setEvents((prev) => (prev ? [event, ...prev.filter((e) => e.id !== event.id)].slice(0, 12) : prev)));
  }, []);
  return (
    <aside className="dash-activity">
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
    </aside>
  );
}
