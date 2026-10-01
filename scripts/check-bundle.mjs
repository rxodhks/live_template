#!/usr/bin/env node
/*
 * 첫 화면 번들 크기 예산 검사 — 빌드된 client/dist를 읽어, 첫 화면에서 받는 JS·CSS(gzip) 크기를 잰다.
 *  · 첫 화면 = index.html이 바로 불러오는 스크립트·스타일 + 그 스크립트가 정적으로 import하는 파일 전부
 *  · 지연 로딩되는 화면(로그인, 워크스페이스 등)은 각 화면에 들어갈 때 추가로 받는 크기를 따로 잰다
 * 예산은 scripts/bundle-budget.json. 넘으면 실패(exit 1)해서 CI가 느려지는 변경을 막는다.
 * 실행: npm run build && node scripts/check-bundle.mjs   (GitHub Actions에서는 결과를 작업 요약에 표로 남긴다)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
const budget = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'bundle-budget.json'), 'utf8'));

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('client/dist/index.html이 없습니다. 먼저 npm run build를 실행하세요.');
  process.exit(1);
}

const gz = new Map();
/** gzip 크기 (바이트) */
function gzipSize(rel) {
  if (!gz.has(rel)) gz.set(rel, zlib.gzipSync(fs.readFileSync(path.join(dist, rel)), { level: 9 }).length);
  return gz.get(rel);
}

/** 한 JS 파일이 정적으로 가져오는 파일 (import ... from "./x.js", import "./x.js"). import("./x.js")는 지연 로딩이라 제외 */
function staticImports(rel) {
  const src = fs.readFileSync(path.join(dist, rel), 'utf8');
  const out = new Set();
  for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*)["'](\.{1,2}\/[^"']+\.js)["']/g)) {
    out.add(path.posix.join(path.posix.dirname(rel), m[1]));
  }
  return out;
}

/** 시작 파일들과 그 정적 import 전부 */
function closure(starts) {
  const seen = new Set();
  const stack = [...starts];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    if (f.endsWith('.js')) stack.push(...staticImports(f));
  }
  return seen;
}

const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const local = (href) => href.replace(/^\//, '');
const entryFiles = [
  ...[...html.matchAll(/<script[^>]+src="(\/assets\/[^"]+)"/g)].map((m) => local(m[1])),
  ...[...html.matchAll(/<link[^>]+rel="(?:modulepreload|stylesheet)"[^>]+href="(\/assets\/[^"]+)"/g)].map((m) => local(m[1])),
];
const firstScreen = closure(entryFiles);

/** 지연 로딩 화면: 파일 이름 앞부분(예: Workspace)으로 찾은 청크 + 그 정적 import 중 첫 화면에 없는 것 */
const assets = fs.readdirSync(path.join(dist, 'assets'));
function lazyRoute(prefix) {
  const chunk = assets.find((f) => f.startsWith(`${prefix}-`) && f.endsWith('.js'));
  if (!chunk) return null;
  const files = [...closure([`assets/${chunk}`])].filter((f) => !firstScreen.has(f));
  // 지연 청크의 CSS는 같은 이름으로 따로 나온다
  const css = assets.filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.css')).map((f) => `assets/${f}`);
  return [...files, ...css];
}

const sum = (files) => [...files].reduce((n, f) => n + gzipSize(f), 0);
const kb = (n) => (n / 1024).toFixed(1);

const rows = [];
const firstJs = sum([...firstScreen].filter((f) => f.endsWith('.js')));
const firstCss = sum([...firstScreen].filter((f) => f.endsWith('.css')));
rows.push({ name: '첫 화면 (JS+CSS)', size: firstJs + firstCss, limit: budget.firstScreen, detail: `JS ${kb(firstJs)}KB · CSS ${kb(firstCss)}KB · 파일 ${firstScreen.size}개` });
for (const [prefix, limit] of Object.entries(budget.routes ?? {})) {
  const files = lazyRoute(prefix);
  if (!files) {
    rows.push({ name: `${prefix} 화면 추가분`, size: NaN, limit, detail: '청크를 찾지 못함 (이름이 바뀌었다면 bundle-budget.json도 고쳐 주세요)' });
    continue;
  }
  rows.push({ name: `${prefix} 화면 추가분`, size: sum(files), limit, detail: `파일 ${files.length}개` });
}

let failed = false;
const lines = ['| 항목 | gzip | 예산 | 결과 | 내용 |', '| --- | ---: | ---: | :---: | --- |'];
for (const r of rows) {
  const limitBytes = r.limit * 1024;
  const ok = Number.isFinite(r.size) && r.size <= limitBytes;
  if (!ok) failed = true;
  const pct = Number.isFinite(r.size) ? ` (${Math.round((r.size / limitBytes) * 100)}%)` : '';
  lines.push(`| ${r.name} | ${Number.isFinite(r.size) ? kb(r.size) + 'KB' : '-'} | ${r.limit}KB | ${ok ? '✅' : '❌'}${pct} | ${r.detail} |`);
}

// 첫 화면에서 큰 파일 상위 5개 (어디가 커졌는지 바로 보이게)
const top = [...firstScreen].sort((a, b) => gzipSize(b) - gzipSize(a)).slice(0, 5);
const topLines = ['', '첫 화면에서 큰 파일:', ...top.map((f) => `- ${f} · ${kb(gzipSize(f))}KB`)];

const report = ['### 번들 크기 예산', '', ...lines, ...topLines].join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');

if (failed) {
  console.error('\n번들 크기 예산을 넘었습니다. 새로 넣은 의존성을 지연 로딩(import())으로 바꾸거나, 꼭 필요하면 scripts/bundle-budget.json의 예산을 이유와 함께 올려 주세요.');
  process.exit(1);
}
