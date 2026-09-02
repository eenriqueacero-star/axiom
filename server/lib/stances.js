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
    const r = latest.get(t);
    if (!r) {
      stances[t] = { verdict: null, analyzed: false };
      continue;
    }
    stances[t] = {
      verdict: r.verdict || null,
      conviction: r.conviction ?? null,
      headline: r.headline || '',
      ts: r.ts || null,
      stale: now - (r.ts || 0) > STALE_MS,
      broken: !!r.computed?.broken,
      downtrend: !!r.computed?.downtrend,
      analyzed: true,
    };
  }

  const counts = { ADD: 0, HOLD: 0, TRIM: 0, EXIT: 0, none: 0 };
  for (const s of Object.values(stances)) counts[s.verdict || 'none']++;

  return { ready: true, ts: now, counts, stances };
}
