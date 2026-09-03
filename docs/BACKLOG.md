# Axiom — Master TODO / Backlog

Living list. Keep it current. Newer thinking in `project_axiom_roadmap` memory.

---

## 🔜 Up next (2026-09-02) — don't lose these

0. **CHECK THE DESK (2026-09-03+)** — NVIDIA strong model is now wired for synth +
   the boss's overnight assign/brief (commit f2b6af9, SYNTH_PROVIDER=nvidia live on
   Render, verified GROQ 4/4 · NV 1/1 ★). The 2:10 AM ET cron should now complete a
   full run. **Open The Floor tab the morning of 2026-09-03 and confirm "Last night
   at the desk" shows a brief + 6 analyst findings (status: done, not failed).** If
   it failed again, read the deskWork/{date} error + server logs.

0b. **EVENT DESK — real-time boss triage + private chat (user, 2026-09-03)**
   Phases 1-3 SHIPPED (commits after 89ce628). `lib/desk/triage.js` (act/talk/
   archive), `vault.js`, `bossChat.js`, `canSpendEvent`, holdingsNews rewired to
   hand thesis events to the boss, `/desk/{events,vault,chats*}` routes,
   `BossChat.jsx` + header "boss" button + push deep links, weekend all-hands
   reflection cron (Sat 10 ET). Full status in `project_axiom_event_desk` memory.
   Event Desk panel on The Floor (card view) + vault list SHIPPED; LastNight now
   nightly-only. Suggestion/Decision + Proceed→execution chat + agent join
   notices/avatars all verified live. LEFT: surface the desk on TheOffice (3D
   view) too — currently only in the card view; tone audit; watchlist scope.

1. **Backtest the rulebook vs QQQ** — mostly DONE (2026-09-02), one step left.
   - [x] `axiom_5050` / `core_quality_hold` strategies (quant/app/strategies.py) —
     the mechanical rulebook skeleton, no LLM.
   - [x] FastAPI wrapper (`quant/app/main.py`): /health, /backtest, /holdings-now.
   - [x] Node proxy (`server/lib/quant.js` + `routes/quant.js`, degrades when
     QUANT_URL unset) + Scorecard "Strategy vs. the index" panel + the backtest
     verdict is fed into the council synth.
   - [x] `quant/render.yaml` + README.
   - [ ] **USER: create the 3rd Render service** (blueprint or manual — see
     quant/README.md), set TIINGO_TOKEN (separate token!) + QUANT_API_KEY, then
     set QUANT_URL + QUANT_API_KEY on the `axiom` Node service.
   - [ ] Re-run `python run_axiom.py` once the Tiingo hourly limit clears to
     backfill the ~25 missing post-2009 tickers and get the honest full-universe
     number (first partial run: Axiom-50/50 23.3% CAGR vs QQQ 19.3%, DD −27% vs
     −35% — but on a winner-heavy reduced satellite pool).
2. **Agent calibration notes** — IN PROGRESS this session. Weekly job: review scored
   verdicts, write a one-line per-agent calibration note prepended to its prompt
   (the qualitative half of self-improvement; `agentWeights.js` is the numeric half).
3. **Notification delivery is unreliable** — we now push a lot (move-review, scout
   alerts) but Web Push is flaky: stale subscriptions never pruned, no PWA manifest,
   single-subscription model, iOS PWA constraints. The alerts are only as good as
   the pipe. See "Infra / polish" below.
4. **The Desk / autonomous nightly runs** — user: "plan all automated functions
   after you finish", and it's "not supposed to be a debate" — do NOT build v3
   "The Desk" dialogue as spec'd. Needs a dedicated planning conversation first.
5. **Congressional trading tracker** — BLOCKED on the user picking a data source
   (Disclosed Capitol free tier / EODHD free tier / Quiver $25-mo / defer).
6. **Broker sync** — user still needs to connect 2 of 3 brokerages in SnapTrade
   (2× Fidelity + Robinhood; 1 done), then hit Sync.
