/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 협업 서버 주소 (비우면 화면과 같은 주소의 /api) */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
