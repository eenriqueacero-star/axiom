"""Axiom quant service — FastAPI.

Runs backtests of the Axiom rulebook skeleton against the index, and reports
what the mechanical satellite sleeve would hold today. The Node app calls this;
the council reads the result as context ("here's the rules-only floor — you're
the judgment layer meant to beat it").

Start:  uvicorn app.main:app --host 0.0.0.0 --port $PORT
Auth:   set QUANT_API_KEY; callers pass it as the `x-api-key` header.
"""
from __future__ import annotations

import os
from functools import lru_cache

import pandas as pd
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from app import strategies
from app.backtest import run_backtest
from app.data import get_prices
from app.universe import (
    AXIOM_UNIVERSE, CORE_LIST, SATELLITE_POOL, CASH_PROXY,
    ENTRY_MA_DAYS, NAME_CAP_SATELLITE, SPLIT_CORE,
)

app = FastAPI(title="Axiom Quant", version="1.0")

DEFAULT_START = "2013-01-01"   # covers 2015-16, 2018, 2020, 2022 drawdowns; most satellites exist
DEFAULT_END = "2025-08-01"


def _check_key(x_api_key: str | None) -> None:
    want = os.environ.get("QUANT_API_KEY")
    if want and x_api_key != want:
        raise HTTPException(status_code=401, detail="bad or missing x-api-key")


def _build(prices: pd.DataFrame) -> dict[str, pd.DataFrame]:
    return {
        "Buy & hold QQQ": strategies.buy_and_hold(prices, ["QQQ"]),
        "Buy & hold SPY": strategies.buy_and_hold(prices, ["SPY"]),
        "Axiom Core-12 only": strategies.core_quality_hold(prices, CORE_LIST, entry_ma_days=ENTRY_MA_DAYS),
        "Axiom rulebook (50/50, rules only)": strategies.axiom_5050(
            prices, CORE_LIST, SATELLITE_POOL,
            split_core=SPLIT_CORE, entry_ma_days=ENTRY_MA_DAYS, name_cap_sat=NAME_CAP_SATELLITE,
        ),
    }


@lru_cache(maxsize=8)
def _run(start: str, end: str) -> dict:
    prices = get_prices(AXIOM_UNIVERSE, start, end)
    bench = prices["QQQ"].pct_change().dropna()
    strat = _build(prices)

    rows = []
    for name, weights in strat.items():
        res = run_backtest(prices, weights, name=name)
        m = res.metrics
        m["corr_qqq"] = round(float(res.equity.pct_change().dropna().corr(bench)), 2)
        rows.append({"strategy": name, **m})

    df = pd.DataFrame(rows).set_index("strategy")
    qqq_cagr = df.loc["Buy & hold QQQ", "cagr"]
    df["vs_qqq_cagr"] = (df["cagr"] - qqq_cagr).round(4)

    verdict = _plain_verdict(df)
    return {
        "start": str(prices.index[0].date()),
        "end": str(prices.index[-1].date()),
        "years": float(df["years"].iloc[0]),
        "rows": df.reset_index().to_dict(orient="records"),
        "verdict": verdict,
    }


def _plain_verdict(df: pd.DataFrame) -> str:
    edge = df.loc["Axiom rulebook (50/50, rules only)", "vs_qqq_cagr"]
    dd_axiom = df.loc["Axiom rulebook (50/50, rules only)", "max_drawdown"]
    dd_qqq = df.loc["Buy & hold QQQ", "max_drawdown"]
    if edge is None:
        return "Not enough data."
    e = edge * 100
    if e > 1.5:
        head = f"The rules-only skeleton beat QQQ by {e:+.1f}%/yr"
    elif e < -1.5:
        head = f"The rules-only skeleton LAGGED QQQ by {e:+.1f}%/yr"
    else:
        head = f"The rules-only skeleton roughly matched QQQ ({e:+.1f}%/yr)"
    dd = f"max drawdown {dd_axiom:+.0%} vs QQQ {dd_qqq:+.0%}"
    return (f"{head} over {df['years'].iloc[0]:.0f} years, {dd}. "
            f"This is BEFORE the council's judgment overlay and before tax — the honest floor.")


class BacktestReq(BaseModel):
    start: str = Field(default=DEFAULT_START)
    end: str = Field(default=DEFAULT_END)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "universe": len(AXIOM_UNIVERSE), "tiingo": bool(os.environ.get("TIINGO_TOKEN"))}


@app.post("/backtest")
def backtest(req: BacktestReq, x_api_key: str | None = Header(default=None)) -> dict:
    _check_key(x_api_key)
    try:
        return _run(req.start, req.end)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"backtest failed: {e}")


@app.get("/holdings-now")
def holdings_now(x_api_key: str | None = Header(default=None)) -> dict:
    """What the mechanical satellite sleeve would hold today — a momentum sanity
    check for the DCA engine and the council."""
    _check_key(x_api_key)
    try:
        prices = get_prices(AXIOM_UNIVERSE, DEFAULT_START, DEFAULT_END)
        w = strategies.axiom_5050(
            prices, CORE_LIST, SATELLITE_POOL,
            split_core=SPLIT_CORE, entry_ma_days=ENTRY_MA_DAYS, name_cap_sat=NAME_CAP_SATELLITE,
        )
        last = w.iloc[-1]
        held = {t: round(float(x), 4) for t, x in last[last > 0].sort_values(ascending=False).items()}
        return {"asOf": str(w.index[-1].date()), "targetWeights": held, "cash": round(1 - sum(held.values()), 4)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"holdings-now failed: {e}")
