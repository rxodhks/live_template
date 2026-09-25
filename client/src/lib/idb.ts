/*
 * 개인 공간 저장소 (브라우저 IndexedDB)
 *  · templates : 템플릿 목록 (개인 공간 + 오프라인용 협업 공간 사본)
 *  · timeline  : 개인 공간의 활동 기록
 *  · notes     : 개인 공간의 비밀 노트 (브라우저에서 암호화된 상태로만 저장)
 * 템플릿 내용(Y.Doc)은 y-indexeddb가 템플릿마다 별도 DB(lt:tpl:<id>)에 저장한다.
 */

const DB_NAME = 'lt-app';
const VERSION = 1;

export type StoreName = 'templates' | 'timeline' | 'notes';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('timeline')) {
        const s = db.createObjectStore('timeline', { keyPath: 'id' });
        s.createIndex('templateId', 'templateId');
      }
      if (!db.objectStoreNames.contains('notes')) {
        const s = db.createObjectStore('notes', { keyPath: 'id' });
        s.createIndex('templateId', 'templateId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
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
