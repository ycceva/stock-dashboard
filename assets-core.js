// 우리집 자산관리 계산 모듈 (화면·DB 없음, node 테스트: tests/assets-core.test.mjs)
// 기록 한 건 = { month:'YYYY-MM', income, expense, real_estate, my_accounts:[{name,amount}], spouse_accounts:[...] }
// 현금 = 본인 계좌 합 + 배우자 계좌 합 (= 총자산 − 부동산). 입금·지출은 기록용이라 계산에 넣지 않는다.
(function (root) {
  const GOAL = 2_000_000_000; // 목표 은퇴현금 20억

  const num = v => (Number.isFinite(+v) ? +v : 0);
  const comma = n => n.toLocaleString('en-US');

  function parseWon(str) {
    const digits = String(str ?? '').replace(/[^0-9]/g, '');
    return digits ? Number(digits) : 0;
  }

  function fmtWon(n) {
    n = Math.round(num(n));
    if (n === 0) return '0';
    const sign = n < 0 ? '-' : '';
    const a = Math.abs(n);
    if (a < 10_000) return sign + comma(a) + '원';
    let eok = Math.floor(a / 1e8);
    let man = Math.round((a - eok * 1e8) / 1e4);
    if (man === 10_000) { eok += 1; man = 0; }
    const parts = [];
    if (eok) parts.push(comma(eok) + '억');
    if (man) parts.push(comma(man) + '만');
    return sign + parts.join(' ');
  }

  // 차트 눈금 글자: 1억 이상은 "10.25억"처럼, 소수 자리는 눈금 간격이 구분될 만큼만
  function axisLabel(v, step) {
    if (v === 0) return '0';
    if (v < 1e8) return fmtWon(v);
    const dec = Math.max(0, Math.ceil(-Math.log10(step / 1e8) - 1e-9));
    return +(v / 1e8).toFixed(dec) + '억';
  }

  const sumAcc = list => (list || []).reduce((s, a) => s + num(a && a.amount), 0);

  function monthTotals(rec) {
    const mine = sumAcc(rec.my_accounts);
    const spouse = sumAcc(rec.spouse_accounts);
    const realEstate = num(rec.real_estate);
    const cash = mine + spouse;
    return { mine, spouse, cash, realEstate, total: realEstate + cash };
  }

  const sortRecords = recs => [...(recs || [])].sort((a, b) => a.month.localeCompare(b.month));

  function summary(recs) {
    const s = sortRecords(recs);
    if (!s.length) return null;
    const base = s[s.length - 1];
    const prev = s.length > 1 ? s[s.length - 2] : null;
    const t = monthTotals(base);
    let diff = null, diffPct = null;
    if (prev) {
      const pt = monthTotals(prev).total;
      diff = t.total - pt;
      diffPct = pt ? diff / pt * 100 : null;
    }
    return { base, prev, t, diff, diffPct, ready: t.cash / GOAL * 100 };
  }

  function composition(t) {
    if (!t.total) return { realPct: 0, cashPct: 0 };
    return { realPct: t.realEstate / t.total * 100, cashPct: t.cash / t.total * 100 };
  }

  function yearlyFlows(recs) {
    const by = new Map();
    for (const r of sortRecords(recs)) {
      const y = r.month.slice(0, 4);
      const o = by.get(y) || { year: y, income: 0, expense: 0, months: 0 };
      o.income += num(r.income); o.expense += num(r.expense); o.months += 1;
      by.set(y, o);
    }
    return [...by.values()];
  }

  function yearlyBalances(recs) {
    const last = new Map();
    for (const r of sortRecords(recs)) last.set(r.month.slice(0, 4), r);
    return [...last.entries()].map(([year, r]) => ({ year, month: r.month, ...monthTotals(r) }));
  }

  const copyAcc = list => (list || []).map(a => ({ name: a.name, amount: num(a.amount) }));
  const blank = month => ({
    month, income: 0, expense: 0, real_estate: 0,
    my_accounts: ['국내주식계좌', '해외주식계좌'].map(name => ({ name, amount: 0 })),
    spouse_accounts: ['퇴직연금계좌', 'CMA', '연금계좌'].map(name => ({ name, amount: 0 })),
  });

  function prefillFor(month, recs) {
    const s = sortRecords(recs);
    const same = s.find(r => r.month === month);
    if (same) return { ...same, my_accounts: copyAcc(same.my_accounts), spouse_accounts: copyAcc(same.spouse_accounts) };
    const before = s.filter(r => r.month < month);
    const src = before.length ? before[before.length - 1] : s[s.length - 1];
    if (!src) return blank(month);
    return {
      month, income: 0, expense: 0, real_estate: num(src.real_estate),
      my_accounts: copyAcc(src.my_accounts), spouse_accounts: copyAcc(src.spouse_accounts),
    };
  }

  const api = { GOAL, parseWon, fmtWon, axisLabel, monthTotals, sortRecords, summary, composition, yearlyFlows, yearlyBalances, prefillFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AssetCore = api;
})(this);
