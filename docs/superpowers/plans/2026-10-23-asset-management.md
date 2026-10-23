# 우리집 자산관리 페이지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주식대시보드 안에 로그인 전용 자산관리 페이지(`assets.html`)를 만들고, 월별 가계부 입력 팝업, 6개 섹션, 주식+자산 통합 백업을 붙인다.

**Architecture:** 정적 파일(GitHub Pages) + Supabase. 계산은 순수 함수 모듈 `assets-core.js`에 모아 node로 테스트한다. `assets.html`은 그 모듈로 숫자를 만들고 SVG를 직접 그린다. 백업 함수는 `index.html`에서 `backup.js`로 옮겨 두 페이지가 같이 쓴다.

**Tech Stack:** 바닐라 HTML/CSS/JS, supabase-js@2 (CDN), node:test (v26), 화면 확인은 playwright-core + 시스템 Chrome(스크래치패드에 설치).

**Spec:** `docs/superpowers/specs/2026-10-23-asset-management-design.md`

## Global Constraints

- 현금 = 총자산 − 부동산 = 본인 계좌 합 + 배우자 계좌 합. 은퇴준비율 = 현금 ÷ 2,000,000,000 × 100.
- 입금·지출은 총자산·현금 계산에 넣지 않는다.
- 새 테이블 RLS: `authenticated`, ALL, using/with check `(auth.jwt() ->> 'email') = 'evadslr@gmail.com'`, 정책 이름 `owner only`.
- 색: 노란 버튼·총자산 #f2c94c, 현금 선 #5fc08f, 입금 빨강, 지출 파랑, 본인 계좌 파랑 계열, 배우자 계좌 초록 계열, 부동산 #5b6b80, 증가 빨강·감소 파랑.
- 배경 #141414 다크, 글자 #e2e2e2. 폰 폭에서 세로로 쌓인다.
- 금액 표시 "12억 8,000만" 형식, 입력은 원 단위 + 천 단위 콤마.
- push 금지(사용자가 "올려줘"할 때만).

## Review Focus

1. 기록 0건으로 처음 들어온 경우 → 모든 섹션이 빈 상태 문구를 보여주고 오류가 없어야 한다 (Task 2 `summary([])`, Task 5 빈 렌더 확인).
2. 계좌 금액 칸을 비우거나 "1,2a0" 같은 값 → 0 또는 숫자만 추려 계산, NaN이 화면에 나오면 안 된다 (Task 2 `parseWon`).
3. 중간 달이 빠진 기록(예: 8월, 10월만) → 전달 대비는 8월과 비교하고 비교한 달을 표시 (Task 2 `summary`).
4. 예전 백업 파일(자산 키 없음)로 복원 → 주식 데이터만 복원되고 오류 없음 (Task 6).
5. 부동산 0, 현금만 있는 달 / 현금 0 → 도넛·비율 막대가 0으로 나누지 않는다 (Task 2 `composition`).

---

### Task 1: Supabase 테이블

**Files:** Create: `supabase/migrations/20261023_asset_tables.sql`

- [ ] 테이블 `asset_months`: `month text primary key` ('YYYY-MM'), `income bigint not null default 0`, `expense bigint not null default 0`, `real_estate bigint not null default 0`, `my_accounts jsonb not null default '[]'`, `spouse_accounts jsonb not null default '[]'` (각 원소 `{name: string, amount: number}`), `updated_at timestamptz not null default now()`.
- [ ] 테이블 `asset_reviews`: `id bigint generated always as identity primary key`, `created_at timestamptz not null default now()`, `base_month text`, `content text not null`.
- [ ] 두 테이블 RLS on + Global Constraints의 정책. 메모는 기존 `study_notes`에 id `assetnote`로 저장(테이블 추가 없음).
- [ ] 적용 후 확인: `select tablename, policyname, qual from pg_policies where tablename like 'asset_%'` → 두 줄, qual에 이메일.
- [ ] Commit.

### Task 2: 계산 모듈 `assets-core.js`

