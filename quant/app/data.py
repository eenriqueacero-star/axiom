"""Historical daily price data via Stooq (free, no key).

Stooq gates requests behind a SHA-256 proof-of-work challenge; we solve it once
per session. Fine for backtests. Live signals use Finnhub/other providers.
Very new listings may be missing from Stooq — callers drop them.
"""
from __future__ import annotations

import hashlib
import io
import re
import time
from pathlib import Path

import pandas as pd
import requests

CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache"
CACHE_DIR.mkdir(exist_ok=True)

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"


def _solve_challenge(html: str) -> tuple[str, int] | None:
    m = re.search(r'c="([A-Za-z0-9_\-]+)".*?d=(\d+)', html)
    if not m:
        return None
    c, d = m.group(1), int(m.group(2))
    prefix = "0" * d
    n = 0
    while True:
        h = hashlib.sha256(f"{c}{n}".encode()).hexdigest()
        if h.startswith(prefix):
            return c, n
        n += 1


def _make_session() -> requests.Session:
    s = requests.Session()
    s.headers["User-Agent"] = _UA
    probe = s.get("https://stooq.com/q/d/l/?s=spy.us&i=d", timeout=20)
    if probe.text.lstrip().startswith("<") and "crypto.subtle" in probe.text:
        solved = _solve_challenge(probe.text)
        if solved:
            c, n = solved
            s.post("https://stooq.com/__verify", data={"c": c, "n": n}, timeout=20)
    return s


def _fetch_one(sess: requests.Session, ticker: str, d1: str, d2: str) -> pd.Series | None:
    sym = f"{ticker.lower().replace('.', '-')}.us"
    url = f"https://stooq.com/q/d/l/?s={sym}&i=d&d1={d1}&d2={d2}"
    for _ in range(2):
        r = sess.get(url, timeout=20)
        if r.text.lstrip().startswith("<") and "crypto.subtle" in r.text:
            solved = _solve_challenge(r.text)
            if solved:
                sess.post("https://stooq.com/__verify",
                          data={"c": solved[0], "n": solved[1]}, timeout=20)
            continue
        if not r.ok or "no data" in r.text.lower():
            return None
        try:
            df = pd.read_csv(io.StringIO(r.text), parse_dates=["Date"])
        except Exception:
            return None
        if df.empty or "Close" not in df.columns:
            return None
        return df.set_index("Date")["Close"].rename(ticker)
    return None


def get_prices(tickers: list[str], start: str, end: str, *, refresh: bool = False) -> pd.DataFrame:
    """Daily close for `tickers`, date-indexed, one column per ticker.
    Tickers with no history are dropped (and printed)."""
    path = CACHE_DIR / f"prices_{start}_{end}.csv"
    if path.exists() and not refresh:
        cached = pd.read_csv(path, index_col=0, parse_dates=True)
        if set(tickers).issubset(cached.columns):
            return cached[tickers]

    sess = _make_session()
    d1, d2 = start.replace("-", ""), end.replace("-", "")
    series, missing = [], []
    for i, t in enumerate(sorted(set(tickers))):
        if i:
            time.sleep(0.3)
        s = _fetch_one(sess, t, d1, d2)
        if s is not None and len(s) > 20:
            series.append(s)
        else:
            missing.append(t)

    if missing:
        print(f"[data] no Stooq history for: {', '.join(missing)}")
    if not series:
        raise RuntimeError("Stooq returned no data for any ticker")

    prices = pd.concat(series, axis=1).sort_index().ffill()
    prices.to_csv(path)
    return prices[[t for t in tickers if t in prices.columns]]
