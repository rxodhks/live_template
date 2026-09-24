import { useMemo } from 'react';
import { History } from 'lucide-react';
import type { PublicUser } from '@shared/types';
import { AppShell } from '../components/AppShell';
import { TimelineView } from '../components/TimelineView';
import { useTemplates } from '../store/templates';

/** 내가 속한 모든 템플릿의 활동 기록 */
export function GlobalTimeline() {
  const templates = useTemplates((s) => s.templates);
  const people = useMemo(() => {
    const map = new Map<string, PublicUser>();
    for (const t of Object.values(templates)) for (const m of t.members) map.set(m.user.id, m.user);
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [templates]);
  return (
    <AppShell>
      <div className="page-scroll">
        <div className="page page-wide">
          <header className="page-header">
            <h1>
              <History size={22} /> 전체 타임라인
            </h1>
            <p className="muted">내가 참여한 모든 템플릿에서 누가 무엇을 했는지 시간순으로 기록됩니다.</p>
          </header>
          <TimelineView people={people} showTemplate />
        </div>
      </div>
    </AppShell>
  );
}
