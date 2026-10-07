#!/usr/bin/env node
/*
 * 예약 업데이트 — .github/workflows/scheduled-deploy.yml 이 15분마다 실행한다.
 *
 * 업데이트 PR에 공지 파일(notices/*.md)을 함께 넣고 글 머리에 deploy_at(한국 시간)을 적으면
 *  1) 그 시간 전: 공지 파일만 먼저 main에 올리고 배포한다 → 사이트에 "업데이트 예정" 공지
 *  2) 그 시간이 지나면: PR의 CI가 모두 통과했고 충돌이 없을 때 PR을 합치고 배포한다
 *  3) 배포가 성공하면: 공지에 deployed_at 을 적고 한 번 더 배포한다 → "업데이트 완료" 공지
 * CI가 실패했거나 충돌이 있으면 합치지 않고 PR에 한 번 알린다 (고치면 다음 실행 때 다시 시도).
 * 초안(draft) PR은 건너뛴다.
 *
 * 저장소 토큰(GITHUB_TOKEN)으로 한 push 는 다른 워크플로를 깨우지 않으므로 배포는 직접 실행(workflow_dispatch)한다.
 * 실행: GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo node scripts/scheduled-deploy.mjs [--dry-run]
 */

const API = 'https://api.github.com';
const DEPLOY_WORKFLOW = 'deploy.yml';
const MARK = '<!-- scheduled-deploy -->';

export const NOTICE_FILE = /^notices\/(?!README\.md$)[^/]+\.md$/i;
const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

