/*
 * 개인 공간 저장소 (브라우저 IndexedDB) — 로그인한 계정마다 따로 쓴다 (lt-app:<사용자 ID>)
 *  · templates : 템플릿 목록 (개인 공간 + 오프라인용 협업 공간 사본)
 *  · timeline  : 개인 공간의 활동 기록
 *  · notes     : 개인 공간의 비밀 노트 (브라우저에서 암호화된 상태로만 저장)
 * 템플릿 내용(Y.Doc)은 y-indexeddb가 템플릿마다 별도 DB(lt:tpl:<id>)에 저장한다.
 */

/** 로그인 기능 이전의 저장소 — 이 브라우저에서 처음 로그인한 계정으로 옮긴다 */
const LEGACY_DB = 'lt-app';
const LEGACY_DONE = 'lt.legacyMigrated';
const VERSION = 1;
const STORES = ['templates', 'timeline', 'notes'] as const;

export type StoreName = (typeof STORES)[number];

let dbName: string | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

/** 계정별 개인 공간 저장소 이름 */
export const appDbName = (userId: string) => `${LEGACY_DB}:${userId}`;

/** 로그인한 계정의 저장소를 쓴다 (로그인 직후 한 번) */
export function setIdbUser(userId: string): void {
  const name = appDbName(userId);
  if (name === dbName) return;
  void dbPromise?.then((db) => db.close()).catch(() => {});
  dbName = name;
  dbPromise = null;
}

function openDb(name: string, create: boolean): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, VERSION);
    req.onupgradeneeded = (e) => {
      // 없는 저장소를 확인만 하려던 경우에는 만들지 않는다
      if (!create && e.oldVersion === 0) return req.transaction?.abort();
      const db = req.result;
      if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates', { keyPath: 'id' });
      for (const store of ['timeline', 'notes']) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' }).createIndex('templateId', 'templateId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => (create ? reject(req.error) : resolve(null));
  });
}

const all = (db: IDBDatabase, store: StoreName) =>
  new Promise<unknown[]>((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** 가입 없이 쓰던 때의 개인 공간을 이 계정의 저장소로 옮긴다 (브라우저당 한 번) */
async function migrateLegacy(target: IDBDatabase): Promise<void> {
  try {
    if (localStorage.getItem(LEGACY_DONE)) return;
    localStorage.setItem(LEGACY_DONE, '1');
  } catch {
    return;
  }
  const legacy = await openDb(LEGACY_DB, false).catch(() => null);
  if (!legacy) return;
  try {
    const data = await Promise.all(STORES.map((s) => all(legacy, s).catch(() => [] as unknown[])));
    await new Promise<void>((resolve, reject) => {
      const tx = target.transaction([...STORES], 'readwrite');
      STORES.forEach((s, i) => data[i].forEach((v) => tx.objectStore(s).put(v)));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    legacy.close();
    indexedDB.deleteDatabase(LEGACY_DB);
  } catch {
    legacy.close();
  }
}

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  const name = dbName;
  if (!name) return Promise.reject(new Error('로그인 전에는 개인 공간 저장소를 쓸 수 없습니다.'));
  dbPromise = openDb(name, true).then(async (db) => {
    await migrateLegacy(db!);
    return db!;
  });
  dbPromise.catch(() => {
    if (dbName === name) dbPromise = null;
  });
  return dbPromise;
}

const done = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function store(name: StoreName, mode: IDBTransactionMode = 'readonly'): Promise<IDBObjectStore> {
  return (await open()).transaction(name, mode).objectStore(name);
}

export async function idbAll<T>(name: StoreName): Promise<T[]> {
  return done((await store(name)).getAll()) as Promise<T[]>;
}

export async function idbByTemplate<T>(name: 'timeline' | 'notes', templateId: string): Promise<T[]> {
  return done((await store(name)).index('templateId').getAll(templateId)) as Promise<T[]>;
}

export async function idbGet<T>(name: StoreName, id: string): Promise<T | undefined> {
  return done((await store(name)).get(id)) as Promise<T | undefined>;
}

export async function idbPut<T>(name: StoreName, value: T): Promise<void> {
  await done((await store(name, 'readwrite')).put(value));
}

export async function idbDelete(name: StoreName, id: string): Promise<void> {
  await done((await store(name, 'readwrite')).delete(id));
}

export async function idbDeleteByTemplate(name: 'timeline' | 'notes', templateId: string): Promise<void> {
  const s = await store(name, 'readwrite');
  const keys = await done(s.index('templateId').getAllKeys(templateId));
  await Promise.all(keys.map((k) => done(s.delete(k))));
}

/** 템플릿 내용(Y.Doc) DB 이름 */
export const docDbName = (templateId: string) => `lt:tpl:${templateId}`;

export function deleteDocDb(templateId: string): void {
  try {
    indexedDB.deleteDatabase(docDbName(templateId));
  } catch {
    /* 무시 */
  }
}
