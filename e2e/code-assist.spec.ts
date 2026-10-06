import type { Page } from '@playwright/test';
import { dismissToasts, expect, expectDashboard, signUpViaEmail, test, uniqueEmail } from './fixtures';

/*
 * 코드 편집기 기본기
 *  - 자동 정렬 (Prettier · Ruff)
 *  - 오류 밑줄: TypeScript 타입 오류, 파이썬 Ruff 경고 · 상태 표시줄의 문제 수
 *  - 실행 오류의 ‘파일:줄’을 누르면 그 줄로 이동
 */

test.describe.configure({ timeout: 240_000 });

const editor = (page: Page) => page.locator('.code-module .cm-content');
const status = (page: Page) => page.locator('.code-module .status-lint');

async function openCodeWorkspace(page: Page) {
  await page.goto('/');
  await signUpViaEmail(page, uniqueEmail('assist'), '정렬러');
  await expectDashboard(page, '정렬러');
  await dismissToasts(page);
  await page.getByRole('button', { name: '새 템플릿' }).first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: '새 템플릿 만들기' });
  await dialog.getByPlaceholder('예) 신규 서비스 런칭').fill(`기본기 ${Date.now().toString(36)}`);
  await dialog.locator('button.feature-card.feature-code').click();
  await dialog.getByRole('button', { name: '만들기', exact: true }).click();
  await page.waitForURL(/\/t\/[A-Za-z0-9_-]+/);
  await page.getByText('main.js').first().click();
  await expect(editor(page)).toContainText('console.log');
}

async function chooseLanguage(page: Page, name: string) {
  await dismissToasts(page);
  await page.locator('button.lang-select').click();
  await page.getByRole('menuitem', { name: new RegExp(`^${name}\\s*(\\.\\w+)?$`) }).click();
  await expect(page.locator('button.lang-select')).toHaveText(name);
}

async function replaceCode(page: Page, code: string) {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(code);
  await expect(editor(page)).toContainText(code.split('\n')[0].trim());
}

test('자동 정렬 · 오류 밑줄 · 오류 줄로 이동', async ({ page }) => {
  await openCodeWorkspace(page);

  // JS 자동 정렬 (버튼)
  await replaceCode(page, "const point = {x:1,  y:2}\nconsole.log( point.x+point.y )");
  await dismissToasts(page);
  await page.getByRole('button', { name: '자동 정렬 (Shift + Alt + F)' }).click();
  await expect(editor(page)).toContainText('const point = { x: 1, y: 2 };', { timeout: 30_000 });
  await expect(editor(page)).toContainText('console.log(point.x + point.y);');
  // 문제 없는 코드는 ‘문제 없음’
  await expect(status(page)).toHaveText('✓ 문제 없음', { timeout: 60_000 });

  // TypeScript 타입 오류 → 밑줄 + 상태 표시줄 (한국어 메시지)
  await chooseLanguage(page, 'TypeScript');
  await replaceCode(page, "const count: number = 'hi';\nconsole.log(count);");
  await expect(page.locator('.code-module .cm-lintRange-error')).toHaveCount(1, { timeout: 60_000 });
  await expect(status(page)).toHaveText('오류 1');
  await status(page).click();
  await expect(page.locator('.cm-panel.cm-panel-lint')).toContainText("'string' 형식은 'number' 형식에 할당할 수 없습니다");
  await page.keyboard.press('Escape');

  // 빠른 수정: 오타 난 속성 이름 → 설명 아래 버튼으로 고친다
  await replaceCode(page, "const score = { count: 3 };\nconsole.log(score.cuont);");
  await expect(status(page)).toHaveText('오류 1', { timeout: 30_000 });
  await page.locator('.code-module .cm-lintRange-error').hover();
  await page.locator('.cm-tooltip-lint .cm-diagnosticAction', { hasText: 'count' }).click();
  await expect(editor(page)).toContainText('console.log(score.count);');
  await expect(status(page)).toHaveText('✓ 문제 없음', { timeout: 30_000 });

  // 실행 오류의 파일:줄을 누르면 그 줄로
  await replaceCode(page, "function boom() {\n  throw new Error('터짐');\n}\n\nboom();");
  await expect(status(page)).toHaveText('✓ 문제 없음', { timeout: 30_000 });
  await page.locator('.code-module .module-toolbar').getByRole('button', { name: '실행', exact: true }).click();
  const loc = page.locator('.code-panel .out-loc', { hasText: 'main.ts:2' });
  await expect(loc).toBeVisible({ timeout: 60_000 });
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await expect(page.locator('.code-module .statusbar')).toContainText('줄 5');
  await loc.click();
  await expect(page.locator('.code-module .statusbar')).toContainText('줄 2,');

  // 파이썬: Ruff 경고 (안 쓰는 import · 정의 안 된 이름) + 정렬
  await chooseLanguage(page, 'Python');
  await replaceCode(page, 'import os\nprint( undefined_name )');
  await expect(status(page)).toHaveText('경고 2', { timeout: 90_000 });
  await expect(page.locator('.code-module .cm-lintRange-warning')).toHaveCount(2);
  await status(page).click();
  await expect(page.locator('.cm-panel.cm-panel-lint')).toContainText("정의되지 않은 이름입니다: 'undefined_name'");
  await page.keyboard.press('Escape');
  // 빠른 수정: 안 쓰는 import 지우기
  await page.mouse.move(0, 0);
  await page.locator('.code-module .cm-lintRange-warning').first().hover();
  await page.locator('.cm-tooltip-lint .cm-diagnosticAction', { hasText: '안 쓰는 import 지우기' }).click();
  await expect(editor(page)).not.toContainText('import os');
  await expect(status(page)).toHaveText('경고 1', { timeout: 30_000 });
  await dismissToasts(page);
  await editor(page).click();
  await page.keyboard.press('Shift+Alt+F');
  await expect(editor(page)).toContainText('print(undefined_name)', { timeout: 30_000 });
});
