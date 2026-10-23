// 주식대시보드 + 우리집 자산 통합 백업 (index.html, assets.html 공용)
// 두 페이지의 전역 db, SUPABASE_URL, SUPABASE_KEY를 그대로 쓴다.
// ── 백업 ── (btn: 누른 버튼. 글자를 "수집 중"으로 바꿨다가 되돌린다)
async function backupAll(btn) {
  btn = btn || document.querySelector('.header .backup-btn, .header .btn');
  const btnText = btn.textContent;
  btn.textContent = '이미지 수집 중...'; btn.disabled = true;
  try {
    const [tl, en, sn, am, ar] = await Promise.all([
      db.from('timeline').select('*'),
      db.from('entries').select('*').order('order'),
      db.from('study_notes').select('*'),
      db.from('asset_months').select('*').order('month'),
      db.from('asset_reviews').select('*').order('created_at'),
    ]);
    const failed = [tl, en, sn, am, ar].find(r => r.error);
    if (failed) throw failed.error;
    const data = {
      exported_at: new Date().toISOString(),
      timeline:    tl.data  || [],
      entries:     en.data  || [],
      study_notes: sn.data  || [],
      asset_months:  am.data || [],
      asset_reviews: ar.data || [],
    };

    // ── 이미지 URL 수집 ──
    const imgUrls = new Set();
    data.study_notes.forEach(n => {
      if (!n.content) return;
      for (const m of n.content.matchAll(/<img[^>]+src="([^"]+)"/g)) imgUrls.add(m[1]);
    });
    data.entries.forEach(e => {
      ['macro','company','top_pick'].forEach(f => {
        for (const m of (e[f]||'').matchAll(/\[img:(?:[^|]+\|)?([^\]]+)\]/g)) imgUrls.add(m[1]);
      });
    });

    // ── URL → base64 변환 ──
    const b64 = {};
    await Promise.all([...imgUrls].map(async url => {
      try {
        const blob = await fetch(url).then(r => r.blob());
        b64[url] = await new Promise(res => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = () => res(url);
          fr.readAsDataURL(blob);
        });
      } catch { b64[url] = url; }
    }));

    // ── HTML 내 img src 치환 ──
    const embedImgs = html =>
      html.replace(/(<img[^>]+src=")([^"]+)(")/g,
        (_, pre, url, post) => pre + (b64[url] || url) + post);

    // ── entries raw → HTML 렌더 (칩 + 이미지) ──
    const renderRaw = raw => {
      if (!raw) return '';
      let html = '', i = 0;
      while (i < raw.length) {
        if (raw[i] === '[') {
          const end = raw.indexOf(']', i);
          if (end === -1) { html += raw[i++]; continue; }
          const token = raw.slice(i+1, end);
          if (token.startsWith('img:')) {
            const pipe = token.indexOf('|');
            const src  = pipe > 0 ? token.slice(pipe+1) : token.slice(4);
            const w    = pipe > 0 ? ' style="width:' + token.slice(4, pipe) + ';max-width:100%"' : ' style="max-width:100%"';
            html += `<img src="${b64[src]||src}"${w} style="${w.slice(8,-1)};border-radius:3px;display:block;margin:4px 0">`;
          } else if (token.startsWith('!')) {
            html += `<span class="chip chip-orange">${token.slice(1)}</span>`;
          } else if (token.startsWith('?')) {
            html += `<span class="chip chip-green">${token.slice(1)}</span>`;
          } else {
            html += `<span class="chip">${token}</span>`;
          }
          i = end + 1;
        } else if (raw[i] === '\n') {
          html += '<br>'; i++;
        } else {
          html += raw[i++];
        }
      }
      return html;
    };

    // 타임라인 HTML
    const BK_MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];
    const tlRows = BK_MONTHS.map((m, i) => {
      const row = data.timeline.find(r => r.month == i+1) || {};
      return `<tr><td>${m}</td><td>${renderRaw(row.quant||'')}</td><td>${renderRaw(row.market||'')}</td></tr>`;
    }).join('');

    // 월별분석 HTML
    const entryRows = data.entries.map(e =>
      `<tr><td>${e.month||''}</td><td>${renderRaw(e.macro||'')}</td><td>${renderRaw(e.company||'')}</td><td>${renderRaw(e.top_pick||'')}</td></tr>`
    ).join('');

    // 노트 HTML (img src → base64 치환)
    const note1 = embedImgs(data.study_notes.find(n=>n.id==='freenote')?.content || '');
    const note2 = embedImgs(data.study_notes.find(n=>n.id==='freenote2')?.content || '');

    // 우리집 자산 HTML
    const bkEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const won = n => (Number(n) || 0).toLocaleString('ko-KR');
    const accSum = list => (list || []).reduce((s, a) => s + (Number(a.amount) || 0), 0);
    const accList = list => (list || []).map(a => `${bkEsc(a.name)} ${won(a.amount)}`).join('<br>');
    const assetRows = data.asset_months.map(r => {
      const cash = accSum(r.my_accounts) + accSum(r.spouse_accounts);
      return `<tr><td>${bkEsc(r.month)}</td><td>${won(r.real_estate)}</td><td>${accList(r.my_accounts)}</td><td>${accList(r.spouse_accounts)}</td>` +
        `<td>${won(cash)}</td><td>${won((Number(r.real_estate) || 0) + cash)}</td><td>${won(r.income)}</td><td>${won(r.expense)}</td></tr>`;
    }).join('');
    const assetNote = data.study_notes.find(n => n.id === 'assetnote')?.content || '';
    const reviewHtml = data.asset_reviews.map(r =>
      `<div class="note-box"><div style="color:#666;margin-bottom:6px">${bkEsc(String(r.created_at).slice(0,10))} 점검 · ${bkEsc(r.base_month || '')} 기준</div><div style="white-space:pre-wrap">${bkEsc(r.content)}</div></div>`
    ).join('');

    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>주식 + 자산 백업 — ${data.exported_at.slice(0,10)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, sans-serif; font-size: 13px; background: #141414; color: #e2e2e2; padding: 20px; }
  h1 { font-size: 15px; margin-bottom: 4px; }
  .meta { font-size: 11px; color: #555; margin-bottom: 24px; }
  h2 { font-size: 11px; color: #777; text-transform: uppercase; letter-spacing: .6px; margin: 24px 0 8px; }
  table { width: 100%; border-collapse: collapse; background: #1c1c1c; border: 1px solid #2e2e2e; border-radius: 6px; overflow: hidden; margin-bottom: 12px; }
  th { background: #252525; padding: 6px 10px; font-size: 11px; text-align: left; border-bottom: 1px solid #333; color: #ccc; }
  td { padding: 6px 10px; font-size: 11px; border-bottom: 1px solid #222; vertical-align: top; color: #bbb; }
  tr:last-child td { border-bottom: none; }
  .note-box { background: #1c1c1c; border: 1px solid #2e2e2e; border-radius: 6px; padding: 12px 14px; font-size: 12px; line-height: 1.7; color: #bbb; margin-bottom: 12px; min-height: 60px; }
  .note-box img { max-width: 100%; border-radius: 4px; margin: 4px 0; }
  .restore-box { margin-top: 32px; padding: 18px; background: #1a2030; border: 1px solid #2a3a55; border-radius: 8px; }
  .restore-box h2 { margin-top: 0; color: #6a9fd8; }
  .restore-box p { font-size: 11px; color: #778; margin: 8px 0 14px; line-height: 1.7; }
  .restore-btn { padding: 8px 22px; background: #2a5a9a; border: none; border-radius: 5px; color: #fff; font-size: 12px; cursor: pointer; font-family: inherit; }
  .restore-btn:hover { background: #3a6aaa; }
  .restore-btn:disabled { opacity: .5; cursor: default; }
  #restoreLog { margin-top: 12px; font-size: 11px; color: #5a9e4a; min-height: 18px; }
  .chip { display:inline-block; font-size:9px; font-weight:500; padding:1px 6px; border-radius:3px; margin:0 2px 2px 0; background:#1a3050; color:#7ab0e0; }
  .chip-orange { background:#2e1a08; color:#e8924a; }
  .chip-green  { background:#0e2414; color:#52c46e; }
</style>
</head>
<body>
<h1>📊 주식 매크로 대시보드 + 🏠 우리집 자산 — 백업본</h1>
<div class="meta">백업 일시: ${new Date(data.exported_at).toLocaleString('ko-KR')}</div>

<h2>연간 타임라인</h2>
<table>
  <thead><tr><th>월</th><th>퀀트일정</th><th>시장메모</th></tr></thead>
  <tbody>${tlRows}</tbody>
</table>

<h2>월별 분석</h2>
<table>
  <thead><tr><th>월</th><th>매크로·산업</th><th>기업보고서</th><th>최선호주</th></tr></thead>
  <tbody>${entryRows}</tbody>
</table>

<h2>자유노트 1</h2>
<div class="note-box">${note1 || '<span style="color:#444">내용 없음</span>'}</div>

<h2>자유노트 2</h2>
<div class="note-box">${note2 || '<span style="color:#444">내용 없음</span>'}</div>

<h2>🏠 우리집 자산 (원)</h2>
<table>
  <thead><tr><th>월</th><th>부동산</th><th>본인 계좌</th><th>배우자 계좌</th><th>현금</th><th>총자산</th><th>입금</th><th>지출</th></tr></thead>
  <tbody>${assetRows || '<tr><td colspan="8" style="color:#444">기록 없음</td></tr>'}</tbody>
</table>

<h2>자산 메모</h2>
<div class="note-box">${assetNote || '<span style="color:#444">내용 없음</span>'}</div>

<h2>AI 점검</h2>
${reviewHtml || '<div class="note-box"><span style="color:#444">점검 기록 없음</span></div>'}

<div class="restore-box">
  <h2>↩ Supabase에 복원하기</h2>
  <p>이 버튼을 누르면 이 백업 파일의 데이터를 Supabase에 덮어씁니다.<br>
  <strong>현재 Supabase에 있는 데이터는 이 백업본으로 교체됩니다.</strong></p>
  <button class="restore-btn" onclick="doRestore()">복원 시작</button>
  <div id="restoreLog"></div>
</div>

<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"><\/script>
<script>
const BACKUP = ${JSON.stringify(data).replace(/</g, '\\u003c')};
const SUPA_URL = '${SUPABASE_URL}';
const SUPA_KEY = '${SUPABASE_KEY}';

async function doRestore() {
  const btn = document.querySelector('.restore-btn');
  const log = document.getElementById('restoreLog');
  btn.disabled = true; log.textContent = '복원 중...'; log.style.color = '#888';
  try {
const db = supabase.createClient(SUPA_URL, SUPA_KEY);

const email = prompt('복원하려면 로그인이 필요합니다. 이메일:');
const password = email ? prompt('비밀번호:') : null;
if (!email || !password) throw new Error('로그인 정보가 없어 취소했습니다.');
const { error: authError } = await db.auth.signInWithPassword({ email, password });
if (authError) throw authError;

log.textContent = '타임라인 복원 중...';
if (BACKUP.timeline.length) {
  const { error } = await db.from('timeline').upsert(BACKUP.timeline, { onConflict: 'month' });
  if (error) throw error;
}

log.textContent = '월별분석 복원 중...';
if (BACKUP.entries.length) {
  const { error } = await db.from('entries').upsert(BACKUP.entries, { onConflict: 'id' });
  if (error) throw error;
}

log.textContent = '노트 복원 중...';
if (BACKUP.study_notes.length) {
  const { error } = await db.from('study_notes').upsert(BACKUP.study_notes, { onConflict: 'id' });
  if (error) throw error;
}

// 예전 백업 파일에는 자산 키가 없다 → 건너뜀
log.textContent = '자산 기록 복원 중...';
if (BACKUP.asset_months?.length) {
  const { error } = await db.from('asset_months').upsert(BACKUP.asset_months, { onConflict: 'month' });
  if (error) throw error;
}
if (BACKUP.asset_reviews?.length) {
  const { error } = await db.from('asset_reviews').upsert(BACKUP.asset_reviews, { onConflict: 'id' });
  if (error) throw error;
}

log.textContent = '✓ 복원 완료! 대시보드를 새로고침하면 반영됩니다.';
log.style.color = '#5a9e4a';
  } catch(e) {
log.textContent = '오류: ' + e.message;
log.style.color = '#d95a5a';
btn.disabled = false;
  }
}
<\/script>
</body>
</html>`;

    const filename = '주식대시보드_백업_' + data.exported_at.slice(0,10) + '.html';
    const blob = new Blob([html], { type: 'text/html' });

    // Chrome/Edge: 저장 위치 선택 가능
    if (window.showSaveFilePicker) {
      const fh = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'HTML 파일', accept: { 'text/html': ['.html'] } }],
      });
      const writable = await fh.createWritable();
      await writable.write(blob);
      await writable.close();
    } else {
      // Safari 등: 다운로드 폴더로 저장
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  } catch(e) {
    if (e.name !== 'AbortError') alert('백업 실패: ' + e.message);
  } finally {
    btn.textContent = btnText; btn.disabled = false;
  }
}
