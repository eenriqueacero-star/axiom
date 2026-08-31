"""A small, readable backtest engine. Monthly-ish rebalance, long-only.

Not vectorbt — deliberately simple so every number is auditable. Handles the
scale we care about (dozens of tickers, a few years, monthly rebalance).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

TRADING_DAYS = 252


@dataclass
class Result:
    name: str
    equity: pd.Series        # daily portfolio value, starts at 1.0
    weights: pd.DataFrame    # target weights on rebalance dates

    @property
    def metrics(self) -> dict:
        return compute_metrics(self.equity)


def run_backtest(
    prices: pd.DataFrame,
    target_weights: pd.DataFrame,
    *,
    name: str = "strategy",
    cost_bps: float = 5.0,
) -> Result:
    """Simulate holding `target_weights` (set on its index dates), drifting between.

    prices: daily adjusted close, columns = tickers.
    target_weights: rows on rebalance dates, columns ⊆ prices.columns, rows sum ≤ 1
                    (remainder is cash, 0% return).
    """
    prices = prices.sort_index()
    rets = prices.pct_change().fillna(0.0)

    cols = list(target_weights.columns)
    dates = prices.index[prices.index >= target_weights.index[0]]
    cost = cost_bps / 1e4

    pos = pd.Series(0.0, index=cols)   # dollar value per asset
    cash = 1.0
    rebal_dates = set(target_weights.index)
    equity = pd.Series(index=dates, dtype=float)
    prev_w = pd.Series(0.0, index=cols)

    for d in dates:
        pos *= (1.0 + rets.loc[d, cols])          # drift holdings
        total = pos.sum() + cash

        if d in rebal_dates:
            tgt = target_weights.loc[d].reindex(cols).fillna(0.0)
            turnover = (tgt - prev_w).abs().sum()
            total *= (1.0 - cost * turnover)
            pos = total * tgt
            cash = total - pos.sum()
            prev_w = tgt

        equity.loc[d] = pos.sum() + cash

    return Result(name=name, equity=equity, weights=target_weights)


def compute_metrics(equity: pd.Series) -> dict:
    equity = equity.dropna()
    if len(equity) < 2:
        return {}
    rets = equity.pct_change().dropna()
    years = (equity.index[-1] - equity.index[0]).days / 365.25
    total = equity.iloc[-1] / equity.iloc[0] - 1
    cagr = (equity.iloc[-1] / equity.iloc[0]) ** (1 / years) - 1 if years > 0 else np.nan
    vol = rets.std() * np.sqrt(TRADING_DAYS)
    sharpe = (rets.mean() * TRADING_DAYS) / vol if vol else np.nan
    downside = rets[rets < 0].std() * np.sqrt(TRADING_DAYS)
    sortino = (rets.mean() * TRADING_DAYS) / downside if downside else np.nan
    dd = equity / equity.cummax() - 1
    monthly = equity.resample("ME").last().pct_change().dropna()

    return {
        "total_return": round(float(total), 4),
        "cagr": round(float(cagr), 4),
        "max_drawdown": round(float(dd.min()), 4),
        "vol_annual": round(float(vol), 4),
        "sharpe": round(float(sharpe), 2),
        "sortino": round(float(sortino), 2),
        "pct_positive_months": round(float((monthly > 0).mean()), 3),
        "worst_month": round(float(monthly.min()), 4),
        "best_month": round(float(monthly.max()), 4),
        "years": round(float(years), 2),
    }
