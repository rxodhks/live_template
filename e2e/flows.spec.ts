import type { Page } from '@playwright/test';
import { dismissToasts, expect, expectDashboard, signUpViaEmail, test, uniqueEmail, type PageErrors } from './fixtures';

/*
 * 테스트가 없던 주요 사용자 흐름
 *  1) 개인 공간: 문서 · 디자인 · 코드 편집 → 새로 고침 후 유지 → 파일 이름 바꾸기 · 삭제 · 되돌리기 → 휴지통 · 복원
 *  2) 권한: 뷰어는 디자인 · 코드도 바꿀 수 없고, 내보낸 멤버는 바로 쫓겨나 다시 들어올 수 없다
 *  3) 같은 브라우저의 다른 탭에서 로그아웃하면, 템플릿을 열어 둔 탭도 로그인 화면으로 간다
 *     (예전: 그 탭은 "저장됨"으로 보이면서 입력이 저장도 전송도 되지 않고 예외가 났다)
 */

test.describe.configure({ timeout: 90_000 });

/** 해커톤 프리셋(디자인 · 코드 · 문서 모두)으로 템플릿을 만든다 */
async function createHackathon(page: Page, name: string): Promise<string> {
  await dismissToasts(page);
  await page.getByRole('button', { name: '새 템플릿' }).first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: '새 템플릿 만들기' });
  await dialog.getByRole('button', { name: /해커톤/ }).click();
  await dialog.getByPlaceholder('예) 신규 서비스 런칭').fill(name);
  await dialog.getByRole('button', { name: '만들기', exact: true }).click();
  await page.waitForURL(/\/t\/[A-Za-z0-9_-]+/);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await dismissToasts(page);
  return new URL(page.url()).pathname.split('/')[2];
}

/** 초대 링크를 만들고 (처음이면 협업 공간으로 전환) 경로를 돌려준다 */
async function makeInvite(page: Page, role: '편집자' | '뷰어'): Promise<string> {
  await page.getByRole('button', { name: '초대', exact: true }).first().click();
  const invite = page.getByRole('dialog').filter({ hasText: '팀원 초대' });
  const another = invite.getByRole('button', { name: '다른 조건으로 새 링크' });
  if (await another.isVisible()) await another.click();
  await invite.getByRole('radio', { name: new RegExp(role) }).click();
  await invite.getByRole('button', { name: /링크 만들기/ }).click();
  const input = invite.locator('.share-link input');
  await expect(input).toHaveValue(/\/join\/[A-Za-z0-9_-]+$/);
  const path = new URL(await input.inputValue()).pathname;
  await page.keyboard.press('Escape');
  await expect(invite).toBeHidden();
  return path;
}

async function joinAs(page: Page, path: string, name: string) {
  await page.goto(path);
  await page.getByRole('button', { name: '로그인하고 참여하기' }).click();
  await signUpViaEmail(page, uniqueEmail('join'), name);
  await page.waitForURL(/\/t\/[A-Za-z0-9_-]+/);
  await dismissToasts(page);
}

/** 일부러 일으킨(또는 화면을 떠나며 생기는) 요청 실패 기록만 빼고, 나머지 오류는 그대로 검사한다 */
function allowFailedRequests(errors: PageErrors, status: number[], path: RegExp) {
  for (let i = errors.list.length - 1; i >= 0; i--) {
    const e = errors.list[i];
    const m = /status of (\d+) .* @ (\S+)$/.exec(e);
    if (e.startsWith('[console] Failed to load resource') && m && status.includes(Number(m[1])) && path.test(new URL(m[2]).pathname)) errors.list.splice(i, 1);
  }
}

const shapes = (page: Page) => page.locator('svg.canvas-svg [data-shape-id]');
const docEditor = (page: Page) => page.locator('.doc-content .ProseMirror');
const codeEditor = (page: Page) => page.locator('.code-module .cm-content');

