"""Point-in-time S&P 500 membership (fja05680/sp500 dataset).

Lets the backtest only consider stocks that were actually in the index on each
rebalance date — kills survivorship bias.
"""
from __future__ import annotations

import re
from pathlib import Path

import pandas as pd
import requests

CACHE = Path(__file__).resolve().parent.parent / ".cache"
CACHE.mkdir(exist_ok=True)
_CSV = CACHE / "sp500_changes.csv"
_URL = (
    "https://raw.githubusercontent.com/fja05680/sp500/master/"
    "S%26P%20500%20Historical%20Components%20%26%20Changes.csv"
)


def _load() -> pd.DataFrame:
    if not _CSV.exists():
        _CSV.write_bytes(requests.get(_URL, timeout=30).content)
    df = pd.read_csv(_CSV)
    df["date"] = pd.to_datetime(df["date"])
    return df.sort_values("date").reset_index(drop=True)


_DF = _load()


def _clean(tickers: str) -> set[str]:
    out = set()
    for t in tickers.split(","):
        t = re.sub(r"-\d+$", "", t.strip())        # strip "-YYYYMM" change marker
        t = t.replace(".", "-")                      # BRK.B -> BRK-B (Tiingo style)
        if t:
            out.add(t)
    return out


def members_on(date) -> set[str]:
    """S&P 500 tickers as of `date` (last snapshot on-or-before it)."""
    date = pd.Timestamp(date)
    rows = _DF[_DF["date"] <= date]
    if rows.empty:
        rows = _DF.iloc[:1]
    return _clean(rows.iloc[-1]["tickers"])


def all_members_since(date) -> list[str]:
    """Every ticker that was ever an S&P 500 member on/after `date` — the full
    set the backtest may need prices for."""
    date = pd.Timestamp(date)
    seen: set[str] = set()
    for _, row in _DF[_DF["date"] >= date - pd.Timedelta(days=400)].iterrows():
        seen |= _clean(row["tickers"])
    return sorted(seen)
