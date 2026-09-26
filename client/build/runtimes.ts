import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { Plugin } from 'vite';
import { build as esbuild } from 'esbuild';

/*
 * 코드 실행 환경(런타임) 준비 — 빌드할 때 node_modules에서 꺼내 사이트의 /runtimes/<id>-<해시>/ 로 함께 배포한다.
 *  - 폴더 이름에 내용 해시가 들어가므로 파일은 바뀌지 않는다 (브라우저가 한 번 받아 두고 계속 쓴다)
 *  - 클라우드플레어 정적 파일은 한 파일이 25MiB를 넘을 수 없어 큰 파일은 gzip으로 줄여 올리고 브라우저에서 푼다
 *  - 여러 파일로 나뉜 라이브러리(React · Ruby · PHP)는 esbuild로 한 파일로 묶는다
 * 클라이언트는 __RUNTIMES__ (폴더 · 파일 이름 · 크기)만 알고, 실제 파일은 실행할 때 받아 온다.
 */

export type RuntimeId = 'python' | 'sql' | 'lua' | 'ruby' | 'php' | 'react';

export interface RuntimeFileInfo {
  name: string;
  size: number;
  /** gzip으로 줄여 올린 파일 (받은 뒤 풀어서 쓴다) */
  gz?: boolean;
}
export interface RuntimeInfo {
  dir: string;
  version: string;
  files: RuntimeFileInfo[];
  total: number;
}

const ROOT = path.resolve(__dirname, '..', '..');
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'madang-runtimes');
const MAX_ASSET = 25 * 1024 * 1024;

function pkgDir(name: string): string {
  for (const base of [path.join(ROOT, 'client', 'node_modules'), path.join(ROOT, 'node_modules')]) {
    const dir = path.join(base, name);
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
  }
  throw new Error(`실행 환경 패키지를 찾을 수 없습니다: ${name} (npm install 필요)`);
}
const pkgVersion = (name: string): string => JSON.parse(fs.readFileSync(path.join(pkgDir(name), 'package.json'), 'utf8')).version;

interface Source {
  /** 결과 파일 이름 */
  name: string;
  /** node_modules 안의 원본 파일 */
  from?: [pkg: string, file: string];
  /** esbuild로 묶을 진입 코드 */
  bundle?: { contents: string; format: 'esm' | 'iife'; define?: Record<string, string> };
  gzip?: boolean;
}

interface Def {
  version: () => string;
  sources: () => Source[];
}

const DEFS: Record<RuntimeId, Def> = {
  // 파이썬: Pyodide (CPython) — 표준 라이브러리 포함, numpy 같은 추가 패키지는 실행할 때 CDN에서
  python: {
    version: () => pkgVersion('pyodide'),
    sources: () => ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'].map((f) => ({ name: f, from: ['pyodide', f] })),
  },
  // SQL: sql.js (SQLite)
  sql: {
    version: () => pkgVersion('sql.js'),
    sources: () => [
      { name: 'sql-wasm.js', from: ['sql.js', 'dist/sql-wasm-browser.js'] },
      { name: 'sql-wasm.wasm', from: ['sql.js', 'dist/sql-wasm-browser.wasm'] },
    ],
  },
  // Lua 5.4: wasmoon
  lua: {
    version: () => pkgVersion('wasmoon'),
    sources: () => [
      { name: 'wasmoon.js', from: ['wasmoon', 'dist/index.js'] },
      { name: 'glue.wasm', from: ['wasmoon', 'dist/glue.wasm'] },
    ],
  },
  // Ruby 3.4: ruby.wasm (표준 라이브러리 포함) — 30MB라 gzip으로
  ruby: {
    version: () => `${pkgVersion('@ruby/3.4-wasm-wasi')}`,
    sources: () => [
      {
        name: 'ruby-runtime.mjs',
        bundle: {
          format: 'esm',
          contents: `
            export { RubyVM } from ${JSON.stringify(path.join(pkgDir('@ruby/wasm-wasi'), 'dist/esm/vm.js'))};
            export { File, OpenFile, PreopenDirectory, Directory, ConsoleStdout, WASI } from ${JSON.stringify(path.join(pkgDir('@bjorn3/browser_wasi_shim'), 'dist/index.js'))};
          `,
        },
      },
      { name: 'ruby.wasm.gz', from: ['@ruby/3.4-wasm-wasi', 'dist/ruby+stdlib.wasm'], gzip: true },
    ],
  },
  // PHP 8.4: php-wasm (브라우저 저장소 동기화 없이 기본 실행기만)
  php: {
    version: () => pkgVersion('php-wasm'),
    sources: () => {
      const dir = pkgDir('php-wasm');
      const factory = fs.readFileSync(path.join(dir, 'php8.4-web.mjs'), 'utf8');
      const wasm = /([0-9a-f]{40}\.wasm)/.exec(factory)?.[1];
      if (!wasm) throw new Error('php-wasm: PHP 8.4 wasm 파일을 찾지 못했습니다');
      return [
        {
          name: 'php-runtime.mjs',
          bundle: {
            format: 'esm',
            // 샌드박스에서는 import.meta.url이 blob 주소라 wasm 경로 계산이 실패한다 (wasm은 직접 넘겨주므로 쓰이지 않는 주소로 고정)
            define: { 'import.meta.url': JSON.stringify('https://runtime.invalid/php/') },
            contents: `
              import { PhpBase } from ${JSON.stringify(path.join(dir, 'PhpBase.mjs'))};
              import PHP from ${JSON.stringify(path.join(dir, 'php8.4-web.mjs'))};
              export class Php extends PhpBase {
                constructor(args = {}) { super(Promise.resolve(PHP), { autoTransaction: false, ...args }); }
              }
            `,
          },
        },
        { name: 'php.wasm', from: ['php-wasm', wasm] },
      ];
    },
  },
  // JSX · TSX 미리보기용 React (UMD가 없어져서 전역 React · ReactDOM으로 묶는다)
  react: {
    version: () => pkgVersion('react'),
    sources: () => [
      {
        name: 'react.js',
        bundle: {
          format: 'iife',
          contents: `
            import * as React from 'react';
            import * as ReactDOM from 'react-dom';
            import * as ReactDOMClient from 'react-dom/client';
            import * as JSXRuntime from 'react/jsx-runtime';
            self.React = React;
            self.ReactDOM = Object.assign({}, ReactDOM, ReactDOMClient);
            self.ReactJSXRuntime = JSXRuntime;
          `,
        },
      },
    ],
  },
};

