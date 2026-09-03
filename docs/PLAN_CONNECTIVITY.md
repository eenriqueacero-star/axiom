# Build plan — connectivity + agent control

From the 2026-09-03 3-agent audit. Goal: every feature feeds the agents, agents
see what the user sees, agents can act on the app. Work top-down; each phase
ships on its own.

---

## Phase 0 — safety cleanup (do first, ~half a session)

The audit's operational risks. Small, no new surface.

- [ ] **Token budgeting** (`lib/budget.js` + `lib/groq.js`). Groq free tier is
      token-limited, not request-limited. Estimate tokens per call in
      `recordCall` (input len + maxTokens) and add a daily token ceiling
      alongside the request count. A scout pass is ~1M tokens and currently
      unaccounted.
- [ ] **Prune `analyses`** (`lib/analyses.js`, new helper or in the write paths).
      Keep newest ~15 per ticker + newest ~100 overall, like `memos.js`/`vault.js`.
      Every council run full-scans this collection today (firmContext,
      recentCalls, calibration, scorecard aggregate, /floor).
- [ ] **Finnhub empty-quote guard** (`lib/council.js` fetchLiveData). `{}` on
      rate-limit → `price` undefined → silent data-starved HOLD. Detect, retry
      once, fall back to Tiingo last close (`metrics.js`), else stamp
      `dataIncomplete: true` on the analysis and surface it in VerdictBanner.
- [ ] **Verify `runPortfolioAlerts` position store** (`jobs/alertJob.js`). It
      reads `users/{uid}/data/positions`; everything else uses
      `users/{uid}/accounts/{id}.holdings`. Confirm which the client writes; the
      alert path may be dead.
- [ ] Unify the 3 JSON extractors → use `council.js extractJSON` everywhere
      (`reflect.js`, `dialogue.js` have their own greedy regex).

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

**Client half:** `App.jsx` already has `view` + `analyzeTicker`. Pass them:
`chatAgent(agent.id, msgs, ticker)` from `floor/shared.jsx` AgentChat (the API
already accepts the 3rd arg — it's just unused), and add `{view}` to the chat
POST body; `routes/council.js` reads them into `buildAgentContext`.

---

## Phase 2 — surfaces that make it feel connected

- [ ] **Overnight digest screen.** New `client/src/components/Digest.jsx` +
      thin `GET /api/desk/digest` that returns: last night's `deskWork` brief +
      assignments/findings + reflection, new `signals` since `state.lastSeen`,
      any verdict that flipped since yesterday, the morning's DCA pick. Show it
      as a dismissible banner on Portfolio the first time you open the app each
      day ("While you were away…"), tap to expand. Data all exists; ~1 component
      + 1 aggregation route.
- [ ] **Open ticker in chat** (done in Phase 1's client half — verify it lands:
      open Analyze on NVDA, go to The Floor, ask VEGA "what do you think of this
      one?" with no ticker typed → it should know).
- [ ] **Per-holding "desk's latest take"** — `buildStances` adds the freshest
      `relevantMemos(uid,{ticker})` line per holding; `DecisionDetail` in
      Portfolio renders it under the rationale. ~20 lines.

---

## Phase 3 — agent action layer

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
- [ ] **Signals feed screen** — `users/{uid}/signals` is fully populated;
      `/api/signals/holdings` exists (48h/held). Broaden to paginated + kind
      filters (news/filing/insider/congress) + the dismiss/snooze actions + a
      link to the event-desk job if one opened.
- [ ] **Congress alerts for held names** — `congressTrades` + `heldTickers` both
      exist; add a congress pass to `scanHoldingsNewsForUser` that pushes +
      triages a disclosed trade in a held name. ~30 lines. (The `triage.js`
      header comment already claims this happens — it doesn't.)
- [ ] **DCA pick into agent context** (~10 lines once Phase 1 lands) + let the
      user ask ZEN/AXIOM "why this pick, not X".
- [ ] **Event desk + vault on the 3D Office view** — `getDeskEvents` / `getVault`
      exist; `TheOffice` only shows `notes.length`. Add hub tabs Notes / Events /
      Vault + a packet animation when an event job runs.
- [ ] **Watchlist** proper — `users/{uid}/watchlist`, add-from-anywhere (Congress
      row, Analyze, agent action); the scout job already iterates a ticker list.

---

## Suggested order for tomorrow

1. Phase 0 (safety — token budget + prune + Finnhub guard).
2. Phase 1 (agentContext.js + rewire chat). Biggest single connectivity win.
3. Phase 2 overnight digest.
4. Phase 3 AUTO tier + activity log.
5. Phase 3 CONFIRM tier (mark_executed first, then portfolio edits).
6. Phase 4 à la carte.
