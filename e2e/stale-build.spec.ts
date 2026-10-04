import { expect, test, type Page } from '@playwright/test';
import { dismissToasts, expectDashboard, signUpViaEmail, uniqueEmail } from './fixtures';

/*
 * 배포 전에 열어 둔 탭
 *  - 서버: 없는 화면 파일(/assets/…)은 index.html이 아니라 404로 답한다 (화면 주소는 그대로 앱 화면)
 *  - 화면: 지연 로딩 파일을 못 불러오면 새 버전이 있는지 확인하고 한 번 새로고침한다. 새 버전이 없으면 새로고침하지 않고 안내한다
 * 실제 배포 대신, 템플릿을 만들 때 받는 파일(seed)을 404로 막고 서버의 index.html 진입 파일 이름을 바꿔 흉내 낸다
 */

test('없는 화면 파일은 404, 화면 주소는 앱 화면으로 답한다', async ({ request }) => {
  for (const p of ['/assets/seed-OLDHASH0.js', '/assets/index-OLDHASH0.css', '/runtimes/old-0000/x.wasm']) {
    const res = await request.get(p);
    expect(res.status(), p).toBe(404);
    expect(res.headers()['content-type'], p).not.toContain('text/html');
    expect(res.headers()['cache-control'], p).toBe('no-store');
  }
  for (const p of ['/', '/login', '/t/abc/design']) {
    const res = await request.get(p);
    expect(res.status(), p).toBe(200);
    expect(res.headers()['content-type'], p).toContain('text/html');
  }
});

async function openCreateDialog(page: Page, name: string) {
  await page.goto('/');
  await signUpViaEmail(page, uniqueEmail('stale'), name);
  await expectDashboard(page, name);
  await dismissToasts(page);
  await page.getByRole('button', { name: '새 템플릿' }).first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: '새 템플릿 만들기' });
  await dialog.getByPlaceholder('예) 신규 서비스 런칭').fill(`새 버전 ${Date.now().toString(36)}`);
  return dialog;
}

/** 템플릿을 만들 때 받는 파일이 사라진 것처럼 (새 배포로 이름이 바뀐 예전 파일). state.stale이 false가 되면 정상으로 */
const blockSeedChunk = (page: Page, state = { stale: true }) =>
  page.route(/\/assets\/seed-[\w-]+\.js$/, (route) =>
    state.stale ? route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' }) : route.fallback(),
  );

test('새 버전이 배포된 뒤 예전 탭에서 템플릿을 만들면 새로고침한 뒤 만들 수 있다', async ({ page }) => {
  test.setTimeout(90_000);
  const dialog = await openCreateDialog(page, '예전탭');
  // 새로고침한 화면은 새 버전이므로 정상으로 돌린다 (라우트를 지우는 대신 상태만 바꿔 진행 중인 요청을 끊지 않는다)
  const state = { stale: true };
  await blockSeedChunk(page, state);
  // 서버에는 새 버전이 올라가 있다: 화면이 확인용으로 받는 index.html의 진입 파일 이름이 다르다
  await page.route('**/', async (route) => {
    if (!state.stale || route.request().resourceType() !== 'fetch') return route.fallback();
    state.stale = false;
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace(/\/assets\/index-[\w-]+\.js/, '/assets/index-NEWBUILD0.js') });
  });

  const reloaded = page.waitForEvent('load');
  await dialog.getByRole('button', { name: '만들기', exact: true }).click();
  await reloaded;
  expect(state.stale, '새 버전 확인 요청').toBe(false);
  await expectDashboard(page, '예전탭');

  // 새로고침한 화면에서는 그대로 만들어진다
  const again = page.getByRole('dialog').filter({ hasText: '새 템플릿 만들기' });
  await dismissToasts(page);
  await page.getByRole('button', { name: '새 템플릿' }).first().click();
  await again.getByPlaceholder('예) 신규 서비스 런칭').fill('새로고침 뒤');
  await again.getByRole('button', { name: '만들기', exact: true }).click();
  await expect(page).toHaveURL(/\/t\/[A-Za-z0-9_-]+/);
});

test('새 버전이 없으면 새로고침하지 않고 안내만 보여 준다', async ({ page }) => {
  test.setTimeout(90_000);
  const dialog = await openCreateDialog(page, '연결끊김');
  await blockSeedChunk(page);
  let navigations = 0;
  page.on('framenavigated', (f) => f === page.mainFrame() && navigations++);
  await dialog.getByRole('button', { name: '만들기', exact: true }).click();
  await expect(page.getByText('필요한 화면 파일을 불러오지 못했습니다')).toBeVisible();
  await expect(page.getByText('is not a valid JavaScript MIME type')).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(navigations).toBe(0);
  await expect(dialog).toBeVisible();
});
