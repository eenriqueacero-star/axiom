# Verdict engine redesign — scope (not yet built)

2026-09-04. User's concern: the council reduces every stock to the same
fixed set of yes/no checks (`qualityBusiness`, `aboveLongTermAvg`, `noRedFlags`,
...), then a formula in `scoreCouncil()` turns those into ADD/HOLD/TRIM/EXIT.
That doesn't bend per company — a pre-revenue biotech and a 40-year-old bank
get asked the identical checklist. The ask: let agents genuinely research and
reason in terms that fit the specific stock, using tools/data, and improve
their own judgment over time — not force everything through one rigid form.

## Why it's a fixed checklist today (context, not an excuse)

It wasn't the original design. The first version had agents emit freeform
0-10 scores. That got reworked on 2026-09-01 specifically because freeform
scoring was unreliable — verdicts felt arbitrary and could drift between
runs on the same facts. The checklist was the fix for that failure, not an
arbitrary choice.

## The tension

- Freeform reasoning end-to-end → per-stock nuance, but verdicts can drift
  and become hard to trust or explain ("why EXIT?" → "the AI felt like it").
- Fixed checklist end-to-end → predictable and explainable, but generic —
  the same 5-6 questions can't capture what actually matters for every
  company.

## Proposed shape: hybrid, not a full reversion

**1. Hard gates stay mechanical, non-negotiable, in code.**
These aren't opinions — they're the firm's actual risk rules and should stay
bulletproof and explainable:
  - Thesis broken (VEGA's `thesisBreaker`) → EXIT
  - Position over 1.5× its own cap → TRIM for size
  - Confirmed downtrend + weak fundamentals → EXIT
These three already exist in `scoreCouncil()` (`server/lib/council.js`) and
should not become "AI's call" — they're closer to compliance rules than
judgment.

**2. Each agent's reasoning becomes genuinely open, per stock.**
Instead of forcing `qualityBusiness: true/false` on every ticker, SAGE (say)
gets a prompt like: "Assess this business's durability and growth using
whatever's actually relevant — for a biotech that's pipeline/cash runway,
for a bank that's net interest margin/credit quality, for a REIT that's
occupancy/cap rates. Explain your reasoning." The agent still returns a
structured note AXIOM can use, but the *content* isn't shoehorned into 5
generic booleans anymore.

**3. AXIOM synthesizes the verdict from that open reasoning — constrained.**
Not "AXIOM decides freely." The synthesis prompt is bounded: it must respect
the hard gates from #1, must ground the call in what the agents actually
said (no inventing reasons), and produces a verdict + a real explanation of
which agent inputs drove it.

**4. Agents already have a "gets smarter over time" mechanism — reuse it.**
This part doesn't need inventing: `agentWeights.js` (numeric — scorecard
outcomes tune a per-agent vote multiplier) and `calibration.js` +
`playbooks.js` (qualitative — agents rewrite their own prompt/approach based
on how past calls played out) already exist and already feed into every
run. The redesign should feed the *new* freeform verdicts into the same
scorecard/calibration loop, not build a second learning system.

**5. The stability watchdog (shipped 2026-09-04) is the safety net for this.**
`server/lib/verdictAudit.js` fingerprints agent inputs and flags when an
identical same-day input produces a different verdict. Before cutting over,
run the new hybrid engine in *shadow mode* (compute both old and new
verdicts, log both, serve the old one) for a stretch, and use the watchdog
data to see how often the new engine disagrees with itself before trusting
it to go live.

## What actually changes, file by file (draft — not final)

- `server/agents/definitions.js` — per-agent prompts move from "answer these
  5 fixed fields" to "here's your remit and the tools/data available; assess
  this stock's [X] and explain your reasoning" + a smaller set of fields
  that stay structured (enough for the hard gates to still compute — e.g.
  VEGA must still explicitly answer `thesisBreaker: bool` even in a freeform
  regime, because that's a hard gate).
- `server/lib/council.js` `scoreCouncil()` — keeps the 3 hard gates as-is;
  everything else (the current point-scoring formula) gets replaced by an
  AXIOM synthesis call that reads the agents' open reasoning and proposes
  ADD/HOLD/TRIM/EXIT, which then gets gate-checked against #1 before it's
  final (gates can still force an override even if AXIOM's synthesis
  disagreed).
- `convictionTier()` — same treatment: currently a point formula off fixed
  checks; needs a version that works off open reasoning instead.
- Scorecard/calibration — should work largely unchanged (they consume
  verdict + outcome, not the internal checks), but confirm they don't assume
  the fixed check shape anywhere.

## Open questions for the user before building

1. Which checks are hard gates (must stay mechanical) vs. which become part
   of the open reasoning? Draft above proposes 3 gates — is that the right
   list, more, fewer?
2. Shadow-mode cutover — comfortable running old + new in parallel (extra
   Groq calls) for a trial period before switching the Queue/Portfolio over
   to the new verdicts?
3. Per-agent prompts still need *some* structure so downstream code (Queue
   tags, VerdictBanner, agent weighting) has something to key off — should
   each agent's fixed field just be "one-line stance: bullish/neutral/
   bearish" instead of multiple booleans, or keep multiple but agent-defined
   per sector?

## Where this sits relative to the connectivity plan

Independent of `docs/PLAN_CONNECTIVITY.md` — that plan is about *wiring*
(does chat know your portfolio, does the boss see signals); this one is
about *how a verdict gets computed* in the first place. Finish connectivity
first (in progress), then scope this properly with the user's answers above
before writing any code.
