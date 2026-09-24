import { config } from './config.js';
import { startServer } from './app.js';

const running = await startServer(config.port);
console.log(`[live-template] http://localhost:${running.port}  (data: ${config.dataDir})`);

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
