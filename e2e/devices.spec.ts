import { test, expect, expectDashboard, signUpViaEmail, uniqueEmail } from './fixtures';

/*
 * 로그인된 기기: 프로필 수정에서 지금 로그인된 기기를 보고, 다른 기기를 모두 로그아웃한다
 */
test('다른 브라우저의 로그인이 기기 목록에 보이고, "다른 기기 모두 로그아웃"으로 끊을 수 있다', async ({ page, newUserPage }) => {
  const email = uniqueEmail('devices');
  await page.goto('/login');
  await signUpViaEmail(page, email, '기기 주인');
  await expectDashboard(page, '기기 주인');

  // 다른 브라우저(쿠키가 따로)에서 같은 이메일로 로그인
  const other = await newUserPage();
  await other.goto('/login');
  await other.getByPlaceholder('name@example.com').fill(email);
  const start = other.waitForResponse((r) => r.url().endsWith('/api/auth/email/start') && r.request().method() === 'POST');
  await other.getByRole('button', { name: '이메일로 계속하기' }).click();
  expect((await start).status()).toBe(200);
  await other.getByRole('button', { name: '입력하기' }).click();
  await expectDashboard(other, '기기 주인');

  await page.getByRole('button', { name: '내 프로필' }).click();
  await page.getByRole('menuitem', { name: '프로필 수정' }).click();
  const profile = page.getByRole('dialog').filter({ hasText: '로그인된 기기' });
  const rows = profile.locator('.session-list li');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: '이 기기' })).toHaveCount(1);

  await profile.getByRole('button', { name: '다른 기기 모두 로그아웃' }).click();
  await page.getByRole('dialog').filter({ hasText: '다른 기기를 모두 로그아웃할까요?' }).getByRole('button', { name: '모두 로그아웃' }).click();
  await expect(rows).toHaveCount(1);
  await expect(page.getByText('다른 기기를 로그아웃했습니다')).toBeVisible();

  // 다른 브라우저의 로그인은 끊겼다 (화면을 다시 열면 로그인 화면으로 간다)
  const meStatus = (p: typeof page) => p.evaluate(() => fetch('/api/me').then((r) => r.status));
  expect(await meStatus(other)).toBe(401);
  expect(await meStatus(page)).toBe(200);
});
