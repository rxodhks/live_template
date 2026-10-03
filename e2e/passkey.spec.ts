import { test, expect, expectDashboard, signUpViaEmail, uniqueEmail } from './fixtures';

/*
 * 패스키: 크로미움의 가상 인증기(지문 · 얼굴 인증기를 흉내 냄)로 실제 브라우저 흐름을 확인한다
 *  - 이메일로 가입한 직후 패스키 등록을 권하고, 등록하면
 *  - 로그아웃 뒤 로그인 화면에 지난 이메일이 채워져 있고, "패스키로 로그인" 한 번으로 들어온다
 * 패스키는 IP 주소에서 쓸 수 없어(사이트 이름이 필요) 이 테스트만 localhost로 연다.
 */
const origin = `http://localhost:${Number(process.env.E2E_PORT ?? 8798)}`;

test('이메일로 가입 → 패스키 등록 → 로그아웃 → 패스키 한 번으로 다시 로그인', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  const email = uniqueEmail('passkey');
  await page.goto(`${origin}/login`);
  await signUpViaEmail(page, email, '패스키 사용자');
  await expectDashboard(page, '패스키 사용자');

  // 가입 직후 한 번: 이 기기에 패스키를 등록할지 묻는다
  const offer = page.getByRole('dialog').filter({ hasText: '다음부터 더 빠르게 로그인할까요?' });
  await expect(offer).toBeVisible();
  const registered = page.waitForResponse((r) => r.url().endsWith('/api/auth/passkey/register') && r.request().method() === 'POST');
  await offer.getByRole('button', { name: '패스키 등록' }).click();
  expect((await registered).status()).toBe(201);
  await expect(page.getByText('패스키를 등록했습니다')).toBeVisible();
  const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
  expect(credentials).toHaveLength(1);
  expect(credentials[0].isResidentCredential).toBe(true);

  // 로그아웃. 가상 인증기는 사용자 확인을 자동으로 해 주므로 이메일 칸의 패스키 자동 완성으로 바로 들어와 버린다 —
  // 로그인 화면을 확인하는 동안은 끈다
  await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled: false });
  await page.getByRole('button', { name: '내 프로필' }).click();
  await page.getByRole('menuitem', { name: '로그아웃' }).click();
  await page.waitForURL(/\/login/);

  // 지난번 이메일이 채워져 있고, 패스키 버튼에 '최근 사용'
  await expect(page.getByPlaceholder('name@example.com')).toHaveValue(email);
  const passkeyButton = page.getByRole('button', { name: /패스키로 로그인/ });
  await expect(passkeyButton).toContainText('최근 사용');

  await expect(passkeyButton).toBeEnabled();
  const login = page.waitForResponse((r) => r.url().endsWith('/api/auth/passkey/login') && r.request().method() === 'POST');
  await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled: true });
  // 사용자 확인을 다시 켜는 순간 이메일 칸에 띄워 둔 자동 완성 요청이 먼저 끝나 화면이 바뀔 수 있다
  // (로그인 화면이 빨리 뜰수록 자주 생긴다). 어느 쪽으로 들어가든 패스키 한 번으로 로그인하면 된다
  await passkeyButton.click({ timeout: 3_000 }).catch(() => {});
  expect((await login).status()).toBe(200);
  await expectDashboard(page, '패스키 사용자');

  // 프로필 수정에서 등록한 패스키를 볼 수 있다
  await page.getByRole('button', { name: '내 프로필' }).click();
  await page.getByRole('menuitem', { name: '프로필 수정' }).click();
  const profile = page.getByRole('dialog').filter({ hasText: '패스키 로그인' });
  await expect(profile.locator('.passkey-list li')).toHaveCount(1);
  await expect(profile.locator('.passkey-list li')).toContainText('마지막 사용');
});

test('기억한 이메일은 지울 수 있고, 지우면 다음에 채워지지 않는다', async ({ page }) => {
  await page.goto(`${origin}/login`);
  await page.evaluate(() => localStorage.setItem('lt.lastLogin', JSON.stringify({ method: 'email', email: 'remembered@example.com' })));
  await page.reload();
  const input = page.getByPlaceholder('name@example.com');
  await expect(input).toHaveValue('remembered@example.com');
  await page.getByRole('button', { name: '기억 지우기' }).click();
  await expect(input).toHaveValue('');
  await page.reload();
  await expect(input).toHaveValue('');
});
