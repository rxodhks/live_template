import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const apiTarget = process.env.API_URL ?? 'http://localhost:3001';

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
      '/api': apiTarget,
      '/socket.io': { target: apiTarget, ws: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
