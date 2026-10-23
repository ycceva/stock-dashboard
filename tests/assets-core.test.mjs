import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const AC = createRequire(import.meta.url)('../assets-core.js');

const acc = (...amounts) => amounts.map((amount, i) => ({ name: '계좌' + i, amount }));
const rec = (month, o = {}) => ({
  month, income: 0, expense: 0, real_estate: 900_000_000,
  my_accounts: acc(120_000_000, 80_000_000),
  spouse_accounts: acc(90_000_000, 30_000_000, 60_000_000),
  ...o,
});

test('fmtWon: 억/만 단위로 읽기 좋게', () => {
  assert.equal(AC.fmtWon(1_280_000_000), '12억 8,000만');
  assert.equal(AC.fmtWon(18_000_000), '1,800만');
  assert.equal(AC.fmtWon(900_000_000), '9억');
  assert.equal(AC.fmtWon(0), '0');
  assert.equal(AC.fmtWon(5000), '5,000원');
  assert.equal(AC.fmtWon(-18_000_000), '-1,800만');
  assert.equal(AC.fmtWon(1_620_000_000), '16억 2,000만');
});

test('parseWon: 숫자만 추리고 빈값은 0', () => {
  assert.equal(AC.parseWon('1,2a0'), 120);
  assert.equal(AC.parseWon(''), 0);
  assert.equal(AC.parseWon(undefined), 0);
  assert.equal(AC.parseWon('900,000,000'), 900_000_000);
});

test('monthTotals: 현금 = 본인 + 배우자, 입금·지출은 빠진다', () => {
  const t = AC.monthTotals(rec('2026-10', { income: 7_500_000, expense: 4_200_000 }));
  assert.deepEqual(t, { mine: 200_000_000, spouse: 180_000_000, cash: 380_000_000, realEstate: 900_000_000, total: 1_280_000_000 });
});

test('monthTotals: 금액이 비어 있는 계좌는 0으로 본다', () => {
  const t = AC.monthTotals(rec('2026-10', { my_accounts: [{ name: 'x', amount: null }, { name: 'y' }] }));
  assert.equal(t.mine, 0);
  assert.ok(Number.isFinite(t.total));
});

test('summary: 최신 달 기준, 은퇴준비율 = 현금 ÷ 20억', () => {
  const s = AC.summary([rec('2026-10'), rec('2026-09', { real_estate: 882_000_000 })]);
  assert.equal(s.base.month, '2026-10');
  assert.equal(s.prev.month, '2026-09');
  assert.equal(s.diff, 18_000_000);
  assert.ok(Math.abs(s.diffPct - 18_000_000 / 1_262_000_000 * 100) < 1e-9);
  assert.ok(Math.abs(s.ready - 19.0) < 1e-9);
});

test('summary: 중간 달이 빠지면 직전 기록과 비교', () => {
  const s = AC.summary([rec('2026-08'), rec('2026-10')]);
  assert.equal(s.prev.month, '2026-08');
});

test('summary: 기록이 하나면 비교 없음, 없으면 null', () => {
  const s = AC.summary([rec('2026-10')]);
  assert.equal(s.prev, null);
  assert.equal(s.diff, null);
  assert.equal(AC.summary([]), null);
});

test('composition: 총자산 0이면 0으로 나누지 않는다', () => {
  assert.deepEqual(AC.composition({ total: 0, cash: 0, realEstate: 0 }), { realPct: 0, cashPct: 0 });
  const c = AC.composition({ total: 1_000, cash: 160, realEstate: 840 });
  assert.equal(c.cashPct, 16);
  assert.equal(c.realPct, 84);
});

test('yearlyFlows: 그해 기록된 달의 입금·지출 합', () => {
  const y = AC.yearlyFlows([
    rec('2025-12', { income: 100, expense: 50 }),
    rec('2026-01', { income: 10, expense: 1 }),
    rec('2026-02', { income: 20, expense: 2 }),
    rec('2026-03', { income: 30, expense: 3 }),
  ]);
  assert.deepEqual(y, [
    { year: '2025', income: 100, expense: 50, months: 1 },
    { year: '2026', income: 60, expense: 6, months: 3 },
  ]);
});

test('yearlyBalances: 해마다 마지막 기록 잔액', () => {
  const y = AC.yearlyBalances([
    rec('2025-11', { real_estate: 1 }),
    rec('2026-03', { real_estate: 3 }),
    rec('2025-12', { real_estate: 2 }),
  ]);
  assert.deepEqual(y.map(r => [r.year, r.month, r.realEstate]), [['2025', '2025-12', 2], ['2026', '2026-03', 3]]);
  assert.equal(y[0].cash, 380_000_000);
});

test('prefillFor: 있는 달은 그대로, 원본은 안 바뀜', () => {
  const r = rec('2026-09', { income: 5 });
  const p = AC.prefillFor('2026-09', [r]);
  assert.equal(p.income, 5);
  p.my_accounts[0].amount = 1;
  assert.equal(r.my_accounts[0].amount, 120_000_000);
});

test('prefillFor: 새 달은 그 이전 최신 기록의 부동산·계좌를 가져오고 입금·지출은 0', () => {
  const p = AC.prefillFor('2026-11', [rec('2026-09', { real_estate: 1 }), rec('2026-10', { real_estate: 2, income: 9, expense: 9 })]);
  assert.equal(p.month, '2026-11');
  assert.equal(p.real_estate, 2);
  assert.equal(p.income, 0);
  assert.equal(p.expense, 0);
  assert.equal(p.spouse_accounts.length, 3);
});

test('prefillFor: 이전 기록이 없으면 가장 최신 기록, 하나도 없으면 기본 계좌', () => {
  assert.equal(AC.prefillFor('2025-01', [rec('2026-10', { real_estate: 7 })]).real_estate, 7);
  const p = AC.prefillFor('2026-10', []);
  assert.deepEqual(p.my_accounts.map(a => a.name), ['국내주식계좌', '해외주식계좌']);
  assert.deepEqual(p.spouse_accounts.map(a => a.name), ['퇴직연금계좌', 'CMA', '연금계좌']);
  assert.equal(p.real_estate, 0);
});

test('GOAL은 20억', () => {
  assert.equal(AC.GOAL, 2_000_000_000);
});
