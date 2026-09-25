// Lua 5.4 실행 (wasmoon) — 다른 .lua 파일을 require 할 수 있고, io.read는 ‘입력’ 칸에서 읽는다
async function main({ entry, files, stdin }) {
  importScripts(fileURL('wasmoon.js', 'text/javascript'));
  const factory = new self.wasmoon.LuaFactory(fileURL('glue.wasm', 'application/wasm'));
  for (const [name, code] of Object.entries(files)) await factory.mountFile('/app/' + name, code);
  const lua = await factory.createEngine({ injectObjects: false });
  const lines = (stdin || '').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  let buffer = '';
  const flush = () => {
    if (buffer) out('log', buffer.replace(/\n$/, ''));
    buffer = '';
  };
  const write = (s) => {
    buffer += s;
    const parts = buffer.split('\n');
    buffer = parts.pop();
    for (const p of parts) out('log', p);
  };
  lua.global.set('__out', (s) => write(String(s)));
  lua.global.set('__readline', () => (lines.length ? lines.shift() : undefined));
  await lua.doString(`
    package.path = '/app/?.lua;/app/?/init.lua;' .. package.path
    local out, readline = __out, __readline
    print = function(...)
      local t = table.pack(...)
      for i = 1, t.n do t[i] = tostring(t[i]) end
      out(table.concat(t, '\\t', 1, t.n) .. '\\n')
    end
    io.write = function(...)
      for _, v in ipairs({...}) do out(tostring(v)) end
      return io
    end
    io.read = function(fmt)
      local line = readline()
      if line == nil then return nil end
      if fmt == 'n' or fmt == '*n' then return tonumber(line) end
      return line
    end
    io.lines = function() return function() return readline() end end
  `);
  ready();
  try {
    await lua.doString('dofile("/app/' + entry.replace(/"/g, '\\"') + '")');
  } catch (err) {
    flush();
    out('error', String((err && err.message) || err).replace(/\[string "[^"]*"\]:\d+:\s*/, ''));
    const e = new Error('lua');
    e.__reported = true;
    throw e;
  } finally {
    flush();
    lua.global.close();
  }
}
