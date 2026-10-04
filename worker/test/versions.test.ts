/*
 * 버전 기록 정리(versionsToDrop): 기간 규칙과 템플릿당 총량 상한(64MB)
 * 실행: npm test -w worker
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION_TOTAL_MAX_BYTES, versionsToDrop } from '../src/versions.ts';

const H = 3_600_000;
const MB = 1024 * 1024;
const now = Date.UTC(2026, 9, 3, 12);

describe('versionsToDrop', () => {
  it('48시간 안은 모두 남기고, 그 뒤로는 날짜마다 하나씩 30일까지', () => {
    const rows = [
      { id: 1, at: now - 1 * H, size: 1 },
      { id: 2, at: now - 47 * H, size: 1 },
      { id: 3, at: now - 72 * H, size: 1 }, // 3일 전 같은 날짜의 두 버전 → 최근 것만
      { id: 4, at: now - 73 * H, size: 1 },
      { id: 5, at: now - 31 * 24 * H, size: 1 }, // 30일 넘음
    ];
    assert.deepEqual(versionsToDrop(rows, now).sort(), [4, 5]);
  });

  it('모두 합쳐 64MB를 넘으면 오래된 버전부터 지운다', () => {
    // 매시간 16MB 문서 → 최근 4개(64MB)만 남는다
    const rows = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, at: now - i * H, size: 16 * MB }));
    const drop = versionsToDrop(rows, now);
    assert.deepEqual(drop.sort((a, b) => a - b), [5, 6, 7, 8, 9, 10]);
    const kept = rows.filter((r) => !drop.includes(r.id)).reduce((n, r) => n + r.size, 0);
    assert.ok(kept <= VERSION_TOTAL_MAX_BYTES);
  });

  it('가장 최근 버전은 상한보다 커도 남긴다', () => {
    const rows = [
      { id: 1, at: now, size: VERSION_TOTAL_MAX_BYTES + 1 },
      { id: 2, at: now - H, size: 1 },
    ];
    assert.deepEqual(versionsToDrop(rows, now), [2]);
  });

  it('작은 문서는 상한에 걸리지 않는다', () => {
    const rows = Array.from({ length: 48 }, (_, i) => ({ id: i + 1, at: now - i * H, size: 200 * 1024 }));
    assert.deepEqual(versionsToDrop(rows, now), []);
  });
});