**Files:** Create: `assets-core.js`, `tests/assets-core.test.mjs`

**Interfaces — Produces** (브라우저에서는 `window.AssetCore`, node에서는 `module.exports`):
- `GOAL = 2_000_000_000`
- `parseWon(str) -> number` (숫자 외 문자 제거, 빈값 0)
- `fmtWon(n) -> string` ("12억 8,000만", "8,000만", "12억", "0", 1만 미만 "5,000원", 음수는 "-" 접두)
- `monthTotals(rec) -> {mine, spouse, cash, realEstate, total}`
- `sortRecords(recs) -> recs` (month 오름차순, 원본 불변)
- `summary(recs) -> null | {base, prev|null, t, diff|null, diffPct|null, ready}` (base=최신, prev=그 직전 기록, ready=cash/GOAL*100)
- `composition(t) -> {realPct, cashPct}` (total 0이면 둘 다 0)
- `yearlyFlows(recs) -> [{year, income, expense, months}]` (그해 기록 합, months=기록된 달 수)
- `yearlyBalances(recs) -> [{year, month, ...monthTotals}]` (해마다 마지막 기록)
- `prefillFor(month, recs) -> rec` (있으면 그 기록 복사, 없으면 그 달 이전 최신 기록의 부동산·계좌 복사 + 입금·지출 0, 이전이 없으면 최신 기록, 하나도 없으면 기본 계좌 이름 본인[국내주식계좌, 해외주식계좌] / 배우자[퇴직연금계좌, CMA, 연금계좌] 금액 0)

- [ ] 실패 테스트 작성 — 핵심 단언:
  - `fmtWon(1_280_000_000) === '12억 8,000만'`, `fmtWon(18_000_000) === '1,800만'`, `fmtWon(900_000_000) === '9억'`, `fmtWon(0) === '0'`, `fmtWon(5000) === '5,000원'`, `fmtWon(-18_000_000) === '-1,800만'`
  - `parseWon('1,2a0') === 120`, `parseWon('') === 0`
  - 9억 + 본인 [1.2억, 0.8억] + 배우자 [0.9억, 0.3억, 0.6억] → total 1_280_000_000, cash 380_000_000, `summary().ready` ≈ 19.0
  - 기록 8월·10월 → `summary().prev.month === '2026-08'`
  - `summary([]) === null`, `composition({total:0,...}).cashPct === 0`
  - `yearlyFlows`: 2026년 3개 달 입금 합, months 3
  - `yearlyBalances`: 2025-11, 2025-12, 2026-03 → 2025는 12월 값, 2026은 3월 값
  - `prefillFor`: 없는 달 → 직전 계좌 복사, income 0
- [ ] `node --test tests/` → FAIL
- [ ] 구현 (UMD 래퍼, 의존성 없음)
- [ ] `node --test tests/` → 전부 PASS
- [ ] Commit.

### Task 3: `assets.html` 뼈대 — 로그인, 데이터, 한눈에, 팝업

**Files:** Create: `assets.html`
**Consumes:** `AssetCore` (Task 2), 테이블 (Task 1)
**Produces:** `renderAll(records, reviews)` 전역 함수 — 데이터만 받아 모든 섹션을 다시 그린다(화면 확인 때 가짜 데이터로 부른다). `loadAll()` → Supabase에서 읽어 `renderAll` 호출.

- [ ] 로그인: index.html과 같은 Supabase URL/anon key, `getSession` + `onAuthStateChange`. 세션 없으면 대시보드와 같은 로그인 박스.
- [ ] 상단 바: "← 대시보드"(index.html), 제목, "⬇ 백업"(`backupAll(this)`, Task 6), 노란 "✎ 이번달 가계부쓰기".
- [ ] ① 한눈에 5칸 + "YYYY년 M월 기준" + 전달 대비에 비교한 달 표시. 기록 0건이면 안내 문구.
- [ ] 팝업: 월(input type=month, 기본 이번 달) 바꾸면 `prefillFor`로 채움. 금액 칸은 입력 중 콤마 자동. 계좌 행 추가/✕. 합계 자동. 저장 = `asset_months` upsert(onConflict month) 후 `loadAll()`. 기존 달이면 "이 달 기록 삭제" 버튼(confirm). Esc/취소로 닫힘.
- [ ] Commit.

