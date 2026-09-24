import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import express from 'express';
import { Server } from 'socket.io';
import { config } from './config.js';
import { flushDb, initDb } from './db.js';
import { apiRouter } from './routes.js';
import { corsMiddleware, socketCors } from './cors.js';
import { docs, initRealtime } from './realtime.js';
import { ensureDir, flushAllSync } from './store.js';

export interface RunningServer {
  port: number;
  io: Server;
  close(): Promise<void>;
}

export async function startServer(port = config.port): Promise<RunningServer> {
  ensureDir(config.dataDir);
  initDb();

  const app = express();
  app.disable('x-powered-by');
  app.use('/api', corsMiddleware, apiRouter());

  // 빌드된 클라이언트가 있으면 같은 포트에서 제공 (SPA)
  if (fs.existsSync(config.clientDist)) {
    // 해시가 붙은 빌드 결과물은 오래 캐시, 나머지(sw.js, manifest, 아이콘)는 매번 확인
    app.use('/assets', express.static(path.join(config.clientDist, 'assets'), { maxAge: '1y', immutable: true }));
    app.use(express.static(config.clientDist, { index: false, maxAge: 0 }));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
  }

  const server = http.createServer(app);
  const io = new Server(server, {
    maxHttpBufferSize: 10 * 1024 * 1024,
    // GitHub Pages 등 다른 주소의 화면에서도 접속 가능 (허용 출처는 cors.ts)
    cors: socketCors,
  });
  initRealtime(io);

  await new Promise<void>((resolve) => server.listen(port, resolve));
  const actualPort = (server.address() as AddressInfo).port;

  return {
    port: actualPort,
    io,
    async close() {
      await docs.flushAll();
      await flushDb();
      flushAllSync();
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}
