// 한국 금리(국고채 10년·1년, 통안증권 91일)와 경기 지표를 대시보드에 넘겨주는 함수.
// 본문에 monthly: true를 주면 월별 지표(선행·동행지수 순환변동치), kospi: true를 주면 일별 코스피를 준다.
// ECOS API 키는 주소에 들어가서 공개 페이지에 둘 수 없으므로 여기서 대신 받아온다.
// 키는 Supabase 함수 비밀값 ECOS_API_KEY에 둔다. 로그인한 사용자만 부를 수 있다.
// (verify_jwt는 페이지에 공개된 anon 키도 통과시키므로 사용자 세션을 따로 확인한다)

import { createClient } from "npm:@supabase/supabase-js@2";

// [ECOS 통계표, 항목 코드]. 국고채 3개월물은 없어서 통안증권(91일)을 쓴다.
const DAILY: Record<string, [string, string]> = {
  KTB10: ["817Y002", "010210000"],
  KTB1: ["817Y002", "010190000"],
  MSB91: ["817Y002", "010400000"],
};
const MONTHLY: Record<string, [string, string]> = {
  CYCLE: ["901Y067", "I16E"], // 선행지수순환변동치
  COIN: ["901Y067", "I16D"], // 동행지수순환변동치
};
const KOSPI: Record<string, [string, string]> = {
  KOSPI: ["802Y001", "0001000"],
};
const DAILY_START = "19950101";
const MONTHLY_START = "200001";
const KOSPI_START = "20000101";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const compact = (d: string) => d.replaceAll("-", "");

async function fetchSeries([stat, item]: [string, string], cycle: string, key: string, start: string, end: string) {
  const url = `https://ecos.bok.or.kr/api/StatisticSearch/${encodeURIComponent(key)}/json/kr/1/100000/${stat}/${cycle}/${start}/${end}/${item}`;
  // 주소에 키가 들어 있어 원래 오류 문구는 밖으로 내보내지 않는다
  const res = await fetch(url).catch(() => null);
  if (!res) throw new Error(`ECOS ${item} 연결 실패`);
  if (!res.ok) throw new Error(`ECOS ${item} ${res.status}`);
  const json = await res.json();
  if (!json.StatisticSearch) {
    // INFO-200 = 해당 기간에 자료 없음
    if (json.RESULT?.CODE === "INFO-200") return [];
    throw new Error(`ECOS ${item} ${json.RESULT?.CODE ?? ""} ${json.RESULT?.MESSAGE ?? ""}`.trim());
  }
  return (json.StatisticSearch.row as { TIME: string; DATA_VALUE: string }[]).map((r) => {
    const t = r.TIME;
    const v = Number(r.DATA_VALUE);
    // 일별은 YYYYMMDD, 월별은 YYYYMM → 월별은 1일로 맞춘다
    return [`${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8) || "01"}`, r.DATA_VALUE === "" || Number.isNaN(v) ? null : v] as const;
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const auth = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await auth.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "로그인이 필요합니다" }), {
        status: 401,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const key = Deno.env.get("ECOS_API_KEY")?.trim().replace(/^["']|["']$/g, "");
    if (!key) throw new Error("ECOS_API_KEY 비밀값이 없습니다");
    const body = await req.json().catch(() => ({}));
    const monthly = body?.monthly === true;
    const kospi = body?.kospi === true;
    const table = monthly ? MONTHLY : kospi ? KOSPI : DAILY;
    const today = compact(new Date().toISOString().slice(0, 10));
    const start = monthly
      ? MONTHLY_START
      : kospi
      ? KOSPI_START
      : /^\d{4}-\d{2}-\d{2}$/.test(body?.start ?? "") ? compact(body.start) : DAILY_START;
    const end = monthly ? today.slice(0, 6) : today;

    const ids = Object.keys(table);
    const all = await Promise.all(ids.map((id) => fetchSeries(table[id], monthly ? "M" : "D", key, start, end)));

    // 날짜를 하나로 맞춘 표: dates[i]일 때 각 금리 값
    const dates = [...new Set(all.flatMap((s) => s.map(([d]) => d)))].sort();
    const index = new Map(dates.map((d, i) => [d, i]));
    const series: Record<string, (number | null)[]> = {};
    ids.forEach((id, k) => {
      const arr = new Array(dates.length).fill(null);
      for (const [d, v] of all[k]) arr[index.get(d)!] = v;
      series[id] = arr;
    });

    return new Response(JSON.stringify({ dates, series }), {
      headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "max-age=3600" },
    });
  } catch (e) {
    console.error("kr-rates 실패:", String((e as Error).message ?? e));
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
