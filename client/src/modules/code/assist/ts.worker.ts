/// <reference lib="webworker" />
/*
 * JavaScript · TypeScript · JSX · TSX 검사 워커 — TypeScript 언어 서비스로 문법 · 타입 오류를 찾는다.
 * 코드 화면에서 JS/TS 파일을 열 때만 불러온다 (수 MB). 템플릿의 다른 JS/TS 파일도 함께 넣어 import 를 따라간다.
 */
import ts from 'typescript';
import ko from 'typescript/lib/ko/diagnosticMessages.generated.json';
import type { AssistCompletion, AssistDiagnostic, AssistFix, CheckRequest, CompleteRequest, CompleteResult, DetailRequest } from './protocol';

// 표준 라이브러리 타입 (ES2022 + 브라우저 DOM)
const LIBS = import.meta.glob('../../../../../node_modules/typescript/lib/lib.{es5,es2015*,es2016*,es2017*,es2018*,es2019*,es2020*,es2021*,es2022*,dom,dom.iterable,dom.asynciterable,decorators,decorators.legacy}.d.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const libByName = new Map(Object.entries(LIBS).map(([p, text]) => [p.slice(p.lastIndexOf('/') + 1), text]));

// 한국어 오류 메시지
try {
  (ts as unknown as { setLocalizedDiagnosticMessages(m: unknown): void }).setLocalizedDiagnosticMessages(ko);
} catch {
  /* 영어로 */
}

/*
 * 마당 실행 환경에 맞춘 선언
 *  - 실행기는 파일마다 CommonJS로 바꿔 require · module · exports 를 넘겨준다
 *  - JSX/TSX 미리보기는 react · react-dom 을 기본 제공한다 (타입은 없으므로 any 로)
 */
const AMBIENT = `
declare var require: (id: string) => any;
declare var module: { exports: any };
declare var exports: any;
declare var __filename: string;
declare var __dirname: string;
declare module 'react';
declare module 'react-dom';
declare module 'react-dom/client';
declare module 'react/jsx-runtime';
declare namespace JSX {
  interface Element { [key: string]: any }
  interface IntrinsicElements { [name: string]: any }
  interface ElementChildrenAttribute { children: {} }
}
`;
const AMBIENT_FILE = '/__madang__.d.ts';

const options: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  // 파일마다 따로인 모듈로 본다 (다른 파일과 같은 변수 이름을 써도 충돌하지 않고, 시작 파일의 최상위 await 도 된다)
  moduleDetection: ts.ModuleDetectionKind.Force,
  allowJs: true,
  checkJs: true,
  strict: true,
  jsx: ts.JsxEmit.Preserve,
  noEmit: true,
  allowImportingTsExtensions: true,
  resolveJsonModule: true,
  esModuleInterop: true,
  skipLibCheck: true,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
};

const files = new Map<string, { text: string; version: number }>();
files.set(AMBIENT_FILE, { text: AMBIENT, version: 1 });

const libText = (path: string) => (path.startsWith('/lib/') ? libByName.get(path.slice(5)) : undefined);
const readText = (path: string) => files.get(path)?.text ?? libText(path);

const host: ts.LanguageServiceHost = {
  getCompilationSettings: () => options,
  getScriptFileNames: () => [...files.keys()],
  getScriptVersion: (f) => String(files.get(f)?.version ?? 0),
  getScriptSnapshot: (f) => {
    const t = readText(f);
    return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t);
  },
  getCurrentDirectory: () => '/',
  getDefaultLibFileName: () => '/lib/lib.d.ts',
  fileExists: (f) => readText(f) !== undefined,
  readFile: readText,
  directoryExists: (d) => d === '/' || d === '/lib' || d === '/lib/',
  getDirectories: () => [],
};
const service = ts.createLanguageService(host, ts.createDocumentRegistry());

// JS는 초보자 코드가 많아 null 가능성 검사 같은 엄격한 규칙은 빼고 경고로만 보여 준다
const JS_IGNORE = new Set([2531, 2532, 2533, 2722, 18046, 18047, 18048, 18049, 7006, 7005, 7034, 7031]);

function sync(all: Record<string, string>) {
  const want = new Set(Object.keys(all).map((n) => '/' + n));
  for (const key of [...files.keys()]) if (key !== AMBIENT_FILE && !want.has(key)) files.delete(key);
  for (const [name, text] of Object.entries(all)) {
    const key = '/' + name;
    const cur = files.get(key);
    if (!cur) files.set(key, { text, version: 1 });
    else if (cur.text !== text) files.set(key, { text, version: cur.version + 1 });
  }
}

