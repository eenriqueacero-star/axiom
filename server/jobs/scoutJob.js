import { ACCOUNTS, DISCOVERY_POOL } from '../agents/definitions.js';
import { db } from '../lib/firebase.js';
import { sendPush } from '../routes/push.js';
import { runCouncil } from '../lib/council.js';
import { getPortfolio } from '../lib/portfolio.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Don't re-run the council on a name that already has a fresh verdict today.
const FRESH_MS = 20 * 60 * 60 * 1000;

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
      if (!force) {
        const snap = await col.where('ticker', '==', ticker).get();
        const latest = snap.docs
          .map(d => d.data())
          .sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
        if (latest && Date.now() - (latest.ts || 0) < FRESH_MS) continue;
      }
      const result = await runCouncil(ticker, { mode: 'scout', uid });
      await col.add(result);
      ran++;
      console.log(`[scout:holdings] ${uid.slice(0, 6)}… ${ticker}: ${result.verdict} ${result.conviction}/10 · ${result.tier}`);
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
      await db.collection('scoutResults').add(result);
      console.log(`[scout] ${ticker}: ${result.verdict} (${result.conviction}/10)`);
    } catch (err) {
      console.error(`[scout] ${ticker} failed:`, err.message);
    }
    await sleep(2000);
  }

  // Notify subscribed users about strong ADD calls and any EXIT on a held name.
  const held = new Set(Object.values(ACCOUNTS).flatMap(a => a.holdings));
  const alerts = results.filter(r =>
    (r.verdict === 'ADD' && r.conviction >= 7) ||
    (r.verdict === 'EXIT' && held.has(r.ticker)),
  );
  if (alerts.length) {
    const usersSnap = await db.collection('users').get();
    for (const userDoc of usersSnap.docs) {
      for (const r of alerts) {
        await sendPush(userDoc.id, {
          title: `AXIOM Scout: ${r.ticker} — ${r.verdict}`,
          body: r.headline || `Conviction ${r.conviction}/10`,
          data: { ticker: r.ticker, verdict: r.verdict },
        }).catch(() => {});
      }
    }
  }

  console.log(`[scout] Done. ${results.length} scanned, ${alerts.length} alerts.`);
  return results;
}
