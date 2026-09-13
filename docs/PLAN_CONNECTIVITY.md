# Build plan — connectivity + agent control

From the 2026-09-03 3-agent audit. Goal: every feature feeds the agents, agents
see what the user sees, agents can act on the app. Work top-down; each phase
ships on its own.

---

## Phase 0 — safety cleanup (do first, ~half a session)

The audit's operational risks. Small, no new surface.

- [x] **Token budgeting** (`lib/budget.js` + `lib/groq.js`). Groq free tier is
      token-limited, not request-limited. Estimate tokens per call in
      `recordCall` (input len + maxTokens) and add a daily token ceiling
      alongside the request count. A scout pass is ~1M tokens and currently
      unaccounted. — Done: `budget.js` tracks real `tokensToday` from Groq/
      NVIDIA `usage.total_tokens` (est. fallback), `GROQ_DAILY_TOKENS_PER_KEY`.
- [x] **Prune `analyses`** (`lib/analyses.js`, new helper or in the write paths).
      Keep newest ~15 per ticker + newest ~100 overall, like `memos.js`/`vault.js`.
      Every council run full-scans this collection today (firmContext,
      recentCalls, calibration, scorecard aggregate, /floor). — Done:
      `pruneAllAnalyses()` + `saveAnalysis()` is the one write path, prunes on
      every write.
- [x] **Finnhub empty-quote guard** (`lib/council.js` fetchLiveData). `{}` on
      rate-limit → `price` undefined → silent data-starved HOLD. Detect, retry
      once, fall back to Tiingo last close (`metrics.js`), else stamp
      `dataIncomplete: true` on the analysis and surface it in VerdictBanner.
      — Done 2026-09-12: retries the Finnhub quote once, falls back to
      `metrics.js lastClose()` (Tiingo), stamps `computed.dataIncomplete` and
      a note in the LLM prompt. Surfaced as a flag chip in the three *actually
      live* verdict surfaces — `views/Run.jsx`, `views/sheets/HoldingsSheet.jsx`,
      `views/sheets/AlertDetail.jsx` — not `components/VerdictBanner.jsx`,
      which (like `components/Portfolio.jsx` before it) turned out to be dead
      code: `components/Analyze.jsx` imports it but nothing imports Analyze.jsx.
- [x] **Verify `runPortfolioAlerts` position store** (`jobs/alertJob.js`). It
      reads `users/{uid}/data/positions`; everything else uses
      `users/{uid}/accounts/{id}.holdings`. Confirm which the client writes; the
      alert path may be dead. — Resolved differently: it *was* dead (read two
      paths nothing wrote to); removed the cron registration entirely.
      `runMoveReview` (±8% intraday, same file) covers the real need instead.
- [x] Unify the 3 JSON extractors → use `council.js extractJSON` everywhere
      (`reflect.js`, `dialogue.js` have their own greedy regex). — Done
      2026-09-12: both now import `extractJSON` from `council.js`.

---

## Phase 1 — the shared context assembler (the foundation)

**`server/lib/agentContext.js`** — one function every agent surface calls.

```
buildAgentContext({ uid, ticker?, view?, scope })
  scope: 'verdict' | 'chat' | 'desk' | 'boss' | 'triage'
  → { text, data }   // text = the prompt block; data = structured for callers that want it
```

Union of everything the user can see, each caller takes a slice:
- book: total, P&L today ($), all-time gain, sleeve mix, sector breakdown, rulebook flags
- per-holding: verdict + conviction + tier + trigger, cost basis, unrealised %
- the DCA / next-contribution pick + why
- movers: today's ranked ±
- recent signals feed (last ~10 across news/filing/insider/congress)
- congress trades for `ticker` (or top holdings if no ticker)
- backtest verdict line + "rules hold now"
- scorecard: per-agent hit-rate + calibration note
- vault: last ~6 set-aside items
- desk notes: relevant to `ticker`/`scope`
- **"THE USER IS LOOKING AT: <view> / <ticker>"** when passed

