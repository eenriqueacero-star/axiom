import { ACCOUNTS, DISCOVERY_POOL } from '../agents/definitions.js';
import { db } from '../lib/firebase.js';
import { sendPush } from '../routes/push.js';
import { runCouncil } from '../lib/council.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function runDailyScout() {
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
