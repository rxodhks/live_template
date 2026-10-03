import { expect, test } from '@playwright/test';

/*
 * 서버 장애 안내
 *  - 서버(API)가 응답하지 않으면 로그인 화면 대신 장애 안내와 문의 이메일을 보여 주고, 서버가 돌아오면 이어진다
 *  - 앱 파일 자체를 받지 못하면 빈 화면 대신 index.html의 안내를 보여 준다
 */

const CONTACT = 'madang.contact@gmail.com';

test('서버가 응답하지 않으면 장애 안내를 보여 주고, 돌아오면 이어진다', async ({ page }) => {
  let down = true;
  // 클라우드플레어가 대신 내보내는 오류 페이지(HTML 502)처럼 응답
  await page.route('**/api/me', (route) => (down ? route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad gateway</html>' }) : route.fallback()));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '서비스에 일시적인 문제가 있습니다' })).toBeVisible();
  await expect(page.getByRole('link', { name: CONTACT })).toHaveAttribute('href', new RegExp(`^mailto:${CONTACT}\\?subject=`));
  await expect(page.getByText('서버 응답 502')).toBeVisible();

  down = false;
  await page.getByRole('button', { name: '다시 시도' }).click();
  // 로그인하지 않은 사람은 로그인 화면으로
  await expect(page).toHaveURL(/\/login/);
});

test('앱 파일을 받지 못하면 빈 화면 대신 안내를 보여 준다', async ({ page }) => {
  await page.route(/\/assets\/index-[^/]+\.js$/, (route) => route.fulfill({ status: 503, body: '' }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Madang 화면을 불러오지 못했습니다' })).toBeVisible();
  await expect(page.getByRole('link', { name: CONTACT })).toHaveAttribute('href', new RegExp(`^mailto:${CONTACT}`));
});

test('화면 파일이 정상이면 안내가 보이지 않는다', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.locator('#app-outage')).toBeHidden();
});
