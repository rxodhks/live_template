import type { Page } from '@playwright/test';
import { dismissToasts, expect, expectDashboard, signUpViaEmail, test, uniqueEmail } from './fixtures';

/*
 * 언어별 자동 완성
 *  - HTML: ! 만 쳐도 추천, ! + Tab → 기본 구조, Emmet 약어(ul>li*3) + Tab
 *  - CSS: Emmet (m10 + Tab → margin: 10px;)
 *  - JS: 객체의 메서드 추천 (TypeScript 언어 서비스), 코드 조각(log)
 *  - 파이썬: 내장 함수 추천
 */

test.describe.configure({ timeout: 240_000 });

// 추천 목록의 Emmet 미리보기도 작은 편집기라 첫 번째(본 편집기)만
const editor = (page: Page) => page.locator('.code-module .cm-content').first();
const options = (page: Page) => page.locator('.cm-tooltip-autocomplete li');

async function newFile(page: Page, name: string) {
  await dismissToasts(page);
  await page.getByRole('button', { name: '새 파일', exact: true }).click();
  const prompt = page.getByRole('dialog').filter({ hasText: '새 파일' });
  await prompt.getByPlaceholder('예) app.ts, main.py, index.html').fill(name);
  await prompt.getByRole('button', { name: '만들기', exact: true }).click();
  await expect(page.locator('.file-tab.is-active')).toContainText(name);
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
}

test('언어별 자동 완성 · Emmet', async ({ page }) => {
  await page.goto('/');
  await signUpViaEmail(page, uniqueEmail('complete'), '완성');
  await expectDashboard(page, '완성');
  await dismissToasts(page);
  await page.getByRole('button', { name: '새 템플릿' }).first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: '새 템플릿 만들기' });
  await dialog.getByPlaceholder('예) 신규 서비스 런칭').fill(`완성 ${Date.now().toString(36)}`);
  await dialog.locator('button.feature-card.feature-code').click();
  await dialog.getByRole('button', { name: '만들기', exact: true }).click();
  await page.waitForURL(/\/t\/[A-Za-z0-9_-]+/);
  await page.getByText('main.js').first().click();

  // HTML: ! 만 쳐도 추천이 뜨고, Tab 으로 기본 구조
  await newFile(page, 'index.html');
  await page.keyboard.type('!');
  await expect(options(page).first()).toContainText('!');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('HTML 기본 구조');
  await page.keyboard.press('Tab');
  await expect(editor(page)).toContainText('<!DOCTYPE html>');
  await expect(editor(page)).toContainText('<meta name="viewport"');
  // 커서는 <title> 안 → 제목을 바로 칠 수 있다
  await page.keyboard.type('내 페이지');
  await expect(editor(page)).toContainText('<title>내 페이지</title>');

  // Emmet: body 안에서 ul>li*3 + Tab
  await page.keyboard.press('Tab'); // 다음 칸(body 안)으로
  await page.keyboard.type('ul>li*3');
  await page.keyboard.press('Tab');
  await expect(editor(page)).toContainText('<ul>');
  await expect(page.locator('.code-module .cm-line', { hasText: '<li></li>' })).toHaveCount(3);

  // CSS: Emmet
  await newFile(page, 'style.css');
  await page.keyboard.type('.box {\n');
  await page.keyboard.type('m10');
  await page.keyboard.press('Tab');
  await expect(editor(page)).toContainText('margin: 10px;');

  // JS: 배열 메서드 추천 + 코드 조각
  await newFile(page, 'app.js');
  await page.keyboard.type('const nums = [1, 2, 3];\nnums.filt');
  await expect(options(page).first()).toContainText('filter', { timeout: 60_000 });
  await page.keyboard.press('Tab');
  await expect(editor(page)).toContainText('nums.filter');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('log');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('콘솔에 출력');
  await page.keyboard.press('Tab');
  await expect(editor(page)).toContainText('console.log()');

  // 파이썬: 내장 함수
  await newFile(page, 'main.py');
  await page.keyboard.type('pri');
  await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('print');
  await page.keyboard.press('Tab');
  await expect(editor(page)).toContainText('print');
});
