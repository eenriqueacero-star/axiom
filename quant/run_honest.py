"""Honest-ish backtest: the momentum METHOD on a fixed ~120 large-cap universe,
2010-2025, through the 2011 / 2015-16 / 2018 / 2020 / 2022 drawdowns.

Not survivorship-free (the 120 are today's large caps) but far fairer than
testing on a hand-picked winner list, and it covers real bear markets.

Usage:  python run_honest.py [start] [end]
"""
from __future__ import annotations

import sys

import pandas as pd

from app import strategies
from app.backtest import run_backtest
from app.data import get_prices
from app.universe import BENCHMARKS, CASH_PROXY, LIQUID_120

pd.set_option("display.width", 240)


def main() -> None:
    start = sys.argv[1] if len(sys.argv) > 1 else "2009-06-01"
    end = sys.argv[2] if len(sys.argv) > 2 else "2025-08-01"

    universe = sorted(set(LIQUID_120 + BENCHMARKS + [CASH_PROXY]))
    print(f"Universe: {len(universe)} tickers, {start}..{end}")
    prices = get_prices(universe, start, end)
    print(f"Prices: {prices.shape[1]}/{len(universe)} tickers, "
          f"{prices.index[0].date()}..{prices.index[-1].date()}\n")

    tradeable = [t for t in LIQUID_120 if t in prices.columns]

    candidates = {
        "Buy & hold SPY": strategies.buy_and_hold(prices, ["SPY"]),
        "Buy & hold QQQ": strategies.buy_and_hold(prices, ["QQQ"]),
        "Buy & hold the 120 (equal wt)": strategies.buy_and_hold(prices, tradeable),
        "Momentum top15 / 6mo / trend filter": strategies.relative_momentum(
            prices, tradeable, lookback_days=126, top_n=15, trend_ma_days=200),
        "Momentum top15 / 12mo / trend filter": strategies.relative_momentum(
            prices, tradeable, lookback_days=252, top_n=15, trend_ma_days=200),
        "Momentum top25 / 12mo / trend filter": strategies.relative_momentum(
            prices, tradeable, lookback_days=252, top_n=25, trend_ma_days=200),
        "Momentum top15 / 12mo / NO trend filter": strategies.relative_momentum(
            prices, tradeable, lookback_days=252, top_n=15, trend_ma_days=None),
        "Dual momentum SPY/cash 12mo": strategies.dual_momentum(
            prices, risk_asset="SPY", safe_asset=CASH_PROXY, lookback_days=252),
    }

    spy_ret = prices["SPY"].pct_change().dropna()
    rows = []
    for name, weights in candidates.items():
        res = run_backtest(prices, weights, name=name)
        m = res.metrics
        m["corr_spy"] = round(float(res.equity.pct_change().dropna().corr(spy_ret)), 2)
        m["vs_spy_cagr"] = None
        rows.append({"strategy": name, **m})

    df = pd.DataFrame(rows).set_index("strategy")
    spy_cagr = df.loc["Buy & hold SPY", "cagr"]
    df["vs_spy_cagr"] = (df["cagr"] - spy_cagr).round(4)
    cols = ["cagr", "vs_spy_cagr", "max_drawdown", "sharpe", "sortino",
            "vol_annual", "pct_positive_months", "worst_month", "corr_spy", "years"]
    print(df[cols].to_string())


if __name__ == "__main__":
    main()
