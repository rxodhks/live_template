import zlib from 'node:zlib';
import { createTemplate, dismissToasts, expect, expectDashboard, signUpViaEmail, test, uniqueEmail } from './fixtures';

/*
 * 외부 공유 전에 고친 것들
 *  - 앱 안 "피드백 보내기"
 *  - 이미지 여러 장을 한 번에 넣으면 모두 들어간다 (예전에는 마지막 한 장만 남음)
 *  - 인터넷이 끊기면 바로 "오프라인"으로 표시
 *  - 뷰어는 문서 화면에서도 "읽기 전용" 표시
 */

/** 작은 PNG (무작위 색) */
function png(seed: number): Buffer {
  const w = 24;
  const raw = Buffer.alloc((w * 3 + 1) * w);
  for (let i = 0; i < raw.length; i++) raw[i] = i % (w * 3 + 1) === 0 ? 0 : (i * 31 + seed * 97) % 256;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

test('피드백 보내기 · 이미지 여러 장 · 오프라인 표시', async ({ page, context }) => {
  await page.goto('/');
  await signUpViaEmail(page, uniqueEmail('prelaunch'), '앨리스');
  await expectDashboard(page, '앨리스');
  await createTemplate(page, '공유 전 확인');

  // 피드백 보내기 (왼쪽 아래 버튼)
  await dismissToasts(page);
  await page.getByRole('button', { name: '피드백 보내기' }).click();
  const dialog = page.getByRole('dialog', { name: '피드백 보내기' });
  await dialog.getByRole('textbox', { name: '피드백 내용' }).fill('표를 넣으면 글자가 겹쳐 보여요');
  const sent = page.waitForResponse((r) => r.url().endsWith('/api/feedback'));
  await dialog.getByRole('button', { name: '보내기' }).click();
  expect((await sent).status()).toBe(201);
  await expect(page.getByRole('region', { name: '알림' })).toContainText('피드백을 보냈습니다');

  // 이미지 세 장을 한 번에 넣으면 세 장 모두 들어간다
  await page.getByText('제목 없는 문서').first().click();
  const editor = page.locator('.doc-content .ProseMirror');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/이미지');
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  await (await chooser).setFiles([0, 1, 2].map((i) => ({ name: `사진${i}.png`, mimeType: 'image/png', buffer: png(i) })));
  await expect(page.locator('.doc-content .doc-image img')).toHaveCount(3);

  // 인터넷이 끊기면 바로 오프라인으로 표시하고, 돌아오면 다시 저장된다
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.locator('.save-indicator')).toContainText('오프라인', { timeout: 3000 });
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('.save-indicator')).toContainText(/저장됨/, { timeout: 15_000 });
});

test('뷰어는 문서 화면에서도 읽기 전용으로 표시된다', async ({ page, newUserPage }) => {
  await page.goto('/');
  await signUpViaEmail(page, uniqueEmail('owner-v'), '앨리스');
  await expectDashboard(page, '앨리스');
  await createTemplate(page, '뷰어 확인');
  await page.getByRole('button', { name: '초대', exact: true }).first().click();
  const invite = page.getByRole('dialog').filter({ hasText: '팀원 초대' });
  await invite.getByRole('radio', { name: /뷰어/ }).click();
  await invite.getByRole('button', { name: '협업 공간으로 전환하고 링크 만들기' }).click();
  await expect(invite.getByText('PC 브라우저에서 열어 달라고')).toBeVisible();
  const joinPath = new URL(await invite.locator('.share-link input').inputValue()).pathname;

  const viewer = await newUserPage();
  await viewer.goto(joinPath);
  await viewer.getByRole('button', { name: '로그인하고 참여하기' }).click();
  await signUpViaEmail(viewer, uniqueEmail('viewer'), '밥');
  await viewer.waitForURL(/\/t\//);
  await viewer.getByText('제목 없는 문서').first().click();
  await expect(viewer.locator('.doc-content .ProseMirror')).toHaveAttribute('contenteditable', 'false');
  await expect(viewer.locator('.docs-module .status-readonly')).toHaveText('읽기 전용');
});
