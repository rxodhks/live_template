#!/usr/bin/env node
/*
 * 영어 번역 점검 (npm run i18n)
 *
 * 화면 문구는 한국어 문장 그대로를 열쇠로 쓴다: t('저장') → 영어 화면에서는 en 사전의 'Save'.
 * 이 스크립트는
 *   1) 화면 코드에 t()로 감싸지 않은 한국어 문구(문자열 · JSX 글자)가 남았는지
 *   2) t()에 넘긴 문구와 서버 · 공용 코드의 한국어 문구가 영어 사전(client/src/i18n/en/)에 모두 있는지
 *   3) 사전에 쓰이지 않거나 두 번 들어간 문구가 있는지
 * 를 확인한다. 한국어로 남겨야 하는 줄은 같은 줄이나 바로 윗줄에 `i18n-ignore` 주석을 단다
 * (파일 전체는 맨 위에 `i18n-ignore-file`).
 *
 *   node scripts/i18n-check.mjs          → 문제가 있으면 목록을 보여 주고 실패
 *   node scripts/i18n-check.mjs --list   → 감싸지 않은 문구만 파일별로 보여 준다
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const HANGUL = /[가-힣ㄱ-ㆎ]/;
/** 번역 함수 이름 — 첫 인자가 한국어 원문 (ko는 한국어로 저장하고 보는 화면에서 옮기는 문구) */
const T_FUNCS = new Set(['t', 'tr', 'ko']);

/** 영어 사전 (화면 · 서버 문구 모두) */
const DICT_DIR = 'client/src/i18n/en';
/**
 * 화면 코드: 한국어 문구는 t()로 감싼다.
 * 서버 · 공용 코드 · 웹 워커: 한국어 그대로 보내고, 화면이 받아서 translateServer()로 옮긴다 — 문구가 사전에 있기만 하면 된다.
 */
const UI_DIRS = ['client/src'];
const RAW_DIRS = ['shared', 'worker/src'];
const isRawFile = (rel) => RAW_DIRS.some((d) => rel.startsWith(d + '/')) || /\.worker\.ts$/.test(rel);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|mts)$/.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** 템플릿 문자열을 사전 열쇠 모양으로: `${n}개` → '{n}개' (변수 이름이 없으면 {0}, {1} …) */
function templateKey(node, sf) {
  let s = node.head.text;
  node.templateSpans.forEach((span, i) => {
    const e = span.expression;
    const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : String(i);
    s += `{${name}}${span.literal.text}`;
  });
  return s;
}

function scanFile(file) {
  const text = readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  if (/i18n-ignore-file/.test(text.slice(0, 2000))) return { rel, bare: [], keys: [] };
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = text.split('\n');
  // i18n-ignore-start ~ i18n-ignore-end 사이의 줄
  const ranges = [];
  lines.forEach((l, i) => {
    if (/i18n-ignore-start/.test(l)) ranges.push([i, lines.length]);
    else if (/i18n-ignore-end/.test(l) && ranges.length) ranges[ranges.length - 1][1] = i;
  });
  const inRange = (n) => ranges.some(([a, b]) => n >= a && n <= b);
  const ignored = (pos) => {
    const line = sf.getLineAndCharacterOfPosition(pos).line;
    return /i18n-ignore/.test(lines[line] ?? '') || /i18n-ignore/.test(lines[line - 1] ?? '') || inRange(line);
  };
  const bare = [];
  const keys = [];
  const isTCall = (n) => n && ts.isCallExpression(n) && ts.isIdentifier(n.expression) && T_FUNCS.has(n.expression.text);

  function visit(node) {
    // 개발자용 기록(console.*)은 번역하지 않는다
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'console') return;
    // t('…') 의 첫 인자: 사전 열쇠
    if (isTCall(node) && node.arguments.length) {
      const a = node.arguments[0];
      if (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) {
        keys.push({ key: a.text, pos: a.getStart(sf) });
        node.arguments.slice(1).forEach(visit);
        return;
      }
    }
    let value = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) value = node.text;
    else if (ts.isTemplateExpression(node)) value = templateKey(node, sf);
    else if (ts.isJsxText(node)) value = node.text.trim();
    if (value !== null && HANGUL.test(value)) {
      const parent = node.parent;
      const skip =
        ignored(node.getStart(sf)) ||
        // import 경로 · 정규식 등은 문구가 아니다
        ts.isImportDeclaration(parent) ||
        ts.isExportDeclaration(parent) ||
        (ts.isLiteralTypeNode(parent));
      if (!skip) bare.push({ value, pos: node.getStart(sf) });
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach((s) => visit(s.expression));
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  const where = (pos) => `${rel}:${sf.getLineAndCharacterOfPosition(pos).line + 1}`;
  return { rel, bare: bare.map((b) => ({ ...b, where: where(b.pos) })), keys: keys.map((k) => ({ ...k, where: where(k.pos) })) };
}

/** 사전 파일에서 열쇠 목록을 읽는다 (객체의 문자열 속성 이름) */
function dictKeys(p) {
  const text = readFileSync(p, 'utf8');
  const sf = ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true);
  const keys = new Set();
  const visit = (n) => {
    if (ts.isPropertyAssignment(n) && (ts.isStringLiteral(n.name) || ts.isNoSubstitutionTemplateLiteral(n.name)) && HANGUL.test(n.name.text)) keys.add(n.name.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return keys;
}

const listOnly = process.argv.includes('--list');
let problems = 0;
const report = (title, items) => {
  if (!items.length) return;
  problems += items.length;
  console.log(`\n● ${title} ${items.length}개`);
  for (const line of items) console.log(`  ${line}`);
};

const files = [...UI_DIRS, ...RAW_DIRS].flatMap((d) => walk(path.join(root, d))).filter((f) => !path.relative(root, f).startsWith(DICT_DIR));
const results = files.map(scanFile);
const used = new Map();
const bare = [];
for (const r of results) {
  for (const k of r.keys) if (!used.has(k.key)) used.set(k.key, k.where);
  if (isRawFile(r.rel)) for (const b of r.bare) !used.has(b.value) && used.set(b.value, b.where);
  else bare.push(...r.bare.map((b) => `${b.where}  ${JSON.stringify(b.value).slice(0, 120)}`));
}
report('t()로 감싸지 않은 한국어 문구', bare);
if (!listOnly) {
  const dict = new Map();
  const dup = [];
  for (const f of walk(path.join(root, DICT_DIR))) {
    for (const k of dictKeys(f)) {
      if (dict.has(k)) dup.push(`${JSON.stringify(k)}  (${dict.get(k)} · ${path.relative(root, f)})`);
      else dict.set(k, path.relative(root, f));
    }
  }
  report('사전에 두 번 들어간 문구', dup);
  report(
    `영어 사전(${DICT_DIR})에 없는 문구`,
    [...used].filter(([k]) => HANGUL.test(k) && !dict.has(k)).map(([k, w]) => `${w}  ${JSON.stringify(k)}`),
  );
  report('쓰이지 않는 사전 문구', [...dict.keys()].filter((k) => !used.has(k)).map((k) => `${JSON.stringify(k)}  (${dict.get(k)})`));
}
if (problems) {
  console.log(`\n번역 점검: 문제 ${problems}개`);
  process.exit(1);
}
console.log('번역 점검: 통과');