Then rewire the 6 builders to call it:
- `council.js` fetchLiveData/buildHoldingsContext → `buildAgentContext({scope:'verdict'})`
- `routes/council.js` buildAgentSystem → `buildAgentContext({scope:'chat', ticker, view})`
  **← this is the big win; the 1-on-1 chat is currently the thinnest context**
- `desk/night.js` firmContext → `{scope:'desk'}`
- `desk/triage.js` → `{scope:'triage'}`
- `desk/bossChat.js` bossSystem → `{scope:'boss'}`
- `lib/dialogue.js` → `{scope:'desk'}`

Keep `buildAgentContext` deterministic for the verdict scope (date not minute,
no Math.random) — the STABILITY RULE still applies there.

**Status 2026-09-12:** the shared `agentContext.js` extraction (one function,
6 call sites rewired) hasn't happened — that's still real, larger surgery.
But the specific pain point this phase was chasing — the 1-on-1 chat being
"the thinnest context" — was mostly already fixed in an earlier pass (see the
comment at `routes/council.js`'s chat handler: portfolio, live price/news,
desk memos, DCA pick, congress trades, backtest line, and recent signals were
all already wired in). Filled in the two pieces the spec called for that were
still missing: today's P&L $ + all-time gain on the book line, and a ranked
TODAY'S MOVERS block (both pulled from data `getPortfolio` already returns —
no new fetches), plus the per-holding "council's last verdict/conviction/tier"
line for whatever ticker is in view. The actual `buildAgentContext()` unifying
refactor across desk/night.js, desk/triage.js, dialogue.js, bossChat.js and
council.js's own fetchLiveData is still open if you want the full architecture
change — it's a bigger, riskier lift than what shipped here.

