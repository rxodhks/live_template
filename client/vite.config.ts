import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// 개발 중에는 클라우드플레어 로컬 런타임(wrangler dev, 8787)으로 API와 실시간 연결을 넘긴다
const apiTarget = process.env.API_URL ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@shared': path.resolve(__dirname, '../shared') },
    // Yjs/ProseMirror/CodeMirror는 인스턴스가 하나여야 한다
    dedupe: ['yjs', 'y-protocols', 'lib0', '@codemirror/state', '@codemirror/view', '@tiptap/pm'],
  },
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
});
