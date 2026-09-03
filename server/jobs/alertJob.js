import { ACCOUNTS } from '../agents/definitions.js';
import { db } from '../lib/firebase.js';
import { notify, notifyBatch } from '../lib/notify.js';
import { getPortfolio } from '../lib/portfolio.js';
import { runCouncil } from '../lib/council.js';

const BIG_MOVE_PCT = 8;              // a day move this large re-opens the case
const REVIEW_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/**
 * Event-driven re-review. Runs on the market-hours cron: any holding that's moved
 * ≥8% on the day gets a fresh council run (which now pulls "why it's moving" news),
 * and the user gets pushed the new verdict. No waiting for tomorrow's 9:05 scout.
 */
export async function runMoveReview() {
  let users = [];
  try { users = (await db.collection('users').get()).docs.map(d => d.id); } catch { return 0; }

  let reviewed = 0;
  for (const uid of users) {
    let portfolio;
    try { portfolio = await getPortfolio(uid); } catch { continue; }

    const movers = new Map();
    for (const acct of portfolio.accounts || []) {
      for (const p of acct.positions || []) {
        if ((p.shares || 0) > 0 && p.changePct != null && Math.abs(p.changePct) >= BIG_MOVE_PCT) {
          movers.set(p.ticker, p.changePct);
        }
      }
    }
    if (!movers.size) continue;

    const col = db.collection(`users/${uid}/analyses`);
    const pending = [];
    for (const [ticker, changePct] of movers) {
      try {
        const snap = await col.where('ticker', '==', ticker).get();
        const latest = snap.docs.map(d => d.data()).sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
        if (latest && Date.now() - (latest.ts || 0) < REVIEW_COOLDOWN_MS) continue;

        const result = await runCouncil(ticker, { mode: 'scout', uid });
        const added = await col.add({ ...result, trigger: 'move' });
        reviewed++;
        pending.push({
          kind: 'move',
          severity: Math.abs(changePct) >= 12 ? 'critical' : 'review',
          ticker,
          title: `${ticker} ${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}% — council re-reviewed`,
          body: `${result.verdict} ${result.conviction}/10${result.headline ? ` · ${result.headline}` : ''}`,
          refKind: 'analysis', refId: added?.id || null,
        });
      } catch (err) {
        console.error(`[move-review] ${ticker}:`, err.message);
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    // A broad selloff can move many names at once — coalesce the routine ones.
    const critical = pending.filter((p) => p.severity === 'critical');
    const routine = pending.filter((p) => p.severity !== 'critical');
    for (const p of critical) await notify(uid, p);
    if (routine.length) {
      await notifyBatch(uid, routine, {
        title: `${routine.length} holdings moved — re-reviewed`,
        body: routine.map((p) => `${p.ticker} ${p.title.match(/[+-][\d.]+%/)?.[0] || ''}`).join(', '),
        path: '/?tab=notifications',
      });
    }
  }
  if (reviewed) console.log(`[move-review] re-reviewed ${reviewed} big movers`);
  return reviewed;
}

const FINNHUB = () => process.env.FINNHUB_KEY;

async function getPrice(ticker) {
  try {
    const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB()}`);
    if (!r.ok) return null;
    const d = await r.json();
    return d.c > 0 ? d.c : d.pc || null;
  } catch { return null; }
}

export async function runPortfolioAlerts() {
  const allTickers = [...new Set(Object.values(ACCOUNTS).flatMap(a => a.holdings))];

  // Get all users
  const usersSnap = await db.collection('users').get();
  if (usersSnap.empty) return;

  // Fetch prices once for all tickers
  const prices = {};
  for (const ticker of allTickers) {
    prices[ticker] = await getPrice(ticker);
    await new Promise(r => setTimeout(r, 200));
  }

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;

    // Get user's alert settings
    const alertsSnap = await db.collection(`users/${uid}/alerts`).get();
    if (alertsSnap.empty) continue;

    // Get user's positions for cost basis
    const posSnap = await db.doc(`users/${uid}/data/positions`).get().catch(() => null);
    const positions = posSnap?.data()?.positions || {};

    for (const alertDoc of alertsSnap.docs) {
      const alert = alertDoc.data();
      const { ticker, account, threshold = 5, lastNotified = 0 } = alert;

      // Don't spam — 4 hour cooldown per alert
      if (Date.now() - lastNotified < 4 * 3600000) continue;

      const price = prices[ticker];
      if (!price) continue;

      const pos = positions[account]?.[ticker];
      if (!pos?.cost) continue;

      const changePct = ((price - pos.cost) / pos.cost) * 100;
      const absChange = Math.abs(changePct);

      if (absChange >= threshold) {
        await notify(uid, {
          kind: 'move', severity: 'review', ticker,
          title: `${ticker} alert — ${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%`,
          body: `${ticker} is ${changePct > 0 ? 'up' : 'down'} ${absChange.toFixed(1)}% from your cost basis of $${pos.cost.toFixed(2)}`,
        });

        await alertDoc.ref.update({ lastNotified: Date.now() });
      }
    }
  }
}
