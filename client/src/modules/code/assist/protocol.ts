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
