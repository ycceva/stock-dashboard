// 주봉 골든크로스 계산·찜 목록 (screener.html, index.html 공용)
// data/weekly.json(전 종목 52주 주봉 종가·거래량 배수)으로 5주선·20주선과 돌파·이탈 이력을 계산한다.
// 찜 목록은 study_notes의 id 'gc_watch' 한 줄에 JSON으로 둔다(백업 버튼이 함께 챙긴다).
const GC = (() => {
  const SHORT = 5, LONG = 20;
  const VOL_X = 1.5;   // 돌파 주 거래량이 직전 20주 평균의 몇 배 이상이어야 돌파로 인정하는지
  const REBOUND = 4;   // 이탈 뒤 이 주 수 안에 다시 돌파 못 하면 제외
  const RECENT = 12;   // "12주 안 재돌파" 표시 기준(주)
  const CHART = 30;    // 미니차트에 그릴 주 수
  const WATCH_ID = 'gc_watch';
  let PARTIAL = false;  // 마지막 주봉이 진행 중(금요일 마감 전)이면 true — 그 주 돌파·이탈은 잠정

  function sma(p, n) {
    const out = new Array(p.length).fill(null);
    for (let i = n - 1; i < p.length; i++) {
      let sum = 0, ok = true;
      for (let j = i - n + 1; j <= i; j++) { if (p[j] == null) { ok = false; break; } sum += p[j]; }
      if (ok) out[i] = sum / n;
    }
    return out;
  }

  // 종목 하나: 이동평균, 주마다 5주선이 위(1)/아래(-1), 돌파(up)·이탈(down) 이력
  //   돌파에는 그 주 거래량 배수(vr)와 거래량 조건 충족 여부(vol)를 붙인다
  function analyze(st) {
    const p = st.p, r = st.r || [], s = sma(p, SHORT), l = sma(p, LONG), last = p.length - 1;
    const sign = p.map((_, i) => s[i] == null || l[i] == null ? null : (s[i] > l[i] ? 1 : -1));
    const events = [];
    for (let i = 1; i <= last; i++) {
      if (sign[i] != null && sign[i - 1] != null && sign[i] !== sign[i - 1]) {
        const up = sign[i] === 1, vr = r[i] ?? null;
        events.push({ i, up, vr, vol: up && vr != null && vr >= VOL_X, tent: PARTIAL && i === last });
      }
    }
    return { st, s, l, sign, events, last, above: sign[last] === 1 };
  }

  // from(기준 주: 돌파한 주 또는 찜한 주) 이후 흐름
  //   kind: hold(돌파 뒤 계속 위) · re(내려갔다가 다시 위) · down(지금 아래)
  //   expiredAt: 이탈 뒤 REBOUND주 안에 다시 못 뚫어 제외된 주(없으면 null)
  //   wait: 지금 이탈 중일 때 다시 뚫어야 하는 남은 주 수
  function track(a, from) {
    const ev = a.events.filter(e => e.i >= from);
    const hadDown = ev.some(e => !e.up && e.i > from);
    const kind = !a.above ? 'down' : hadDown ? 're' : 'hold';
    let expiredAt = null, wait = null;
    const lastFull = PARTIAL ? a.last - 1 : a.last;  // 4주 셈은 확정된 주까지만
    for (const d of ev) {
      if (d.up || d.i === from) continue;
      const nextUp = a.events.find(e => e.up && e.i > d.i);
      const gap = (nextUp ? nextUp.i : Infinity) - d.i;
      if (gap > REBOUND && d.i + REBOUND <= lastFull) { expiredAt = d.i + REBOUND; break; }
      if (!nextUp) wait = REBOUND - (a.last - d.i);
    }
    const lastEv = a.events[a.events.length - 1];
    const weeks = lastEv ? a.last - lastEv.i + 1 : null;  // 지금 상태가 몇 주째인지
    const thisWeek = lastEv && lastEv.i === a.last ? (lastEv.up ? 'up' : 'down') : null;
    const base = a.st.p[from], now = a.st.p[a.last];
    const ret = base && now ? (now / base - 1) * 100 : null;
    return { from, ev, kind, weeks, thisWeek, ret, expiredAt, wait };
  }

  // 최근 start주 이후 이야기: 거래량 동반 돌파에서 시작해, 이탈 뒤 REBOUND주 안에 못 뚫으면 끝.
  // 끝난 뒤에 거래량 동반 돌파가 또 있으면 거기서 다시 시작. 남은 이야기가 없으면 null(제외).
  function recentStory(a, start) {
    let after = start - 1;
    for (const e of a.events) {
      if (!e.up || !e.vol || e.i <= after) continue;
      const t = track(a, e.i);
      if (t.expiredAt == null) return t;
      after = t.expiredAt;
    }
    return null;
  }

  function stateLabel(t) {
    if (t.expiredAt != null) return `이탈 뒤 ${REBOUND}주 반등 없음`;
    const tent = PARTIAL && t.thisWeek ? '(잠정)' : '';
    if (t.thisWeek === 'up') return (t.kind === 're' ? '이번 주 재돌파' : '이번 주 돌파') + tent;
    if (t.thisWeek === 'down') return `이번 주 이탈${tent} · ${REBOUND}주 안에 반등해야`;
    const w = t.weeks ? ` ${t.weeks}주째` : '';
    if (t.kind === 'hold') return t.ev.some(e => e.up) ? `유지${w}` : `위${w}`;
    if (t.kind === 're') return `재돌파 뒤 유지${w}`;
    if (t.wait != null) return `이탈${w} · ${t.wait}주 남음`;
    return t.ev.some(e => e.up) ? `이탈${w}` : `아래${w}`;
  }

  // ── 데이터 ──
  let dataPromise = null;
  function loadData() {
    if (!dataPromise) {
      dataPromise = fetch('data/weekly.json', { cache: 'no-store' })
        .then(r => { if (!r.ok) throw new Error('주봉 데이터 ' + r.status); return r.json(); })
        .then(d => { PARTIAL = !!d.partialWeek; d.byCode = new Map(d.stocks.map(st => [st.c, st])); return d; });
    }
    return dataPromise;
  }

  // ── 찜 목록 [{c, n, at:'YYYYMMDD'}] ──
  async function loadWatch(db) {
    const { data, error } = await db.from('study_notes').select('content').eq('id', WATCH_ID).maybeSingle();
    if (error) throw error;
    try { return JSON.parse(data?.content || '[]'); } catch { return []; }
  }
  async function saveWatch(db, list) {
    const { error } = await db.from('study_notes')
      .upsert({ id: WATCH_ID, content: JSON.stringify(list), updated_at: new Date().toISOString() });
    if (error) throw error;
  }
  // 찜한 날이 데이터 범위 밖이면 가장 오래된 주로
  function indexOf(dates, ymd) {
    let i = dates.findIndex(d => d >= ymd);
    if (i < 0) i = dates.length - 1;
    return i;
  }

  // ── 미니차트: 주가(회색)·5주선(노랑)·20주선(파랑), 돌파 ●노랑 / 이탈 ○파랑, 기준 주 점선 ──
  function mini(a, opt = {}) {
    const W = 300, H = opt.h || 60, P = 4;
    const n = Math.min(CHART, a.st.p.length), off = a.st.p.length - n;
    const cut = arr => arr.slice(off);
    const pc = cut(a.st.p), s = cut(a.s), l = cut(a.l);
    const vals = [...pc, ...s, ...l].filter(v => v != null);
    if (!vals.length) return '';
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const x = i => P + (W - 2 * P) * i / (n - 1);
    const y = v => P + (H - 2 * P) * (1 - (v - lo) / span);
    const path = arr => {
      let d = '', pen = false;
      arr.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1); pen = true; });
      return d;
    };
    const line = (d, c, w) => `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" vector-effect="non-scaling-stroke"/>`;
    let marks = '';
    if (opt.from != null && opt.from >= off) {
      const fx = x(opt.from - off);
      marks += `<line x1="${fx}" x2="${fx}" y1="0" y2="${H}" stroke="#444" stroke-dasharray="2 3" vector-effect="non-scaling-stroke"/>`;
    }
    const dots = a.events.filter(e => e.i >= off).map(e => {
      const left = (x(e.i - off) / W * 100).toFixed(2), top = y(s[e.i - off]).toFixed(1);
      return `<i class="gc-dot ${e.up ? (e.vol ? 'up' : 'up weak') : 'dn'}${e.tent ? ' tent' : ''}" style="left:${left}%;top:${top}px"></i>`;
    }).join('');
    return `<div class="gc-chart"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">${marks}
      ${line(path(pc), 'var(--price)', 1)}${line(path(l), 'var(--ma20)', 1.6)}${line(path(s), 'var(--yellow)', 1.6)}</svg>${dots}</div>`;
  }

  // ── 대시보드 첫 화면 버튼 옆: 찜한 종목 중 이번 주 돌파·이탈 개수 ──
  async function badge(db, el) {
    try {
      const [d, watch] = await Promise.all([loadData(), loadWatch(db)]);
      let n = 0;
      for (const w of watch) {
        const st = d.byCode.get(w.c); if (!st) continue;
        const a = analyze(st);
        const t = track(a, indexOf(d.dates, w.at));
        if (t.thisWeek && t.expiredAt == null) n++;
      }
      el.textContent = n ? `${PARTIAL ? '잠정 ' : ''}변화 ${n}` : '';
      el.style.display = n ? '' : 'none';
    } catch (e) { console.warn('골든크로스 표시 실패', e); }
  }

  return { RECENT, VOL_X, REBOUND, analyze, track, recentStory, stateLabel, loadData, loadWatch, saveWatch, indexOf, mini, badge };
})();
