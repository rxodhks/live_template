import { dismissToasts, expect, expectDashboard, signUpViaEmail, test, uniqueEmail } from './fixtures';

/*
 * 가입 전 둘러보기
 *  - 로그인하지 않아도 예시 템플릿을 읽기 전용으로 열 수 있다 (서버 · 브라우저 저장소에 쓰지 않는다)
 *  - 코드 실행 · 미리보기는 그대로 되고, 편집 · 만들기는 가입 안내로 이어진다
 */

test('로그인 화면에서 예시를 둘러보고 코드를 실행해 볼 수 있다', async ({ page, errors }) => {
  test.setTimeout(60_000);
  errors.watch(page);
  await page.goto('/login');
  await page.getByRole('link', { name: '가입 전에 예시 둘러보기' }).click();
  await expect(page).toHaveURL(/\/explore$/);
  const writes: string[] = [];
  page.on('request', (r) => r.method() !== 'GET' && new URL(r.url()).pathname.startsWith('/api/') && writes.push(`${r.method()} ${r.url()}`));
  await expect(page.getByRole('heading', { name: '예시 템플릿 둘러보기' })).toBeVisible();

  await page.getByRole('link', { name: /웹 프로젝트/ }).click();
  await expect(page).toHaveURL(/\/t\/demo-web/);
  await expect(page.getByRole('note').filter({ hasText: '예시 템플릿을 둘러보는 중입니다' })).toBeVisible();
  await expect(page.locator('.space-chip')).toContainText('예시 · 읽기 전용');
  // 방문자에게는 프로필 메뉴 대신 로그인 · 가입 버튼
  await expect(page.getByRole('button', { name: '내 프로필' })).toHaveCount(0);
  await expect(page.locator('.topbar').getByRole('link', { name: '로그인 · 가입' })).toBeVisible();

  // 코드: 읽기 전용이지만 실행된다
  await page.goto('/t/demo-web/code');
  const editor = page.locator('.cm-content').first();
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await page.getByText('main.js', { exact: true }).first().click();
  await page.locator('.code-module .module-toolbar').getByRole('button', { name: /^(실행|미리보기)$/ }).click();
  await expect(page.locator('.code-module')).toContainText('페이지가 준비되었습니다', { timeout: 30_000 });

  // 만들고 편집하려면 가입
  expect(writes, '둘러보기는 서버에 쓰지 않는다').toEqual([]);
  await page.getByRole('note').getByRole('link', { name: '가입하고 만들기' }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test('없는 예시 주소는 둘러보기 목록으로, 다른 템플릿 주소는 로그인으로 보낸다', async ({ page }) => {
  await page.goto('/t/demo-nothing');
  await expect(page).toHaveURL(/\/explore$/);
  await page.goto('/t/abcdef');
  await expect(page).toHaveURL(/\/login/);
});

test('로그인한 사람도 예시를 열어 보고, 대시보드에는 남지 않는다', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await signUpViaEmail(page, uniqueEmail('explore'), '둘러보기');
  await expectDashboard(page, '둘러보기');
  await dismissToasts(page);
  await page.goto('/explore');
  await expect(page.getByRole('link', { name: '내 대시보드' })).toBeVisible();
  await page.getByRole('link', { name: /웹 프로젝트/ }).click();
  await expect(page.locator('.space-chip')).toContainText('예시 · 읽기 전용');
  await expect(page.getByRole('button', { name: '내 프로필' })).toBeVisible();
  await page.getByRole('note').getByRole('link', { name: '다른 예시' }).click();
  await page.getByRole('link', { name: '내 대시보드' }).click();
  await expectDashboard(page, '둘러보기');
  await expect(page.getByText('개인 공간 0개 · 협업 공간 0개')).toBeVisible();
});

test('모든 예시의 화면을 오류 없이 열 수 있다', async ({ page, errors }) => {
  test.setTimeout(90_000);
  errors.watch(page);
  await page.goto('/explore');
  const cards = page.locator('.explore-card');
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  expect(count).toBeGreaterThan(3);
  for (let i = 0; i < count; i++) {
    await page.goto('/explore');
    await cards.nth(i).click();
    await expect(page.locator('.space-chip')).toContainText('예시 · 읽기 전용');
    const base = new URL(page.url()).pathname.split('/').slice(0, 3).join('/');
    for (const view of ['overview', 'code', 'docs', 'design', 'notes', 'timeline', 'members', 'settings']) {
      await page.goto(`${base}/${view}`);
      await expect(page.getByRole('note').filter({ hasText: '예시 템플릿을 둘러보는 중입니다' })).toBeVisible();
    }
  }
});