7. **Scorecard has no data yet** — verdicts must age before `agentWeights` +
   calibration do anything. Consider a shorter scoring horizon so they activate
   this week instead of next.

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
  - [x] DCA suggestion engine ("this week's $X → NAME") — `lib/dca.js`.
  - [x] Conviction tiers per holding — `convictionTier()` in `lib/council.js`
    (HIGH/MEDIUM/LOW/SPECULATIVE, code-computed from the binary checks). Stored on
    every analysis, surfaced on Portfolio + the full analysis, fed back into the
    next run's agent context, and gates the DCA engine (soured Core names get no
    new money). See STRATEGY.md §7.
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
  - [x] Slice 4: **holdings-aware council** — `runCouncil` takes `uid`,
    `buildHoldingsContext` feeds the real portfolio (position %, sector %, mix,
    rulebook flags) into every agent prompt + the synth. `scoreCouncil` now
    downgrades ADD→HOLD when a sector/name is at its cap (`concentrationBlock`),
    and HOLD→TRIM when already oversized. Verified: NVDA went ADD 10/10 → TRIM
    6/10 ("Semiconductors sector 73%, at cap"). VerdictBanner shows ALREADY AT
    CAP + the holdings line.
  - [x] Slice 5a: **DCA engine** (`server/lib/dca.js`, `GET /api/strategy/dca`) —
    ranks Core names by underweight vs equal-share target, runs the entry-rule
    check on each, picks the contribution target (or QQQ buffer). Verified: picked
    MSFT ("most underweight Core, uptrend, not extended").
  - [x] Slice 5b: **The Floor tab** — agent rooms (blurb, checks owned, track
    record, recent calls), scheduled-work list, council activity feed, DCA card.
    `GET /api/council/floor`. Live.
  - [x] Slice 5c: **per-agent chat** — `POST /api/council/agent/:id/chat`, in
    character, grounded in the user's real portfolio (sector %, mix, rulebook
    flags) + auto-detected ticker's live facts/news. Chat box in each Floor room.
    Verified: asked ATLAS "too concentrated in semis?" → "Yes, at 73%...".
  - [x] Slice 5d: **per-holding stance badges** (Portfolio view shows the
    council's latest ADD/HOLD/TRIM/EXIT + conviction on every owned name, via
    `GET /api/council/stances`).
  - [x] Slice 5e: **conviction tiers** (STRATEGY.md §7) + the daily scout now
    runs the full council on every held name per user and writes to
    `users/{uid}/analyses` (`scoutHoldingsForUser` in `jobs/scoutJob.js`) — before
    this the scout only wrote a global `scoutResults` collection nothing read, so
    stance badges only ever populated for manually-convened tickers.
  - [x] Slice 5f: **the firm's mandate + cost basis** (2026-09-02). PROTOCOLS now
    opens with "you are the investment committee of Axiom managing real capital —
    protect capital first, compound it fastest second." `buildHoldingsContext`
    feeds the firm's actual position per name — shares, avg cost, unrealised P&L —
    into every agent prompt + the synth (`positionEconomics()`); rule added that
    being underwater is not a sell reason but does gate averaging-down. Agent chat
    context + `buildStances` + VerdictBanner + the Portfolio DecisionDetail all
    carry the position economics now.
  - [x] Slice 5g: **"Review the book"** — `POST /api/council/review` fire-and-forget
    runs the full council on every unrated/stale holding; the Portfolio conviction
    strip has a "Review N names" button that kicks it off and polls `/stances` as
    verdicts land. Plus the daily 9:05 scout already does this pass automatically.
  - Still open: backtest the rulebook vs QQQ on the quant service, autonomous
    nightly agent debate → idea cards.