test('개인 공간: 세 모듈 편집이 새로 고침 뒤에도 남고, 이름 바꾸기 · 삭제 되돌리기 · 휴지통 복원이 된다', async ({ page, errors }) => {
  await page.goto('/');
  await signUpViaEmail(page, uniqueEmail('flow'), '앨리스');
  await expectDashboard(page, '앨리스');
  const name = `흐름 ${Date.now().toString(36)}`;
  const id = await createHackathon(page, name);
  const side = page.getByRole('complementary');

  // 문서
  await side.getByText('회의록').click();
  await docEditor(page).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('문서에 남길 글 ✍️');

  // 디자인: 사각형 하나 그리기
  await side.getByText('아이디어 보드').click();
  const svg = page.locator('svg.canvas-svg');
  await expect(svg).toBeVisible();
  const before = await shapes(page).count();
  await page.getByRole('button', { name: '사각형 (R)' }).click();
  const box = (await svg.boundingBox())!;
  await page.mouse.move(box.x + box.width - 220, box.y + box.height - 160);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 140, box.y + box.height - 100, { steps: 5 });
  await page.mouse.up();
  await expect(shapes(page)).toHaveCount(before + 1);

  // 코드: 고치고 실행
  await side.getByText('vote.js').click();
  await codeEditor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText("console.log('합계', [1, 2, 3].reduce((a, b) => a + b))");
  await page.locator('.code-module .module-toolbar').getByRole('button', { name: /^실행$/ }).click();
  await expect(page.locator('.code-panel')).toContainText('합계 6');
  await expect(page.locator('.code-panel')).toContainText('✓ 실행 완료');

  // 새로 고쳐도 모두 남아 있다
  await expect(page.locator('.save-indicator')).toContainText('저장됨');
  await page.reload();
  await expect(codeEditor(page)).toContainText("console.log('합계'");
  await side.getByText('회의록').click();
  await expect(docEditor(page)).toContainText('문서에 남길 글 ✍️');
  await side.getByText('아이디어 보드').click();
  await expect(shapes(page)).toHaveCount(before + 1);

  // 파일 이름 바꾸기 (한글 · 이모지), 같은 이름은 막힌다
  const openMenu = async (label: RegExp) => {
    const row = side.getByRole('link', { name: label });
    await row.hover();
    await row.getByRole('button', { name: '더 보기' }).click();
  };
  await openMenu(/vote\.js/);
  await page.getByRole('menuitem', { name: /이름 변경/ }).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('투표_🗳️.ts');
  await page.keyboard.press('Enter');
  await expect(side.getByText('투표_🗳️.ts')).toBeVisible();
  await openMenu(/app\.py/);
  await page.getByRole('menuitem', { name: /이름 변경/ }).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('투표_🗳️.TS');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: '알림' })).toContainText('같은 이름의 파일이 이미 있습니다');
  await expect(side.getByText('app.py')).toBeVisible();
  await dismissToasts(page);

  // 삭제 → 알림의 "되돌리기"
  await openMenu(/투표_🗳️\.ts/);
  await page.getByRole('menuitem', { name: '삭제' }).click();
  await expect(side.getByText('투표_🗳️.ts')).toHaveCount(0);
  await page.getByRole('region', { name: '알림' }).getByRole('button', { name: '되돌리기' }).click();
  await expect(side.getByText('투표_🗳️.ts')).toBeVisible();
  await dismissToasts(page);

  // 휴지통으로 → 대시보드에서 사라짐 → 복원하면 내용 그대로
  await page.goto(`/t/${id}/settings`);
  await page.getByRole('button', { name: '휴지통으로 이동' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '휴지통으로 이동' }).click();
  await page.waitForURL((u) => u.pathname === '/');
  await expect(page.getByRole('article').filter({ hasText: name })).toHaveCount(0);
  await page.getByRole('button', { name: '휴지통' }).click();
  const trash = page.getByRole('dialog', { name: '휴지통' });
  await trash.getByRole('listitem').filter({ hasText: name }).getByRole('button', { name: '복원' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('article').filter({ hasText: name })).toBeVisible();
  await page.goto(`/t/${id}/docs`);
  await side.getByText('회의록').click();
  await expect(docEditor(page)).toContainText('문서에 남길 글 ✍️');
  await expect(side.getByText('투표_🗳️.ts')).toBeVisible();
  // 휴지통으로 옮긴 직후 열려 있던 템플릿 화면이 한 번 더 조회하며 404가 남는다 (화면 영향 없음)
  allowFailedRequests(errors, [404], /^\/api\/templates\/[^/]+$/);
});

