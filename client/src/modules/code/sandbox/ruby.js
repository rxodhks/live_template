// Ruby 3.4 실행 (ruby.wasm) — require_relative로 다른 .rb 파일을 불러올 수 있고, gets는 ‘입력’ 칸에서 읽는다
async function main({ entry, files, stdin }) {
  const R = await import(fileURL('ruby-runtime.mjs', 'text/javascript'));
  const module = await WebAssembly.compile(await gunzip('ruby.wasm.gz'));
  const enc = new TextEncoder();
  const app = new Map(Object.entries(files).map(([name, code]) => [name, new R.File(enc.encode(code))]));
  const fds = [
    new R.OpenFile(new R.File(enc.encode(stdin || ''))),
    R.ConsoleStdout.lineBuffered((l) => out('log', l)),
    R.ConsoleStdout.lineBuffered((l) => out('error', l)),
    new R.PreopenDirectory('/app', app),
  ];
  const wasi = new R.WASI([], [], fds, { debug: false });
  const { vm } = await R.RubyVM.instantiateModule({ module, wasip1: wasi });
  ready();
  try {
    vm.eval('$stdout.sync = true; $stderr.sync = true; Dir.chdir("/app"); load "/app/' + entry.replace(/"/g, '\\"') + '"');
  } catch (err) {
    out('error', String((err && err.message) || err).replace(/\/app\//g, ''));
    const e = new Error('ruby');
    e.__reported = true;
    throw e;
  }
}
