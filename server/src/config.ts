import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(here, '../..');

export const config = {
  port: Number(process.env.PORT ?? 3001),
  /** 모든 데이터(JSON, Yjs 바이너리, 암호화된 비밀 노트)가 저장되는 위치 */
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(ROOT_DIR, 'data')),
  clientDist: path.join(ROOT_DIR, 'client', 'dist'),
  /** 디스크 저장 지연(ms) - 연속 입력을 묶어서 저장 */
  saveDebounceMs: Number(process.env.SAVE_DEBOUNCE_MS ?? 600),
  /** 저장이 계속 미뤄지더라도 이 시간 안에는 반드시 저장 */
  saveMaxWaitMs: 4000,
  /** 아무도 없는 문서를 메모리에서 내리는 시간 */
  docIdleUnloadMs: 60_000,
  /** 비밀 노트 잠금 해제 유지 시간 */
  secretTicketTtlMs: 30 * 60 * 1000,
  /** 비밀번호 연속 실패 허용 횟수와 잠금 시간 */
  secretMaxAttempts: 5,
  secretLockoutMs: 5 * 60 * 1000,
  timelineLimit: 3000,
  chatLimit: 500,
};
