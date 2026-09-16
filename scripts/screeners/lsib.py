"""
LSIB screener — daily NSE stock scan.

Applies a fixed technical rule set (breakout + volatility-band screen) to
daily OHLCV history for every symbol in scripts/symbols.txt, and writes
the day's matches to data/screeners/lsib.json. Meant to run once per day
via GitHub Actions, after NSE market close — not something to run live on
every page load (3,000+ individual historical downloads is too slow/heavy
for that).

This is one of potentially several screeners. To add another one: copy
this file's shape into scripts/screeners/<name>.py, writing its output to
data/screeners/<name>.json, then add both a workflow step and a frontend
entry in the SCREENERS list in app.js.

Rules (all values computed as of the most recent daily bar, "0 days ago"):
  Must pass ALL:
    1. Close > 30
    2. -2.5 <= %Change(5 days ago) <= 2.5
    3. High(5 days ago) <= High(6 days ago)
    4. Low(5 days ago) >= Low(6 days ago)
    5. 50-day SMA(Volume) >= 50,000
    6. Close <= 1.25 * 50-day SMA(Close)
  Must pass ANY ONE:
    - Close(5d ago) >= Close(15d ago) * 1.1
    - Close(5d ago) >= Close(95d ago) * 1.3
    - Close(5d ago) >= Close(35d ago) * 1.2
    - Close(5d ago) >= Close(10d ago) * 1.1
  Plus:
    - Weekly % change > 20
"""

import json
import sys
import time
from datetime import datetime, timezone

import pandas as pd
import yfinance as yf

SYMBOLS_FILE = "scripts/symbols.txt"
OUTPUT_FILE = "data/screeners/lsib.json"
SCREENER_NAME = "LSIB"
CHUNK_SIZE = 200
LOOKBACK_PERIOD = "1y"  # headroom for the 95-day-ago lookback + 50-period SMA
PAUSE_BETWEEN_BATCHES_SEC = 2


def load_symbols():
    with open(SYMBOLS_FILE) as f:
        return [line.strip() for line in f if line.strip()]


def fetch_batch(symbols):
    tickers = [s + ".NS" for s in symbols]
    try:
        data = yf.download(
            tickers=tickers,
            period=LOOKBACK_PERIOD,
            interval="1d",
            group_by="ticker",
            threads=True,
            progress=False,
            auto_adjust=False,
        )
    except Exception as e:
        print(f"Batch download failed: {e}", file=sys.stderr)
        return {}

    out = {}
    if len(tickers) == 1:
        out[symbols[0]] = data
        return out

    for sym, ticker in zip(symbols, tickers):
        try:
            df = data[ticker].dropna(how="all")
            if not df.empty:
                out[sym] = df
        except Exception:
            continue
    return out


def back(series, n):
    """Value n trading days before the most recent bar (n=0 -> most recent)."""
    idx = len(series) - 1 - n
    if idx < 0:
        return None
    return series.iloc[idx]


def evaluate(symbol, df):
    df = df.dropna(subset=["Open", "High", "Low", "Close", "Volume"])
    if len(df) < 100:
        return None  # not enough history for the 95-day-ago lookback

    close, high, low, volume = df["Close"], df["High"], df["Low"], df["Volume"]

    c0 = back(close, 0)
    c5, c6 = back(close, 5), back(close, 6)
    h5, h6 = back(high, 5), back(high, 6)
    l5, l6 = back(low, 5), back(low, 6)
    c10, c15, c35, c95 = back(close, 10), back(close, 15), back(close, 35), back(close, 95)

    if None in (c0, c5, c6, h5, h6, l5, l6, c10, c15, c35, c95) or c6 == 0:
        return None

    sma_close_50 = close.iloc[-50:].mean()
    sma_volume_50 = volume.iloc[-50:].mean()
    pct_change_5 = ((c5 - c6) / c6) * 100

    group1 = (
        c0 > 30
        and -2.5 <= pct_change_5 <= 2.5
        and h5 <= h6
        and l5 >= l6
        and sma_volume_50 >= 50000
        and c0 <= 1.25 * sma_close_50
    )
    if not group1:
        return None

    group2 = (
        (c5 >= c15 * 1.1)
        or (c5 >= c95 * 1.3)
        or (c5 >= c35 * 1.2)
        or (c5 >= c10 * 1.1)
    )
    if not group2:
        return None

    weekly_close = close.resample("W").last().dropna()
    if len(weekly_close) < 2 or weekly_close.iloc[-2] == 0:
        return None
    weekly_pct_change = ((weekly_close.iloc[-1] - weekly_close.iloc[-2]) / weekly_close.iloc[-2]) * 100
    if weekly_pct_change <= 20:
        return None

    return {
        "symbol": symbol,
        "close": round(float(c0), 2),
        "pctChange5dAgo": round(float(pct_change_5), 2),
        "weeklyPctChange": round(float(weekly_pct_change), 2),
    }


def main():
    symbols = load_symbols()
    print(f"Screening {len(symbols)} symbols...")
    results = []

    for i in range(0, len(symbols), CHUNK_SIZE):
        batch = symbols[i : i + CHUNK_SIZE]
        batch_num = i // CHUNK_SIZE + 1
        print(f"Batch {batch_num}: {len(batch)} symbols")
        data = fetch_batch(batch)
        for sym, df in data.items():
            try:
                hit = evaluate(sym, df)
                if hit:
                    results.append(hit)
                    print(f"  MATCH: {sym}")
            except Exception as e:
                print(f"  {sym}: error {e}", file=sys.stderr)
        time.sleep(PAUSE_BETWEEN_BATCHES_SEC)

    output = {
        "screener": SCREENER_NAME,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "totalScanned": len(symbols),
        "matchCount": len(results),
        "results": sorted(results, key=lambda r: -r["weeklyPctChange"]),
    }

    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"Done. {len(results)} stocks matched out of {len(symbols)}.")


if __name__ == "__main__":
    main()
