import { test, expect, uniqueEmail } from './fixtures';

/*
 * 봇 확인(Turnstile)을 켠 서버: 클라우드플레어 테스트 키(항상 통과)로 실제 위젯 스크립트를 불러와 확인한다
 *  - 토큰 없이 인증 메일을 요청하면 거절
 *  - 로그인 화면은 보이지 않게 토큰을 받아 함께 보낸다
 */
const origin = `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 8798) + 1}`;

test('봇 확인이 켜져 있으면 토큰 없이 인증 메일을 보낼 수 없다', async ({ request }) => {
  const config = await (await request.get(`${origin}/api/auth/config`)).json();
  expect(config.turnstileSiteKey).toBe('1x00000000000000000000AA');
  const res = await request.post(`${origin}/api/auth/email/start`, { data: { email: uniqueEmail('bot') } });
  expect(res.status()).toBe(403);
});

test('로그인 화면은 봇 확인 토큰을 받아 인증 메일을 요청한다', async ({ page }) => {
  await page.goto(`${origin}/login`);
  await page.getByPlaceholder('name@example.com').fill(uniqueEmail('human'));
  const start = page.waitForResponse((r) => r.url().endsWith('/api/auth/email/start') && r.request().method() === 'POST', { timeout: 20_000 });
  await page.getByRole('button', { name: '이메일로 계속하기' }).click();
  const res = await start;
  expect(typeof res.request().postDataJSON().turnstile).toBe('string');
  expect(res.status()).toBe(200);
  await expect(page.getByRole('heading', { name: '메일을 확인해 주세요' })).toBeVisible();
});
