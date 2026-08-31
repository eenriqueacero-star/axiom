# Axiom — Master TODO / Backlog

Living list. Keep it current. Newest thinking in `project_axiom_roadmap` memory.

---

## ⭐ Hard requirements (do not drop)

- **AI agents must be able to interact with and engage the entire app UI.**
  The agents are not just verdict generators — they must be able to drive the app:
  navigate between views, populate/filter screens, surface analyses, respond to what
  the user is looking at, and act within the app on the user's behalf. Every UI surface
  we build must be agent-addressable (an action/tool the agents can call), not just
  human-clickable. Design each feature with an agent-facing interface from the start.
- Everything syncs across devices in real time (Firestore). Server does the compute
  and the writes; client is a thin view. Already the pattern — keep it.
- Push/commit after every working phase (user works PC + phone).

---

## Now / next (pick order with user)

- [ ] **Backtest harness** — strategy-agnostic. Logs {ticker, date, signal, fwd return
      +5/+20/+60d}. Replay 2-3 yrs on holdings + discovery pool. Test candidates A-E
      (see roadmap memory) vs baseline "buy QQQ weekly."
- [ ] **Rebuild the strategy core** around the backtest winner. Likely: mechanical
      momentum/trend core + LLM agents as a news/risk/catalyst overlay (not the whole
      system). Replace or re-weight the 4-gate design — it's brittle & unmeasured.
- [ ] **Real-world events / catalyst signal service** — server cron ingests Finnhub
      news + market-news, SEC EDGAR 8-K, congress trades (house/senate stock-watcher,
      free), Fed/econ/FDA calendars, (later) Quiver gov contracts, MT Newswires MCP.
      Normalize → tag tickers → Firestore `signals` → feed NOVA agent + push alerts.
- [ ] **Live verdict scorecard** — track every real verdict vs forward returns.
      Per-agent hit rate. Feeds agent self-improvement.

## Strategy / methodology

- [ ] Give REX (technical agent) real OHLC bars (52wk weekly) or compute trend
      deterministically in code (SMA slope, higher-high count) instead of guessing
      from one price point.
- [ ] Replace hard AND-gates with a weighted 0-100 score + threshold (smoother, less
      flip-prone, weights tunable from backtest).
- [ ] Majority-vote mode for forced re-runs (run each agent 3x, take modal stance) —
      only if cache-only proves insufficient.
- [ ] Agent self-improvement loop: nightly reflection job, AXIOM reviews week's calls
      vs price action, writes per-agent calibration notes prepended to prompts.
- [ ] Backtest the 4-Gate + Sell Protocol specifically — does it beat buy-and-hold?

## Features

- [ ] Congressional / government trading tracker (part of events service). Free source:
      house-stock-watcher / senate-stock-watcher S3 JSON. Feed as signal + notify.
- [ ] Paper-portfolio of AXIOM's own calls so "the edge" is a measurable number.
- [ ] Watchlist + auto-scan (scout job exists) → daily conviction-ranked digest push.
- [ ] Portfolio / accounts view (Edwin/Dad/Bro holdings already in definitions.js).
- [ ] Rulings log (user decisions + rationale) — CRUD, was in old the-council.
- [ ] Quotes / news panel per ticker.

## Infra / polish

- [ ] Notification system rework — Web Push (VAPID) delivery is unreliable. Investigate:
      stale subscriptions not pruned, SW lifecycle on mobile, single-subscription model,
      no retry/logging, iOS PWA constraints. Goal: reliable scout + portfolio alerts.
- [ ] PWA manifest + service worker → installable on phone, enables push.
- [ ] Client code-split (bundle is ~580KB, mostly Firebase).
- [ ] SPA routing + `/*` → index.html rewrite on the static site (when multi-view).
- [ ] Evaluate paid MCP data servers (Quiver, FMP) once free-data version proves useful.

## Done ✅

- Backend live (axiom-u58i.onrender.com), boot-safe, all env vars set.
- v1 client live (axiom-client.onrender.com) — Google auth, council run, 6 agent
  cards + AXIOM verdict, realtime Firestore history.
- Server-side council orchestration + Firestore persistence for cross-device sync.
- Groq key health endpoint (/api/status/groq-keys).
- Verdict stability: temperature:0 + seed, + 6h reuse cache per ticker (force to override).
- Fixed: Finnhub earnings-calendar 302→HTML crashed every run.
- Firebase: Google sign-in enabled, domain authorized, Firestore rules verified.