/** 글 머리(--- 사이)에서 key: value 하나 읽기 */
export function frontValue(text, key) {
  const m = text.replace(/\r\n/g, '\n').match(/^﻿?---\n([\s\S]*?)\n---/);
  if (!m) return undefined;
  const line = m[1].split('\n').find((l) => l.startsWith(`${key}:`));
  return line?.slice(key.length + 1).trim().replace(/^['"]|['"]$/g, '');
}

/** "2026-10-12 14:00" (한국 시간) → 밀리초. 형식이 틀리면 NaN */
export function parseKST(stamp) {
  if (!STAMP.test(stamp ?? '')) return NaN;
  return Date.parse(`${stamp.replace(' ', 'T')}:00+09:00`);
}

/** 밀리초 → "2026-10-12 14:07" (한국 시간) */
export function formatKST(ms) {
  return new Date(ms + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ');
}

/** 글 머리에 deployed_at 을 넣는다 (deploy_at 바로 아래, 이미 있으면 바꾼다) */
export function markDeployed(text, stamp) {
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(nl);
  const end = lines.indexOf('---', 1);
  const existing = lines.findIndex((l, i) => i < end && l.startsWith('deployed_at:'));
  if (existing > 0) lines[existing] = `deployed_at: ${stamp}`;
  else {
    const at = lines.findIndex((l, i) => i < end && l.startsWith('deploy_at:'));
    lines.splice(at > 0 ? at + 1 : end, 0, `deployed_at: ${stamp}`);
  }
  return lines.join(nl);
}

/** 이 PR의 체크 상태: 'pass' | 'pending' | 'fail' (예약 워크플로 자신은 뺀다) */
export function checkState(runs) {
  const others = runs.filter((r) => !/scheduled[- ]deploy|예약 업데이트/i.test(r.name));
  if (!others.length) return 'pending';
  if (others.some((r) => r.status !== 'completed')) return 'pending';
  return others.every((r) => ['success', 'skipped', 'neutral'].includes(r.conclusion)) ? 'pass' : 'fail';
}

// ───────────── GitHub API ─────────────

function client(token, repo, dryRun) {
  const call = async (method, path, body) => {
    if (dryRun && method !== 'GET') {
      console.log(`[dry-run] ${method} ${path}`);
      return {};
    }
    const res = await fetch(`${API}${path.replace('{repo}', repo)}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'madang-scheduled-deploy' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404 && method === 'GET') return null;
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
    return res.status === 204 ? {} : res.json();
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b),
    async file(path, ref) {
      const f = await call('GET', `/repos/{repo}/contents/${encodeURI(path)}?ref=${encodeURIComponent(ref)}`);
      return f && { sha: f.sha, text: Buffer.from(f.content, 'base64').toString('utf8') };
    },
    writeFile: (path, text, message, sha) =>
      call('PUT', `/repos/{repo}/contents/${encodeURI(path)}`, { message, content: Buffer.from(text, 'utf8').toString('base64'), branch: 'main', ...(sha ? { sha } : {}) }),
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** main 배포를 실행하고 끝날 때까지 기다린다. 성공하면 true */
async function deploy(gh, why) {
  const since = Date.now() - 5_000;
  console.log(`배포 실행: ${why}`);
  if (gh.deploy) return gh.deploy(why); // 테스트용
  await gh.post(`/repos/{repo}/actions/workflows/${DEPLOY_WORKFLOW}/dispatches`, { ref: 'main' });
  if (gh.dryRun) return true;
  let run;
  for (let i = 0; i < 120; i++) {
    await sleep(15_000);
    const runs = await gh.get(`/repos/{repo}/actions/workflows/${DEPLOY_WORKFLOW}/runs?event=workflow_dispatch&branch=main&per_page=5`);
    run = runs.workflow_runs.find((r) => Date.parse(r.created_at) >= since);
    if (run?.status === 'completed') break;
  }
  console.log(`배포 결과: ${run?.conclusion ?? '시간 초과'} ${run?.html_url ?? ''}`);
  return run?.conclusion === 'success';
}

/** PR에 한 번만 남기는 알림 (같은 내용이면 다시 쓰지 않는다) */
async function notifyOnce(gh, pr, key, text) {
  const comments = await gh.get(`/repos/{repo}/issues/${pr.number}/comments?per_page=100`);
  const tag = `${MARK}<!-- ${key} -->`;
  if (comments.some((c) => c.body.includes(tag))) return;
  await gh.post(`/repos/{repo}/issues/${pr.number}/comments`, { body: `${tag}\n${text}` });
}

export async function handle(gh, pr, now) {
  if (pr.draft) return;
  const files = await gh.get(`/repos/{repo}/pulls/${pr.number}/files?per_page=100`);
  const notices = [];
  for (const f of files.filter((f) => NOTICE_FILE.test(f.filename) && f.status !== 'removed')) {
    const file = await gh.file(f.filename, pr.head.sha);
    const stamp = file && frontValue(file.text, 'deploy_at');
    if (!stamp) continue;
    const at = parseKST(stamp);
    if (Number.isNaN(at)) {
      await notifyOnce(gh, pr, `bad-${f.filename}-${stamp}`, `⚠️ \`${f.filename}\`의 \`deploy_at: ${stamp}\` 형식이 틀려 예약하지 않았어요. \`2026-10-12 14:00\`처럼 한국 시간으로 적어 주세요.`);
      continue;
    }
    notices.push({ path: f.filename, text: file.text, stamp, at, title: frontValue(file.text, 'title') ?? f.filename });
  }
  if (!notices.length) return;
  // 여러 공지가 있으면 가장 늦은 시간에 합친다
  const at = Math.max(...notices.map((n) => n.at));
  const stamp = formatKST(at);

  if (now < at) {
    // 1) 예정 공지를 먼저 올린다 (PR 쪽 공지를 고치면 main 쪽도 맞춘다)
    let changed = false;
    for (const n of notices) {
      const onMain = await gh.file(n.path, 'main');
      if (onMain?.text === n.text) continue;
      await gh.writeFile(n.path, n.text, `공지: ${n.title} (업데이트 예정 ${n.stamp}, #${pr.number})`, onMain?.sha);
      changed = true;
    }
    if (changed) {
      const ok = await deploy(gh, `#${pr.number} 업데이트 예정 공지`);
      await notifyOnce(
        gh,
        pr,
        `announce-${stamp}`,
        ok
          ? `📅 업데이트 예정 공지를 사이트에 올렸어요. **${stamp}**(한국 시간)이 지나면 CI가 통과한 상태일 때 이 PR을 자동으로 합치고 배포해요. (GitHub 예약 실행은 최대 30분쯤 늦을 수 있어요)`
          : `⚠️ 업데이트 예정 공지는 main에 올렸지만 배포가 실패했어요. Actions의 Deploy to Cloudflare 기록을 확인해 주세요.`,
      );
    }
    return;
  }

  // 2) 시간이 됐다: CI · 충돌 확인 후 합치기
  const full = await gh.get(`/repos/{repo}/pulls/${pr.number}`);
  const runs = (await gh.get(`/repos/{repo}/commits/${pr.head.sha}/check-runs?per_page=100`)).check_runs;
  const state = checkState(runs);
  if (full.mergeable === false || full.mergeable_state === 'dirty') {
    await notifyOnce(gh, pr, `conflict-${pr.head.sha}`, `⚠️ 예약 시간(${stamp})이 지났지만 main과 충돌이 있어 합치지 않았어요. 충돌을 풀면 다음 실행 때 다시 시도해요.`);
    return;
  }
  if (state === 'fail') {
    await notifyOnce(gh, pr, `ci-${pr.head.sha}`, `⚠️ 예약 시간(${stamp})이 지났지만 CI가 실패해서 합치지 않았어요. 고쳐서 push하면 CI가 통과한 뒤 다음 실행 때 합쳐요.`);
    return;
  }
  if (state === 'pending' || full.mergeable == null) {
    console.log(`#${pr.number}: CI 또는 충돌 검사가 아직 끝나지 않아 다음 실행 때 다시 확인`);
    return;
  }

  const merged = await gh.put(`/repos/{repo}/pulls/${pr.number}/merge`, { merge_method: 'squash', sha: pr.head.sha, commit_title: `${pr.title} (#${pr.number})` });
  console.log(`#${pr.number} 합침 ${merged.sha ?? ''}`);
  const ok = await deploy(gh, `#${pr.number} 예약 업데이트`);
  if (!ok) {
    await notifyOnce(gh, pr, `deploy-fail-${stamp}`, `⚠️ 예약 시간에 PR을 합쳤지만 배포가 실패했어요. 사이트는 이전 버전 그대로예요. Actions의 Deploy to Cloudflare 기록을 확인해 주세요.`);
    return;
  }

  // 3) 완료 공지
  const done = formatKST(Date.now());
  for (const n of notices) {
    const onMain = await gh.file(n.path, 'main');
    if (!onMain) continue;
    await gh.writeFile(n.path, markDeployed(onMain.text, done), `공지: ${n.title} 업데이트 완료 (${done})`, onMain.sha);
  }
  await deploy(gh, `#${pr.number} 업데이트 완료 공지`);
  await notifyOnce(gh, pr, `done-${stamp}`, `✅ ${done}에 업데이트를 배포하고 완료 공지를 올렸어요.`);
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY 가 필요합니다');
  const dryRun = process.argv.includes('--dry-run');
  const gh = { ...client(token, repo, dryRun), dryRun };
  const prs = await gh.get('/repos/{repo}/pulls?state=open&base=main&per_page=50');
  console.log(`열린 PR ${prs.length}개 확인 (지금 ${formatKST(Date.now())} 한국 시간)`);
  let failed = false;
  for (const pr of prs) {
    try {
      await handle(gh, pr, Date.now());
    } catch (e) {
      failed = true;
      console.error(`#${pr.number}: ${e.message}`);
    }
  }
  if (failed) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
