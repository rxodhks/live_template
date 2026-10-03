import zlib from 'node:zlib';
import crypto from 'node:crypto';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { createTemplate, expect, expectDashboard, signUpViaEmail, test, uniqueEmail } from './fixtures';

/*
 * 연결이 끊겼다 돌아올 때의 저장
 *  - 오프라인 중 넣은 이미지 여러 장(한 메시지 상한 4MB를 넘는 차이)도 다시 연결하면 저장된다
 *    (예전에는 문서가 16MB보다 한참 작아도 413으로 거절되어 "저장 한도" 배너와 함께 잠겼다)
 *  - 저장 확인(ack) 전에 잠깐 끊겼다 돌아오면 "다시 동기화 중"에 머물지 않는다
 */

/** 두 사람이 같은 협업 문서를 연 상태 */
async function twoEditors(page: Page, newUserPage: () => Promise<Page>, tag: string) {
  await page.goto('/');
  await signUpViaEmail(page, uniqueEmail(`${tag}-a`), '앨리스');
  await expectDashboard(page, '앨리스');
  await createTemplate(page, `동기화 ${tag}`);
  await page.getByRole('button', { name: '초대', exact: true }).first().click();
  const invite = page.getByRole('dialog').filter({ hasText: '팀원 초대' });
  await invite.getByRole('button', { name: '협업 공간으로 전환하고 링크 만들기' }).click();
  const linkInput = invite.locator('.share-link input');
  await expect(linkInput).toHaveValue(/\/join\/[A-Za-z0-9_-]+$/);
  const joinPath = new URL(await linkInput.inputValue()).pathname;
  await page.keyboard.press('Escape');
  await page.getByText('제목 없는 문서').first().click();
  const pageB = await newUserPage();
  await pageB.goto(joinPath);
  await pageB.getByRole('button', { name: '로그인하고 참여하기' }).click();
  await signUpViaEmail(pageB, uniqueEmail(`${tag}-b`), '밥');
  await pageB.waitForURL(/\/t\/[A-Za-z0-9_-]+/);
  await pageB.getByText('제목 없는 문서').first().click();
  const editorA = page.locator('.doc-content .ProseMirror');
  const editorB = pageB.locator('.doc-content .ProseMirror');
  await expect(editorA).toBeVisible();
  await expect(editorB).toBeVisible();
  return { pageB, editorA, editorB };
}

async function setOffline(context: BrowserContext, page: Page, offline: boolean) {
  await context.setOffline(offline);
  await page.evaluate((v) => window.dispatchEvent(new Event(v ? 'offline' : 'online')), offline);
}

async function typeAtEnd(page: Page, editor: Locator, text: string) {
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText(text);
}

/** 무작위 잡음 PNG — 줄여도 잘 압축되지 않아 한 장에 1MB 안팎이 된다 */
function noisePng(size = 1200): Buffer {
  const raw = crypto.randomBytes((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) raw[y * (size * 3 + 1)] = 0;
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
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}

test('오프라인 중 넣은 이미지 여러 장도 다시 연결하면 저장된다', async ({ page, newUserPage, errors }) => {
  test.setTimeout(90_000);
  const { pageB, editorA } = await twoEditors(page, newUserPage, 'img');
  await setOffline(page.context(), page, true);
  await expect(page.locator('.save-indicator')).toContainText('오프라인', { timeout: 5000 });
  await editorA.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/이미지');
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Enter');
  const count = 4;
  await (await chooser).setFiles(Array.from({ length: count }, (_, i) => ({ name: `잡음${i}.png`, mimeType: 'image/png', buffer: noisePng() })));
  await expect(page.locator('.doc-content .doc-image img')).toHaveCount(count, { timeout: 30_000 });
  // 한 메시지 상한(4MB)을 넘는 차이여야 이 테스트가 의미 있다
  const chars = await page.locator('.doc-content .doc-image img').evaluateAll((imgs) => imgs.reduce((n, i) => n + (i as HTMLImageElement).src.length, 0));
  expect(chars).toBeGreaterThan(3_000_000);

  await setOffline(page.context(), page, false);
  await expect(pageB.locator('.doc-content .doc-image img')).toHaveCount(count, { timeout: 30_000 });
  await expect(page.locator('.save-indicator')).toContainText(/저장됨/, { timeout: 15_000 });
  await expect(page.locator('.too-large-banner')).toHaveCount(0);
  // 오프라인 동안의 연결 실패 기록은 이 테스트에서 기대한 것
  errors.list.splice(0, errors.list.length, ...errors.list.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e)));
});

test('저장 확인 전에 잠깐 끊겼다 돌아오면 "저장됨"으로 돌아온다', async ({ page, newUserPage, errors }) => {
  const { editorA, editorB } = await twoEditors(page, newUserPage, 'blip');
  const text = `잠깐 끊김 ${Date.now().toString(36)}`;
  await typeAtEnd(page, editorA, text);
  // 서버가 받아 다른 사람에게 전달한 것을 확인하자마자 끊는다 (저장 확인은 저장소에 기록된 뒤, 최대 2초 뒤에 온다)
  await expect(editorB).toContainText(text);
  await setOffline(page.context(), page, true);
  await page.waitForTimeout(300);
  await setOffline(page.context(), page, false);
  await expect(page.locator('.save-indicator')).toContainText(/저장됨/, { timeout: 15_000 });
  errors.list.splice(0, errors.list.length, ...errors.list.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e)));
});
