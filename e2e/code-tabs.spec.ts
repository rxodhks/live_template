import { dismissToasts, expect, expectDashboard, signUpViaEmail, test, uniqueEmail } from './fixtures';

/*
 * 코드 화면 위의 열린 파일 탭 — 브라우저 탭처럼 파일을 오간다
 */

test.describe.configure({ timeout: 120_000 });

test('열린 파일 탭으로 전환 · 닫기 · 새로 고침 뒤에도 남는다', async ({ page }) => {
  await page.goto('/');
  await signUpViaEmail(page, uniqueEmail('tabs'), '탭쓰기');
  await expectDashboard(page, '탭쓰기');
  await dismissToasts(page);
  await page.getByRole('button', { name: '새 템플릿' }).first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: '새 템플릿 만들기' });
  await dialog.getByPlaceholder('예) 신규 서비스 런칭').fill(`탭 ${Date.now().toString(36)}`);
  await dialog.locator('button.feature-card.feature-code').click();
  await dialog.getByRole('button', { name: '만들기', exact: true }).click();
  await page.waitForURL(/\/t\/[A-Za-z0-9_-]+/);
  await page.getByText('main.js').first().click();

  const tabs = page.locator('.code-module .file-tab');
  const editor = page.locator('.code-module .cm-content');
  await expect(tabs).toHaveCount(1);
  await expect(tabs.first()).toContainText('main.js');
  // 탭이 하나면 닫기 버튼이 없다
  await expect(page.locator('.file-tab-close')).toHaveCount(0);

  // + 로 새 파일 → 오른쪽에 새 탭
  await page.getByRole('button', { name: '새 파일', exact: true }).click();
  const prompt = page.getByRole('dialog').filter({ hasText: '새 파일' });
  await prompt.getByPlaceholder('예) app.ts, main.py, index.html').fill('util.py');
  await prompt.getByRole('button', { name: '만들기', exact: true }).click();
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toContainText('util.py');
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('button.lang-select')).toHaveText('Python');

  // 탭을 눌러 전환
  await tabs.nth(0).click();
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('button.lang-select')).toHaveText('JavaScript');
  await expect(editor).toContainText('console.log');

  // 새로 고침해도 열린 탭이 남는다
  await page.reload();
  await expect(tabs).toHaveCount(2);

  // 가운데 클릭으로 닫기 (지금 탭이 아니면 화면은 그대로)
  await tabs.nth(1).click({ button: 'middle' });
  await expect(tabs).toHaveCount(1);
  await expect(page.locator('button.lang-select')).toHaveText('JavaScript');

  // 왼쪽 목록에서 다시 열면 탭이 다시 생기고, × 로 지금 탭을 닫으면 옆 탭으로
  await page.locator('.shell-panel, aside').getByText('util.py').first().click();
  await expect(tabs).toHaveCount(2);
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'util.py 탭 닫기' }).click();
  await expect(tabs).toHaveCount(1);
  await expect(page.locator('button.lang-select')).toHaveText('JavaScript');
});
