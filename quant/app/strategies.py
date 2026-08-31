"""Candidate strategies. Each returns a target-weights DataFrame
(rebalance dates x tickers) to feed run_backtest.
"""
from __future__ import annotations

import pandas as pd


def _month_ends(index: pd.DatetimeIndex) -> pd.DatetimeIndex:
    """Last available trading day of each month in `index`."""
    s = pd.Series(index, index=index)
    return pd.DatetimeIndex(s.resample("ME").last().dropna().values)


def buy_and_hold(prices: pd.DataFrame, tickers: list[str]) -> pd.DataFrame:
    """Equal-weight `tickers` on day 1, never rebalance."""
    tickers = [t for t in tickers if t in prices.columns]
    w = pd.DataFrame(0.0, index=[prices.index[0]], columns=tickers)
    w.iloc[0] = 1.0 / len(tickers)
    return w


def relative_momentum(
    prices: pd.DataFrame,
    universe: list[str],
    *,
    lookback_days: int = 126,
    top_n: int = 5,
    trend_ma_days: int | None = 200,
) -> pd.DataFrame:
    """Monthly: hold the top_n names by trailing return, each also above its
    `trend_ma_days` SMA. Names failing the trend filter go to cash.
    """
    universe = [t for t in universe if t in prices.columns]
    px = prices[universe]
    warmup = max(lookback_days, trend_ma_days or 0) + 5
    rebal = _month_ends(px.index)
    rebal = rebal[rebal >= px.index[warmup]]

    rows = {}
    for d in rebal:
        window = px.loc[:d]
        mom = window.iloc[-1] / window.iloc[-lookback_days] - 1
        # only rank names with a full lookback of real (non-NaN) data
        valid = window.iloc[-lookback_days].notna()
        ranked = mom[valid].dropna().sort_values(ascending=False)
        picks = list(ranked.index[:top_n])

        if trend_ma_days:
            ma = window[picks].rolling(trend_ma_days).mean().iloc[-1]
            picks = [t for t in picks if window[t].iloc[-1] > ma[t]]

        w = pd.Series(0.0, index=universe)
        if picks:
            w[picks] = 1.0 / len(picks)   # remainder (dropped picks) stays cash
        rows[d] = w

    return pd.DataFrame(rows).T


def relative_momentum_pit(
    prices: pd.DataFrame,
    members_on,
    *,
    lookback_days: int = 126,
    top_n: int = 15,
    trend_ma_days: int | None = 200,
    skip_recent_days: int = 21,
) -> pd.DataFrame:
    """Point-in-time momentum. At each month-end, rank only the tickers that
    were index members then (and have data), by trailing return excluding the
    most recent `skip_recent_days` (classic momentum skips the last month).
    """
    px = prices
    warmup = max(lookback_days, trend_ma_days or 0) + skip_recent_days + 5
    rebal = _month_ends(px.index)
    rebal = rebal[rebal >= px.index[warmup]]

    rows = {}
    for d in rebal:
        window = px.loc[:d]
        elig = [t for t in members_on(d) if t in window.columns]
        if not elig:
            continue
        w = window[elig]
        past = w.iloc[-(lookback_days + skip_recent_days)]
        recent = w.iloc[-(skip_recent_days + 1)]
        mom = (recent / past - 1)[w.iloc[-(lookback_days + skip_recent_days)].notna()]
        ranked = mom.dropna().sort_values(ascending=False)
        picks = list(ranked.index[:top_n])

        if trend_ma_days:
            ma = w[picks].rolling(trend_ma_days).mean().iloc[-1]
            picks = [t for t in picks if w[t].iloc[-1] > ma[t]]

        vec = pd.Series(0.0, index=px.columns)
        if picks:
            vec[picks] = 1.0 / len(picks)
        rows[d] = vec

    return pd.DataFrame(rows).T


def dual_momentum(
    prices: pd.DataFrame,
    *,
    risk_asset: str = "QQQ",
    safe_asset: str = "BIL",
    lookback_days: int = 252,
) -> pd.DataFrame:
    """Monthly: if risk_asset's trailing return > safe_asset's, hold risk_asset;
    else hold safe_asset. Antonacci-style absolute momentum, single sleeve.
    """
    cols = [risk_asset, safe_asset]
    px = prices[cols]
    rebal = _month_ends(px.index)
    rebal = rebal[rebal >= px.index[lookback_days + 5]]

    rows = {}
    for d in rebal:
        window = px.loc[:d]
        trailing = window.iloc[-1] / window.iloc[-lookback_days] - 1
        pick = risk_asset if trailing[risk_asset] > trailing[safe_asset] else safe_asset
        w = pd.Series(0.0, index=cols)
        w[pick] = 1.0
        rows[d] = w

    return pd.DataFrame(rows).T
