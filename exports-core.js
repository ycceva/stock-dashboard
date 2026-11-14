// 일평균 수출 계산 (index.html의 한국 장단기 금리차 차트가 쓴다)
// 월 수출액(ECOS 901Y118 통관기준, 천 달러)을 산업통상부 방식 조업일수로 나눈다.
// 조업일수: 평일 1일, 토요일 0.5일, 일요일·공휴일 0일. 12/31은 근무일, 5/1(노동절)은 휴일.
// 평일 공휴일은 따로 표를 두지 않고 국고채 금리가 없는 평일(채권시장 휴장일)로 찾는다.
// 토요일 공휴일은 시장 자료로 알 수 없어 날짜 표로 거른다.
// 발표치와 맞춰 봄: 2025-05 21.5일, 2025-12 24.0일, 2026-05 20.5일, 2026-09 21.5일.
(function (root) {
  // 설날·추석·부처님오신날(양력). 설·추석은 앞뒤 하루까지 쉰다.
  const SEOLLAL = ['2000-02-05', '2001-01-24', '2002-02-12', '2003-02-01', '2004-01-22', '2005-02-09', '2006-01-29',
    '2007-02-18', '2008-02-07', '2009-01-26', '2010-02-14', '2011-02-03', '2012-01-23', '2013-02-10', '2014-01-31',
    '2015-02-19', '2016-02-08', '2017-01-28', '2018-02-16', '2019-02-05', '2020-01-25', '2021-02-12', '2022-02-01',
    '2023-01-22', '2024-02-10', '2025-01-29', '2026-02-17', '2027-02-07', '2028-01-27', '2029-02-13', '2030-02-03'];
  const CHUSEOK = ['2000-09-12', '2001-10-01', '2002-09-21', '2003-09-11', '2004-09-28', '2005-09-18', '2006-10-06',
    '2007-09-25', '2008-09-14', '2009-10-03', '2010-09-22', '2011-09-12', '2012-09-30', '2013-09-19', '2014-09-08',
    '2015-09-27', '2016-09-15', '2017-10-04', '2018-09-24', '2019-09-13', '2020-10-01', '2021-09-21', '2022-09-10',
    '2023-09-29', '2024-09-17', '2025-10-06', '2026-09-25', '2027-09-15', '2028-10-03', '2029-09-22', '2030-09-12'];
  const BUDDHA = ['2000-05-11', '2001-05-01', '2002-05-19', '2003-05-08', '2004-05-26', '2005-05-15', '2006-05-05',
    '2007-05-24', '2008-05-12', '2009-05-02', '2010-05-21', '2011-05-10', '2012-05-28', '2013-05-17', '2014-05-06',
    '2015-05-25', '2016-05-14', '2017-05-03', '2018-05-22', '2019-05-12', '2020-04-30', '2021-05-19', '2022-05-08',
    '2023-05-27', '2024-05-15', '2025-05-05', '2026-05-24', '2027-05-13', '2028-05-02', '2029-05-20', '2030-05-09'];

  const DAY = 86400000;
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const LUNAR = new Set(BUDDHA);
  for (const d of [...SEOLLAL, ...CHUSEOK]) {
    const t = Date.parse(d);
    [t - DAY, t, t + DAY].forEach(x => LUNAR.add(iso(x)));
  }

  // 날짜가 고정된 공휴일 [월-일, 시작 연도, 끝 연도]
  const FIXED = [['01-01'], ['03-01'], ['04-05', 0, 2005], ['05-01'], ['05-05'], ['06-06'], ['07-17', 0, 2007],
    ['08-15'], ['10-03'], ['10-09', 2013], ['12-25']];
  const isFixedHoliday = d => {
    const y = +d.slice(0, 4), md = d.slice(5);
    return FIXED.some(([m, from = 0, to = 9999]) => m === md && y >= from && y <= to);
  };

  // ym = 'YYYY-MM', open = 채권시장이 열린 날짜 Set. 시장 자료가 그달을 다 덮지 못하면 null.
  function workdays(ym, open, firstOpen, lastOpen) {
    const start = Date.parse(ym + '-01');
    const next = new Date(start); next.setUTCMonth(next.getUTCMonth() + 1);
    const end = iso(next.getTime() - DAY);
    if (firstOpen > ym + '-01' || lastOpen <= end) return null;
    let days = 0;
    for (let t = start; t < next.getTime(); t += DAY) {
      const d = iso(t), wd = new Date(t).getUTCDay();
      if (wd === 0) continue;
      if (wd === 6) {
        if (!isFixedHoliday(d) && !LUNAR.has(d)) days += 0.5;
      } else if (open.has(d) || d.slice(5) === '12-31') {
        days += 1;
      }
    }
    return days;
  }

  // monthly = { dates: ['YYYY-MM-01', ...], series: { EXPORT: [천 달러, ...] } }
  // daily   = 국고채 금리 표 { dates, series: { KTB10: [...] } }
  // 돌려주는 값: 그달 1일 날짜, 일평균 수출(억 달러), 조업일수
  function dailyAvg(monthly, daily) {
    const openDates = daily.dates.filter((d, i) => daily.series.KTB10[i] != null);
    const out = { dates: [], values: [], days: [] };
    if (!openDates.length || !monthly?.series?.EXPORT) return out;
    const open = new Set(openDates);
    const firstOpen = openDates[0], lastOpen = openDates[openDates.length - 1];
    monthly.dates.forEach((d, i) => {
      const v = monthly.series.EXPORT[i];
      if (v == null) return;
      const n = workdays(d.slice(0, 7), open, firstOpen, lastOpen);
      if (!n) return;
      out.dates.push(d);
      out.values.push(+(v / 1e5 / n).toFixed(2));
      out.days.push(n);
    });
    return out;
  }

  const api = { workdays, dailyAvg, LUNAR, isFixedHoliday };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ExportCore = api;
})(this);
