// node --test scripts/ — 예약 업데이트 스크립트의 시간 · 공지 처리
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkState, formatKST, frontValue, handle, markDeployed, NOTICE_FILE, parseKST } from './scheduled-deploy.mjs';

const notice = `---
title: 10월 12일 업데이트 안내
date: 2026-10-08
tag: 점검
deploy_at: 2026-10-12 14:00
---
본문`;

test('글 머리에서 deploy_at 을 읽는다', () => {
  assert.equal(frontValue(notice, 'deploy_at'), '2026-10-12 14:00');
  assert.equal(frontValue(notice, 'title'), '10월 12일 업데이트 안내');
  assert.equal(frontValue('본문만', 'deploy_at'), undefined);
  assert.equal(frontValue(notice.replace(/\n/g, '\r\n'), 'deploy_at'), '2026-10-12 14:00');
});

test('한국 시간으로 읽고 쓴다', () => {
  assert.equal(parseKST('2026-10-12 14:00'), Date.parse('2026-10-12T05:00:00Z'));
  assert.ok(Number.isNaN(parseKST('2026-10-12 2pm')));
  assert.ok(Number.isNaN(parseKST(undefined)));
  assert.equal(formatKST(Date.parse('2026-10-12T05:07:30Z')), '2026-10-12 14:07');
});

test('완료 시간은 deploy_at 바로 아래에 한 번만 적는다', () => {
  const once = markDeployed(notice, '2026-10-12 14:07');
  assert.match(once, /deploy_at: 2026-10-12 14:00\ndeployed_at: 2026-10-12 14:07\n---/);
  const twice = markDeployed(once, '2026-10-12 14:30');
  assert.equal(twice.match(/deployed_at/g).length, 1);
  assert.match(twice, /deployed_at: 2026-10-12 14:30/);
  assert.match(markDeployed(notice, 'x'), /\n본문$/);
});

test('CI 상태: 모두 통과해야 합친다', () => {
  const ok = { name: 'check', status: 'completed', conclusion: 'success' };
  assert.equal(checkState([]), 'pending');
  assert.equal(checkState([ok, { name: 'e2e', status: 'in_progress', conclusion: null }]), 'pending');
  assert.equal(checkState([ok, { name: 'e2e', status: 'completed', conclusion: 'failure' }]), 'fail');
  assert.equal(checkState([ok, { name: 'deploy', status: 'completed', conclusion: 'skipped' }]), 'pass');
  // 예약 업데이트 자신의 실행은 세지 않는다
  assert.equal(checkState([ok, { name: 'run (예약 업데이트)', status: 'in_progress', conclusion: null }]), 'pass');
});

test('공지 파일만 고른다', () => {
  assert.ok(NOTICE_FILE.test('notices/2026-10-12-update.md'));
  assert.ok(!NOTICE_FILE.test('notices/README.md'));
  assert.ok(!NOTICE_FILE.test('client/notices/x.md'));
  assert.ok(!NOTICE_FILE.test('notices/sub/x.md'));
});

/** GitHub 대신 쓰는 가짜: main · PR 파일과 호출 기록 */
function fakeGitHub({ checks = 'success', mergeable = true } = {}) {
  const main = new Map();
  const log = [];
  const pr = { number: 42, title: '예약 업데이트 테스트', draft: false, head: { sha: 'abc' } };
  const prFiles = new Map([['notices/2026-10-12-update.md', notice], ['client/src/x.ts', 'x']]);
  const gh = {
    log,
    main,
    async get(p) {
      if (p.endsWith('/pulls/42/files?per_page=100')) return [...prFiles.keys()].map((filename) => ({ filename, status: 'added' }));
      if (p.endsWith('/pulls/42')) return { mergeable, mergeable_state: mergeable ? 'clean' : 'dirty' };
      if (p.includes('/check-runs')) return { check_runs: [{ name: 'check', status: 'completed', conclusion: checks }] };
      if (p.includes('/comments')) return log.filter((l) => l[0] === 'comment').map((l) => ({ body: l[1] }));
      throw new Error(`unexpected GET ${p}`);
    },
    async post(p, b) {
      if (p.includes('/comments')) log.push(['comment', b.body]);
      return {};
    },
    async put(p) {
      if (p.endsWith('/merge')) {
        log.push(['merge']);
        for (const [k, v] of prFiles) if (!main.has(k)) main.set(k, v);
      }
      return { sha: 'merged' };
    },
    async file(path, ref) {
      const text = ref === 'main' ? main.get(path) : prFiles.get(path);
      return text == null ? null : { sha: 's', text };
    },
    async writeFile(path, text, message) {
      main.set(path, text);
      log.push(['write', path, message]);
    },
    async deploy(why) {
      log.push(['deploy', why]);
      return true;
    },
  };
  return { gh, pr };
}

const before = Date.parse('2026-10-12T04:00:00Z'); // 13:00 한국 시간
const after = Date.parse('2026-10-12T05:10:00Z'); // 14:10

test('예정 공지 → 시간이 되면 합치고 배포 → 완료 공지', async () => {
  const { gh, pr } = fakeGitHub();
  await handle(gh, pr, before);
  assert.equal(gh.main.get('notices/2026-10-12-update.md'), notice, '예정 공지가 main에 먼저 올라간다');
  assert.ok(!gh.log.some((l) => l[0] === 'merge'), '시간 전에는 합치지 않는다');
  assert.equal(gh.log.filter((l) => l[0] === 'deploy').length, 1);

  // 같은 내용이면 다시 올리거나 배포하지 않는다
  await handle(gh, pr, before + 60_000);
  assert.equal(gh.log.filter((l) => l[0] === 'deploy').length, 1);

  await handle(gh, pr, after);
  assert.ok(gh.log.some((l) => l[0] === 'merge'));
  assert.match(gh.main.get('notices/2026-10-12-update.md'), /deployed_at: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
  assert.equal(gh.log.filter((l) => l[0] === 'deploy').length, 3, '예정 · 업데이트 · 완료 공지 배포');
});

test('CI가 실패했거나 충돌이 있으면 합치지 않고 한 번만 알린다', async () => {
  for (const opts of [{ checks: 'failure' }, { mergeable: false }]) {
    const { gh, pr } = fakeGitHub(opts);
    await handle(gh, pr, after);
    await handle(gh, pr, after + 15 * 60_000);
    assert.ok(!gh.log.some((l) => l[0] === 'merge'));
    assert.equal(gh.log.filter((l) => l[0] === 'comment').length, 1);
  }
});

test('초안 PR은 건너뛴다', async () => {
  const { gh, pr } = fakeGitHub();
  await handle(gh, { ...pr, draft: true }, after);
  assert.equal(gh.log.length, 0);
});
