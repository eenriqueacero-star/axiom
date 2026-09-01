# Axiom Strategy Rulebook

> **STATUS: DRAFT — pending user approval.** Nothing here is wired into the app yet.
> This is the skeleton. The council agents are the judgment layer that executes it.

---

## 0. What this is for

Three family accounts (2 Fidelity, 1 Robinhood), funded by regular contributions
($60/wk, $50/mo, and lump adds). Long time horizon. Goal: **beat the S&P
meaningfully over years without blowing up.**

Honest framing from the backtest work:
- No strategy reliably beats the market "by a lot" in the short term.
- Realistic edge from method alone ≈ 2–5%/yr, with bigger drawdowns.
- **Your real edge is contribution rate + staying invested through crashes +
  a concentrated-but-not-reckless growth tilt.** Not clever trading.
- If, after 12 months, Axiom isn't beating QQQ net of tax, the honest move is to
  simplify toward indexing. We measure this from day one.

---

## 1. Portfolio structure — Core / Satellite

| Sleeve | Target | What goes here | Turnover |
|---|---|---|---|
| **Core** | 65–75% | 12–18 quality compounders, spread across **≥5 sectors** | Very low — buy and hold |
| **Satellite** | 25–35% | High-conviction growth / thematic (AI infra, semis, etc.) | Moderate — trim/rotate allowed |
| **Cash/ETF buffer** | 0–10% | Where a contribution parks if nothing eligible | — |

The **current holdings (NVDA, NBIS, MU, AMD, SNDK, CRDO, APLD, ALAB) are all
Satellite.** They're ~100% of the portfolio today. That's the thing this rulebook
fixes — over time, via where new money goes, not by panic-selling.

---

## 2. Universe — what's even eligible

A name can be bought only if **all** of these are true:
1. US-listed, market cap **≥ $10B** (Core: ≥ $30B).
2. Profitable **or** a clear, funded path to profit within ~2 years (pre-profit
   names are Satellite-only and capped — see §3).
3. Liquid — average daily volume ≥ $50M.
4. You can state the thesis in one sentence ("why will this be bigger in 5 years").

Everything currently held is grandfathered in as Satellite.

---

## 3. Position & sector limits (hard caps)

| Rule | Core | Satellite |
|---|---|---|
| Max in any **one name** | 10% | 8% |
| Max in any **one sector** (GICS) | 30% | 30% (combined w/ core) |
| Max in **pre-profit** names, total | 0% | 10% |
| Min # of names once built out | 12 | 4 |

When a cap is breached: **redirect new contributions away from it first.** Only
actually sell if a single name exceeds **1.5× its cap** (e.g. Core name hits 15%).
Selling triggers short-term cap-gains tax, so we avoid it.

---

## 4. Entry rule — buying a name (new position or adding)

Buy only if:
1. **Trend is OK** — price above its 200-day average (uptrend), OR in a flat
   base near the 200-day. **Never buy a name in a confirmed downtrend.**
   *(This uses the computed facts layer already built.)*
2. **Not chasing** — price is **not more than 25% above its 50-day average**
   (extended / blow-off risk). If it is, wait for it to cool.
3. **Starter first** — a brand-new position enters at **half its target weight**,
   scaled to full over 2–3 buys as it holds up.

If nothing eligible passes on contribution day → that contribution goes to the
**ETF buffer (QQQ or VOO)** for the week. Never force a bad entry.

---

## 5. Exit rule — selling a name

**Trim** when: position exceeds its cap by >1.5× (see §3), or conviction is
downgraded to Starter and it's above Starter weight.

**Full exit** only when **one** of these is clearly true:
- **Thesis broken** — acquisition closing, fraud/accounting blowup, structural
  loss of the core demand driver, or a guidance cut *plus* lost trust in
  management. Not a single bad quarter.
- **Confirmed weekly downtrend** — lower highs *and* lower lows for multiple
  weeks on the weekly chart, *and* price below the 200-day average.

**Never exit on:** one red week, a 5–10% pullback, "it's expensive," a scary
headline that doesn't change the 5-year story, or boredom.

---

## 6. Where contributions go (the DCA engine)

Each weekly/monthly contribution:
1. List holdings **most underweight vs their target**, highest conviction first.
2. Walk that list; buy the first one that **passes the §4 entry rule**.
3. If that would breach a §3 cap, skip to the next.
4. If none pass → ETF buffer this cycle.

This is how the portfolio diversifies and rebalances — no calendar rebalance,
no forced sales.

---

## 7. Conviction tiers

Every holding is tagged, and the tag drives its target weight and whether it gets
new money:

| Tier | Core target | Satellite target | Gets new $? |
|---|---|---|---|
| **High** | 8–10% | 6–8% | Yes |
| **Medium** | 4–7% | 3–5% | Yes, if underweight |
| **Starter** | 2–4% | 1–3% | Only to reach starter weight |
| **Exit** | → 0 | → 0 | No — trim/sell per §5 |

Conviction is reviewed **quarterly** (or on a material event) — that's the
council's "does it still belong?" job.

---

## 8. Explicitly out of scope for v1

- Leverage, leveraged ETFs, margin.
- Options (covered calls etc. — maybe v2).
- Day/swing trading, earnings gambles.
- Shorting.
- Crypto (separate decision if ever).

---

## 9. Benchmark & honesty check

Track Axiom's blended return vs **QQQ** and **VOO** buy-and-hold, from the first
funded day, net of estimated tax. Surface it on the Scorecard. Review at 6 and 12
months. If we're not beating QQQ, we simplify.

---

## 10. How the agents map to this rulebook

| Agent | Rulebook job |
|---|---|
| **SAGE** | §2 quality + §7 "does it still belong?" (quarterly thesis review) |
| **REX** | §4 entry rule — trend + not-extended check (uses computed facts) |
| **VEGA** | §5 "is the thesis broken?" — devil's-advocate thesis-breaker hunt |
| **ZEN** | §3 position & sector caps, §6 which name gets the contribution — using **real holdings** |
| **NOVA** | catalysts / news that should move a conviction tier |
| **ATLAS** | sector health — is a whole sector sleeve (e.g. semis) structurally rolling over |
| **AXIOM** | combines the above into the verdict: **ADD / HOLD / TRIM / EXIT** + conviction tier |

---

## Open questions for approval

1. Core/Satellite split — 70/30 about right, or more aggressive (60/40)?
2. Sector cap at 30% — or looser (35–40%) given you want a growth tilt?
3. Starter Core list — want me to propose ~12 quality names across sectors to
   build the Core toward, or pick them yourself?
4. ETF buffer — QQQ or VOO as the default park?
