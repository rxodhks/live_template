import os from 'node:os';
import { config } from './config.js';
import { startServer } from './app.js';

const running = await startServer(config.port);
console.log(`[live-template] http://localhost:${running.port}  (data: ${config.dataDir})`);

// 같은 Wi‑Fi의 휴대폰에서 접속할 수 있는 주소 안내
const lan = Object.values(os.networkInterfaces())
  .flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal)
  .map((n) => `http://${n!.address}:${running.port}`);
if (lan.length) console.log(`[live-template] 휴대폰(같은 네트워크)에서 열기: ${lan.join('  ')}`);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[live-template] ${signal} 수신 - 저장 후 종료합니다`);
  try {
    await running.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
