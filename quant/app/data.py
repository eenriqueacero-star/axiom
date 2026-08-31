"""Historical daily price data via Tiingo (free tier, broad coverage).

Free tier: ~1000 req/day, stocks + ETFs, decades of split/dividend-adjusted
history. Fine for backtests. Live trading signals use Finnhub/other providers.
Set TIINGO_TOKEN in the environment (quant/.env for local).
"""
from __future__ import annotations

import os
import time
from pathlib import Path

import pandas as pd
import requests

CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache"
CACHE_DIR.mkdir(exist_ok=True)

_BASE = "https://api.tiingo.com/tiingo/daily/{ticker}/prices"


def _load_env() -> None:
    env = Path(__file__).resolve().parent.parent / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def _token() -> str:
    _load_env()
    t = os.environ.get("TIINGO_TOKEN")
    if not t:
        raise RuntimeError("TIINGO_TOKEN not set (put it in quant/.env)")
    return t


class RateLimited(Exception):
    pass


def _fetch_one(sess: requests.Session, ticker: str, start: str, end: str) -> pd.Series | None:
    r = sess.get(
        _BASE.format(ticker=ticker),
        params={"startDate": start, "endDate": end, "token": _token(), "format": "json"},
        timeout=25,
    )
    if r.status_code == 429:
        raise RateLimited(r.text[:200])
    if not r.ok:
        return None
    data = r.json()
    if not isinstance(data, list) or not data:
        return None
    df = pd.DataFrame(data)
    col = "adjClose" if "adjClose" in df.columns else "close"
    s = pd.Series(df[col].values, index=pd.to_datetime(df["date"]).dt.tz_localize(None), name=ticker)
    return s.sort_index()


def get_prices(tickers: list[str], start: str, end: str, *, refresh: bool = False) -> pd.DataFrame:
    """Split/dividend-adjusted daily close for `tickers`, date-indexed,
    one column per ticker. Tickers with no history are dropped (and printed)."""
    path = CACHE_DIR / f"prices_{start}_{end}.csv"
    if path.exists() and not refresh:
        cached = pd.read_csv(path, index_col=0, parse_dates=True)
        if set(tickers).issubset(cached.columns):
            return cached[tickers]

    # resume: keep a partial cache so a rate-limit interruption isn't wasted
    partial = CACHE_DIR / f"prices_{start}_{end}_partial.csv"
    have = {}
    if partial.exists():
        pf = pd.read_csv(partial, index_col=0, parse_dates=True)
        have = {c: pf[c] for c in pf.columns}

    sess = requests.Session()
    todo = [t for t in sorted(set(tickers)) if t not in have]
    missing = []
    try:
        for i, t in enumerate(todo):
            if i:
                time.sleep(0.9)  # ~40/min, well under 500/hr
            s = _fetch_one(sess, t, start, end)
            if s is not None and len(s) > 20:
                have[t] = s
            else:
                missing.append(t)
    except RateLimited as e:
        print(f"[data] rate-limited after {len(have)} tickers — saving partial, retry later")
        pd.concat(have.values(), axis=1).sort_index().to_csv(partial)
        raise SystemExit(1)

    if missing:
        print(f"[data] no Tiingo history for: {', '.join(missing)}")
    if not have:
        raise RuntimeError("Tiingo returned no data for any ticker")

    prices = pd.concat(have.values(), axis=1).sort_index().ffill()
    prices.to_csv(path)
    partial.unlink(missing_ok=True)
    return prices[[t for t in tickers if t in prices.columns]]
