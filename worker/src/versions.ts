/*
 * 버전 기록을 얼마나 남길지 (TemplateRoom이 새 버전을 남길 때마다 부른다).
 * Durable Object 런타임과 떨어진 순수 함수라 서버 테스트에서 바로 확인한다.
 */

/** 48시간 이내는 모두 */
export const VERSION_KEEP_ALL_MS = 48 * 60 * 60 * 1000;
/** 그 뒤로는 날짜마다 마지막 버전 하나씩 30일까지 */
export const VERSION_KEEP_DAILY_MS = 30 * 86_400_000;
/**
 * 템플릿 하나의 버전 기록 총량. 버전마다 문서 전체(최대 16MB)를 저장해서, 상한이 없으면 방 하나에
 * 1GB 넘게 쌓일 수 있었다 (48개 + 30개 × 16MB). 넘으면 오래된 버전부터 지운다. 가장 최근 버전은 늘 남긴다
 */
export const VERSION_TOTAL_MAX_BYTES = 64 * 1024 * 1024;

export interface StoredVersion {
  id: number;
  at: number;
  size: number;
}

/** 지울 버전 ID. rows는 순서와 상관없다 */
export function versionsToDrop(rows: StoredVersion[], now: number, maxBytes = VERSION_TOTAL_MAX_BYTES): number[] {
  const sorted = [...rows].sort((a, b) => b.at - a.at);
  const days = new Set<number>();
  const drop: number[] = [];
  let total = 0;
  for (const [i, r] of sorted.entries()) {
    const age = now - r.at;
    if (age > VERSION_KEEP_ALL_MS) {
      const day = Math.floor((r.at + 9 * 3_600_000) / 86_400_000); // 한국 시간 기준 날짜
      if (age > VERSION_KEEP_DAILY_MS || days.has(day)) {
        drop.push(r.id);
        continue;
      }
      days.add(day);
    }
    if (i > 0 && total + r.size > maxBytes) {
      drop.push(r.id);
      continue;
    }
    total += r.size;
  }
  return drop;
}
