# Axiom Quant Service

A small FastAPI service that backtests the **mechanical skeleton of the Axiom
rulebook** (50/50 Core/Satellite, 200-day entry gate, momentum satellite sleeve,
sector/name caps) against just holding QQQ — the §9 honesty check. No LLM: this
is the rules-only floor the council's judgment is meant to beat.

## Local

```bash
cd quant
python -m venv .venv && .venv/Scripts/activate    # or: source .venv/bin/activate
pip install -r requirements.txt
echo "TIINGO_TOKEN=..." > .env
python run_axiom.py                    # prints the comparison table
uvicorn app.main:app --reload          # http://localhost:8000/docs
```

## Endpoints

| Route | What |
|---|---|
| `GET /health` | liveness + whether Tiingo is configured |
| `POST /backtest` `{start,end}` | metrics for QQQ / SPY / Core-only / Axiom-50-50 + a plain-English verdict. Cached in-process. |
| `GET /holdings-now` | what the mechanical satellite sleeve would hold today (momentum sanity check for DCA) |

All routes except `/health` require the `x-api-key` header (`QUANT_API_KEY`).

## Deploy (Render, 3rd service)

`render.yaml` in this dir is a blueprint. Or manually: Web Service, root `quant`,
Python, build `pip install -r requirements.txt`, start
`uvicorn app.main:app --host 0.0.0.0 --port $PORT`.

Set `TIINGO_TOKEN` (use a **separate** token from the Node app's) and
`QUANT_API_KEY`. Then in the `axiom` Node service set `QUANT_URL` (this service's
URL) and the same `QUANT_API_KEY`.

**Note:** Render's free disk is ephemeral — `.cache/*.csv` won't survive a
restart, so the first `/backtest` after a cold start re-fetches the universe
(~45s, ~47 Tiingo calls). To make it instant + rate-limit-proof, commit a
complete `quant/.cache/prices_<start>_<end>.csv` to the repo once fetched.

## First-run TODO

The committed price cache is missing ~25 of the Axiom universe (post-2009 IPOs:
META, TSLA, SNOW, COIN, PLTR, ARM, …). Run `python run_axiom.py` once the Tiingo
hourly limit is clear to backfill + re-cache, then commit the CSV.
