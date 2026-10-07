/** 공지사항 한 건 (빌드할 때 notices/*.md 에서 만든 /notices.json 의 항목) */
export const NOTICE_TAGS = ['중요', '점검', '새 기능', '정책', '소식'] as const;
export type NoticeTag = (typeof NOTICE_TAGS)[number];

export interface Notice {
  /** 파일 이름 (주소 /notices/<id>) */
  id: string;
  title: string;
  /** 게시일 YYYY-MM-DD (한국 시간). 미래 날짜면 그날부터 보인다 */
  date: string;
  tag: NoticeTag;
  /** 홈 위쪽 배너로 띄운다 */
  pin: boolean;
  /** 배너를 이날까지만 띄운다 (YYYY-MM-DD, 포함) */
  until?: string;
  /** 새 소식 · 배너에 보이는 한 줄 */
  summary: string;
  /** 본문 (빌드 때 마크다운에서 바꾼 HTML) */
  html: string;
  /** 예약 업데이트 시간 "YYYY-MM-DD HH:mm" (한국 시간). 있으면 '업데이트 예정' 공지 (scripts/scheduled-deploy.mjs) */
  deployAt?: string;
  /** 업데이트를 마친 시간. 있으면 '업데이트 완료' 공지 (예약 업데이트가 배포 뒤 적는다) */
  deployedAt?: string;
}

/** 읽음 · 배너 닫기를 기억하는 열쇠. 업데이트를 마치면 바뀌어 완료 소식을 다시 알린다 */
export const noticeKey = (n: Pick<Notice, 'id' | 'deployedAt'>) => (n.deployedAt ? `${n.id}#done` : n.id);
