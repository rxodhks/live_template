import { dismissToasts, expect, expectDashboard, signUpViaEmail, test, uniqueEmail } from './fixtures';

/*
 * 가입 전 체험하기
 *  - 로그인하지 않아도 예시 템플릿을 열어 고쳐 볼 수 있다 (서버 · 브라우저 저장소에 쓰지 않는다)
 *  - 바뀐 내용은 메모리에만 있고, 초대 · 저장은 가입 안내로 이어진다
 */

test('로그인 화면에서 예시를 열어 직접 고치고 실행해 볼 수 있다', async ({ page, errors }) => {
  test.setTimeout(60_000);
  errors.watch(page);
  await page.goto('/login');
  await page.getByRole('link', { name: '가입 없이 체험해 보기' }).click();
  await expect(page).toHaveURL(/\/explore$/);
  const writes: string[] = [];
  page.on('request', (r) => r.method() !== 'GET' && new URL(r.url()).pathname.startsWith('/api/') && writes.push(`${r.method()} ${r.url()}`));
  await expect(page.getByRole('heading', { name: '예시 템플릿 체험하기' })).toBeVisible();

  await page.getByRole('link', { name: /웹 프로젝트/ }).click();
  await expect(page).toHaveURL(/\/t\/demo-web/);
  await expect(page.getByRole('note').filter({ hasText: '예시 템플릿을 체험하는 중입니다' })).toBeVisible();
  await expect(page.locator('.space-chip')).toContainText('체험 중 · 저장 안 됨');
  // 방문자에게는 프로필 메뉴 대신 로그인 · 가입 버튼
  await expect(page.getByRole('button', { name: '내 프로필' })).toHaveCount(0);
  await expect(page.locator('.topbar').getByRole('link', { name: '로그인 · 가입' })).toBeVisible();

  // 코드: 직접 고쳐서 실행해 볼 수 있다
  await page.goto('/t/demo-web/code');
  await page.getByText('main.js', { exact: true }).first().click();
  const editor = page.locator('.cm-content').first();
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText("console.log('체험 중 고친 코드');");
  await page.locator('.code-module .module-toolbar').getByRole('button', { name: /^(실행|미리보기)$/ }).click();
  await expect(page.locator('.code-module')).toContainText('체험 중 고친 코드', { timeout: 30_000 });

  // 초대는 가입 안내로
  await page.locator('.topbar').getByRole('button', { name: '초대' }).click();
  const invite = page.getByRole('dialog').filter({ hasText: '예시 템플릿에는 초대할 수 없습니다' });
  await expect(invite).toBeVisible();
  await invite.getByRole('button', { name: '닫기', exact: true }).last().click();

  // 비밀 노트도 만들어 볼 수 있다 (메모리에만)
  await page.goto('/t/demo-web/notes');
  await page.locator('.notes-module, main').getByRole('button', { name: '새 비밀 노트' }).first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: '새 비밀 노트' });
  await dialog.getByPlaceholder('예) 배포 서버 계정').fill('체험 노트');
  await dialog.locator('input[type="password"]').nth(0).fill('abcd1234');
  await dialog.locator('input[type="password"]').nth(1).fill('abcd1234');
  await dialog.getByRole('button', { name: '만들기', exact: true }).click();
  await expect(page.getByText('비밀 노트를 만들었습니다')).toBeVisible();
  await expect(page).toHaveURL(/\/t\/demo-web\/notes\/.+/);

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
  await expect(page.locator('.space-chip')).toContainText('체험 중 · 저장 안 됨');
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
    await expect(page.locator('.space-chip')).toContainText('체험 중 · 저장 안 됨');
    const base = new URL(page.url()).pathname.split('/').slice(0, 3).join('/');
    for (const view of ['overview', 'code', 'docs', 'design', 'notes', 'timeline', 'members', 'settings']) {
      await page.goto(`${base}/${view}`);
      await expect(page.getByRole('note').filter({ hasText: '예시 템플릿을 체험하는 중입니다' })).toBeVisible();
    }
  }
});