test('뷰어는 디자인 · 코드도 바꿀 수 없고, 내보낸 편집자는 바로 쫓겨난다', async ({ page, newUserPage, errors }) => {
  await page.goto('/');
  await signUpViaEmail(page, uniqueEmail('perm-owner'), '앨리스');
  await expectDashboard(page, '앨리스');
  const name = `권한 ${Date.now().toString(36)}`;
  const id = await createHackathon(page, name);
  const editorPath = await makeInvite(page, '편집자');
  const viewerPath = await makeInvite(page, '뷰어');
  expect(editorPath).not.toBe(viewerPath);

  const viewer = await newUserPage();
  await joinAs(viewer, viewerPath, '뷰리');
  const editor = await newUserPage();
  await joinAs(editor, editorPath, '에디');

  // 뷰어: 디자인 보드에 그리거나 지울 수 없다
  await page.goto(`/t/${id}/design`);
  await viewer.goto(`/t/${id}/design`);
  await expect(viewer.locator('svg.canvas-svg')).toBeVisible();
  const count = await shapes(page).count();
  await expect(shapes(viewer)).toHaveCount(count);
  await viewer.keyboard.press('r');
  const box = (await viewer.locator('svg.canvas-svg').boundingBox())!;
  await viewer.mouse.move(box.x + 120, box.y + 120);
  await viewer.mouse.down();
  await viewer.mouse.move(box.x + 220, box.y + 220, { steps: 4 });
  await viewer.mouse.up();
  await shapes(viewer).first().click({ force: true });
  await viewer.keyboard.press('Delete');
  await expect(shapes(viewer)).toHaveCount(count);
  await expect(shapes(page)).toHaveCount(count);

  // 뷰어: 코드는 읽기 전용, 이름 변경 · 삭제 메뉴는 꺼져 있다. 실행은 할 수 있다
  await viewer.goto(`/t/${id}/code`);
  await viewer.getByRole('complementary').getByText('vote.js').click();
  await expect(codeEditor(viewer)).toHaveAttribute('contenteditable', 'false');
  const row = viewer.getByRole('complementary').getByRole('link', { name: /vote\.js/ });
  await row.hover();
  await row.getByRole('button', { name: '더 보기' }).click();
  await expect(viewer.getByRole('menuitem', { name: /이름 변경/ })).toBeDisabled();
  await expect(viewer.getByRole('menuitem', { name: '삭제' })).toBeDisabled();
  await viewer.keyboard.press('Escape');

  // 뷰어: 서버도 초대 링크 만들기 · 템플릿 이름 바꾸기를 거절한다
  const status = await viewer.evaluate(async (tid) => {
    const post = await fetch(`/api/templates/${tid}/invites`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"role":"viewer"}' });
    const patch = await fetch(`/api/templates/${tid}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"name":"x"}' });
    return [post.status, patch.status];
  }, id);
  expect(status).toEqual([403, 403]);

  // 편집자가 문서를 열어 둔 채 내보내지면 대시보드로 돌아가고, 다시 열 수 없다
  await editor.goto(`/t/${id}/docs`);
  await editor.getByRole('complementary').getByText('회의록').click();
  await expect(docEditor(editor)).toHaveAttribute('contenteditable', 'true');
  await page.goto(`/t/${id}/members`);
  await page.locator('.member-row').filter({ hasText: '에디' }).getByRole('button', { name: '내보내기' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '내보내기' }).click();
  await editor.waitForURL((u) => u.pathname === '/');
  await expect(editor.getByRole('region', { name: '알림' })).toContainText('템플릿에서 제외되었습니다');
  await editor.goto(`/t/${id}`);
  await expect(editor.getByText('템플릿을 찾을 수 없습니다')).toBeVisible();
  // 위에서 일부러 보낸 뷰어 요청(403)과, 내보낸 뒤 템플릿 조회(404)
  allowFailedRequests(errors, [403, 404], /^\/api\/templates\/[^/]+(\/invites)?$/);
});

test('다른 탭에서 로그아웃하면 템플릿을 열어 둔 탭도 로그인 화면으로 간다', async ({ page, context, errors }) => {
  await page.goto('/');
  await signUpViaEmail(page, uniqueEmail('tabs'), '앨리스');
  await expectDashboard(page, '앨리스');
  await createHackathon(page, `두 탭 ${Date.now().toString(36)}`);
  // 협업 공간이어야 로그아웃 때 이 기기의 문서 사본을 지운다
  await makeInvite(page, '편집자');
  await page.getByRole('complementary').getByText('회의록').click();
  await expect(docEditor(page)).toHaveAttribute('contenteditable', 'true');
  await expect(page.locator('.save-indicator')).toContainText('저장됨');

  const other = await context.newPage();
  errors.watch(other);
  await other.goto('/');
  await other.getByRole('button', { name: '내 프로필' }).click();
  await other.getByRole('menuitem', { name: '로그아웃' }).click();
  await other.waitForURL(/\/login/);

  // 사본이 지워지는 순간 첫 탭도 로그인이 끝난 것을 알아차린다 (입력이 조용히 사라지지 않도록)
  await page.waitForURL(/\/login/, { timeout: 15_000 });
  // 로그아웃하면 서버가 그 세션의 실시간 연결을 닫고, 다시 접속하려던 연결과 권한 확인은 401로 거절된다 (그 뒤 로그인 화면으로)
  for (let i = errors.list.length - 1; i >= 0; i--) if (/WebSocket connection to .*\/ws\?.*failed/.test(errors.list[i])) errors.list.splice(i, 1);
  allowFailedRequests(errors, [401], /^\/api\/templates\/[^/]+$/);
});