## The Floor — 3D vision (user, 2026-09-01)
User wants The Floor to be a real 3D house: agents living in it, a side menu of
names, click one → fly into that agent's 3D room, see their info, chat 1-on-1.
"Feel 3D and with life and volume." Plan + free CC0 asset sources +  reference
repos are in the `project-axiom-floor-3d` memory. Sequencing: chat first (DONE),
then the R3F 3D shell. This is the biggest single feature — days of work, mobile
perf care needed. Current card-based Floor stays as the fast fallback / the
content shown inside each 3D room.
  - [x] **3D shell v1** — `client/src/components/Floor3D.jsx` (lazy-loaded, ~224KB
    gzip chunk). Isometric fixed ortho camera, 6 dollhouse rooms in a 3×2 grid,
    tinted low-poly robots (primitive geometry — NOT GLB yet) with idle bob + wave
    on focus, per-agent themed props (REX monitors, NOVA rocket, ATLAS globe, VEGA
    bear, SAGE bookshelves, ZEN balance scale). Side nav of names + tap-a-room →
    camera lerps in → DOM overlay panel reuses AgentPanel + AgentChat (extracted to
    `components/floor/shared.jsx`). Toggle to card view persists in localStorage
    (`axiom.floor3d`). Default = 3D. Builds clean; NOT yet eyeballed live.
  - [~] v1.1 primitive pass — dark restrained rooms, hover-jitter fixed. User
    verdict (2026-09-01): "squares with little dolls… AI slop." Wants (a) real
    3D characters + a workstation vignette per agent, (b) the scene bound to
    live system data / reactive effects, (c) chat & panels IN the scene.

  ### v3 "The Desk" — ONE ROOM (user redirect, 2026-09-01) ← CURRENT
  Supersedes the six-separate-plinths layout. User's words: one big room, a
  discussion table in the middle, agents share ideas on their own; when two
  agents want to talk they LEAVE their workstations, walk to the table, and
  when the conversation ends it's summarised — **not for the user, as data the
  agents themselves reuse** when answering later, together or independently.
  Room must take over the ENTIRE page, not a small embedded canvas.

  **A. Backend — agent-to-agent dialogue + desk notes (the substance)**
  - [ ] `lib/dialogue.js`
    - `pickPairing(uid)` — choose 2 agents + topic from real state, e.g.
      VEGA×SAGE (a held name is both flagged and passes quality), ATLAS×ZEN
      (sector over cap AND sleeve off target — true today: semis 73%, core 0%),
      REX×NOVA (holding in downtrend but fresh news); fallback = the two agents
      whose recent stances on one ticker diverge most.
    - `runDialogue(uid, pairing)` — 3–4 alternating turns, each `callBase` with
      that agent's persona + shared grounding (diagnose + priceFacts + recent
      analyses + existing memos).
    - `distill(dialogue)` — one more call → strict JSON memo:
      `{ id, ts, participants[2], topic, ticker|null, keyPoints[≤4], conclusion,
        confidence, actionable, tags[] }` → `users/{uid}/deskNotes` (cap ~50).
  - [ ] `lib/memos.js` `relevantMemos(uid,{ticker,agentId,limit})` → injected as
    a `DESK NOTES (prior conclusions from the table — treat as your own
    memory)` block into `runCouncil` agent prompts, the AXIOM synthesis, and
    `callAgentChat`. **This closes the loop** — a past table conversation
    actually changes future answers.
  - [ ] Routes: `POST /api/desk/convene`, `GET /api/desk/notes`,
    `GET /api/desk/state` (`{ activeDialogue|null, notes }` for the scene).
    Nightly cron convenes 1–2 dialogues.

  **B. Client — the room**
  - [ ] Full-bleed: The Floor escapes `max-w-3xl`, fills the viewport.
  - [ ] One large room — floor, walls, ceiling light rig. Six workstations
    around the perimeter (desk + screen + chair, agent-coloured accent).
    Central round table, six seats, holo display above it.
  - [ ] Choreography from `/api/desk/state`: the two robots play Walking along
    waypoints station→table, face each other, gesture while turns stream, then
    walk back; a memo card materialises on the table.
  - [ ] Table click → Desk Notes browser (filter by agent/ticker). Agent click
    → their station + panel + chat, chat citing memos.
  - [ ] Camera: wide room by default, dollies to the table during a dialogue,
    to a station on select.

  Decisions taken (change if wrong): memos are per-user in `users/{uid}/
  deskNotes`; dialogues run nightly + on-demand "Convene" (reactive-on-verdict
  later); one dialogue ≈ 5 Groq calls so nightly is cheap; card view stays as
  the fallback.

  ### v2 "The Workshop" — SUPERSEDED by v3 (kept for the asset/character work)
  Direction: recognizable "little Claude" robots (one animated model, 6 tints),
  each in a themed WORKSTATION (not a square room), every visual bound to real
  portfolio data.

  Assets: `client/public/models/robot.glb` = three.js RobotExpressive (CC0,
  Tomás Laulhé / mod. Don McCurdy, 464 KB). Materials: Main (tint per agent),
  Grey, Black. Anims: Idle, Wave, Yes, No, ThumbsUp, Dance, Walking, Punch,
  Sitting, Running, Jump, Death. Served same-origin from /public (no CDN risk).

  1. [x] **Server** — `lib/floorLive.js` `buildFloorLive(uid)`: per-agent
     `{ reaction, busy, metric }` from `diagnose()` + `priceFacts` trend +
     `tickerNews`. Folded into `GET /api/council/floor` as `live`; lean
     `GET /api/council/floor/live` for polling. ZEN tilt, ATLAS sector heat,
     VEGA flag count, REX trendScore, NOVA fresh-news count, SAGE core-intact.
  2. [ ] **Character system** — `useGLTF('/models/robot.glb')` once →
     `SkeletonUtils.clone()` ×6 → tint Main material → `useAnimations` per clone.
     `<AgentRobot reaction=… busy=…>` crossfades anim, returns to Idle. Keep
     damped iso camera + side nav. Plinths only. Deploy → screenshot → tune.
  3. [ ] **Vignettes** (2 commits) — REX curved monitor desk (screens = live
     sparkline CanvasTexture), NOVA mission console + headline crawl + rocket,
     SAGE study (bookshelf, practical desk lamp, plant), VEGA dim bunker
     (hanging lamp, red-string board, bear bust), ATLAS observatory
     (globe/orrery + sector bars), ZEN balance room (scale tilts to sleeve mix,
     stones). Per-vignette key + practical lights.
  4. [ ] **Reactive layer** — bind `live` → robot reaction anims + prop state
     (ZEN tilt, ATLAS hot ring, VEGA embers, REX needle/screens, NOVA ticker
     speed, SAGE calm/agitated). Firestore `onSnapshot(users/{uid}/analyses)`
     → AXIOM-core pulse + sequential agent reactions on a new verdict. 30 s poll
     of `/floor/live` for busy/stance.
  5. [ ] **In-scene panel + chat** — selected agent → drei `<Html>` glass
     console anchored to the vignette (AgentPanel + AgentChat); robot gestures
     while replying; recent-call tokens orbit robot → click → onAnalyze.
  6. [ ] **AXIOM core** — central slow-rotating light, threads to each vignette
     (brightness = conviction), pulse on new verdict, DCA pick → beam to the
     backing agent.
  7. [ ] **Polish** — bloom/contrast/shadow tuning, loading skeleton, mobile
     perf (dpr cap, MeshReflector off small screens, effects toggle), keyboard
     nav on the side list. Card Floor stays as fallback.

  Iterate by deploying to Render + screenshotting each step (localhost sign-in
  popup is uncontrollable from automation — Render only).
