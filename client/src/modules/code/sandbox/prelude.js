// 샌드박스 워커 공통 (격리된 iframe 안의 Web Worker에서 실행된다 — 이 앱의 저장소 · 로그인 정보에 접근할 수 없다)
//  · out(level, text): 출력 한 줄 · table(columns, rows): 표 출력 · ready(): 실행 환경 준비 끝 (여기서부터 시간 제한)
//  · FILES: 부모가 넘겨준 실행 환경 파일 { 이름: ArrayBuffer }
'use strict';
const post = (m) => postMessage(m);
const fmt = (v, depth = 0) => {
  if (typeof v === 'string') return depth ? JSON.stringify(v) : v;
  if (typeof v === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
  if (v instanceof Error) return v.name + ': ' + v.message;
  if (typeof v === 'bigint') return v + 'n';
  if (v === undefined) return 'undefined';
  if (typeof v === 'symbol') return v.toString();
  if (v instanceof Map) return 'Map(' + v.size + ') ' + fmt(Object.fromEntries(v), depth + 1);
  if (v instanceof Set) return 'Set(' + v.size + ') ' + fmt([...v], depth + 1);
  try {
    const seen = new WeakSet();
    return JSON.stringify(
      v,
      (k, x) => {
        if (typeof x === 'object' && x !== null) {
          if (seen.has(x)) return '[Circular]';
          seen.add(x);
        }
        if (typeof x === 'bigint') return x + 'n';
        if (typeof x === 'function') return '[Function]';
        if (x === undefined) return null;
        return x;
      },
      2,
    );
  } catch {
    return String(v);
  }
};
let outCount = 0;
const MAX_OUT = 5000;
const out = (level, text) => {
  if (++outCount > MAX_OUT) {
    if (outCount === MAX_OUT + 1) post({ t: 'out', level: 'warn', text: '출력이 너무 많아 이후 출력은 생략합니다.' });
    return;
  }
  post({ t: 'out', level, text: String(text) });
};
const table = (columns, rows, note) => post({ t: 'table', columns, rows: rows.slice(0, 500), total: rows.length, note });
const ready = () => post({ t: 'ready' });
const send = (level, args) => out(level, args.map((a) => fmt(a)).join(' '));
console.log = (...a) => send('log', a);
console.info = (...a) => send('info', a);
console.debug = (...a) => send('log', a);
console.warn = (...a) => send('warn', a);
console.error = (...a) => send('error', a);
console.table = (d) => send('log', [d]);
self.onunhandledrejection = (e) => {
  e.preventDefault();
  send('error', ['처리되지 않은 Promise 거부: ' + fmt(e.reason)]);
};

let FILES = {};
const fileBlob = (name, type) => {
  if (!FILES[name]) throw new Error('실행 환경 파일이 없습니다: ' + name);
  return new Blob([FILES[name]], { type: type || 'application/octet-stream' });
};
const fileURL = (name, type) => URL.createObjectURL(fileBlob(name, type));
const fileText = (name) => new TextDecoder().decode(FILES[name]);
/** gzip으로 줄여 올린 파일 풀기 */
const gunzip = async (name) => {
  const bytes = new Uint8Array(FILES[name]);
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return FILES[name];
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
};
const errText = (e) => (e && (e.stack || e.message)) || String(e);

self.onmessage = async (e) => {
  const d = e.data || {};
  FILES = d.files || {};
  const started = performance.now();
  try {
    await main(d.payload || {});
    post({ t: 'done', ok: true, ms: Math.round(performance.now() - started) });
  } catch (err) {
    if (err && err.__reported) post({ t: 'done', ok: false });
    else {
      out('error', typeof err === 'object' && err && 'message' in err ? String(err.message) : String(err));
      post({ t: 'done', ok: false });
    }
  }
};
