# Axiom — Master TODO / Backlog

Living list. Keep it current. Newer thinking in `project_axiom_roadmap` memory.

---

## ⭐ Hard requirements (never drop)

- **EVERYTHING MUST BE CONNECTED.** No isolated features. Every piece feeds the others —
  news → agents; backtest → strategy → agents; scorecard → agent learning; signals →
  notifications → holdings; agent chat → every view. If a feature doesn't wire into the
  rest of the system, it isn't done. Build the connections, not just the boxes.
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

## DECIDED (2026-08-31): Axiom = long-term quality-basket manager, NOT a trading bot

Backtest verdict: momentum's edge over "equal-weight the same universe + hold" is only
~2% gross, eaten by taxes/costs for a small retail account. No downside protection.
Real lever = stock SELECTION + holding + low turnover. So:

- [~] **Portfolio view** — holdings are the home screen. Live quotes, editable shares,
  tap a ticker → council. DONE (deploying).
- [~] **Strategy rulebook** — `docs/STRATEGY.md`. Core/Satellite 50/50
  (council-adjustable), 35% sector cap, 10/8% name caps, QQQ buffer, entry =
  above-200DMA + not >25% over 50DMA, exit = thesis broken OR multi-wk downtrend,
  DCA → most-underweight eligible name. 12-name Core list proposed & approved.
  - [x] Config as data (`server/lib/strategy.js`) + `/api/strategy` +
    `/strategy/diagnostics` (pure math) + StrategyCheck panel on Portfolio.
  - [ ] DCA suggestion engine ("this week's $X → NAME") + conviction tiers per holding.
  - [ ] Backtest the rulebook vs QQQ/VOO on the quant service.
  - [ ] Wire the diagnostics into the council (agents see the flags).

- [x] **Re-point the agents** — DONE (2026-09-01).
  - [x] Slice 1: code-computed price facts (`server/lib/metrics.js`) — trend vs
    50/200-day, % off 52wk high, 3/6/12mo momentum via Tiingo EOD.
  - [x] Slice 2: council now answers belongs / entry / broken / sector / size.
    Each agent returns BINARY checks (true/false/null). Verdict
    **ADD / HOLD / TRIM / EXIT** + conviction computed in code (`scoreCouncil`)
    from the checks + the strategy rulebook (broken→EXIT, downtrend→EXIT,
    score≥7 & entry clear→ADD, ≤3→TRIM). AXIOM explains the verdict, can't
    change it. ATLAS re-scoped macro→sector health.
  - [x] Slice 3: AgentCard renders ✓/✗ checks + note; VerdictBanner shows
    THESIS BROKEN / DOWNTREND / ENTRY NOT CLEAR flags + the facts line.
    scoutJob now reuses runCouncil; scorecard isHit + buckets updated.
  - [ ] Slice 4: **holdings-aware council** — feed the user's real positions so
    ZEN/verdict know "you're already 100% semis, this adds concentration".
    Needs the council run to carry uid. THE obvious next step.
- [ ] **Re-point the agents (original note)** — from "should I trade this week" to: (1) Still belongs?
  (2) Right size? (3) Broken? AND switch from freeform 0-10 scores to **binary yes/no
  sub-questions scored in code** (LLM holistic scoring is provably inconsistent — see
  the AMD 5/5/4/5/3/5/5 evidence; BINEVAL / rubric research). Feed real computed
  metrics not one-line summaries. Majority-vote only the genuinely subjective questions.
- [ ] **Per-position council stance** on the portfolio view (keep / trim / add / exit).
- [ ] **Candidate ranking** — for the weekly DCA, rank which names best deserve new money.
- [x] **Paste-import positions** — tolerant parser for broker copy-paste / CSV.
- [x] **Portfolio polish** — cash-fund rows (SPAXX etc → cash), linked accounts
  read-only, rename accounts (nickname persists across sync), two-step delete
  confirm (works on linked + manual), stopped auto-seeding template accounts.
- [~] **Broker auto-sync (SnapTrade Personal)** — integration rewritten for Personal
  API-key mode (no user registration, no portal; user links brokers in SnapTrade's own
  dashboard, we just read via `getAllAccountPositions`). SNAPTRADE_CLIENT_ID set in
  Render (`PERS-EUNL8MVD5NKLZGAAJXDF`); CONSUMER_KEY pending user paste.
  **User connected 1 of 3 brokerages so far — still needs to connect the other 2
  (2× Fidelity + Robinhood; one done). Do this in SnapTrade dashboard → Home →
  Connect a brokerage, then hit Sync in Axiom.**
  Verify the position field mapping (symbol / units / cost basis paths in `broker.js`
  are defensive guesses) once the first real sync runs.
- [ ] Cost-basis entry UI for manual accounts (field + parser exist; no dedicated input).

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

- [x] **News feed (v1, UI only)** — `server/lib/signals.js` marketNews + tickerNews via
  Finnhub; `/api/signals/*`; NewsPanel under the agent cards.
- [ ] **CONNECT news → agents** ⭐ — the panel is standalone right now = cosmetic. Wire
  `signals` into the council: pass recent ticker headlines into NOVA (catalyst) + VEGA
  (bear case) agent context so verdicts cite real events; surface which headlines drove
  the verdict; push-alert on material news for held tickers. Nothing is "done" until it
  connects.
- [ ] **Events service — remaining**: SEC EDGAR 8-K, Fed/econ/FDA calendars, persist to
  Firestore `signals`, feed NOVA agent context, push alerts on holdings hits.
- [ ] **Congressional trading tracker** — BLOCKED on data source. Free sources dead in
  2026 (old S3/github datasets gone; CongressInvests API rate-shared + 3mo stale).
  Decide: Disclosed Capitol free-tier signup, Quiver $25/mo, or defer.
- [x] **Verdict scorecard (v1)** — `lib/scorecard.js` scores past analyses vs actual
  price move; aggregate hit rate by verdict + agent stance; daily cron + Scorecard tab.
  Empty until verdicts age 7d — data accumulates from here.
- [ ] **Scorecard → agent weights** — once there's data, tune AXIOM's agent weighting
  and drop/fix agents that don't predict. (The point of collecting it.)
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
