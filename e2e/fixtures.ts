import { test as base, expect, type BrowserContext, type ConsoleMessage, type Page } from '@playwright/test';
import crypto from 'node:crypto';

/*
 * 공통 도구
 *  - 외부 글꼴(CDN) 요청은 빈 응답으로 대신한다: 네트워크 상태와 관계없이 같은 결과가 나오도록
 *  - 모든 페이지의 콘솔 오류 · 처리되지 않은 예외를 모아 테스트가 끝날 때 없음을 확인한다
 */

/** 로그인 전 세션 확인(/api/me)의 401은 정상 동작이라 오류로 보지 않는다 */
const ALLOWED_CONSOLE_ERRORS: ((m: ConsoleMessage) => boolean)[] = [
  (m) => m.text().includes('401') && new URL(m.location().url || 'http://x/').pathname === '/api/me',
];

export interface PageErrors {
  list: string[];
  watch(page: Page): void;
}

async function hermetic(context: BrowserContext) {
  await context.route(/^https:\/\/cdn\.jsdelivr\.net\//, (route) =>
    route.fulfill({ status: 200, contentType: route.request().resourceType() === 'stylesheet' ? 'text/css' : 'application/octet-stream', body: '' }),
  );
}

export const test = base.extend<{ errors: PageErrors; newUserPage: () => Promise<Page> }>({
  errors: async ({}, use) => {
    const list: string[] = [];
    const watch = (page: Page) => {
      page.on('console', (m) => {
        if (m.type() === 'error' && !ALLOWED_CONSOLE_ERRORS.some((ok) => ok(m))) list.push(`[console] ${m.text()} @ ${m.location().url}`);
      });
      page.on('pageerror', (e) => list.push(`[pageerror] ${e.message}`));
    };
    await use({ list, watch });
    expect(list, 'console errors / uncaught exceptions').toEqual([]);
  },
  context: async ({ context }, use) => {
    await hermetic(context);
    await use(context);
  },
  page: async ({ page, errors }, use) => {
    errors.watch(page);
    await use(page);
  },
  /** 두 번째 사용자용: 쿠키 · 저장소가 따로인 새 브라우저 컨텍스트 */
  newUserPage: async ({ browser, errors }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async () => {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      await hermetic(ctx);
      const page = await ctx.newPage();
      errors.watch(page);
      return page;
    });
    await Promise.all(contexts.map((c) => c.close()));
  },
});

export { expect };

export const uniqueEmail = (tag: string) => `e2e-${tag}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}@example.com`;

/**
 * 로그인 화면에서 이메일 인증 코드로 가입까지 마친다.
 * AUTH_DEV_MODE에서는 화면에 인증 코드와 "입력하기" 버튼이 나온다.
 */
export async function signUpViaEmail(page: Page, email: string, name: string) {
  await page.getByPlaceholder('name@example.com').fill(email);
  const start = page.waitForResponse((r) => r.url().endsWith('/api/auth/email/start') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '이메일로 계속하기' }).click();
  const res = await start;
  expect(res.status()).toBe(200);
  const devCode = (await res.json()).devCode as string;
  expect(devCode, 'AUTH_DEV_MODE devCode').toMatch(/^\d{6}$/);

  await expect(page.getByRole('heading', { name: '메일을 확인해 주세요' })).toBeVisible();
  await expect(page.getByRole('note')).toContainText(devCode);
  await page.getByRole('button', { name: '입력하기' }).click();

  // 처음 가입: 이름 정하기 단계
  await page.waitForURL(/\/signup/);
  await expect(page.getByRole('heading', { name: '이름을 정해 주세요' })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await page.getByPlaceholder('예) 김민수').fill(name);
  await page.getByRole('button', { name: '가입 완료하고 시작하기' }).click();
}

/** 메인 화면(대시보드)이 보일 때까지 */
export async function expectDashboard(page: Page, name: string) {
  await expect(page.getByRole('heading', { level: 1, name: new RegExp(`${name} 님`) })).toBeVisible();
  await expect(page.getByRole('button', { name: '새 템플릿' }).first()).toBeVisible();
}

// 참고: 공용 Modal에 접근 가능한 이름(aria-labelledby)이 없어 제목 글자로 찾는다
/**
 * 떠 있는 알림(토스트)을 모두 닫는다.
 * 가입 직후 "환영합니다" 알림이 대시보드 오른쪽 위 "새 템플릿" 버튼을 약 4초 동안 가린다 (알려진 화면 문제).
 */
export async function dismissToasts(page: Page) {
  const region = page.getByRole('region', { name: '알림' });
  // 닫히는 중(is-leaving)인 알림은 건너뛴다
  const close = region.locator('.toast:not(.is-leaving)').getByRole('button', { name: '알림 닫기' });
  for (let i = 0; i < 10 && (await close.count()) > 0; i++) await close.first().click({ timeout: 2000 }).catch(() => {});
  await expect(region.getByRole('status')).toHaveCount(0);
}

/** 대시보드에서 빈 문서 템플릿을 만들고 작업 공간이 열릴 때까지 */
export async function createTemplate(page: Page, name: string) {
  await dismissToasts(page);
  await page.getByRole('button', { name: '새 템플릿' }).first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: '새 템플릿 만들기' });
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('예) 신규 서비스 런칭').fill(name);
  const t0 = Date.now();
  await dialog.getByRole('button', { name: '만들기', exact: true }).click();
  await page.waitForURL(/\/t\/[A-Za-z0-9_-]+/);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  return { id: new URL(page.url()).pathname.split('/')[2], ms: Date.now() - t0 };
}

/** 정보용 측정값: 테스트 결과(주석)와 출력에 남긴다. 기준값은 두지 않는다 */
export function metric(name: string, ms: number) {
  const value = `${Math.round(ms)}ms`;
  test.info().annotations.push({ type: `metric:${name}`, description: value });
  console.log(`[metric] ${name}: ${value}`);
}
