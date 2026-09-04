import { ACCOUNTS, DISCOVERY_POOL } from '../agents/definitions.js';
import { db } from '../lib/firebase.js';
import { notify } from '../lib/notify.js';
import { runCouncil } from '../lib/council.js';
import { getPortfolio } from '../lib/portfolio.js';
import { saveAnalysis } from '../lib/analyses.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Don't re-run the council on a name that already has a fresh verdict today.
const FRESH_MS = 20 * 60 * 60 * 1000;
const VERDICTS = new Set(['ADD', 'HOLD', 'TRIM', 'EXIT']);

/** Distinct tickers a portfolio actually holds (shares > 0, cash sweeps already stripped). */
function heldTickers(portfolio) {
  const set = new Set();
  for (const acct of portfolio?.accounts || []) {
    for (const p of acct.positions || []) {
      if (p.ticker && (p.shares || 0) > 0) set.add(p.ticker);
    }
  }
  return [...set];
}

/**
 * Run the full council on every name a user holds and persist it to
 * users/{uid}/analyses — the collection the Portfolio stance badges,
 * conviction tiers, and scorecard all read from. Without this the badges
 * only ever populate for tickers the user manually convened.
 */
export async function scoutHoldingsForUser(uid, { force = false } = {}) {
  let portfolio;
  try { portfolio = await getPortfolio(uid); } catch { return { uid, ran: 0 }; }
  const tickers = heldTickers(portfolio);
  if (!tickers.length) return { uid, ran: 0 };

  const col = db.collection(`users/${uid}/analyses`);
  let ran = 0;

  for (const ticker of tickers) {
    try {
      const snap = await col.where('ticker', '==', ticker).get();
      const prev = snap.docs
        .map(d => d.data())
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];

      if (!force) {
        // Skip only if it's genuinely fresh AND carries the current rating shape
        // (a valid verdict + a conviction tier). Re-run pre-tier analyses.
        const fresh = prev && Date.now() - (prev.ts || 0) < FRESH_MS;
        if (fresh && prev.tier && VERDICTS.has(prev.verdict)) continue;
      }
      const result = await runCouncil(ticker, { mode: 'scout', uid });
      const added = await saveAnalysis(uid, { ...result, trigger: 'scout' });
      ran++;
      console.log(`[scout:holdings] ${uid.slice(0, 6)}… ${ticker}: ${result.verdict} ${result.conviction}/10 · ${result.tier}`);

      // Rating change on a name you hold → surface it (was written silently).
      if (prev && VERDICTS.has(prev.verdict) && VERDICTS.has(result.verdict) && prev.verdict !== result.verdict) {
        await notify(uid, {
          kind: 'rating',
          severity: result.verdict === 'EXIT' ? 'critical' : 'review',
          ticker,
          title: `${ticker}: ${prev.verdict} → ${result.verdict}`,
          body: `The council changed its call — ${result.conviction}/10${result.headline ? ` · ${result.headline}` : ''}`,
          refKind: 'analysis', refId: added?.id || null,
          dedupeKey: `rating:${ticker}:${result.verdict}`,
        });
      }
    } catch (err) {
      console.error(`[scout:holdings] ${ticker} failed:`, err.message);
    }
    await sleep(2000);
  }
  return { uid, ran };
}

/** Every user's holdings (cron). Runs before the discovery sweep — the book matters most. */
export async function scoutAllHoldings({ force = false } = {}) {
  let users = [];
  try { users = (await db.collection('users').get()).docs.map(d => d.id); } catch { return 0; }
  let total = 0;
  for (const uid of users) {
    const { ran } = await scoutHoldingsForUser(uid, { force });
    total += ran;
  }
  console.log(`[scout:holdings] done — ${total} council runs across ${users.length} users`);
  return total;
}

export async function runDailyScout() {
  // 1. Refresh every held name for every user (drives stance badges + tiers).
  await scoutAllHoldings().catch(err => console.error('[scout:holdings] Error:', err.message));

  // 2. Discovery sweep — the shared idea pool (no per-user context).
  const tickers = [...new Set([
    ...Object.values(ACCOUNTS).flatMap(a => a.holdings),
    ...DISCOVERY_POOL,
  ])];

  const results = [];
  for (const ticker of tickers) {
    try {
      const result = await runCouncil(ticker, { mode: 'scout' });
      results.push(result);
      const scoutCol = db.collection('scoutResults');
      await scoutCol.add(result);
      // discovery.js's topDiscoveries only ever reads the newest run per
      // ticker -- this collection has been growing forever with dead older
      // runs nobody reads. Keep just the latest per ticker (~len(tickers)
      // docs total, permanently, instead of one more every day since launch).
      const stale = await scoutCol.where('ticker', '==', ticker).get().catch(() => null);
      if (stale && stale.docs.length > 1) {
        const sorted = stale.docs.sort((a, b) => (b.data().ts || 0) - (a.data().ts || 0));
        await Promise.all(sorted.slice(1).map((d) => d.ref.delete()));
      }
      console.log(`[scout] ${ticker}: ${result.verdict} (${result.conviction}/10)`);
    } catch (err) {
      console.error(`[scout] ${ticker} failed:`, err.message);
    }
    await sleep(2000);
  }

  // Notify subscribed users. Discovery ideas are NOT one-push-each any more —
  // that buried the phone in 15+ "AXIOM Scout: X — ADD" alerts at once. Instead:
  // a single digest line for the new ideas, and an individual push only for an
  // EXIT on a name actually held (that one's genuinely urgent).
  const held = new Set(Object.values(ACCOUNTS).flatMap(a => a.holdings));
  const ideas = results
    .filter(r => r.verdict === 'ADD' && r.conviction >= 8 && !held.has(r.ticker))
    .sort((a, b) => (b.conviction || 0) - (a.conviction || 0));
  const exits = results.filter(r => r.verdict === 'EXIT' && held.has(r.ticker));

  if (ideas.length || exits.length) {
    const usersSnap = await db.collection('users').get();
    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      for (const r of exits) {
        await notify(uid, {
          kind: 'scout', severity: 'critical', ticker: r.ticker,
          title: `Scout: EXIT ${r.ticker}`,
          body: r.headline || `The council would exit ${r.ticker}.`,
        });
      }
      if (ideas.length) {
        const names = ideas.slice(0, 5).map(r => r.ticker).join(', ');
        await notify(uid, {
          kind: 'scout', severity: 'fyi',
          title: `Scout — ${ideas.length} idea${ideas.length > 1 ? 's' : ''} worth a look`,
          body: `${names}${ideas.length > 5 ? ' …' : ''} — high-conviction ADD on names you don't own.`,
          path: '/?tab=floor',
          dedupeKey: `scout-ideas:${new Date().toISOString().slice(0, 10)}`,
        });
      }
    }
  }

  console.log(`[scout] Done. ${results.length} scanned, ${ideas.length} ideas + ${exits.length} exits.`);
  return results;
}
