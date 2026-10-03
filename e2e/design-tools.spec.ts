import fs from 'node:fs';
import { createTemplate, expect, expectDashboard, signUpViaEmail, test, uniqueEmail } from './fixtures';

/*
 * 디자인 보드 그리기 도구 (테스터 피드백)
 *  1) 펜 색 · 굵기를 그리기 전에 고르면 그 값으로 그려진다
 *  2) 지우개로 문지른 부분만 지워져 선이 둘로 나뉘고, 실행 취소로 되돌아온다
 *  3) "배경 투명"으로 PNG를 저장하면 빈 곳이 투명하다
 */

test('펜 미리 설정 · 지우개 · 배경 투명 PNG', async ({ page }) => {
  await page.goto('/');
  await signUpViaEmail(page, uniqueEmail('draw'), '그리미');
  await expectDashboard(page, '그리미');
  const { id } = await createTemplate(page, 'E2E 브레인스토밍');

  // 디자인 영역을 켜면 빈 자유 캔버스 "보드 1"이 생긴다
  await page.goto(`/t/${id}/design`);
  await page.getByRole('button', { name: '디자인 영역 추가' }).click();
  const svg = page.locator('svg.canvas-svg');
  await expect(svg).toBeVisible();

  // 1) 펜을 고르고, 그리기 전에 빨강 · 굵게
  await page.getByRole('button', { name: /^펜 \(P\)/ }).click();
  const penBar = page.getByRole('toolbar', { name: '펜 설정' });
  await expect(penBar).toBeVisible();
  await penBar.getByRole('button', { name: '펜 색 #ef4444' }).click();
  await penBar.getByRole('button', { name: /^굵게 8px/ }).click();

  const box = (await svg.boundingBox())!;
  const draw = async (y: number) => {
    await page.mouse.move(box.x + 300, box.y + y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + 300 + i * 30, box.y + y + (i % 2) * 10);
    await page.mouse.up();
  };
  await draw(300);
  await draw(450);
  const strokes = svg.locator('[data-shape-id] path[stroke="#ef4444"]');
  await expect(strokes).toHaveCount(2);
  await expect(strokes.first()).toHaveAttribute('stroke-width', '8');

  // 2) 지우개(E)로 첫 번째 선의 가운데만 가로질러 문지른다
  await page.keyboard.press('e');
  await expect(page.getByRole('button', { name: /^지우개/ })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.move(box.x + 450, box.y + 260);
  await page.mouse.down();
  await page.mouse.move(box.x + 450, box.y + 300, { steps: 4 });
  await page.mouse.move(box.x + 450, box.y + 340, { steps: 4 });
  await page.mouse.up();
  // 첫 번째 선은 지운 곳을 사이에 두고 두 조각으로, 두 번째 선은 그대로
  await expect(strokes).toHaveCount(3);
  await expect(strokes.first()).toHaveAttribute('stroke-width', '8');

  // 실행 취소하면 원래 선으로 돌아온다
  await page.keyboard.press('Control+z');
  await expect(strokes).toHaveCount(2);

  // 3) 배경 투명으로 PNG 내보내기 (선택 없음 = 보드 전체)
  await page.keyboard.press('v');
  await page.keyboard.press('Escape');
  await page.getByLabel('배경 투명 (배경 없이 저장)').check();
  const download = page.waitForEvent('download');
  await page.locator('.inspector').getByRole('button', { name: 'PNG' }).click();
  const file = await (await download).path();
  const png = fs.readFileSync(file).toString('base64');
  // 왼쪽 위 모서리(여백)의 알파값이 0이어야 한다
  const alpha = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(2, 2, 1, 1).data[3];
  }, png);
  expect(alpha).toBe(0);
});
