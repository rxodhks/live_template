// 파이썬 실행 (Pyodide · CPython WebAssembly)
//  payload: { entry, files: { 이름: 코드 } (다른 .py 파일도 import 가능), stdin, cdn }
//  실행 환경 파일은 부모가 넘겨준 FILES에서 쓰고, numpy 같은 추가 패키지만 CDN에서 받는다
async function main({ entry, files, stdin, cdn }) {
  const realFetch = self.fetch.bind(self);
  self.fetch = (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith('/pyodide.asm.wasm')) return Promise.resolve(new Response(FILES['pyodide.asm.wasm'], { headers: { 'content-type': 'application/wasm' } }));
    return realFetch(input, init);
  };
  // 격리된 샌드박스에서는 모듈 워커를 만들 수 없어 일반 워커에서 실행한다.
  // Pyodide는 일반 워커를 거부하므로(importScripts 사용 여부로 판단) importScripts를 막아 두고, 파일은 import()로 불러온다
  self.importScripts = () => {
    throw new Error('importScripts is disabled');
  };
  const { loadPyodide } = await import(fileURL('pyodide.mjs', 'text/javascript'));
  const createPyodideModule = (await import(fileURL('pyodide.asm.mjs', 'text/javascript'))).default;
  const py = await loadPyodide({
    indexURL: cdn,
    packageBaseUrl: cdn,
    createPyodideModule,
    lockFileContents: fileText('pyodide-lock.json'),
    stdLibURL: fileURL('python_stdlib.zip', 'application/zip'),
    checkAPIVersion: false,
  });
  py.setStdout({ batched: (s) => out('log', s) });
  py.setStderr({ batched: (s) => out('error', s) });
  let given = false;
  const text = stdin ? (stdin.endsWith('\n') ? stdin : stdin + '\n') : '';
  py.setStdin({ stdin: () => (given || !text ? null : ((given = true), text)) });

  // 템플릿의 다른 .py 파일을 같은 폴더에 두어 import 할 수 있게
  const home = '/home/pyodide';
  for (const [name, code] of Object.entries(files)) py.FS.writeFile(home + '/' + name, code);
  py.runPython('import sys, os\nos.chdir(' + JSON.stringify(home) + ')\nif ' + JSON.stringify(home) + ' not in sys.path: sys.path.insert(0, ' + JSON.stringify(home) + ')');

  const code = files[entry];
  // numpy · pandas 같은 패키지는 필요할 때만 CDN에서
  try {
    await py.loadPackagesFromImports(code, {
      messageCallback: (m) => /^Loading|^Loaded/.test(m) && post({ t: 'status', text: '패키지 ' + m.replace(/^Load(ing|ed)\s*/, '') + (m.startsWith('Loaded') ? ' 준비됨' : ' 받는 중…') }),
      errorCallback: (m) => out('warn', m),
    });
  } catch (err) {
    out('warn', '패키지를 불러오지 못했습니다 (인터넷 연결이 필요합니다): ' + (err && err.message ? err.message : err));
  }
  ready();
  const globals = py.toPy({ __name__: '__main__', __file__: home + '/' + entry });
  try {
    await py.runPythonAsync(code, { globals, filename: home + '/' + entry });
  } catch (err) {
    const msg = cleanTraceback(String((err && err.message) || err), home);
    out('error', msg);
    if (/EOFError/.test(msg)) out('info', '입력(input)이 필요한 코드입니다. 출력 창의 ‘입력’ 칸에 한 줄에 하나씩 값을 넣고 다시 실행하세요.');
    const e = new Error('python');
    e.__reported = true;
    throw e;
  } finally {
    globals.destroy && globals.destroy();
  }
}

/** Pyodide 내부 호출(/lib/python314.zip/_pyodide/… · <exec>)은 그 아래 코드 줄까지 통째로 감추고, 템플릿 파일의 줄만 남긴다 */
function cleanTraceback(msg, home) {
  const kept = [];
  let skipIndent = -1;
  for (const l of msg.split('\n')) {
    const indent = l.length - l.trimStart().length;
    if (skipIndent >= 0) {
      if (!l.trim() || indent > skipIndent) continue;
      skipIndent = -1;
    }
    const frame = /^(\s*)File "([^"]*)"/.exec(l);
    if (frame && (frame[2].startsWith('/lib/') || frame[2].startsWith('<'))) {
      skipIndent = frame[1].length;
      continue;
    }
    kept.push(l);
  }
  // 남은 호출 줄이 없으면 'Traceback' 머리말도 뺀다
  const i = kept.findIndex((l) => /^Traceback \(most recent call last\):/.test(l));
  if (i >= 0 && !/^\s*File "/.test(kept[i + 1] || '')) kept.splice(i, 1);
  return kept.join('\n').replaceAll(home + '/', '').trim();
}
