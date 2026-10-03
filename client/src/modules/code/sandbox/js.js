// JavaScript · TypeScript 실행 — 템플릿 안의 다른 파일을 import / require 할 수 있다 (파일마다 CommonJS 모듈로 변환되어 온다)
//  payload: { entry: 파일 이름, modules: { 파일 이름: 변환된 코드 } }
const AsyncFunction = (async () => {}).constructor;
const EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];

async function main({ entry, modules }) {
  const cache = {};
  const resolve = (spec) => {
    const base = spec.replace(/^(\.\.?\/)+/, '').replace(/^\//, '');
    const names = Object.keys(modules);
    for (const ext of EXT) if (names.includes(base + ext)) return base + ext;
    // TypeScript에서 흔한 './util.js' → util.ts
    const noJs = base.replace(/\.(m|c)?js$/, '');
    for (const ext of ['.ts', '.tsx']) if (names.includes(noJs + ext)) return noJs + ext;
    for (const ext of EXT) if (names.includes(base + '/index' + ext)) return base + '/index' + ext;
    return null;
  };
  const load = (name, isEntry) => {
    const mod = { exports: {} };
    cache[name] = mod;
    const code = modules[name] + '\n//# sourceURL=' + encodeURI(name);
    if (name.endsWith('.json')) {
      mod.exports = JSON.parse(modules[name]);
      return { mod, run: null };
    }
    const Fn = isEntry ? AsyncFunction : Function;
    return { mod, run: new Fn('exports', 'require', 'module', '__filename', '__dirname', code) };
  };
  const require = (spec) => {
    if (!spec.startsWith('.') && !spec.startsWith('/')) {
      throw new Error("외부 패키지 '" + spec + "'는 불러올 수 없습니다. 템플릿 안의 파일만 import 할 수 있어요 (예: import { add } from './math').");
    }
    const name = resolve(spec);
    if (!name) throw new Error("'" + spec + "' 파일을 찾을 수 없습니다. 템플릿 안에 있는 파일 이름을 확인해 주세요.");
    if (cache[name]) return cache[name].exports;
    const { mod, run } = load(name, false);
    if (run) run(mod.exports, require, mod, name, '/');
    return mod.exports;
  };
  const timers = trackTimers();
  ready();
  const { mod, run } = load(entry, true);
  try {
    await run(mod.exports, require, mod, entry, '/');
  } catch (err) {
    out('error', describe(err));
    err && typeof err === 'object' && (err.__reported = true);
    throw err;
  }
  // Node처럼 남은 setTimeout · setInterval이 모두 끝날 때까지 기다린다 (처리되지 않은 Promise 거부도 이때 나온다)
  await timers.idle();
}

/** setTimeout · setInterval을 세어 두고, 모두 끝나면 알린다. 콜백에서 난 오류는 파일 · 줄 번호와 함께 보여 주고 실행을 끝낸다 */
function trackTimers() {
  const st = self.setTimeout.bind(self);
  const ct = self.clearTimeout.bind(self);
  const si = self.setInterval.bind(self);
  const ci = self.clearInterval.bind(self);
  const active = new Map();
  let waiting = null;
  let failed = null;
  const settle = () => {
    if (waiting && (failed || !active.size)) {
      const w = waiting;
      waiting = null;
      failed ? w.reject(failed) : w.resolve();
    }
  };
  const call = (fn, args) => {
    if (failed) return;
    try {
      if (typeof fn === 'function') fn(...args);
    } catch (err) {
      out('error', describe(err));
      failed = { __reported: true };
      for (const [id, clear] of active) clear(id);
      active.clear();
    }
  };
  self.setTimeout = (fn, ms, ...args) => {
    const id = st(() => {
      active.delete(id);
      call(fn, args);
      settle();
    }, ms);
    active.set(id, ct);
    return id;
  };
  self.setInterval = (fn, ms, ...args) => {
    const id = si(() => {
      call(fn, args);
      settle();
    }, ms);
    active.set(id, ci);
    return id;
  };
  self.clearTimeout = self.clearInterval = (id) => {
    const clear = active.get(id);
    if (clear) clear(id);
    else {
      ct(id);
      ci(id);
    }
    active.delete(id);
    settle();
  };
  return {
    idle: async () => {
      // 처리되지 않은 Promise 거부가 먼저 보고되도록 한 번 쉬어 간다
      await new Promise((r) => st(r, 0));
      await new Promise((resolve, reject) => {
        waiting = { resolve, reject };
        settle();
      });
    },
  };
}

/** 오류 메시지 + 어느 파일 몇 번째 줄인지 */
function describe(err) {
  if (!(err instanceof Error)) return 'Uncaught ' + fmt(err);
  const m = /([^\s()]+?):(\d+):(\d+)\)?\s*$/m.exec((err.stack || '').split('\n').slice(1).join('\n'));
  let where = '';
  if (m) {
    const file = decodeURI(m[1].replace(/^.*\//, ''));
    // new Function은 앞에 두 줄을 붙인다
    const lineNo = Number(m[2]) - 2;
    if (lineNo > 0 && !/^blob:/.test(m[1])) where = ' (' + file + ':' + lineNo + ')';
  }
  return err.name + ': ' + err.message + where;
}
