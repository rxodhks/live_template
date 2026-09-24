/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 기본 협업 서버 주소 (GitHub Pages처럼 화면만 따로 배포할 때) */
  readonly VITE_SERVER_URL?: string;
  /** 정적 호스팅(GitHub Pages) 빌드 여부 — 서버가 같은 주소에 없다 */
  readonly VITE_STATIC_HOST?: string;
  /** owner/repo (Codespaces 바로가기 링크용) */
  readonly VITE_REPO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
