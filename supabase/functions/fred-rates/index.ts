// FRED 미국 국채 금리(10년·2년·3개월)를 대시보드에 넘겨주는 함수.
// FRED는 브라우저 직접 호출(CORS)을 막고, API 키를 공개 페이지에 둘 수 없어서 여기서 대신 받아온다.
// 키는 Supabase 함수 비밀값 FRED_API_KEY에 둔다. 로그인한 사용자만 부를 수 있다.
// (verify_jwt는 페이지에 공개된 anon 키도 통과시키므로 사용자 세션을 따로 확인한다)

import { createClient } from "npm:@supabase/supabase-js@2";

const SERIES = ["DGS10", "DGS2", "DGS3MO"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function fetchSeries(id: string, key: string, start?: string) {
  const url = new URL("https://api.stlouisfed.org/fred/series/observations");
  url.searchParams.set("series_id", id);
  url.searchParams.set("api_key", key);
  url.searchParams.set("file_type", "json");
  if (start) url.searchParams.set("observation_start", start);
  const res = await fetch(url);
  if (!res.ok) {
    const detail = await res.json().then((j) => j.error_message).catch(() => "");
    throw new Error(`FRED ${id} ${res.status} ${detail ?? ""}`.trim());
  }
  const json = await res.json();
  // 휴일 등 값이 없는 날은 "." → null
  return (json.observations as { date: string; value: string }[]).map(
    (o) => [o.date, o.value === "." ? null : Number(o.value)] as const,
  );
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

    // 비밀값을 넣을 때 따옴표·공백이 같이 들어가도 동작하도록 앞뒤를 떼어낸다
    const key = Deno.env.get("FRED_API_KEY")?.trim().replace(/^["']|["']$/g, "");
    if (!key) throw new Error("FRED_API_KEY 비밀값이 없습니다");
    const body = await req.json().catch(() => ({}));
    const start = /^\d{4}-\d{2}-\d{2}$/.test(body?.start ?? "") ? body.start : undefined;

    const all = await Promise.all(SERIES.map((id) => fetchSeries(id, key, start)));

    // 날짜를 하나로 맞춘 표: dates[i]일 때 각 금리 값
    const dates = [...new Set(all.flatMap((s) => s.map(([d]) => d)))].sort();
    const index = new Map(dates.map((d, i) => [d, i]));
    const series: Record<string, (number | null)[]> = {};
    SERIES.forEach((id, k) => {
      const arr = new Array(dates.length).fill(null);
      for (const [d, v] of all[k]) arr[index.get(d)!] = v;
      series[id] = arr;
    });

    return new Response(JSON.stringify({ dates, series }), {
      headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "max-age=3600" },
    });
  } catch (e) {
    // 키 값은 남기지 않고 길이만 남긴다(정상 키는 32자)
    console.error("fred-rates 실패:", String((e as Error).message ?? e), "키 길이:", Deno.env.get("FRED_API_KEY")?.length ?? 0);
    return new Response(JSON.stringify({ error: String((e as Error).message ?? e) }), {
      status: 500,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
