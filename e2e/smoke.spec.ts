import { createTemplate, expect, expectDashboard, metric, signUpViaEmail, test, uniqueEmail } from './fixtures';

/*
 * 핵심 사용자 흐름 스모크 테스트 (실제 브라우저 + wrangler dev + 빌드된 화면)
 *  1) 첫 화면 → 이메일 로그인 → 이름 정하기(가입) → 대시보드
 *  2) 대시보드에서 템플릿 만들기 → 작업 공간 열기
 *  3) 초대 링크로 들어온 두 번째 사용자가 첫 사용자의 문서 편집을 새로 고침 없이 본다 (실시간 협업)
 */

test('첫 화면이 오류 없이 열리고 이메일 인증으로 가입해 대시보드까지 간다', async ({ page }) => {
  const t0 = Date.now();
  await page.goto('/');
  // 로그인하지 않은 상태: /login으로 이동
  await page.waitForURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Madang 시작하기' })).toBeVisible();
  await expect(page.getByRole('button', { name: '이메일로 계속하기' })).toBeVisible();
  metric('first-screen (goto → login form visible)', Date.now() - t0);

  const t1 = Date.now();
  await signUpViaEmail(page, uniqueEmail('signup'), '앨리스');
  await expectDashboard(page, '앨리스');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('region', { name: '알림' })).toContainText('환영합니다, 앨리스 님!');
  metric('signup (email submit → dashboard visible)', Date.now() - t1);
  metric('total (goto → dashboard visible)', Date.now() - t0);

  // 새로 고쳐도 로그인이 유지된다 (세션 쿠키)
  await page.reload();
  await expectDashboard(page, '앨리스');
});

test('대시보드에서 템플릿을 만들고 작업 공간을 연다', async ({ page }) => {
  await page.goto('/');
  await signUpViaEmail(page, uniqueEmail('create'), '브라이언');
  await expectDashboard(page, '브라이언');
  await expect(page.getByRole('heading', { name: '첫 템플릿을 만들어 보세요' })).toBeVisible();

  const created = await createTemplate(page, 'E2E 런칭 준비');
  metric('create template ("만들기" click → workspace visible)', created.ms);
  await expect(page.getByRole('region', { name: '알림' })).toContainText('템플릿을 만들었습니다');

  // 기본 문서를 열면 편집기가 뜬다
  await page.getByText('제목 없는 문서').first().click();
  const editor = page.locator('.doc-content .ProseMirror');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute('contenteditable', 'true');

  // 대시보드로 돌아가면 방금 만든 템플릿 카드가 있다
  await page.goto('/');
  await expect(page.getByRole('article').filter({ hasText: 'E2E 런칭 준비' })).toBeVisible();
});

test('초대 링크로 참여한 두 번째 사용자가 문서 편집을 실시간으로 본다', async ({ page, newUserPage }) => {
  // 사용자 A: 가입 → 템플릿 만들기 → 초대 링크 만들기 (개인 공간 → 협업 공간 전환)
  await page.goto('/');
  await signUpViaEmail(page, uniqueEmail('owner'), '앨리스');
  await expectDashboard(page, '앨리스');
  const templateName = `실시간 ${Date.now().toString(36)}`;
  await createTemplate(page, templateName);

  await page.getByRole('button', { name: '초대', exact: true }).first().click();
  const invite = page.getByRole('dialog').filter({ hasText: '팀원 초대' });
  await invite.getByRole('button', { name: '협업 공간으로 전환하고 링크 만들기' }).click();
  const linkInput = invite.locator('.share-link input');
  await expect(linkInput).toHaveValue(/\/join\/[A-Za-z0-9_-]+$/);
  const joinPath = new URL(await linkInput.inputValue()).pathname;
  await page.keyboard.press('Escape');
  await expect(invite).toBeHidden();
  await expect(page.getByText('협업 공간', { exact: true }).first()).toBeVisible();

  // A가 문서를 연다
  await page.getByText('제목 없는 문서').first().click();
  const editorA = page.locator('.doc-content .ProseMirror');
  await expect(editorA).toBeVisible();

  // 사용자 B: 초대 링크 → 로그인 · 가입 → (자동) 참여 → 같은 문서
  const pageB = await newUserPage();
  await pageB.goto(joinPath);
  await expect(pageB.getByRole('heading', { name: templateName })).toBeVisible();
  await pageB.getByRole('button', { name: '로그인하고 참여하기' }).click();
  await signUpViaEmail(pageB, uniqueEmail('guest'), '밥');
  // 초대 링크에서 시작한 가입은 "참여하기"를 다시 누르지 않아도 바로 참여한다
  await pageB.waitForURL(/\/t\/[A-Za-z0-9_-]+/);
  await expect(pageB.getByRole('heading', { level: 1, name: templateName })).toBeVisible();
  await pageB.getByText('제목 없는 문서').first().click();
  const editorB = pageB.locator('.doc-content .ProseMirror');
  await expect(editorB).toBeVisible();

  // A가 입력 → B 화면에 새로 고침 없이 나타난다
  const fromA = `앨리스의 실시간 편집 ${Date.now().toString(36)}`;
  await editorA.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  const t0 = Date.now();
  await page.keyboard.insertText(fromA);
  await expect(editorB).toContainText(fromA);
  metric('realtime sync A → B (insert → visible)', Date.now() - t0);

  // 반대 방향도: B가 입력 → A 화면에 나타난다
  const fromB = `밥의 답장 ${Date.now().toString(36)}`;
  await editorB.click();
  await pageB.keyboard.press('Control+End');
  await pageB.keyboard.press('Enter');
  const t1 = Date.now();
  await pageB.keyboard.insertText(fromB);
  await expect(editorA).toContainText(fromB);
  metric('realtime sync B → A (insert → visible)', Date.now() - t1);

  // 접속 표시(프레즌스): 양쪽 모두 2명이 접속 중으로 보인다
  await expect(page.getByRole('button', { name: /^접속 중 2명/ })).toBeVisible();
  await expect(pageB.getByRole('button', { name: /^접속 중 2명/ })).toBeVisible();
});