### Task 4: 차트 섹션 — 자산 구성(A안) + 입금·지출 + 추이

**Files:** Modify: `assets.html`

- [ ] ② 부동산:현금 얇은 막대(양끝 금액·%), 현금 100% 도넛(본인 파랑 계열 / 배우자 초록 계열 계좌별 조각, 가운데 현금 총액), 범례(그룹 합·%·계좌별 금액).
- [ ] ② 아래 입금(빨강)·지출(파랑) 나란히 막대 + 월별/연별 전환. 연별 라벨은 12개월 미만이면 "2026 (10개월)".
- [ ] ③ 총자산(노랑)·현금(초록) 선 + 월별/연별 전환. 점 hover/탭 → 총자산·현금·부동산(월별은 입금·지출 포함) 표시. 월별 24개 초과 시 가로 스크롤, 오른쪽 끝에서 시작.
- [ ] Commit.

### Task 5: 메모·은퇴준비도·AI 점검

**Files:** Modify: `assets.html`

- [ ] ④ 메모: contenteditable, 입력 후 800ms 디바운스로 `study_notes` upsert {id:'assetnote'}, 저장 상태 표시. 붙여넣기는 텍스트만.
- [ ] ⑤ 진행 막대 + "현금 X / 목표 20억 · Y% 달성 · 남은 금액 Z"(100% 넘으면 "목표 달성") + 지출 항목 이름표 6개.
- [ ] ⑥ `asset_reviews` 최신 1건(날짜·기준월·본문, 본문은 이스케이프 후 줄바꿈 유지, `【...】` 줄은 굵게), 이전 건은 `<details>`로 접기. 없으면 안내 문구.
- [ ] 화면 확인: 로컬 서버 + playwright로 `renderAll([])`, `renderAll(샘플 12개월)`을 데스크톱(1280)·폰(390) 폭으로 스크린샷, 콘솔 오류 0.
- [ ] Commit.

### Task 6: 통합 백업 + 대시보드 버튼

**Files:** Create: `backup.js`; Modify: `index.html`

- [ ] `index.html`의 `backupAll()`을 `backup.js`로 옮기고 `backupAll(btn)`으로 바꾼다(누른 버튼의 글자를 바꾼다. 지금은 첫 `.backup-btn`인 로그인 버튼을 잡는 버그가 있음). 전역 `db`, `SUPABASE_URL`, `SUPABASE_KEY`를 그대로 쓴다.
- [ ] 수집에 `asset_months`(month 순), `asset_reviews`(created_at 순) 추가. 백업 HTML 제목 "주식 + 자산", 본문에 "우리집 자산" 표(월·부동산·본인·배우자·총자산·입금·지출), 자산 메모, AI 점검 추가.
- [ ] 복원: `BACKUP.asset_months?.length`일 때만 upsert(onConflict month), `asset_reviews`는 onConflict id. 키가 없는 예전 백업은 건너뜀.
- [ ] `index.html`: FRED 섹션과 자유노트2 사이에 `<a class="asset-link" href="assets.html">🏠 우리집 자산관리</a>` (width 20%, min-width 160px, 왼쪽, 노랑 배경·어두운 글자), 백업 버튼 `onclick="backupAll(this)"`, `<script src="backup.js">`.
- [ ] 확인: playwright로 index.html 로드 시 콘솔 오류 0, `typeof backupAll === 'function'`, 버튼 스크린샷.
- [ ] Commit.

### Task 7: "자산 점검해줘" 처리법 기록

- [ ] 메모리 `asset-management-page.md`에 점검 절차 기록: `asset_months` 전체 읽기 → AssetCore와 같은 규칙으로 계산 → 20년 차 은퇴설계 전문가 관점 `【진단】`/`【조언】` 본문 → `asset_reviews` insert(base_month=최신 월).
