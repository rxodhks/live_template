/*
 * 코드 실행 환경(런타임) 파일 불러오기
 *  - 파일은 /runtimes/<id>-<해시>/ 에 있고 내용이 바뀌지 않는다 → 한 번 받으면 브라우저 저장소(Cache Storage)에 두고 계속 쓴다
 *  - 격리된 샌드박스 안에서는 브라우저 캐시가 재사용되지 않으므로, 이 앱(같은 출처)에서 받아 두었다가 샌드박스로 넘긴다
 *  - 새 버전이 배포되면 예전 버전 파일은 저장소에서 지운다
 */

export type RuntimeId = 'python' | 'sql' | 'lua' | 'ruby' | 'php' | 'react';

interface RuntimeFileInfo {
  name: string;
  size: number;
  gz?: boolean;
}
interface RuntimeInfo {
  dir: string;
  version: string;
  files: RuntimeFileInfo[];
  total: number;
}

declare const __RUNTIMES__: Record<RuntimeId, RuntimeInfo>;
export const RUNTIMES: Record<RuntimeId, RuntimeInfo> = __RUNTIMES__;

const CACHE_NAME = 'madang-runtimes';
const memory = new Map<string, ArrayBuffer>();
let cleaned = false;

const fileUrl = (info: RuntimeInfo, f: RuntimeFileInfo) => `/runtimes/${info.dir}/${f.name}`;

async function openCache(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

/** 지금 배포된 버전이 아닌 실행 환경 파일은 지운다 */
async function cleanup(cache: Cache) {
  if (cleaned) return;
  cleaned = true;
  const current = new Set(Object.values(RUNTIMES).map((r) => r.dir));
  for (const req of await cache.keys()) {
    const dir = new URL(req.url).pathname.split('/')[2];
    if (!current.has(dir)) await cache.delete(req);
  }
}

/** 이미 받아 둔 실행 환경인지 (처음 실행이면 ‘내려받는 중’을 보여 준다) */
export async function isRuntimeCached(id: RuntimeId): Promise<boolean> {
  const info = RUNTIMES[id];
  const cache = await openCache();
  for (const f of info.files) {
    const url = fileUrl(info, f);
    if (memory.has(url)) continue;
    if (!cache || !(await cache.match(url))) return false;
  }
  return true;
}

async function download(url: string, size: number, onBytes: (n: number) => void): Promise<ArrayBuffer> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok || !res.body) throw new Error(`실행 환경 파일을 받지 못했습니다 (${res.status})`);
  const reader = res.body.getReader();
  const out = new Uint8Array(size);
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > size) throw new Error('실행 환경 파일이 예상과 다릅니다. 새로고침 후 다시 시도해 주세요.');
    out.set(value, at);
    at += value.length;
    onBytes(value.length);
  }
  // 없는 파일은 화면(index.html)이 대신 오므로 크기로 확인한다
  if (at !== size) throw new Error('실행 환경 파일이 예상과 다릅니다. 새로고침 후 다시 시도해 주세요.');
  return out.buffer;
}

/**
 * 실행 환경 파일을 모두 받아 { 파일 이름: 내용 }으로 돌려준다.
 * 돌려준 ArrayBuffer는 샌드박스로 넘겨도(transfer) 되는 새 사본이다.
 */
export async function loadRuntime(id: RuntimeId, onProgress?: (loaded: number, total: number) => void): Promise<Record<string, ArrayBuffer>> {
  const info = RUNTIMES[id];
  const cache = await openCache();
  if (cache) void cleanup(cache).catch(() => {});
  let loaded = 0;
  const bump = (n: number) => {
    loaded += n;
    onProgress?.(loaded, info.total);
  };
  const entries = await Promise.all(
    info.files.map(async (f): Promise<[string, ArrayBuffer]> => {
      const url = fileUrl(info, f);
      const mem = memory.get(url);
      if (mem) {
        bump(f.size);
        return [f.name, mem.slice(0)];
      }
      const hit = cache ? await cache.match(url) : undefined;
      if (hit) {
        const buf = await hit.arrayBuffer();
        if (buf.byteLength === f.size) {
          bump(f.size);
          return [f.name, buf];
        }
        await cache!.delete(url);
      }
      const buf = await download(url, f.size, bump);
      if (cache) await cache.put(url, new Response(buf.slice(0), { headers: { 'content-type': 'application/octet-stream' } })).catch(() => {});
      // 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 이 창을 닫을 때까지 메모리에 둔다
      else memory.set(url, buf.slice(0));
      return [f.name, buf];
    }),
  );
  return Object.fromEntries(entries);
}

export const runtimeSizeMB = (id: RuntimeId) => Math.max(0.1, Math.round((RUNTIMES[id].total / 1024 / 1024) * 10) / 10);

/** 브라우저 텍스트 파일(작은 JS 라이브러리)을 문자열로 */
export async function loadRuntimeText(id: RuntimeId, name: string): Promise<string> {
  const files = await loadRuntime(id);
  return new TextDecoder().decode(files[name]);
}
