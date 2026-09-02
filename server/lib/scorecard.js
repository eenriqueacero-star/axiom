/**
 * Verdict scorecard. Every council analysis records the price at the time.
 * This scores each past analysis against what the stock actually did, and
 * aggregates hit rates by verdict and by agent stance.
 *
 * Firestore: users/{uid}/analyses/{id} gains { score: { asOf, days, perf, hit } }.
 */
import { db } from './firebase.js';
import { getQuote } from './quotes.js';

const AGENT_IDS = ['quality', 'trend', 'catalyst', 'bear', 'sector', 'sizing'];

// A verdict is "right" if the direction matched: ADD→up, TRIM/EXIT→down.
// HOLD is neutral. (Legacy BUY/SKIP/WATCH still handled for old rows.)
function isHit(verdict, perf) {
  if (verdict === 'ADD' || verdict === 'BUY') return perf > 0;
  if (verdict === 'TRIM' || verdict === 'EXIT' || verdict === 'SKIP') return perf < 0;
  return null;
}

// 5 trading-ish days is noisy for judging a long-term thesis, but it's enough to
// start calibrating the agents (was it right about the trend, the catalyst?) —
// and the scorecard keeps re-scoring at longer horizons as each analysis ages.
const SCORE_AFTER_DAYS = 5;

/** Score every analysis older than SCORE_AFTER_DAYS and not scored in the last 6d. */
export async function scoreUser(uid) {
  const snap = await db.collection(`users/${uid}/analyses`).get();
  const now = Date.now();
  let updated = 0;

  const quoteCache = new Map();
  const quote = async (t) => {
    if (!quoteCache.has(t)) quoteCache.set(t, await getQuote(t));
    return quoteCache.get(t);
  };

  for (const doc of snap.docs) {
    const a = doc.data();
    const ageDays = (now - (a.ts || 0)) / 864e5;
    if (ageDays < SCORE_AFTER_DAYS || !a.price) continue;
    const lastScored = a.score?.asOf || 0;
    if (now - lastScored < 6 * 864e5) continue; // re-score at most weekly

    const q = await quote(a.ticker);
    if (!q?.price) continue;
    const perf = (q.price - a.price) / a.price;
    await doc.ref.update({
      score: {
        asOf: now,
        days: Math.round(ageDays),
        perf: Number(perf.toFixed(4)),
        hit: isHit(a.verdict, perf),
      },
    });
    updated++;
  }
  return updated;
}

/** Run scoring for every user (cron). */
export async function scoreAllUsers() {
  const users = await db.collection('users').get();
  let total = 0;
  for (const u of users.docs) total += await scoreUser(u.id);
  return total;
}

/** Aggregate hit rates for one user's scored analyses. */
export async function aggregate(uid) {
  const snap = await db.collection(`users/${uid}/analyses`).get();
  const scored = snap.docs.map((d) => d.data()).filter((a) => a.score?.perf != null);

  const bucket = (rows) => ({
    n: rows.length,
    avgPerf: rows.length ? +(rows.reduce((s, r) => s + r.score.perf, 0) / rows.length).toFixed(4) : null,
    pctUp: rows.length ? +(rows.filter((r) => r.score.perf > 0).length / rows.length).toFixed(2) : null,
    hitRate: (() => {
      const h = rows.filter((r) => r.score.hit != null);
      return h.length ? +(h.filter((r) => r.score.hit).length / h.length).toFixed(2) : null;
    })(),
  });

  const byVerdict = {};
  for (const v of ['ADD', 'HOLD', 'TRIM', 'EXIT']) {
    byVerdict[v] = bucket(scored.filter((a) => a.verdict === v));
  }

  const byAgent = {};
  for (const id of AGENT_IDS) {
    byAgent[id] = {};
    for (const st of ['PASS', 'CAUTION', 'FAIL', 'BEARISH']) {
      const rows = scored.filter((a) => a.agents?.[id]?.stance === st);
      if (rows.length) byAgent[id][st] = bucket(rows);
    }
  }

  return { total: scored.length, byVerdict, byAgent, ts: Date.now() };
}
