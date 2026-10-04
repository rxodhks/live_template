import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { runtimesPlugin } from './build/runtimes';
import { CONTACT_EMAIL } from '../shared/contact';
import { CLIENT_VERSION, CLIENT_VERSION_HEADER } from '../shared/protocol';

// 개발 중에는 클라우드플레어 로컬 런타임(wrangler dev, 8787)으로 API와 실시간 연결을 넘긴다
const apiTarget = process.env.API_URL ?? 'http://localhost:8787';

/** 문서 편집기의 수식 확장이 katex를 바로 가져오지 않고, 수식이 처음 보일 때 불러오게 한다 (src/lib/katexLazy.ts) */
function lazyKatexPlugin(): Plugin {
  const shim = path.resolve(__dirname, 'src/lib/katexLazy.ts');
  return {
    name: 'lazy-katex',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source === 'katex' && importer?.includes('@tiptap/extension-mathematics')) return shim;
    },
  };
}

/** index.html의 장애 안내(앱이 뜨지 못할 때)에 문의 이메일을 넣는다 */
function contactPlugin(): Plugin {
  return {
    name: 'contact-email',
    transformIndexHtml: (html) => html.replaceAll('%CONTACT_EMAIL%', CONTACT_EMAIL),
  };
}

/** index.html의 API 미리 요청(lib/api.ts takePrefetch)에 화면 버전을 넣는다. 서버 주소를 따로 쓰면(VITE_API_BASE) 끈다 */
function apiPrefetchPlugin(): Plugin {
  let on = true;
  return {
    name: 'api-prefetch',
    configResolved: (config) => void (on = !config.env.VITE_API_BASE),
    transformIndexHtml: (html) =>
      html
        .replaceAll('%API_PREFETCH%', on ? 'on' : 'off')
        .replaceAll('%CLIENT_VERSION_HEADER%', CLIENT_VERSION_HEADER)
        .replaceAll('%CLIENT_VERSION%', String(CLIENT_VERSION)),
  };
}

export default defineConfig(async () => ({
  // 코드 실행 환경(파이썬 · SQL · Ruby · PHP · Lua · React)을 /runtimes/ 로 함께 배포
  plugins: [react(), lazyKatexPlugin(), contactPlugin(), apiPrefetchPlugin(), await runtimesPlugin()],
  resolve: {
    alias: { '@shared': path.resolve(__dirname, '../shared') },
    // Yjs/ProseMirror/CodeMirror는 인스턴스가 하나여야 한다
    dedupe: ['yjs', 'y-protocols', 'lib0', '@codemirror/state', '@codemirror/view', '@tiptap/pm'],
  },
  // 미리 묶으면 위 플러그인이 끼어들 수 없다
  optimizeDeps: { exclude: ['@tiptap/extension-mathematics'] },
  server: {
    port: 5173,
    fs: { allow: [path.resolve(__dirname, '..')] },
    proxy: {
      '/api': { target: apiTarget, ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
}));
