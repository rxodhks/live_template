import { appDbName, docDbName } from './idb';

/*
 * 로그아웃할 때 이 기기에서 계정 데이터 지우기
 * ──────────────────────────────────────
 * 같은 컴퓨터를 다른 사람이 쓰더라도 내 작업이 남지 않도록, 클라우드에 안전하게 저장된 사본은 이 기기에서 지운다.
 * 열려 있는 저장소는 지울 수 없으므로 계획만 남기고 새로 고친 뒤(아무 저장소도 열기 전에) 지운다.
 * 아직 클라우드에 올라가지 않은 데이터는 절대 지우지 않는다 — 다음에 로그인하면 자동으로 백업된다.
 */

const KEY = 'lt.clearDevice';

interface Plan {
  /** 통째로 지울 계정 저장소 (백업 안 된 개인 템플릿이 남아 있으면 null) */
  appDb: string | null;
  /** 지울 템플릿 문서 사본 */
  docs: string[];
}

export function scheduleDeviceClear(userId: string, cloudTemplateIds: string[], keepAppDb: boolean): void {
  const plan: Plan = { appDb: keepAppDb ? null : appDbName(userId), docs: cloudTemplateIds.map(docDbName) };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(plan));
  } catch {
    /* 저장소를 쓸 수 없으면 지우지 않는다 */
  }
}

function drop(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** 앱 시작 때 (저장소를 열기 전에) 남겨 둔 계획대로 지운다 */
export async function runDeviceClear(): Promise<void> {
  let plan: Plan | null = null;
  try {
    plan = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Plan | null;
    sessionStorage.removeItem(KEY);
  } catch {
    return;
  }
  if (!plan) return;
  await Promise.all([...(plan.appDb ? [plan.appDb] : []), ...plan.docs].map(drop));
  try {
    // 보드별 화면 위치 등 템플릿마다 남긴 화면 설정
    for (const k of Object.keys(localStorage)) if (k.startsWith('lt.vp.')) localStorage.removeItem(k);
  } catch {
    /* 무시 */
  }
}
