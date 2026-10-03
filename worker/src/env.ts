import type { Directory } from './directory';
import type { TemplateRoom } from './room';

export interface Env {
  DIRECTORY: DurableObjectNamespace<Directory>;
  ROOM: DurableObjectNamespace<TemplateRoom>;
  ASSETS: Fetcher;

  /*
   * 로그인 설정 — Worker의 Secret (대시보드 Settings → Variables and Secrets, 또는 GitHub 저장소 Secrets에 넣으면
   * 배포 워크플로가 옮겨 준다). 값이 있는 로그인 방법만 로그인 화면에 나타난다.
   */
  /** 인증 코드 메일 발송 (resend.com API 키) */
  RESEND_API_KEY?: string;
  /** 보내는 사람. 기본값 "Madang <login@madang.party>" */
  EMAIL_FROM?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** 깃허브 OAuth App (GitHub 저장소 Secret 이름은 GITHUB_로 시작할 수 없어서 GIT_를 쓴다) */
  GIT_CLIENT_ID?: string;
  GIT_CLIENT_SECRET?: string;
  /**
   * 클라우드플레어 Turnstile(봇 확인) — 둘 다 있으면 이메일 인증 코드를 보내기 전에 사람인지 확인한다.
   * 없으면 확인 없이 동작 (대시보드 Turnstile에서 사이트를 추가하면 받을 수 있다)
   */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  /** 앱 안 "피드백 보내기"로 온 의견을 받을 메일 주소 (RESEND_API_KEY가 있을 때). 없으면 저장 · 로그에만 남긴다 */
  FEEDBACK_EMAIL?: string;
  /** 사이트 전체 하루 인증 코드 메일 상한. 기본 80 (보안 알림 15통은 따로) — Resend 무료 요금제는 하루 100통 */
  MAIL_DAILY_LIMIT?: string;
  /** "1"이면 로컬(localhost)에서만 인증 코드를 응답에 담아 준다 — 개발 · 테스트용 */
  AUTH_DEV_MODE?: string;
}
