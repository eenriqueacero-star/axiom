/**
 * Discovery digest — the daily scout runs the full council on a ~30-name
 * discovery pool and writes every result to the global `scoutResults`
 * collection. This surfaces the best of those: names the user does NOT own
 * that the council currently rates ADD (or a strong HOLD), ranked.
 *
 * Read-only Firestore; no LLM. Feeds the "worth a look" card on The Floor.
 */
import { db } from './firebase.js';
import { getPortfolio } from './portfolio.js';

const RANK = { ADD: 3, HOLD: 1, TRIM: 0, EXIT: -1 };
const STALE_MS = 5 * 24 * 60 * 60 * 1000;

export async function topDiscoveries(uid, limit = 6) {
  let runs = [];
  try {
    const snap = await db.collection('scoutResults').get();
    runs = snap.docs.map((d) => d.data());
  } catch {
    return [];
  }

  // newest scout run per ticker
  const latest = new Map();
  for (const r of runs) {
    if (!r?.ticker) continue;
    const cur = latest.get(r.ticker);
    if (!cur || (r.ts || 0) > (cur.ts || 0)) latest.set(r.ticker, r);
  }

  // names the user already holds — not "discovery"
  const held = new Set();
  try {
    const p = await getPortfolio(uid);
    for (const a of p.accounts || []) {
      for (const pos of a.positions || []) {
        if ((pos.shares || 0) > 0) held.add(pos.ticker);
      }
    }
  } catch { /* no portfolio — show everything */ }

  const now = Date.now();
  return [...latest.values()]
    .filter((r) => !held.has(r.ticker))
    .filter((r) => r.verdict === 'ADD' || r.verdict === 'HOLD')
    .filter((r) => now - (r.ts || 0) < STALE_MS)
    .sort((a, b) =>
      (RANK[b.verdict] - RANK[a.verdict])
      || ((b.conviction || 0) - (a.conviction || 0)),
    )
    .slice(0, limit)
    .map((r) => ({
      ticker: r.ticker,
      verdict: r.verdict,
      conviction: r.conviction ?? null,
      tier: r.tier || null,
      headline: r.headline || '',
      ts: r.ts || null,
    }));
}
