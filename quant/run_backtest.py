"""Run every candidate strategy over a window and print a comparison table.

Usage:  python run_backtest.py [start] [end]
        python run_backtest.py 2021-01-01 2024-12-31
"""
from __future__ import annotations

import sys

import pandas as pd

from app import strategies
from app.backtest import run_backtest
from app.data import get_prices
from app.universe import BENCHMARKS, CASH_PROXY, HOLDINGS, UNIVERSE

pd.set_option("display.width", 200)
pd.set_option("display.max_columns", 20)


def main() -> None:
    start = sys.argv[1] if len(sys.argv) > 1 else "2021-01-01"
    end = sys.argv[2] if len(sys.argv) > 2 else "2025-08-01"

    tickers = sorted(set(UNIVERSE + BENCHMARKS + [CASH_PROXY]))
    print(f"Downloading {len(tickers)} tickers {start}..{end}")
    prices = get_prices(tickers, start, end)
    print(f"Got {prices.shape[1]} tickers, {prices.shape[0]} days\n")

    candidates = {
        "E: buy QQQ, hold": strategies.buy_and_hold(prices, ["QQQ"]),
        "E: hold current holdings (EW)": strategies.buy_and_hold(prices, HOLDINGS),
        "B: rel-mom top5 6mo +200dma": strategies.relative_momentum(
            prices, UNIVERSE, lookback_days=126, top_n=5, trend_ma_days=200
        ),
        "B: rel-mom top10 12mo +200dma": strategies.relative_momentum(
            prices, UNIVERSE, lookback_days=252, top_n=10, trend_ma_days=200
        ),
        "B: rel-mom top5 6mo, no trend filter": strategies.relative_momentum(
            prices, UNIVERSE, lookback_days=126, top_n=5, trend_ma_days=None
        ),
        "A: dual-momentum QQQ/BIL 12mo": strategies.dual_momentum(
            prices, risk_asset="QQQ", safe_asset=CASH_PROXY, lookback_days=252
        ),
    }

    spy = prices["SPY"].pct_change().dropna()
    rows = []
    for name, weights in candidates.items():
        res = run_backtest(prices, weights, name=name)
        m = res.metrics
        corr = res.equity.pct_change().dropna().corr(spy)
        m["corr_spy"] = round(float(corr), 2)
        rows.append({"strategy": name, **m})

    # Benchmark row for reference
    bench = run_backtest(prices, strategies.buy_and_hold(prices, ["SPY"]), name="SPY")
    rows.append({"strategy": "— SPY (benchmark) —", **bench.metrics, "corr_spy": 1.0})

    df = pd.DataFrame(rows).set_index("strategy")
    order = ["cagr", "total_return", "max_drawdown", "sharpe", "sortino",
             "vol_annual", "pct_positive_months", "worst_month", "corr_spy", "years"]
    print(df[order].to_string())


if __name__ == "__main__":
    main()