async function produce(src: Source): Promise<Buffer> {
  if (src.bundle) {
    const r = await esbuild({
      stdin: { contents: src.bundle.contents, resolveDir: path.join(ROOT, 'client'), loader: 'js' },
      bundle: true,
      write: false,
      format: src.bundle.format,
      platform: 'browser',
      target: 'es2022',
      minify: true,
      legalComments: 'none',
      define: { 'process.env.NODE_ENV': '"production"', ...src.bundle.define },
      logLevel: 'silent',
    });
    return Buffer.from(r.outputFiles[0].contents);
  }
  const [pkg, file] = src.from!;
  const raw = fs.readFileSync(path.join(pkgDir(pkg), file));
  return src.gzip ? zlib.gzipSync(raw, { level: 9 }) : raw;
}

/** 원본이 바뀌지 않았으면 이전에 만든 파일을 그대로 쓴다 (gzip · 묶기는 느리다) */
async function prepare(id: RuntimeId): Promise<{ info: RuntimeInfo; dir: string }> {
  const def = DEFS[id];
  const version = def.version();
  const sources = def.sources();
  const stampKey = createHash('sha256')
    .update(JSON.stringify({ id, version, sources: sources.map((s) => ({ ...s, stat: s.from ? fs.statSync(path.join(pkgDir(s.from[0]), s.from[1])).size : 0 })) }))
    .digest('hex')
    .slice(0, 16);
  const work = path.join(CACHE, `${id}-${stampKey}`);
  const manifestFile = path.join(work, 'manifest.json');
  if (fs.existsSync(manifestFile)) return { info: JSON.parse(fs.readFileSync(manifestFile, 'utf8')), dir: work };

  fs.mkdirSync(work, { recursive: true });
  const hash = createHash('sha256');
  const files: RuntimeFileInfo[] = [];
  for (const src of sources) {
    const data = await produce(src);
    if (data.length > MAX_ASSET) throw new Error(`실행 환경 파일이 25MiB를 넘습니다: ${id}/${src.name} (${data.length})`);
    fs.writeFileSync(path.join(work, src.name), data);
    hash.update(src.name).update(data);
    files.push({ name: src.name, size: data.length, ...(src.gzip ? { gz: true } : {}) });
  }
  const info: RuntimeInfo = { dir: `${id}-${hash.digest('hex').slice(0, 10)}`, version, files, total: files.reduce((n, f) => n + f.size, 0) };
  fs.writeFileSync(manifestFile, JSON.stringify(info));
  return { info, dir: work };
}

/** 빌드 · 개발 서버에 실행 환경 파일을 붙이는 Vite 플러그인 */
export async function runtimesPlugin(): Promise<Plugin> {
  const prepared = await Promise.all((Object.keys(DEFS) as RuntimeId[]).map(async (id) => [id, await prepare(id)] as const));
  const manifest = Object.fromEntries(prepared.map(([id, p]) => [id, p.info])) as Record<RuntimeId, RuntimeInfo>;
  const byDir = new Map(prepared.map(([, p]) => [p.info.dir, p.dir]));
  let outDir = '';
  return {
    name: 'madang-runtimes',
    config: () => ({ define: { __RUNTIMES__: JSON.stringify(manifest) } }),
    configResolved(c) {
      outDir = path.resolve(c.root, c.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/runtimes\/([^/]+)\/([^/?]+)/.exec(req.url ?? '');
        const src = m && byDir.get(m[1]);
        if (!m || !src || m[2] === 'manifest.json' || !fs.existsSync(path.join(src, m[2]))) return next();
        res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        fs.createReadStream(path.join(src, m[2])).pipe(res);
      });
    },
    writeBundle() {
      for (const [, p] of prepared) {
        const dest = path.join(outDir, 'runtimes', p.info.dir);
        fs.mkdirSync(dest, { recursive: true });
        for (const f of p.info.files) fs.copyFileSync(path.join(p.dir, f.name), path.join(dest, f.name));
      }
    },
  };
}
