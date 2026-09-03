"""Regenerate server/data/backtest.json — the static backtest result the app
serves when there's no live quant service.

    cd quant && python refresh.py

Run it every month or so, then commit server/data/backtest.json. Needs
TIINGO_TOKEN in quant/.env; falls back to whatever's already cached if the
provider is rate-limited (the result is then flagged partial).
"""
from __future__ import annotations

import datetime
import json
from pathlib import Path

import pandas as pd

from app import strategies
from app.backtest import run_backtest
from app.data import get_prices, CACHE_DIR
from app.universe import (
    AXIOM_UNIVERSE, CORE_LIST, SATELLITE_POOL,
    ENTRY_MA_DAYS, NAME_CAP_SATELLITE, SPLIT_CORE,
)

START, END = "2013-01-01", "2025-08-01"
OUT = Path(__file__).resolve().parent.parent / "server" / "data" / "backtest.json"


def _prices() -> pd.DataFrame:
    try:
        return get_prices(AXIOM_UNIVERSE, "2009-06-01", END)
    except SystemExit:
        # rate-limited mid-fetch — use whatever's cached
        for p in sorted(CACHE_DIR.glob("prices_*_*.csv")):
            df = pd.read_csv(p, index_col=0, parse_dates=True)
            if "QQQ" in df.columns:
                return df
        raise


def main() -> None:
    full = _prices()
    px = full.loc[START:END]
    core = [t for t in CORE_LIST if t in px.columns]
    pool = [t for t in SATELLITE_POOL if t in px.columns]
    partial = len(core) < len(CORE_LIST) or len(pool) < len(SATELLITE_POOL)

    cands = {
        "Buy & hold QQQ": strategies.buy_and_hold(px, ["QQQ"]),
        "Buy & hold SPY": strategies.buy_and_hold(px, ["SPY"]),
        "Axiom Core-12 only": strategies.core_quality_hold(px, core, entry_ma_days=ENTRY_MA_DAYS),
        "Axiom rulebook (50/50, rules only)": strategies.axiom_5050(
            px, core, pool, split_core=SPLIT_CORE, entry_ma_days=ENTRY_MA_DAYS, name_cap_sat=NAME_CAP_SATELLITE,
        ),
    }

    qqq = px["QQQ"].pct_change().dropna()
    rows = []
    for name, w in cands.items():
        res = run_backtest(px, w, name=name)
        m = res.metrics
        m["corr_qqq"] = round(float(res.equity.pct_change().dropna().corr(qqq)), 2)
        rows.append({"strategy": name, **m})

    df = pd.DataFrame(rows).set_index("strategy")
    df["vs_qqq_cagr"] = (df["cagr"] - df.loc["Buy & hold QQQ", "cagr"]).round(4)

    axiom = "Axiom rulebook (50/50, rules only)"
    edge = df.loc[axiom, "vs_qqq_cagr"] * 100
    dda, ddq = df.loc[axiom, "max_drawdown"], df.loc["Buy & hold QQQ", "max_drawdown"]
    yrs = float(df["years"].iloc[0])
    if edge > 1.5:
        head = f"The rules-only skeleton beat QQQ by {edge:+.1f}%/yr"
    elif edge < -1.5:
        head = f"The rules-only skeleton LAGGED QQQ by {edge:+.1f}%/yr"
    else:
        head = f"The rules-only skeleton roughly matched QQQ ({edge:+.1f}%/yr)"
    verdict = (f"{head} over {yrs:.0f} years, max drawdown {dda:.0%} vs QQQ {ddq:.0%}. "
               f"Rules only, no council judgment, before tax and slippage. The satellite universe is "
               f"large-cap tech/growth names that traded before 2009, so it's not cherry-picked, but "
               f"monthly rebalancing this in a taxable account would give back a chunk of the edge.")
    if partial:
        verdict += (f" (Partial data — satellite pool {len(pool)}/{len(SATELLITE_POOL)} names available.)")

    # What the mechanical 50/50 sleeve would hold today — a momentum cross-check
    # for the council: names it's rotating INTO that you don't own may be worth a
    # look; names it's rotating OUT of that you hold are a yellow flag.
    axiom_w = cands[axiom]
    last = axiom_w.iloc[-1]
    holds_now = {t: round(float(w), 4) for t, w in last[last > 0].sort_values(ascending=False).items()}

    out = {
        "start": str(px.index[0].date()), "end": str(px.index[-1].date()),
        "years": round(yrs, 1), "generatedAt": datetime.date.today().isoformat(),
        "partialUniverse": partial, "coreNames": core, "satelliteNames": pool,
        "rows": df.reset_index().to_dict(orient="records"),
        "verdict": verdict,
        "rulesHoldNow": {"asOf": str(axiom_w.index[-1].date()), "weights": holds_now},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"wrote {OUT}\n")
    print(df[["cagr", "vs_qqq_cagr", "max_drawdown", "sharpe", "years"]].to_string())


if __name__ == "__main__":
    main()
