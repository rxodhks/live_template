/** 검사 워커와 주고받는 모양 */
export interface AssistDiagnostic {
  /** 파일 안 글자 위치 */
  from: number;
  to: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  source: string;
  /** 빠른 수정 (검사한 내용 기준의 글자 위치) */
  fixes?: AssistFix[];
}

export interface AssistFix {
  title: string;
  changes: { from: number; to: number; insert: string }[];
}

export interface CheckRequest {
  /** 검사할 파일 이름 */
  name: string;
  /** 검사할 파일과 함께 볼 파일들 { 이름: 내용 } (import 를 따라가기 위해) */
  files: Record<string, string>;
}

/** 자동 완성 요청 — 커서 위치(pos)에서 쓸 수 있는 이름들 */
export interface CompleteRequest extends CheckRequest {
  pos: number;
}

export interface AssistCompletion {
  label: string;
  /** function · method · property · variable · class · type · keyword · module … */
  kind: string;
  /** 정렬 순서 (작을수록 위) */
  sort: string;
  /** 넣을 글자가 이름과 다르면 (예: 대괄호 접근) */
  insert?: string;
  /** 바꿀 범위가 따로 있으면 */
  from?: number;
  to?: number;
  /** 자세한 정보를 물을 때 돌려줄 값 */
  source?: string;
  data?: unknown;
}

export interface CompleteResult {
  /** 이름을 바꿀 시작 위치 */
  from: number;
  items: AssistCompletion[];
}

/** 자동 완성 항목의 자세한 정보 (타입 · 설명) */
export interface DetailRequest extends CompleteRequest {
  entry: string;
  source?: string;
  data?: unknown;
}
