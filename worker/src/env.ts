import type { Directory } from './directory';
import type { TemplateRoom } from './room';

export interface Env {
  DIRECTORY: DurableObjectNamespace<Directory>;
  ROOM: DurableObjectNamespace<TemplateRoom>;
  ASSETS: Fetcher;

  /*
   * 로그인 설정 (대시보드의 Settings → Variables and Secrets에서 Secret으로 추가)
   * 값이 있는 로그인 방법만 로그인 화면에 나타난다.
   */
  /** 인증 코드 메일 발송 (resend.com API 키) */
  RESEND_API_KEY?: string;
  /** 보내는 사람. 기본값 "Madang <login@madang.party>" */
  EMAIL_FROM?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /** Sign in with Apple: Services ID · 팀 ID · 키 ID · 개인 키(.p8 파일 내용) */
  APPLE_CLIENT_ID?: string;
  APPLE_TEAM_ID?: string;
  APPLE_KEY_ID?: string;
  APPLE_PRIVATE_KEY?: string;
  /** "1"이면 로컬(localhost)에서만 인증 코드를 응답에 담아 준다 — 개발 · 테스트용 */
  AUTH_DEV_MODE?: string;
}
