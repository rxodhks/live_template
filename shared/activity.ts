import type { ActivityModule, ActivityType, ToastKind } from './types';

interface ActivityDef {
  module: ActivityModule;
  /** 커서 옆 말풍선에 표시되는 짧은 라벨 */
  label: string;
  /** 타임라인/토스트 문장 */
  text: (target: string, detail: string) => string;
  /** true면 다른 사용자에게 토스트로 알림 */
  important?: boolean;
  toastKind?: ToastKind;
  /** 같은 사용자의 같은 대상에 대한 연속 활동을 하나로 합침 */
  coalesce?: boolean;
}

const q = (s: string) => (s ? `‘${s}’ ` : '');

export const ACTIVITY: Record<ActivityType, ActivityDef> = {
  'presence.join': { module: 'presence', label: '접속', text: () => '템플릿에 접속했습니다', important: true, toastKind: 'success' },
  'presence.leave': { module: 'presence', label: '퇴장', text: () => '템플릿에서 나갔습니다', important: true, toastKind: 'info' },
  'template.create': { module: 'template', label: '템플릿 생성', text: (t) => `${q(t)}템플릿을 만들었습니다` },
  'template.update': { module: 'template', label: '설정 변경', text: (_t, d) => `템플릿 설정을 변경했습니다${d ? ` · ${d}` : ''}`, important: true, toastKind: 'info' },
  'member.join': { module: 'member', label: '참여', text: () => '초대 링크로 템플릿에 참여했습니다', important: true, toastKind: 'success' },
  'member.leave': { module: 'member', label: '탈퇴', text: () => '템플릿을 떠났습니다', important: true, toastKind: 'warning' },
  'member.role': { module: 'member', label: '권한 변경', text: (t, d) => `${t} 님의 권한을 변경했습니다 · ${d}`, important: true, toastKind: 'info' },
  'member.remove': { module: 'member', label: '멤버 내보내기', text: (t) => `${t} 님을 템플릿에서 내보냈습니다`, important: true, toastKind: 'warning' },

  'code.create': { module: 'code', label: '파일 생성', text: (t) => `${q(t)}파일을 만들었습니다`, important: true, toastKind: 'success' },
  'code.delete': { module: 'code', label: '파일 삭제', text: (t) => `${q(t)}파일을 삭제했습니다`, important: true, toastKind: 'danger' },
  'code.rename': { module: 'code', label: '이름 변경', text: (_t, d) => `파일 이름을 변경했습니다 · ${d}` },
  'code.language': { module: 'code', label: '언어 변경', text: (t, d) => `${q(t)}파일의 언어를 변경했습니다 → ${d}`, important: true, toastKind: 'info' },
  'code.edit': { module: 'code', label: '코드 편집', text: (t) => `${q(t)}파일을 편집했습니다`, coalesce: true },
  'code.run': { module: 'code', label: '코드 실행', text: (t) => `${q(t)}파일을 실행했습니다`, coalesce: true },

  'docs.create': { module: 'docs', label: '문서 생성', text: (t) => `${q(t)}문서를 만들었습니다`, important: true, toastKind: 'success' },
  'docs.delete': { module: 'docs', label: '문서 삭제', text: (t) => `${q(t)}문서를 삭제했습니다`, important: true, toastKind: 'danger' },
  'docs.rename': { module: 'docs', label: '제목 변경', text: (_t, d) => `문서 제목을 변경했습니다 · ${d}` },
  'docs.edit': { module: 'docs', label: '문서 작성', text: (t) => `${q(t)}문서를 편집했습니다`, coalesce: true },

  'design.create': { module: 'design', label: '보드 생성', text: (t) => `${q(t)}보드를 만들었습니다`, important: true, toastKind: 'success' },
  'design.delete': { module: 'design', label: '보드 삭제', text: (t) => `${q(t)}보드를 삭제했습니다`, important: true, toastKind: 'danger' },
  'design.rename': { module: 'design', label: '이름 변경', text: (_t, d) => `보드 이름을 변경했습니다 · ${d}` },
  'design.shape.add': { module: 'design', label: '도형 추가', text: (t, d) => `${q(t)}보드에 도형을 추가했습니다${d ? ` · ${d}` : ''}`, coalesce: true },
  'design.shape.delete': { module: 'design', label: '도형 삭제', text: (t) => `${q(t)}보드에서 도형을 삭제했습니다`, coalesce: true },
  'design.edit': { module: 'design', label: '디자인 편집', text: (t) => `${q(t)}보드를 편집했습니다`, coalesce: true },

  'notes.create': { module: 'notes', label: '비밀 노트 생성', text: (t) => `${q(t)}비밀 노트를 만들었습니다`, important: true, toastKind: 'success' },
  'notes.delete': { module: 'notes', label: '비밀 노트 삭제', text: (t) => `${q(t)}비밀 노트를 삭제했습니다`, important: true, toastKind: 'danger' },
  'notes.unlock': { module: 'notes', label: '비밀 노트 열람', text: (t) => `${q(t)}비밀 노트를 열었습니다`, coalesce: true },
  'notes.unlock_fail': { module: 'notes', label: '잠금 해제 실패', text: (t) => `${q(t)}비밀 노트의 비밀번호 입력에 실패했습니다`, coalesce: true },
  'notes.password': { module: 'notes', label: '비밀번호 변경', text: (t) => `${q(t)}비밀 노트의 비밀번호를 변경했습니다`, important: true, toastKind: 'warning' },
  'notes.edit': { module: 'notes', label: '비밀 노트 편집', text: (t) => `${q(t)}비밀 노트를 편집했습니다`, coalesce: true },
};

export const ACTIVITY_TYPES = Object.keys(ACTIVITY) as ActivityType[];

/** 클라이언트가 직접 보고할 수 있는 활동 (나머지는 서버가 직접 기록) */
export const CLIENT_REPORTABLE: ReadonlySet<ActivityType> = new Set<ActivityType>([
  'code.create',
  'code.delete',
  'code.rename',
  'code.language',
  'code.edit',
  'code.run',
  'docs.create',
  'docs.delete',
  'docs.rename',
  'docs.edit',
  'design.create',
  'design.delete',
  'design.rename',
  'design.shape.add',
  'design.shape.delete',
  'design.edit',
  'notes.edit',
]);

export const MODULE_LABEL: Record<ActivityModule, string> = {
  presence: '접속',
  template: '템플릿',
  member: '멤버',
  design: '디자인',
  code: '코딩',
  docs: '문서',
  notes: '비밀 노트',
};

/** 합치기 창: 같은 행동이 이 시간 안에 반복되면 하나의 이벤트로 합친다 */
export const COALESCE_WINDOW_MS = 5 * 60 * 1000;
