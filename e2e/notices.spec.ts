import { expectDashboard, expect, signUpViaEmail, test, uniqueEmail } from './fixtures';

/*
 * 공지사항: notices/*.md → /notices.json → 공지 페이지 · 상단 새 소식 · 홈 배너
 */

test('로그인하지 않아도 공지사항 페이지를 보고 글을 펼칠 수 있다', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: '공지사항' }).click();
  await expect(page).toHaveURL(/\/notices$/);
  await expect(page.getByRole('heading', { level: 1, name: '공지사항' })).toBeVisible();
  const title = page.getByRole('link', { name: /공지사항을 시작해요/ });
  await expect(title).toBeVisible();
  await title.click();
  await expect(page).toHaveURL(/\/notices\/2026-10-07-notices-open$/);
  await expect(page.locator('.notice-body')).toContainText('종 아이콘');
  // 없는 공지 주소는 목록과 함께 안내
  await page.goto('/notices/no-such-notice');
  await expect(page.getByText('찾는 공지가 없습니다')).toBeVisible();
});

const todayKST = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

test('새 공지는 종 아이콘에 점이 붙고, 읽으면 사라진다', async ({ page }) => {
  // 처음 쓰는 기기는 2주보다 오래된 글을 읽은 것으로 보므로, 실제 공지 파일 날짜와 관계없이 오늘 글로 확인한다
  const notices = [
    { id: 'e2e-new', title: '새 기능 소식', date: todayKST(), tag: '새 기능', pin: false, summary: '오늘 올라온 공지', html: '<p>새 기능 본문</p>' },
    { id: 'e2e-older', title: '한 달 전 공지', date: '2026-01-01', tag: '소식', pin: false, summary: '오래된 공지', html: '<p>x</p>' },
  ];
  await page.route('**/notices.json', (r) => r.fulfill({ json: notices }));
  await page.goto('/');
  await signUpViaEmail(page, uniqueEmail('notice'), '공지확인');
  await expectDashboard(page, '공지확인');

  const bell = page.getByRole('button', { name: '새 소식 (읽지 않은 공지 있음)' });
  await expect(bell).toBeVisible();
  await bell.click();
  const pop = page.getByRole('dialog', { name: '새 소식' });
  await expect(pop.getByText('한 달 전 공지')).toBeVisible();
  await expect(pop.getByLabel('읽지 않음')).toHaveCount(1);
  await pop.getByText('새 기능 소식').click();
  await expect(page).toHaveURL(/\/notices\/e2e-new$/);
  await expect(page.locator('.notice-body')).toContainText('새 기능 본문');

  // 공지 페이지를 열면 모두 읽은 것으로 → 점이 없다 (새로고침해도)
  await page.goto('/');
  await expectDashboard(page, '공지확인');
  await expect(page.getByRole('button', { name: '새 소식', exact: true })).toBeVisible();
  await expect(page.locator('.notice-dot')).toHaveCount(0);
});

test('중요 공지는 홈 위쪽 배너로 뜨고, 닫으면 다시 안 뜬다', async ({ page }) => {
  const today = todayKST();
  const notices = [
    { id: 'e2e-check', title: '서버 점검 안내', date: today, tag: '점검', pin: true, summary: '새벽 2시부터 저장이 잠시 멈춰요', html: '<p>점검 본문</p>' },
    { id: 'e2e-old', title: '지난 배너', date: '2026-01-01', tag: '중요', pin: true, until: '2026-01-02', summary: '기간이 지난 배너', html: '<p>x</p>' },
    { id: 'e2e-later', title: '예약 공지', date: '2999-01-01', tag: '소식', pin: true, summary: '아직 안 보임', html: '<p>x</p>' },
  ];
  await page.route('**/notices.json', (r) => r.fulfill({ json: notices }));
  await page.goto('/');
  await signUpViaEmail(page, uniqueEmail('banner'), '배너확인');
  await expectDashboard(page, '배너확인');

  const banner = page.getByRole('status').filter({ hasText: '서버 점검 안내' });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('새벽 2시부터 저장이 잠시 멈춰요');
  await expect(page.getByText('지난 배너')).toHaveCount(0);
  await expect(page.getByText('예약 공지')).toHaveCount(0);

  await banner.getByRole('link', { name: '자세히' }).click();
  await expect(page).toHaveURL(/\/notices\/e2e-check$/);
  await expect(page.locator('.notice-body')).toContainText('점검 본문');
  await expect(page.getByText('예약 공지')).toHaveCount(0);

  await page.goto('/');
  await page.getByRole('button', { name: '이 공지 닫기' }).click();
  await expect(banner).toHaveCount(0);
  await page.reload();
  await expectDashboard(page, '배너확인');
  await expect(page.getByRole('button', { name: /새 소식/ })).toBeVisible();
  await expect(page.getByText('서버 점검 안내')).toHaveCount(0);
});
