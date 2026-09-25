import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Cloud, Eye, History, HardDrive, Lock, MessageSquare, MousePointer2, Plus, Share2, Users } from 'lucide-react';
import type { Feature, TimelineEvent } from '@shared/types';
import { FEATURE_INFO } from '@shared/presets';
import { getLanguage } from '@shared/schema';
import { useWorkspace, viewPath } from './context';
import { createBoard, createCodeFile, createDocument, itemLabel, itemsMap, type ItemModule } from './actions';
import { itemName, MODULE_NAMES } from './viewLabel';
import { useYItems } from '../hooks/useY';
import { useTick } from '../hooks/useInterval';
import { usePresence, uniqueUsers } from '../store/presence';
import { useSession } from '../store/session';
import { onTimelineEvent } from '../store/templates';
import { useUI } from '../store/ui';
import { queryTimeline } from '../lib/timeline';
import { relativeTime } from '../lib/time';
import { CursorPage } from '../components/Cursors';
import { Avatar, AvatarStack, Button } from '../components/ui';

export function Overview() {
  const ws = useWorkspace();
  const t = ws.template;
  const setShareOpen = useUI((s) => s.setShareOpen);
  return (
    <CursorPage wide className="overview">
      <header className="overview-hero">
        <span className="overview-emoji">{t.emoji}</span>
        <div className="overview-titles">
          <h1>{t.name}</h1>
          {t.description && <p className="muted">{t.description}</p>}
          <div className="template-features">
            {t.features.map((f) => (
              <span key={f} className={`feature-pill feature-${f}`}>
                {FEATURE_INFO[f].emoji} {FEATURE_INFO[f].name}
              </span>
            ))}
          </div>
        </div>
        <div className="overview-members">
          <AvatarStack users={t.members.map((m) => m.user)} max={6} size={30} />
          {ws.canEdit && (
            <Button icon={<Share2 size={14} />} onClick={() => setShareOpen(true)}>
              초대
            </Button>
          )}
        </div>
      </header>

      {ws.isPrivate ? <PersonalBanner /> : <Collaborators />}

      <div className="overview-grid">
        {t.features.map((f) => (
          <FeatureCard key={f} feature={f} />
        ))}
        <NotesCard />
      </div>

      <RecentTemplateActivity />
    </CursorPage>
  );
}

/** 개인 공간 안내 — 초대하면 협업 공간으로 바뀐다는 것을 알려 준다 */
function PersonalBanner() {
  const setShareOpen = useUI((s) => s.setShareOpen);
  return (
    <section className="personal-banner">
      <div className="personal-banner-icon">
        <HardDrive size={22} />
      </div>
      <div className="personal-banner-text">
        <b>개인 공간</b>
        <span>
          나만 볼 수 있는 템플릿입니다. 클라우드에 자동으로 백업되어 브라우저 데이터를 지우거나 다른 기기에서 로그인해도 그대로 이어서 작업할 수
          있습니다. 팀원을 초대하면 <b>협업 공간</b>으로 전환되고 아래 기능이 켜집니다.
        </span>
        <ul className="personal-banner-list">
          <li>
            <MousePointer2 size={14} /> 실시간 커서 · 행동 표시
          </li>
          <li>
            <MessageSquare size={14} /> 채팅
          </li>
          <li>
            <Users size={14} /> 멤버 · 권한 관리
          </li>
          <li>
            <Cloud size={14} /> 멤버와 실시간 동기화
          </li>
        </ul>
      </div>
      <Button variant="primary" icon={<Share2 size={15} />} onClick={() => setShareOpen(true)}>
        팀원 초대하고 협업 시작
      </Button>
    </section>
  );
}

