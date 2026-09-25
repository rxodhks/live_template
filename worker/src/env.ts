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
  /** "1"이면 로컬(localhost)에서만 인증 코드를 응답에 담아 준다 — 개발 · 테스트용 */
  AUTH_DEV_MODE?: string;
}