**Client half:** `App.jsx` already has `view` + `analyzeTicker`. Pass them:
`chatAgent(agent.id, msgs, ticker)` from `floor/shared.jsx` AgentChat (the API
already accepts the 3rd arg — it's just unused), and add `{view}` to the chat
POST body; `routes/council.js` reads them into `buildAgentContext`.

---

## Phase 2 — surfaces that make it feel connected

- [x] **Overnight digest screen.** New `client/src/components/Digest.jsx` +
      thin `GET /api/desk/digest` that returns: last night's `deskWork` brief +
      assignments/findings + reflection, new `signals` since `state.lastSeen`,
      any verdict that flipped since yesterday, the morning's DCA pick. Show it
      as a dismissible banner on Portfolio the first time you open the app each
      day ("While you were away…"), tap to expand. Data all exists; ~1 component
      + 1 aggregation route. — Done: `server/lib/digest.js` + `Digest.jsx`,
      confirmed live on prod ("While you were away — 20 things" banner).
- [x] **Open ticker in chat** (done in Phase 1's client half — verify it lands:
      open Analyze on NVDA, go to The Floor, ask VEGA "what do you think of this
      one?" with no ticker typed → it should know). — Verified in code:
      `App.jsx` threads `runTicker` down as `activeTicker`, `Floor.jsx` passes
      it into `AgentSheet` as `ticker`. Plumbing is real, not just planned.
- [x] **Per-holding "desk's latest take"** — `buildStances` adds the freshest
      `relevantMemos(uid,{ticker})` line per holding; `DecisionDetail` in
      Portfolio renders it under the rationale. ~20 lines. — Done 2026-09-12:
      wired into `GET /council/analysis/:ticker` (not `buildStances`, since
      that route is what `DecisionDetail` actually reads from) as a `deskNote`
      field; renders under the rationale in `Portfolio.jsx`.

---

## Phase 3 — agent action layer

**Status 2026-09-12:** discovered `navigate` was already fully built — the
boss ends a reply with `[[open:run TICKER]]` / `[[open:alerts|jobs|book|floor]]`,
`desk/bossChat.js parseActions()` turns it into a button, `App.jsx onBossAction`
executes it. That's a real, working AUTO action, just under a different name
than this doc's `{"action":...}` JSON spec. Added `server/lib/actions.js` — a
small registry (`watchlist_add`, `watchlist_remove` so far) driven by a second
directive, `[[do: name arg]]`, that EXECUTES immediately (no button — these
are receipt-style, not navigation) and appends a plain confirmation sentence.
Wired into both `desk/bossChat.js` (the boss) and `routes/council.js`'s
per-agent chat handler (any analyst) per the "analysts → watchlist only"
scoping rule below. `run_council`, `dismiss_signal/snooze_signal`, `pin` and
the whole CONFIRM tier (`mark_executed`, `portfolio_set_shares`, etc.) are
still open — dismiss/snooze needs a new `dismissed` flag on
`users/{uid}/signals` first, per the original Phase 4 note.

**`server/lib/actions.js`** — registry `{ name, scope, mode, validate, exec }`.
Parser clones `parseConsult`: the boss (or an analyst, scoped) emits
`{"action":"navigate","args":{...}}`; server validates → executes (AUTO) or
queues (CONFIRM) → result goes back into the conversation.

**AUTO** (reversible / visual — just do it, show a receipt):
- `navigate({view, ticker})` — drive App.jsx; toast "AXIOM opened NVDA"
- `run_council({ticker})` — already fire-and-forget elsewhere
- `watchlist_add / watchlist_remove({ticker})` — new `users/{uid}/watchlist`
- `dismiss_signal({id}) / snooze_signal({id, days})` — new `dismissed` flag on
  `users/{uid}/signals`
- `pin({type, id})` — new `users/{uid}/pins`
- `write_desk_note` — already autonomous

**CONFIRM** (approval card, nothing changes until the user taps Approve):
- `portfolio_set_shares({account, ticker, shares, costBasis})`
- `portfolio_add_ticker / portfolio_remove_ticker`
- `account_add / account_remove / account_rename`
- `mark_executed({ticker, verdict, account, shares, price})` — **keystone**:
  writes `users/{uid}/executions`, stamps the analysis `acted:true`, feeds the
  paper portfolio. (Half-shipped as `resolveThread('act')` — finish it.)
- `strategy_set({split, caps})` — needs new `users/{uid}/strategyConfig` +
  `PUT /api/strategy/config` first (today SPLIT/CAPS are module constants in
  `lib/strategy.js`). Always confirm; show a diff of which flags change.

**NEVER:** real trades / broker orders. SnapTrade stays read-only.

**Client:** `<ActionCard action onApprove onDismiss>` — AUTO renders as a
past-tense receipt with undo; CONFIRM renders pending with plain-English
description + exact diff. Plus `users/{uid}/actions` log surfaced in
SystemStatus + on the Office view ("AXIOM activity").

**Scope by actor** (CLAUDE.md "a child can drop but not add capabilities"):
analysts → navigate + run_council + write_desk_note + watchlist only. Boss →
all CONFIRM actions.

Route targets mostly exist: `routes/portfolio.js` (PUT/POST/DELETE
`/:acct/:ticker`, PATCH/DELETE `/:acct`), `routes/desk.js`, `routes/council.js`.

---

## Phase 4 — near-free features (data already collected; pick by appetite)

- [ ] **Paper portfolio** — "if you'd followed every ADD at conviction ≥7" equity
      curve. Pure client math on `analyses` (has verdict + price + ts +
      score.perf). Overlay real vs hypothetical once `mark_executed` lands.
- [x] **Signals feed screen** — turned out `views/Alerts.jsx` already covers
      most of this: it reads `users/{uid}/notifications` (a richer feed than
      raw `users/{uid}/signals`), already has kind filters (news/filing/
      insider/congress/moves/ratings/scout/desk/macro), a detail pane, and
      links out to source/council. The one real gap — dismiss — is done
      2026-09-12: `notify.js dismissNotification()` soft-deletes a card
      (`dismissed: true`, filtered out of both the REST list and the live
      Firestore query), `POST /api/notifications/:id/dismiss`, and a "×" on
      each row in `Alerts.jsx`. Snooze — done 2026-09-12: `snoozeNotification()`
      stamps `snoozedUntil`, a new `snooze-sweep` heartbeat job (every 30 min)
      un-hides anything past its window (`runSnoozeSweep()`), `POST
      /:id/snooze` with `{days}`, and the "×" now opens a small menu (snooze
      1 day / 1 week / dismiss for good) instead of an instant dismiss — same
      pattern as the queue's skip menu.
- [x] **Congress alerts for held names** — `congressTrades` + `heldTickers` both
      exist; add a congress pass to `scanHoldingsNewsForUser` that pushes +
      triages a disclosed trade in a held name. ~30 lines. (The `triage.js`
      header comment already claims this happens — it doesn't.) — Done
      2026-09-12: congress pass added, deduped by trade id, buys go to the
      event desk (thesis-level), sells are FYI-only push.
- [x] **DCA pick into agent context** + let the user ask ZEN/AXIOM "why this
      pick, not X". — Done 2026-09-12: the pick itself was already in the chat
      context; added a "WHY NOT THE OTHERS" line built from `dcaSuggestion`'s
      existing `ranked` array (conviction tier, sector cap, entry rule, or
      just a smaller gap-to-target) — no new data source, `dcaSuggestion`
      already computed all of it.
- [x] **Event desk + vault** — `TheOffice.jsx` (the component this item names)
      turned out to be dead code, same as `Portfolio.jsx`/`Analyze.jsx`/
      `VerdictBanner.jsx` before it — nothing imports it. The real live hub is
      `views/Floor.jsx`, which already had Notes and an "Event desk" panel
      wired in (a broader search would've found `events.slice(0,6).map` —
      an earlier regex miss made it look unused). Vault was the one genuine
      gap: added 2026-09-12, a `Vault · N` panel same style as the others,
      fetched via the existing `getVault()`/`GET /desk/vault`. No packet
      animation — skipped as pure decoration outside this pass's scope.
- [ ] **Watchlist** proper — `users/{uid}/watchlist`, add-from-anywhere (Congress
      row, Analyze, agent action); the scout job already iterates a ticker list.
      — Partial: base CRUD shipped (`server/lib/watchlist.js` + `Watchlist.jsx`,
      Book's sidebar). 2026-09-12: added a `+ watchlist` control to the Congress
      trades list (`Alerts.jsx`) and the Run/council result header (`Run.jsx`) —
      the two live ticker-surfacing screens (`Analyze.jsx` is dead code, not a
      real entry point). Still missing: agent-action wiring and scout-job use.

---

## Suggested order for tomorrow

1. Phase 0 (safety — token budget + prune + Finnhub guard).
2. Phase 1 (agentContext.js + rewire chat). Biggest single connectivity win.
3. Phase 2 overnight digest.
4. Phase 3 AUTO tier + activity log.
5. Phase 3 CONFIRM tier (mark_executed first, then portfolio edits).
6. Phase 4 à la carte.

---

## Shipped outside this plan (2026-09-12)

- **Liquidity calendar** (`server/lib/calendar.js`) — NYSE market holidays
  (computed, incl. Good Friday via a real Easter algorithm), options
  expiration Fridays (computed, quarterly triple-witching flagged), and
  Jewish holidays (free hebcal.com API, no key, 30-day cache). Wired into
  every council prompt via `calendarBlock()` right next to `macroBlock()` —
  descriptive context ("thin volume expected"), never a signal. All three
  sources are free and fully automatic; nothing needs manual yearly upkeep
  like `macro.js`'s Fed/CPI schedule does.
