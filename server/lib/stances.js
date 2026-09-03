/**
 * Per-holding council stance — the latest verdict the council has on every name
 * the user actually owns. Pure Firestore read of users/{uid}/analyses; no LLM
 * calls, so it's cheap enough to load with the portfolio view.
 *
 * The daily scout already runs the full council on every holding, so in normal
 * operation these verdicts stay fresh on their own. `stale` just flags the ones
 * that have aged out (scout skipped, or a name added since the last run).
 */
import { db } from './firebase.js';
import { getPortfolio } from './portfolio.js';

const STALE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/** The firm's aggregate position in one name: shares, avg cost, unrealised P&L. */
function positionEconomics(portfolio, sym) {
  let shares = 0, cost = 0, value = 0;
  for (const a of portfolio?.accounts || []) {
    for (const p of a.positions || []) {
      if (p.ticker !== sym) continue;
      shares += p.shares || 0;
      value += p.value || 0;
      cost += (p.costBasis || 0) * (p.shares || 0);
    }
  }
  if (shares <= 0) return null;
  const known = cost > 0;
  return {
    shares, value,
    avgCost: known ? cost / shares : null,
    unreal: known ? value - cost : null,
    unrealPct: known ? (value - cost) / cost : null,
  };
}

// The current rulebook vocabulary. Old analyses carry legacy verdicts
// (BUY/SKIP/WATCH) from before the council rework — ignore those and let the
// badge prompt a fresh run instead of showing a stance the rulebook can't mean.
const VERDICTS = new Set(['ADD', 'HOLD', 'TRIM', 'EXIT']);

// First sentence of the AXIOM rationale, markdown stripped — a one-line "why"
// for the Portfolio rows without shipping the whole paragraph.
function firstSentence(text) {
  if (!text) return '';
  const clean = String(text).replace(/\*\*(.+?)\*\*/g, '$1').replace(/[*`_#>]/g, '').trim();
  const m = clean.match(/^.*?[.!?](?=\s|$)/);
  return (m ? m[0] : clean).slice(0, 150).trim();
}

/** Distinct tickers the user holds right now (cash sweeps already stripped by getPortfolio). */
function heldTickers(portfolio) {
  const set = new Set();
  for (const acct of portfolio?.accounts || []) {
    for (const p of acct.positions || []) {
      if (p.ticker && (p.shares || 0) > 0) set.add(p.ticker);
    }
  }
  return [...set];
}

export async function buildStances(uid) {
  const portfolio = await getPortfolio(uid).catch(() => null);
  const tickers = heldTickers(portfolio);
  if (!tickers.length) return { ready: false, stances: {} };

  let runs = [];
  try {
    const snap = await db.collection(`users/${uid}/analyses`).get();
    runs = snap.docs.map((d) => d.data());
  } catch {
    return { ready: false, stances: {} };
  }

  // newest run per ticker
  const latest = new Map();
  for (const r of runs) {
    if (!r?.ticker) continue;
    const cur = latest.get(r.ticker);
    if (!cur || (r.ts || 0) > (cur.ts || 0)) latest.set(r.ticker, r);
  }

  const now = Date.now();
  const stances = {};
  for (const t of tickers) {
    const econ = positionEconomics(portfolio, t);
    const r = latest.get(t);
    if (!r || !VERDICTS.has(r.verdict)) {
      stances[t] = { verdict: null, analyzed: false, econ };
      continue;
    }
    stances[t] = {
      verdict: r.verdict || null,
      conviction: r.conviction ?? null,
      mandate: r.mandate || (r.computed?.broken || r.computed?.downtrendExit || r.computed?.concentrationTrim ? 'decision' : 'suggestion'),
      tier: r.tier || null,
      tierReasons: r.tierReasons || [],
      headline: r.headline || '',
      summary: firstSentence(r.rationale) || r.headline || '',
      ts: r.ts || null,
      stale: now - (r.ts || 0) > STALE_MS,
      broken: !!r.computed?.broken,
      downtrend: !!r.computed?.downtrend,
      econ,
      analyzed: true,
    };
  }

  const counts = { ADD: 0, HOLD: 0, TRIM: 0, EXIT: 0, none: 0 };
  const tierCounts = { HIGH: 0, MEDIUM: 0, LOW: 0, SPECULATIVE: 0, none: 0 };
  for (const s of Object.values(stances)) {
    counts[s.verdict || 'none']++;
    tierCounts[s.tier || 'none']++;
  }

  return { ready: true, ts: now, counts, tierCounts, stances };
}