- [ ] **Re-point the agents (original note)** — from "should I trade this week" to: (1) Still belongs?
  (2) Right size? (3) Broken? AND switch from freeform 0-10 scores to **binary yes/no
  sub-questions scored in code** (LLM holistic scoring is provably inconsistent — see
  the AMD 5/5/4/5/3/5/5 evidence; BINEVAL / rubric research). Feed real computed
  metrics not one-line summaries. Majority-vote only the genuinely subjective questions.
- [x] **Per-position council stance** on the portfolio view (add / hold / trim / exit).
  `server/lib/stances.js` `buildStances(uid)` — reads the latest `users/{uid}/analyses`
  verdict for every held ticker (pure Firestore, no LLM). `GET /api/council/stances`
  → `{ ready, counts, stances: { TICKER: { verdict, conviction, headline, ts, stale,
  broken, downtrend, analyzed } } }`. Portfolio.jsx shows a `StanceBadge` per row
  (verdict + conviction, colour-coded, dimmed when stale). Tapping the ticker or
  badge expands `DecisionDetail` inline — verdict, AXIOM rationale, rulebook flags
  (THESIS BROKEN / DOWNTREND / AT CAP / ENTRY NOT CLEAR), per-agent stance + note,
  catalyst, "full analysis →" link. Backed by `GET /api/council/analysis/:ticker`
  (Firestore read, no LLM). The daily scout keeps verdicts fresh; `stale` flags
  names it missed / added since.
- [x] **Candidate ranking** — for the weekly DCA, `lib/dca.js` ranks Core names by
  underweight-gap, then conviction tier, then sector; and now also considers
  underweight HIGH/MEDIUM-conviction *satellite* holdings against a §7 tier target
  weight, so a high-conviction growth name can win the contribution too.
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

- [x] Give REX real code-computed trend, not a guess — `metrics.js` priceFacts feeds
  the COMPUTED FACTS block (trend vs 50/200-day, momentum, drawdown, `bars` count).