function check({ name, files: all }: CheckRequest): AssistDiagnostic[] {
  sync(all);
  const key = '/' + name;
  if (!files.has(key)) return [];
  const isJs = /\.(m|c)?jsx?$/i.test(name);
  const raw = [...service.getSyntacticDiagnostics(key), ...service.getSemanticDiagnostics(key)];
  const out: AssistDiagnostic[] = [];
  for (const d of raw) {
    if (d.start === undefined) continue;
    if (isJs && d.category !== ts.DiagnosticCategory.Error) continue;
    const semantic = d.code >= 2000;
    if (isJs && semantic && JS_IGNORE.has(d.code)) continue;
    out.push({
      fixes: fixesFor(key, d),
      from: d.start,
      to: d.start + (d.length ?? 0),
      severity: d.category === ts.DiagnosticCategory.Error ? (isJs && semantic ? 'warning' : 'error') : d.category === ts.DiagnosticCategory.Warning ? 'warning' : 'info',
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
      source: `TS${d.code}`,
    });
  }
  return out;
}

const FORMAT: ts.FormatCodeSettings = { indentSize: 2, tabSize: 2, convertTabsToSpaces: true, semicolons: ts.SemicolonPreference.Ignore };
const PREFS: ts.UserPreferences = { quotePreference: 'auto', importModuleSpecifierEnding: 'minimal' };

/** 빠른 수정 (오타 이름 바꾸기, 빠진 import 추가, await 붙이기 …) — 이 파일만 고치는 것만 */
function fixesFor(key: string, d: ts.Diagnostic): AssistFix[] | undefined {
  if (d.start === undefined) return undefined;
  let found: readonly ts.CodeFixAction[];
  try {
    found = service.getCodeFixesAtPosition(key, d.start, d.start + (d.length ?? 0), [d.code], FORMAT, PREFS);
  } catch {
    return undefined;
  }
  const fixes = found
    // ‘이 파일 검사 끄기’ 같은 수정은 빼고, 이 파일만 고치는 것만
    .filter((f) => f.fixName !== 'disableJsDiagnostics' && f.changes.length > 0 && f.changes.every((c) => c.fileName === key) && !f.commands?.length)
    .slice(0, 3)
    .map((f) => ({
      title: f.description,
      changes: f.changes.flatMap((c) => c.textChanges.map((t) => ({ from: t.span.start, to: t.span.start + t.span.length, insert: t.newText }))),
    }));
  return fixes.length ? fixes : undefined;
}

/** 자동 완성: 커서 자리에서 쓸 수 있는 이름 (변수 · 함수 · 객체의 속성 · 메서드 …) */
function complete({ name, files: all, pos }: CompleteRequest): CompleteResult {
  sync(all);
  const key = '/' + name;
  const text = files.get(key)?.text ?? '';
  let from = pos;
  while (from > 0 && /[\w$]/.test(text[from - 1])) from--;
  const info = service.getCompletionsAtPosition(key, pos, {
    includeCompletionsWithInsertText: true,
    includeAutomaticOptionalChainCompletions: true,
    includeCompletionsForModuleExports: false,
  });
  if (!info) return { from, items: [] };
  const items: AssistCompletion[] = [];
  for (const e of info.entries) {
    // JS에서 이 파일의 아무 단어나 넣어 주는 추천(warning)은 빼고 진짜 이름만
    if (e.kind === ts.ScriptElementKind.warning) continue;
    items.push({
      label: e.name,
      kind: e.kind,
      sort: e.sortText,
      insert: e.insertText && e.insertText !== e.name ? e.insertText : undefined,
      from: e.replacementSpan?.start,
      to: e.replacementSpan ? e.replacementSpan.start + e.replacementSpan.length : undefined,
      source: e.source,
      data: e.data,
    });
    if (items.length >= 400) break;
  }
  return { from, items };
}

function detail({ name, files: all, pos, entry, source, data }: DetailRequest): { detail: string; doc: string } | null {
  sync(all);
  const d = service.getCompletionEntryDetails('/' + name, pos, entry, FORMAT, source, PREFS, data as ts.CompletionEntryData | undefined);
  if (!d) return null;
  return { detail: ts.displayPartsToString(d.displayParts), doc: ts.displayPartsToString(d.documentation) };
}

type Msg = { id: number; req?: CheckRequest; complete?: CompleteRequest; detail?: DetailRequest };
self.onmessage = (e: MessageEvent<Msg>) => {
  const { id, req, complete: c, detail: dt } = e.data;
  try {
    if (c) self.postMessage({ id, completions: complete(c) });
    else if (dt) self.postMessage({ id, detail: detail(dt) });
    else if (req) self.postMessage({ id, diagnostics: check(req) });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
