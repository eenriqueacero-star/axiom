# Axiom — Master TODO / Backlog

Living list. Keep it current. Newer thinking in `project_axiom_roadmap` memory.

---

## ⭐ Hard requirements (never drop)

- **AI agents must be able to interact with and engage the entire app UI.** Not just
  verdict generators — they navigate views, populate/filter screens, surface analyses,
  respond to what the user is looking at, act in-app on the user's behalf. Every UI
  surface must be agent-addressable (a callable action/tool), designed with an
  agent-facing interface from the start.
- Everything syncs across devices in real time (Firestore). Server does compute + writes;
  client is a thin view.
- Commit + push after every working phase (user works PC + phone).
- Honest before impressive — measure strategies against "just buy the index" before
  building around them.

---

## Blocked / in progress

- [~] **Honest backtest running** — momentum method on ~120 large caps, 2010-2025,
  through real crashes. Waiting on Tiingo rate-limit reset, then auto-runs. This
  result gates the strategy-rebuild decision.

## Next big decisions (need the backtest first)

- [ ] **Go / no-go on a mechanical strategy core.** If momentum beats the index after
  removing bias → rebuild Axiom around it. If not → simplify (DCA into an index) and
  focus the app on tracking + catalysts, not stock-picking.
- [ ] **Rebuild the strategy core** around the winner. Likely shape: mechanical
  momentum/trend core + LLM agents as a news/risk/catalyst overlay. Retire or re-weight
  the brittle 4-gate design.
- [ ] **Proper point-in-time backtest** (full S&P 500 historical membership, longer
  history) if the quick pass looks promising — `constituents.py` already built.

## Quant service (Python, `quant/`)

- [x] Scaffolded — backtest engine, strategy generators, Tiingo data, PIT constituents.
- [ ] Wrap as a FastAPI service so the Node app + agents can call it (`/backtest`, etc.).
- [ ] Deploy as a 3rd Render service.
- [ ] Momentum ranking endpoint for live use (which names does the strategy hold now).
- [ ] Rate-limit-proof data layer (Tiingo free = 500/hr; cache hard, maybe add a
  fallback provider).

## Strategy / agent methodology

- [ ] Give REX (technical agent) real price bars or code-computed trend, not a guess
  from one price point.
- [ ] Replace hard AND-gates with a weighted 0-100 score + threshold (smoother, tunable).
- [ ] Agent self-improvement loop — nightly: AXIOM reviews the week's calls vs price
  action, writes per-agent calibration notes prepended to prompts. (Mine TradingAgents'
  reflection-loop design.)
- [ ] Majority-vote mode for forced re-runs (only if the 6h cache proves insufficient).
- [ ] Backtest the current 4-Gate + Sell Protocol specifically vs buy-and-hold.

## Features

- [x] **News feed (v1)** — `server/lib/signals.js` marketNews + tickerNews via Finnhub;
  `/api/signals/*`; NewsPanel under the agent cards. Congress/SEC still TODO.
- [ ] **Events service — remaining**: SEC EDGAR 8-K, Fed/econ/FDA calendars, persist to
  Firestore `signals`, feed NOVA agent context, push alerts on holdings hits.
- [ ] **Congressional trading tracker** — BLOCKED on data source. Free sources dead in
  2026 (old S3/github datasets gone; CongressInvests API rate-shared + 3mo stale).
  Decide: Disclosed Capitol free-tier signup, Quiver $25/mo, or defer.
- [ ] **Live verdict scorecard** — track every real verdict vs forward returns; per-agent
  hit rate; feeds the self-improvement loop.
- [ ] **Paper-portfolio of AXIOM's own calls** — makes "the edge" a real number.
- [ ] Watchlist + auto-scan (scout job exists) → daily conviction-ranked digest push.
- [ ] Portfolio / accounts view (Edwin / Dad / Bro holdings already in definitions.js).
- [ ] Rulings log (user decisions + rationale) — CRUD, was in old the-council.
- [ ] Quotes / news panel per ticker.
- [ ] Agent chat — talk to AXIOM, and it can drive the UI (ties to the hard requirement).

## Infra / polish

- [ ] **Notification system rework** — Web Push delivery is unreliable. Stale
  subscriptions not pruned, SW lifecycle on mobile, single-subscription model, no
  retry/logging, iOS PWA constraints.
- [ ] PWA manifest + service worker → installable on phone, enables push.
- [ ] Client code-split (bundle ~580KB, mostly Firebase).
- [ ] SPA routing + `/*` → index.html rewrite on the static site (when multi-view).
- [ ] Decide: port Node backend → Python later, or keep the two-service split.
- [ ] Evaluate paid data/MCP (Quiver, FMP paid, Twelve Data) once free tier limits bite.
- [ ] Retire the Node `/api/agent` raw route if nothing uses it after the council rework.

## Done ✅

- Backend live (axiom-u58i.onrender.com), boot-safe, all env vars set.
- v1 client live (axiom-client.onrender.com) — Google auth, council run, 6 agent cards +
  AXIOM verdict, realtime Firestore "Recent" list.
- Server-side council orchestration + Firestore persistence for cross-device sync.
- Groq key health endpoint (/api/status/groq-keys).
- Verdict stability: temperature:0 + seed, + 6h reuse cache per ticker (force to override).
- Fixed: Finnhub earnings-calendar 302→HTML was crashing every run.
- Firebase: Google sign-in enabled, domain authorized, Firestore rules verified.
- Strategy research done (momentum/trend/dual-momentum evidence) — see roadmap memory.
- Public projects surveyed for reuse (TradingAgents, ai-hedge-fund, congress data) —
  see roadmap memory.
- Quant service scaffolded; first (biased) backtest run.
- System status view in the app — health flags + per-Groq-key health (header dot).
