import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const VC = createRequire(import.meta.url)('../valuation-core.js');
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('stepper: 그날까지 나온 가장 최근 값을 쓴다', () => {
  const at = VC.stepper([['2026-01-01', 1], ['2026-04-01', 2]]);
  assert.equal(at('2025-12-31'), null);
  assert.equal(at('2026-03-31'), 1);
  assert.equal(at('2026-04-01'), 2);
});

// GDP 분기 250(십억)씩 → 4분기 합 1조, M2 2,000(십억) → 2조, 일평균 수출 10억 달러(3개월 평균)
const base = {
  dates: ['2025-01-01', '2025-04-01', '2025-07-01', '2025-10-01'],
  series: { GDP: [250, 250, 250, 250], M2: [null, null, null, 2000], MCAP: [null, null, null, null] },
};
const exp = { dates: ['2025-08-01', '2025-09-01', '2025-10-01'], values: [10, 10, 10] };
const withCap = caps => {
  const dates = [...base.dates, ...Object.keys(caps)];
  const pad = (arr, n) => [...arr, ...new Array(n).fill(null)];
  const n = Object.keys(caps).length;
  return { dates, series: { GDP: pad(base.series.GDP, n), M2: pad(base.series.M2, n), MCAP: [...base.series.MCAP, ...Object.values(caps)] } };
};

test('build: 비율이 추세선 위에 그대로 있으면 적정 시총 = 시총', () => {
  // 시총 1조 → 2조(1년 뒤) → 4조(2년 뒤): 비율이 해마다 2배로 매끈하게 오른다
  const r = VC.build(withCap({ '2026-01-01': 10000, '2027-01-01': 20000, '2028-01-01': 40000 }), exp);
  assert.deepEqual(r.dates, ['2026-01-01', '2027-01-01', '2028-01-01']);
  r.series.MCAP.forEach((m, i) => near(r.series.FAIR_GDP[i], m));
  r.series.MCAP.forEach((m, i) => near(r.series.FAIR_EXP[i], m));
  assert.ok(Math.abs(r.trend.GDP.perYear - 1) < 0.01);  // 연 +100%
});

test('build: 추세보다 높은 날은 시총이 적정 시총보다 크다', () => {
  // 비율 1, 3, 1 → 추세는 가운데에서 평균(기하) 수준, 가운데 날이 위로 벗어난다
  const r = VC.build(withCap({ '2026-01-01': 10000, '2027-01-01': 30000, '2028-01-01': 10000 }), exp);
  assert.ok(r.series.MCAP[1] > r.series.FAIR_GDP[1]);
  assert.ok(r.series.MCAP[0] < r.series.FAIR_GDP[0]);
  near(r.series.R_GDP[1], 3);                            // 시총 3조 ÷ GDP 1조
  near(r.series.R_EXP[1], 0.3);                          // 조 원 ÷ 억 달러
});

test('build: 기준 지표가 아직 없으면 그날은 뺀다', () => {
  const r = VC.build({ dates: ['2026-01-02'], series: { MCAP: [10000] } }, { dates: [], values: [] });
  assert.deepEqual(r.dates, []);
});

test('movingAvg: 앞쪽 n개 평균, 빈 칸은 건너뛴다', () => {
  assert.deepEqual(VC.movingAvg([1, 2, 3, 4], 2), [null, 1.5, 2.5, 3.5]);
  assert.deepEqual(VC.movingAvg([2, null, 4, 6], 2), [null, 2, 4, 5]);
  assert.deepEqual(VC.movingAvg([null, null, null, 6], 4), [null, null, null, null]);  // 절반도 안 모이면 비움
});
