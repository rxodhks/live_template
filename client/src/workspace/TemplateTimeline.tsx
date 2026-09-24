import { History } from 'lucide-react';
import { useWorkspace } from './context';
import { CursorPage } from '../components/Cursors';
import { TimelineView } from '../components/TimelineView';

export function TemplateTimeline() {
  const { template } = useWorkspace();
  return (
    <CursorPage wide>
      <header className="page-header">
        <h1>
          <History size={22} /> 타임라인
        </h1>
        <p className="muted">
          {template.emoji} {template.name}에서 멤버들이 한 일을 모두 기록합니다. 반복된 편집은 5분 단위로 묶어 ×N으로 표시합니다.
        </p>
      </header>
      <TimelineView templateId={template.id} people={template.members.map((m) => m.user)} />
    </CursorPage>
  );
}
