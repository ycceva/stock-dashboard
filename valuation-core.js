// 코스피 밸류에이션 계산 (index.html 맨 아랫줄 '적정 시총' 차트가 쓴다)
// 김영익 교수 방식(경제스쿨 2026-11-14 영상 19:57~21:00): 코스피 시가총액이 명목GDP·M2·일평균 수출에 비해
// "장기 추세에서 얼마나 벗어났는가"를 본다.
//  - 비율 = 시총 ÷ 기준 지표. 이 비율의 장기 추세선을 구한다(로그 직선 회귀, 2003년 10월~).
//    시총/GDP처럼 자본시장이 커지며 꾸준히 오르는 비율도 추세를 빼고 보게 된다.
//  - 적정 시총 = 기준 지표 × 그날의 추세 비율 (조 원). 시총이 이보다 위면 그 기준으로 비싸다.
// 기준 지표는 그날까지 나온 가장 최근 값을 쓴다.
//  - 명목GDP: 최근 4분기 합(원계열, 조 원)
//  - M2: 평잔·계절조정(조 원)
//  - 일평균 수출: 최근 3개월 평균(억 달러). 명절이 낀 달에 출렁이는 것을 줄인다.
//    이렇게 하면 교수님이 말한 수치(2026년 5월 약 +70%, 10월 −3%)와 거의 같게 나온다(+62%, −3%).
(function (root) {
  const KEYS = ['GDP', 'M2', 'EXP'];
  const YEAR = 365.25 * 86400000;

  // 날짜순 [날짜, 값] 목록에서 d 이전(포함) 가장 최근 값을 꺼낸다. d는 커지는 순서로 넣는다.
  function stepper(points) {
    let j = -1;
    return d => {
      while (j + 1 < points.length && points[j + 1][0] <= d) j++;
      return j < 0 ? null : points[j][1];
    };
  }

  // n개씩 묶은 값 (연속한 기간이라고 본다)
  const rolling = (pts, n, f) => pts.slice(n - 1).map((p, i) => [p[0], f(pts.slice(i, i + n).map(x => x[1]))]);
  const sum = a => a.reduce((s, x) => s + x, 0);
  const mean = a => sum(a) / a.length;

  // y = a + b·x 최소제곱 직선
  function fitLine(xs, ys) {
    const mx = mean(xs), my = mean(ys);
    let sxy = 0, sxx = 0;
    xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; });
    const b = sxx ? sxy / sxx : 0;
    return { a: my - b * mx, b };
  }

  // val = kr-rates valuation 응답 { dates, series: { MCAP(억 원, 일별), M2(십억 원, 월별), GDP(십억 원, 분기) } }
  // exp = ExportCore.dailyAvg 결과 { dates, values(억 달러) }
  function build(val, exp) {
    const pts = id => val.dates.map((d, i) => [d, val.series[id]?.[i]]).filter(p => p[1] != null);
    const dens = {
      GDP: stepper(rolling(pts('GDP'), 4, a => sum(a) / 1000)),
      M2: stepper(pts('M2').map(([d, v]) => [d, v / 1000])),
      EXP: stepper(rolling(exp.dates.map((d, i) => [d, exp.values[i]]), 3, mean)),
    };
    const rows = [];
    for (const [d, v] of pts('MCAP')) {
      const den = {};
      for (const k of KEYS) den[k] = dens[k](d);
      if (KEYS.every(k => den[k] != null)) rows.push([d, v / 1e4, den]);
    }
    const out = { dates: rows.map(r => r[0]), series: { MCAP: rows.map(r => r[1]) }, trend: {} };
    if (!rows.length) return out;
    const t0 = Date.parse(rows[0][0]);
    const years = rows.map(([d]) => (Date.parse(d) - t0) / YEAR);
    for (const k of KEYS) {
      const r = rows.map(([, m, den]) => m / den[k]);
      const { a, b } = fitLine(years, r.map(Math.log));
      const trend = years.map(t => Math.exp(a + b * t));
      out.series['R_' + k] = r;
      out.series['TREND_' + k] = trend;
      out.series['FAIR_' + k] = rows.map(([, , den], i) => den[k] * trend[i]);
      out.trend[k] = { perYear: Math.exp(b) - 1 };  // 추세 비율이 1년에 몇 %씩 변하는지
    }
    return out;
  }

  // 이동평균: 앞쪽 n개(자기 포함) 평균. 값이 빈 칸은 건너뛰고, 모인 값이 절반이 안 되면 비운다.
  function movingAvg(values, n) {
    const out = new Array(values.length).fill(null);
    let s = 0, c = 0;
    for (let i = 0; i < values.length; i++) {
      if (values[i] != null) { s += values[i]; c++; }
      if (i >= n && values[i - n] != null) { s -= values[i - n]; c--; }
      if (i >= n - 1 && c >= n / 2) out[i] = s / c;
    }
    return out;
  }

  const api = { KEYS, build, stepper, fitLine, movingAvg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ValCore = api;
})(this);
