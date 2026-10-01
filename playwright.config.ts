import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * 브라우저 E2E 스모크 테스트
 *  - `npm run build`로 만든 client/dist를 wrangler dev(Worker + Durable Object)가 그대로 제공한다
 *  - AUTH_DEV_MODE: 메일 대신 화면에 인증 코드가 표시된다 (localhost에서만 동작)
 *  - 실행: npm run build && npm run e2e
 *
 * 환경 변수
 *  E2E_PORT          wrangler dev 포트 (기본 8798)
 *  PW_CHROMIUM_PATH  이미 설치된 크로미움 실행 파일을 쓸 때 (설정하지 않으면 `npx playwright install chromium`으로 받은 것)
 */

const port = Number(process.env.E2E_PORT ?? 8798);
// 설정 파일은 테스트 작업 프로세스에서도 다시 읽히므로 임시 저장 폴더는 한 번만 만든다
process.env.E2E_PERSIST_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'lt-e2e-'));
const persistDir = process.env.E2E_PERSIST_DIR;
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
// 봇 확인(Turnstile)을 켠 두 번째 서버: 클라우드플레어가 제공하는 테스트 키(항상 통과)를 쓴다
export const turnstilePort = port + 1;
process.env.E2E_TURNSTILE_PERSIST_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), 'lt-e2e-ts-'));
const turnstileVars = ['TURNSTILE_SITE_KEY:1x00000000000000000000AA', 'TURNSTILE_SECRET_KEY:1x0000000000000000000000000000000AA'].map((v) => `--var ${v}`).join(' ');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }], ['github']] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 900 },
    locale: 'ko-KR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: executablePath ? { executablePath } : {} },
    },
  ],
  webServer: [
    {
      command: `npx wrangler dev --port ${port} --ip 127.0.0.1 --persist-to ${JSON.stringify(persistDir)} --log-level warn --var AUTH_DEV_MODE:1`,
      cwd: './worker',
      url: `http://127.0.0.1:${port}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: { WRANGLER_SEND_METRICS: 'false', CI: '1' },
    },
    {
      command: `npx wrangler dev --port ${turnstilePort} --ip 127.0.0.1 --persist-to ${JSON.stringify(process.env.E2E_TURNSTILE_PERSIST_DIR)} --inspector-port ${turnstilePort + 1000} --log-level warn --var AUTH_DEV_MODE:1 ${turnstileVars}`,
      cwd: './worker',
      url: `http://127.0.0.1:${turnstilePort}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      stdout: 'ignore',
      stderr: 'pipe',
      env: { WRANGLER_SEND_METRICS: 'false', CI: '1' },
    },
  ],
});
