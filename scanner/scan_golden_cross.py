"""주봉 골든크로스 추적용 데이터 수집.

코스피·코스닥, 시가총액 1000억 이상, 일반 주식만(ETF·ETN 제외, 이름에 '스팩' 들어간 종목 제외)
모든 종목의 최근 52주 주봉 종가와 거래량 배수(직전 20주 평균 대비)를 모아 data/weekly.json에 저장한다.
5주선·20주선, 거래량 증가, 돌파·이탈·재돌파 판정은 화면(gc-core.js)이 계산한다.
그래서 찜한 종목이 몇 주 뒤에 내려가거나 다시 올라가도 계속 따라갈 수 있다.

데이터: 네이버 증권 공개 시세(시가총액 순위 목록, 주봉 차트). 파이썬 기본 기능만 쓴다.
평일 매일 17시(KST) 자동 실행. 월~목 결과는 진행 중인 주봉이라 '잠정'이고,
그 주 거래량은 지난 거래일 수로 나눠 한 주 치로 늘려(×5/거래일 수) 비교한다. 금요일 결과가 확정.

실행: python3 scanner/scan_golden_cross.py
"""
import json
import re
import sys
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

MIN_MCAP = 100_000_000_000  # 1000억 원
WEEKS = 52                  # 저장할 주봉 개수 (20주선이 33주 동안 그려진다)
UA = {"User-Agent": "Mozilla/5.0"}
KST = timezone(timedelta(hours=9))
DATA_DIR = Path(__file__).resolve().parent.parent / "data"
OUT = DATA_DIR / "weekly.json"


def get(url, retries=3):
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=15) as r:
                return r.read()
        except Exception:
            if i == retries - 1:
                raise
            time.sleep(1 + i)


def list_market(market):
    """시가총액 순으로 내려가며 1000억 이상만 모은다."""
    out, page = [], 1
    while True:
        url = f"https://m.stock.naver.com/api/stocks/marketValue/{market}?page={page}&pageSize=100"
        stocks = json.loads(get(url)).get("stocks", [])
        if not stocks:
            break
        for s in stocks:
            mcap = int(s.get("marketValueRaw") or 0)
            if mcap < MIN_MCAP:
                return out
            if s.get("stockEndType") != "stock":
                continue
            name = s["stockName"]
            if "스팩" in name:
                continue
            out.append({"code": s["itemCode"], "name": name, "market": market, "mcap": mcap})
        page += 1
    return out


def weekly(stock):
    url = (f"https://fchart.stock.naver.com/sise.nhn?symbol={stock['code']}"
           f"&timeframe=week&count={WEEKS}&requestType=0")
    try:
        xml = get(url).decode("euc-kr", errors="ignore")
    except Exception as e:
        return stock, None, str(e)
    rows = {}
    for d in re.findall(r'data="([^"]+)"', xml):
        date, _o, _h, _l, c, v = d.split("|")
        if c not in ("0", ""):
            rows[date] = (int(c), int(v or 0))
    return stock, rows, None


def vol_ratio(vols, scale_last=1.0, n=20):
    """주마다 거래량 ÷ 직전 n주 평균 거래량 (소수 첫째 자리). 앞 n주는 비워 둔다.
    scale_last: 진행 중인 주의 거래량을 한 주 치로 늘리는 배수(화요일까지면 5/2)."""
    out = []
    for i, v in enumerate(vols):
        prev = [x for x in vols[max(0, i - n):i] if x is not None]
        if v is None or len(prev) < n or sum(prev) == 0:
            out.append(None)
        else:
            if i == len(vols) - 1:
                v *= scale_last
            out.append(round(v / (sum(prev) / n), 1))
    return out


def ymd_date(s):
    return date(int(s[:4]), int(s[4:6]), int(s[6:]))


def week_status(last_bar, now):
    """마지막 주봉이 진행 중인지, 그 주에 거래일이 며칠 지났는지.
    금요일 15:30 장 마감 전이고 마지막 주봉이 이번 주 것이면 진행 중(잠정)."""
    last = ymd_date(last_bar)
    monday = last - timedelta(days=last.weekday())
    this_monday = now.date() - timedelta(days=now.weekday())
    before_close = now.weekday() < 4 or (now.weekday() == 4 and (now.hour, now.minute) < (15, 30))
    partial = last >= this_monday and before_close
    # 그 주 거래일 수: 삼성전자 일봉으로 센다
    xml = get("https://fchart.stock.naver.com/sise.nhn?symbol=005930&timeframe=day&count=10&requestType=0").decode("euc-kr", "ignore")
    days = sum(1 for d in re.findall(r'data="(\d{8})\|', xml) if monday <= ymd_date(d) <= last)
    return partial, max(days, 1)


def main():
    t0 = time.time()
    universe = list_market("KOSPI") + list_market("KOSDAQ")
    print(f"대상 {len(universe)}종목 (코스피·코스닥, 시총 1000억↑, ETF·스팩 제외)", flush=True)

    with ThreadPoolExecutor(max_workers=8) as ex:
        fetched = list(ex.map(weekly, universe))

    errors = [f"{s['code']} {e}" for s, _, e in fetched if e]
    # 공통 주차: 종목 대부분이 가진 날짜 중 최근 WEEKS개
    count = Counter(d for _, rows, _ in fetched if rows for d in rows)
    need = max(1, len(universe) // 2)
    dates = sorted(d for d, n in count.items() if n >= need)[-WEEKS:]

    now = datetime.now(KST)
    partial, days = week_status(dates[-1], now)
    scale = 5 / days if partial else 1.0

    stocks = []
    for s, rows, e in fetched:
        if not rows:
            continue
        closes = [rows[d][0] if d in rows else None for d in dates]
        vols = [rows[d][1] if d in rows else None for d in dates]
        # 거래정지 등으로 빈 주는 앞 주 종가, 거래량 0으로 채운다(상장 전 구간은 비워 둔다)
        for i in range(1, len(closes)):
            if closes[i] is None and closes[i - 1] is not None:
                closes[i], vols[i] = closes[i - 1], 0
        stocks.append({
            "c": s["code"], "n": s["name"],
            "m": "P" if s["market"] == "KOSPI" else "D",
            "cap": round(s["mcap"] / 1e8),  # 억 원
            "p": closes,
            "r": vol_ratio(vols, scale),
        })

    data = {
        "updated": now.strftime("%Y-%m-%d %H:%M"),
        "partialWeek": partial,  # 마지막 주봉이 아직 진행 중(금요일 마감 전)이면 true → 화면에 '잠정'
        "weekDays": days,        # 마지막 주봉에 들어간 거래일 수

        "criteria": "주봉 5주선이 20주선을 아래에서 위로 돌파 · 돌파 주 거래량이 직전 20주 평균의 1.5배 이상 · 이탈 뒤 4주 안에 다시 돌파 못 하면 제외 · 코스피·코스닥 · 시총 1000억 이상 · ETF·ETN·스팩 제외",
        "dates": dates,
        "stocks": stocks,
    }
    DATA_DIR.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"저장 {len(stocks)}종목 · 마지막 주 {dates[-1]}{f' (잠정, 거래일 {days}일)' if partial else ' (확정)'} · 실패 {len(errors)} · "
          f"{OUT.stat().st_size / 1024:.0f}KB · {time.time() - t0:.0f}초")
    if errors:
        print("실패 예:", errors[:5], file=sys.stderr)
    if len(errors) > len(universe) * 0.2:
        sys.exit("받기 실패가 너무 많아 결과를 믿기 어렵습니다")


if __name__ == "__main__":
    main()
