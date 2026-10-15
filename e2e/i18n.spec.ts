import { expect, test } from './fixtures';

/*
 * 영어 화면
 *  - 한국어가 아닌 브라우저는 처음부터 영어로 연다 (영어 사전은 이때만 따로 받는다)
 *  - 고른 언어는 기억하고, 화면 아래 링크로 바로 바꿀 수 있다
 *  - 화면에 한국어가 남지 않는다 (브랜드 '마당' · 언어 이름 '한국어' · 약관 원문 · 공지 글은 예외)
 */

test.use({ locale: 'en-US' });

/** 화면 글자 가운데 한국어 (허용한 낱말은 뺀다) */
async function koreanLeft(page: import('@playwright/test').Page): Promise<string[]> {
  const text = await page.locator('body').innerText();
  return [...new Set(text.match(/[가-힣][가-힣\s·]*/g) ?? [])].map((s) => s.trim()).filter((s) => s && !['마당', '한국어'].includes(s));
}

test('영어 브라우저는 로그인 화면 · 체험 화면이 영어로 열린다', async ({ page, errors }) => {
  test.setTimeout(60_000);
  errors.watch(page);
  await page.goto('/login');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('link', { name: 'Try it without signing up' })).toBeVisible();
  expect(await koreanLeft(page)).toEqual([]);

  await page.getByRole('link', { name: 'Try it without signing up' }).click();
  await expect(page.getByRole('heading', { name: 'Try an example template' })).toBeVisible();
  expect(await koreanLeft(page)).toEqual([]);

  // 예시 내용(시작 파일 · 문서)도 영어로 만들어진다
  await page.getByRole('link', { name: /Web project/ }).click();
  await expect(page).toHaveURL(/\/t\/demo-web/);
  await expect(page.locator('.space-chip')).toContainText('Trying it out · Not saved');
  await expect(page.locator('.topbar').getByRole('link', { name: 'Sign in or sign up' })).toBeVisible();
  await page.goto('/t/demo-web/code');
  await page.getByText('main.js', { exact: true }).first().click();
  await expect(page.locator('.cm-content').first()).toContainText('The page is ready');
  expect(await koreanLeft(page)).toEqual([]);
});

test('화면 아래 언어 링크로 한국어 ↔ English를 바꾸고, 고른 언어를 기억한다', async ({ page, errors }) => {
  errors.watch(page);
  await page.goto('/login');
  await page.getByRole('button', { name: /한국어/ }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await expect(page.getByRole('link', { name: '가입 없이 체험해 보기' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('link', { name: '가입 없이 체험해 보기' })).toBeVisible();

  await page.getByRole('button', { name: /English/ }).click();
  await expect(page.getByRole('link', { name: 'Try it without signing up' })).toBeVisible();
});

test('영어 화면의 약관 · 방침은 참고용 영어 번역을 보여 주고, 한국어 원문이 우선한다고 알린다', async ({ page }) => {
  await page.goto('/terms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Terms of Service');
  await expect(page.getByText('The Korean original is the legally binding version')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Article 1 (Purpose)' })).toBeVisible();
  await page.getByRole('button', { name: 'View the Korean original' }).click();
  await expect(page.getByRole('heading', { name: '제1조 (목적)' })).toBeVisible();

  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Privacy Policy');
  await expect(page.getByRole('heading', { name: '1. Personal information we collect' })).toBeVisible();
  expect(await koreanLeft(page)).toEqual([]);
});
