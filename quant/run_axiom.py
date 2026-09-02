"""Backtest the Axiom rulebook skeleton vs just holding the index.

    python run_axiom.py [start] [end]

This is the §9 honesty check: strip out the council's judgment, run the
mechanical rules (50/50 Core/Satellite, 200-day entry gate, momentum satellite,
caps), and see whether it clears "just buy QQQ and hold".
"""
from __future__ import annotations

import sys

import pandas as pd

from app import strategies
from app.backtest import run_backtest
from app.data import get_prices
from app.universe import (
    AXIOM_UNIVERSE, CORE_LIST, SATELLITE_POOL,
    ENTRY_MA_DAYS, NAME_CAP_SATELLITE, SPLIT_CORE,
)

pd.set_option("display.width", 220)


def main() -> None:
    start = sys.argv[1] if len(sys.argv) > 1 else "2013-01-01"
    end = sys.argv[2] if len(sys.argv) > 2 else "2025-08-01"

    prices = get_prices(AXIOM_UNIVERSE, start, end)
    print(f"Prices: {prices.shape[1]} tickers, {prices.index[0].date()}..{prices.index[-1].date()}\n")

    candidates = {
        "Buy & hold QQQ": strategies.buy_and_hold(prices, ["QQQ"]),
        "Buy & hold SPY": strategies.buy_and_hold(prices, ["SPY"]),
        "Axiom Core-12 only": strategies.core_quality_hold(prices, CORE_LIST, entry_ma_days=ENTRY_MA_DAYS),
        "Axiom rulebook (50/50, rules only)": strategies.axiom_5050(
            prices, CORE_LIST, SATELLITE_POOL,
            split_core=SPLIT_CORE, entry_ma_days=ENTRY_MA_DAYS, name_cap_sat=NAME_CAP_SATELLITE,
        ),
    }

    qqq = prices["QQQ"].pct_change().dropna()
    rows = []
    for name, w in candidates.items():
        res = run_backtest(prices, w, name=name)
        m = res.metrics
        m["corr_qqq"] = round(float(res.equity.pct_change().dropna().corr(qqq)), 2)
        rows.append({"strategy": name, **m})

    df = pd.DataFrame(rows).set_index("strategy")
    df["vs_qqq"] = (df["cagr"] - df.loc["Buy & hold QQQ", "cagr"]).round(4)
    cols = ["cagr", "vs_qqq", "max_drawdown", "sharpe", "sortino", "vol_annual",
            "pct_positive_months", "worst_month", "corr_qqq", "years"]
    print(df[cols].to_string())


if __name__ == "__main__":
    main()
