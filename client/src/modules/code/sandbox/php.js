// PHP 8.4 실행 (php-wasm) — require로 다른 .php 파일을 불러올 수 있고, fgets(STDIN)은 ‘입력’ 칸에서 읽는다
async function main({ entry, files, stdin }) {
  // 브라우저용 PHP는 화면(document)이 있다고 가정하고 만들어졌다 — 워커에서는 쓰지 않는 기능이라 빈 객체로 채운다
  if (typeof document === 'undefined') {
    self.document = {
      currentScript: null,
      addEventListener() {},
      removeEventListener() {},
      querySelector: () => null,
      getElementById: () => null,
      createElement: () => ({ style: {} }),
      body: null,
      documentElement: {},
      title: '',
      visibilityState: 'visible',
      hidden: false,
    };
  }
  if (typeof window === 'undefined') self.window = self;
  if (typeof screen === 'undefined') self.screen = {};

  const { Php } = await import(fileURL('php-runtime.mjs', 'text/javascript'));
  const pending = { out: '', err: '' };
  const level = (l) => (/^(PHP )?(Fatal error|Parse error)/.test(l) ? 'error' : /^(PHP )?(Warning|Notice|Deprecated)/.test(l) ? 'warn' : 'log');
  const clean = (l) => l.replace(/\/app\//g, '');
  const emit = (kind) => (e) => {
    pending[kind] += (e.detail || []).join('');
    const parts = pending[kind].split('\n');
    pending[kind] = parts.pop();
    for (const p of parts) {
      // PHP가 오류 앞에 붙이는 빈 줄과 내부 실행 줄은 감춘다
      if (!p && kind === 'out' && !pending.seenOut) continue;
      if (/php-wasm run script/.test(p)) continue;
      pending.seenOut = true;
      out(kind === 'err' ? 'error' : level(p), clean(p));
    }
  };
  // wasm은 이미 넘겨받았으니 주소 계산(샌드박스의 blob 주소로는 상대 경로를 만들 수 없다)을 건너뛴다
  const php = new Php({ wasmBinary: FILES['php.wasm'], locateFile: (path) => path });
  php.addEventListener('output', emit('out'));
  php.addEventListener('error', emit('err'));
  const bin = await php.binary;
  try {
    bin.FS.mkdir('/app');
  } catch {}
  for (const [name, code] of Object.entries(files)) bin.FS.writeFile('/app/' + name, code);
  if (stdin) php.inputString(stdin.endsWith('\n') ? stdin : stdin + '\n');
  ready();
  // 파일을 include로 실행해야 오류에 파일 이름 · 줄 번호가 나온다. 웹용 PHP에는 STDIN 상수가 없어서 만들어 준다
  const status = await php.run(
    "<?php chdir('/app'); if (!defined('STDIN')) { define('STDIN', fopen('php://stdin', 'r')); define('STDOUT', fopen('php://stdout', 'w')); define('STDERR', fopen('php://stderr', 'w')); } include '/app/" +
      entry.replace(/'/g, "\\'") +
      "';",
  );
  if (pending.out) out(level(pending.out), clean(pending.out));
  if (pending.err) out('error', clean(pending.err));
  if (status) {
    const e = new Error('php');
    e.__reported = true;
    throw e;
  }
}