- [x] **Verdict overhaul (2026-09-02, 3 tiers)** — see STRATEGY.md "How a verdict is
  computed":
  - **T1** — a downtrend forces EXIT only with weak fundamentals / structural bear /
    underwater, else it's a TRIM; young stocks (<240 bars) can't trigger a downtrend
    EXIT; concentration split into `atCap` (HOLD, "would add") vs `concentrationTrim`
    (>1.5× own cap → real trim). VEGA's bear checks must name a mechanism. Tier
    penalties retuned (growth ±2, vol −1, SPEC needs a condemned business).
  - **T2** — real fundamentals (`lib/fundamentals.js`, Finnhub metrics) feed SAGE;
    "why it's moving" news block on ≥5% days; `runMoveReview` re-runs the council on
    any holding ±8% intraday (30-min cron) and pushes the new verdict.
  - **T3** — `scoreCouncil` is now a **weighted 0-100 score** (`CHECK_WEIGHTS`), not a
    hard AND-cascade; hard gates (broken/downtrend-exit/>1.5× cap) still override.
    `lib/agentWeights.js` turns the scorecard into per-agent vote multipliers
    (`GET /api/council/agent-weights`, shown on The Floor as "×N.NN vote") —
    flat 1.0 until verdicts age enough to score.
- [ ] Agent self-improvement loop — nightly: AXIOM reviews the week's calls vs price
  action, writes per-agent calibration notes prepended to prompts. (Mine TradingAgents'
  reflection-loop design.) — partially covered by agentWeights; the prompt-side
  calibration note is still open.
- [ ] Majority-vote mode for forced re-runs (only if the 6h cache proves insufficient).
- [ ] Backtest the current 4-Gate + Sell Protocol specifically vs buy-and-hold.

## Features

- [x] **News feed (v1, UI only)** — `server/lib/signals.js` marketNews + tickerNews via
  Finnhub; `/api/signals/*`; NewsPanel under the agent cards.
- [x] **CONNECT news → agents** ⭐ — done in pieces:
  - `fetchLiveData` feeds the last 7 days of ticker headlines into every council
    run (LIVE DATA block); on a ≥5% day a "WHY IT'S MOVING" block goes to VEGA/NOVA.
  - `lib/holdingsNews.js` `scanAllHoldingsNews` (30-min market-hours cron): scans
    each holding's fresh headlines, flags material ones (acquire/guidance/fraud/
    SEC/CEO/recall/…), pushes once (deduped via `users/{uid}/state/newsSeen`),
    writes them to `users/{uid}/signals`, and re-convenes the council on
    thesis-level events (acquisition, guidance cut, fraud, delisting…).
  - `GET /api/signals/holdings` + Portfolio: a news dot on flagged holdings
    (amber = thesis-level), the headlines in the expanded detail.
- [x] **SEC EDGAR 8-K feed** — DONE 2026-09-03 (commit 7b3395d). `server/lib/edgar.js`
  (free, no key), wired into `scanHoldingsNewsForUser` (push + `kind:'filing'` signal
  + re-convene on thesis items) and into `council.js` LIVE DATA (14d 8-K block).
  Extra 5:20 PM ET scheduler sweep for after-close earnings 8-Ks.
- [x] **Insider (Form 4) buy/sell signal** — DONE 2026-09-03 (commit 89ce628).
  `server/lib/insiders.js` (Finnhub), cluster-buy / cluster-sell detection into
  the council LIVE DATA + a push/signal on held names (cluster buy re-convenes).
- [ ] **Events service — remaining**: Fed/econ calendar, FDA calendar (PDUFA dates).
  Same pattern — new source feeding `scanAllHoldingsNews`. (FDA low value — no
  biotech in the book; Fed rate-decision dates could feed ATLAS.)
- [ ] **13F institutional-holdings changes** — which big funds added/trimmed your
  names each quarter. Reuses `edgar.js` (13F-HR filings). Quarterly, lagged 45d.
- [ ] **Congressional trading tracker** — BLOCKED on data source. Free sources dead in
  2026 (old S3/github datasets gone; CongressInvests API rate-shared + 3mo stale).
  Decide: Disclosed Capitol free-tier signup, Quiver $25/mo, or defer.
- [x] **Verdict scorecard (v1)** — `lib/scorecard.js` scores past analyses vs actual
  price move; aggregate hit rate by verdict + agent stance; daily cron + Scorecard tab.
  Empty until verdicts age 7d — data accumulates from here.
- [x] **Scorecard → agent weights** — `lib/agentWeights.js` (T3 above). Was: once there's data, tune AXIOM's agent weighting
  and drop/fix agents that don't predict. (The point of collecting it.)
- [ ] **Paper-portfolio of AXIOM's own calls** — makes "the edge" a real number.
- [~] Watchlist + auto-scan — the discovery sweep's `scoutResults` now feeds a
  "Worth a look — scout picks you don't own" card on The Floor (`lib/discovery.js`
  `topDiscoveries`, ranked ADD-first then conviction, held names excluded, tap →
  Analyze). Open: the daily digest *push* (deferred with the other automated fns).
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
