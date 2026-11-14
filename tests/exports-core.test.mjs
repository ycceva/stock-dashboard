import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const EC = createRequire(import.meta.url)('../exports-core.js');

// 평일 중 휴장일만 빼고 시장이 열린 날 Set을 만든다
function market(from, to, closed = []) {
  const open = new Set();
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400000) {
    const d = new Date(t).toISOString().slice(0, 10), wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6 && !closed.includes(d)) open.add(d);
  }
  return open;
}
const days = (ym, closed) => EC.workdays(ym, market('2025-01-02', '2026-11-13', closed), '2025-01-02', '2026-11-13');

test('산업부 발표 조업일수와 같다', () => {
  assert.equal(days('2025-05', ['2025-05-01', '2025-05-05', '2025-05-06']), 21.5);
  assert.equal(days('2025-12', ['2025-12-25', '2025-12-31']), 24);           // 12/31 휴장이어도 근무일
  assert.equal(days('2026-05', ['2026-05-01', '2026-05-05', '2026-05-25']), 20.5);
  assert.equal(days('2026-09', ['2026-09-24', '2026-09-25']), 21.5);         // 추석 토요일(9/26)은 0일
});

test('시장 자료가 그달을 다 덮지 못하면 계산하지 않는다', () => {
  assert.equal(days('2026-11'), null);
  assert.equal(days('2024-12'), null);
});

test('dailyAvg: 천 달러 → 억 달러 일평균', () => {
  const daily = { dates: ['2026-08-31', '2026-10-01'], series: { KTB10: [3, 3] } };
  const r = EC.dailyAvg({ dates: ['2026-09-01'], series: { EXPORT: [121050082] } }, daily);
  assert.deepEqual(r.dates, ['2026-09-01']);
});