function Collaborators() {
  const ws = useWorkspace();
  const others = usePresence((s) => s.others);
  const people = uniqueUsers(others);
  const navigate = useNavigate();
  const setShareOpen = useUI((s) => s.setShareOpen);
  useTick(5000);
  return (
    <section className="overview-section">
      <h2>
        <span className="live-dot" /> 지금 함께 작업 중
      </h2>
      {people.length === 0 ? (
        <div className="collab-empty">
          <span>지금은 혼자 작업 중입니다. 팀원을 초대하면 서로의 커서와 행동이 실시간으로 보입니다.</span>
          {ws.canEdit && (
            <Button size="sm" icon={<Share2 size={14} />} onClick={() => setShareOpen(true)}>
              초대 링크
            </Button>
          )}
        </div>
      ) : (
        <div className="collab-grid">
          {people.map((p) => {
            const where = itemName(ws.doc, ws.notes, p.view.module, p.view.itemId);
            const recent = p.actionLabel && p.actionAt && Date.now() - p.actionAt < 60_000;
            return (
              <div key={p.socketId} className="collab-card" style={{ ['--user-color' as string]: p.user.color }}>
                <Avatar user={p.user} size={36} status={p.idle ? 'idle' : 'online'} />
                <div className="collab-text">
                  <b>{p.user.name}</b>
                  <span className="muted small">
                    {p.idle ? '자리 비움 · ' : ''}
                    {MODULE_NAMES[p.view.module]}
                    {where ? ` › ${where}` : ''}
                  </span>
                  {recent && <span className="collab-action">{p.actionLabel} · {relativeTime(p.actionAt!)}</span>}
                </div>
                <div className="collab-actions">
                  <Button size="sm" variant="ghost" onClick={() => navigate(viewPath(ws.template.id, p.view.module, p.view.itemId))}>
                    이동
                  </Button>
                  <Button size="sm" icon={<Eye size={14} />} onClick={() => ws.setFollow(p.user.id)}>
                    따라가기
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function FeatureCard({ feature }: { feature: Feature }) {
  const ws = useWorkspace();
  const me = useSession((s) => s.user)!;
  const module = feature as ItemModule;
  const items = useYItems(itemsMap(ws.doc, module));
  const info = FEATURE_INFO[feature];
  const recent = [...items].reverse().slice(0, 5);
  const add = () => (module === 'code' ? void createCodeFile(ws, me) : module === 'docs' ? createDocument(ws, me) : createBoard(ws, me));
  return (
    <section className={`module-card feature-${feature}`}>
      <header>
        <span className="module-card-emoji">{info.emoji}</span>
        <div>
          <h3>{info.name}</h3>
          <span className="muted small">
            {items.length}개 {module === 'code' ? '파일' : module === 'docs' ? '문서' : '보드'}
          </span>
        </div>
        {ws.canEdit && (
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={add}>
            새로 만들기
          </Button>
        )}
      </header>
      <ul>
        {recent.map((item) => {
          const id = item.get('id') as string;
          return (
            <li key={id}>
              <button onClick={() => ws.go(module, id)}>
                {module === 'code' ? (
                  <span className="lang-dot" style={{ background: getLanguage(item.get('language') as string).color }} />
                ) : (
                  <span>{module === 'docs' ? String(item.get('emoji') ?? '📄') : '🖼️'}</span>
                )}
                <span className="truncate">{itemLabel(item, module)}</span>
                {module === 'code' && <span className="muted small">{getLanguage(item.get('language') as string).name}</span>}
                <ArrowRight size={13} className="hover-arrow" />
              </button>
            </li>
          );
        })}
        {items.length === 0 && <li className="muted small pad-sm">아직 비어 있습니다</li>}
      </ul>
    </section>
  );
}

function NotesCard() {
  const ws = useWorkspace();
  const setNewNoteOpen = useUI((s) => s.setNewNoteOpen);
  return (
    <section className="module-card feature-notes">
      <header>
        <span className="module-card-emoji">🔒</span>
        <div>
          <h3>비밀 노트</h3>
          <span className="muted small">{ws.notes.length}개 · 비밀번호로 보호</span>
        </div>
        {ws.canEdit && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus size={14} />}
            onClick={() => {
              ws.go('notes');
              setNewNoteOpen(true);
            }}
          >
            새로 만들기
          </Button>
        )}
      </header>
      <ul>
        {ws.notes.slice(0, 5).map((n) => (
          <li key={n.id}>
            <button onClick={() => ws.go('notes', n.id)}>
              <Lock size={13} />
              <span className="truncate">{n.title}</span>
              <span className="muted small">{n.createdBy.name}</span>
              <ArrowRight size={13} className="hover-arrow" />
            </button>
          </li>
        ))}
        {ws.notes.length === 0 && <li className="muted small pad-sm">템플릿 멤버만, 비밀번호를 아는 사람만 열 수 있습니다</li>}
      </ul>
    </section>
  );
}

function RecentTemplateActivity() {
  const ws = useWorkspace();
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  useTick(30_000);
  useEffect(() => {
    queryTimeline(ws.template.id, { limit: 8 })
      .then((r) => setEvents(r.events))
      .catch(() => {});
    return onTimelineEvent(({ event }) => {
      if (event.templateId === ws.template.id) setEvents((prev) => [event, ...prev.filter((e) => e.id !== event.id)].slice(0, 8));
    });
  }, [ws.template.id]);
  return (
    <section className="overview-section">
      <div className="section-head">
        <h2>
          <History size={16} /> 최근 활동
        </h2>
        <button className="link small" onClick={() => ws.go('timeline')}>
          타임라인 전체 보기 <ArrowRight size={13} />
        </button>
      </div>
      <ul className="mini-timeline">
        {events.map((e) => (
          <li key={e.id}>
            <Avatar user={e.user} size={24} />
            <div>
              <span>
                <b>{e.user.name}</b> {e.text}
                {e.count > 1 && <span className="count-chip">×{e.count}</span>}
              </span>
              <span className="muted small">{relativeTime(e.at)}</span>
            </div>
          </li>
        ))}
        {events.length === 0 && <li className="muted small">아직 활동이 없습니다.</li>}
      </ul>
    </section>
  );
}
