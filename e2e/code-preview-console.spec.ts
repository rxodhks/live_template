import type { Page } from '@playwright/test';
import { dismissToasts, expect, expectDashboard, signUpViaEmail, test, uniqueEmail } from './fixtures';

/*
 * 미리보기 콘솔은 지금 보고 있는 파일에서 난 메시지만 보여 준다
 *  - main.html 미리보기에 main.js 오류가 섞여 나오지 않는다 (연결하지 않았을 때도 · <script src>로 연결했을 때도)
 *  - main.js를 열면 그 오류가 보인다
 */

test.describe.configure({ timeout: 240_000 });

const editor = (page: Page) => page.locator('.code-module .cm-content').first();
const output = (page: Page) => page.locator('.code-panel');

async function replaceCode(page: Page, code: string) {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(code);
  await expect(editor(page)).toContainText(code.split('\n')[0]);
}

async function openOutput(page: Page) {
  if (!(await output(page).isVisible())) await page.getByRole('button', { name: '출력 패널' }).click();
}

test('미리보기 콘솔은 지금 파일에서 난 메시지만 보여 준다', async ({ page, errors }) => {
  await page.goto('/');
  await signUpViaEmail(page, uniqueEmail('console'), '콘솔');
  await expectDashboard(page, '콘솔');
  await dismissToasts(page);
  await page.getByRole('button', { name: '새 템플릿' }).first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: '새 템플릿 만들기' });
  await dialog.getByPlaceholder('예) 신규 서비스 런칭').fill(`콘솔 ${Date.now().toString(36)}`);
  await dialog.locator('button.feature-card.feature-code').click();
  await dialog.getByRole('button', { name: '만들기', exact: true }).click();
  await page.waitForURL(/\/t\/[A-Za-z0-9_-]+/);
  await page.getByText('main.js').first().click();

  // main.js: 문법 오류 (아무 글자나)
  await replaceCode(page, '그냥 문자 아무거나');

  // main.html: main.js를 연결하지 않았다 (연결이 없으면 JS 파일이 자동으로 붙는다)
  await dismissToasts(page);
  await page.getByRole('button', { name: '새 파일', exact: true }).click();
  const prompt = page.getByRole('dialog').filter({ hasText: '새 파일' });
  await prompt.getByPlaceholder('예) app.ts, main.py, index.html').fill('main.html');
  await prompt.getByRole('button', { name: '만들기', exact: true }).click();
  await expect(page.locator('.file-tab.is-active')).toContainText('main.html');
  await replaceCode(page, "<h1>안녕</h1>\n<script>console.log('HTML에서 찍음')</script>");
  await page.locator('.code-module .module-toolbar').getByRole('button', { name: '미리보기' }).click();
  await expect(page.frameLocator('iframe.code-preview').locator('h1')).toHaveText('안녕', { timeout: 30_000 });
  await openOutput(page);
  await expect(output(page)).toContainText('HTML에서 찍음');
  await expect(output(page)).toContainText('다른 파일(main.js)의 미리보기 메시지는 그 파일을 열면 보입니다');
  expect(await output(page).innerText()).not.toMatch(/SyntaxError|Unexpected/);
  await expect(page.locator('.side-console')).toHaveText(/콘솔 1/);
  await expect(page.locator('.side-console.has-error')).toHaveCount(0);

  // <script src>로 연결해도 main.html에는 main.js 오류가 나오지 않는다
  await replaceCode(page, "<h1>연결</h1>\n<script src=\"main.js\"></script>\n<script>console.log('연결 뒤')</script>");
  await expect(page.frameLocator('iframe.code-preview').locator('h1')).toHaveText('연결', { timeout: 30_000 });
  await expect(output(page)).toContainText('연결 뒤');
  expect(await output(page).innerText()).not.toMatch(/SyntaxError|Unexpected/);

  // main.js를 열면 그 파일의 오류가 보인다
  await page.locator('.file-tab').filter({ hasText: 'main.js' }).click();
  await expect(page.locator('.file-tab.is-active')).toContainText('main.js');
  await expect(page.locator('.side-console.has-error')).toBeVisible({ timeout: 30_000 });
  await openOutput(page);
  await expect(output(page).locator('.out-error')).toContainText('[미리보기]');
  expect(await output(page).innerText()).not.toContain('연결 뒤');

  // 미리보기 안의 오류는 의도한 것이라 콘솔 오류 검사에서 뺀다
  errors.list.splice(0, errors.list.length, ...errors.list.filter((e) => !/SyntaxError|Unexpected|Invalid or unexpected/.test(e)));
});
