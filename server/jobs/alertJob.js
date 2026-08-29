import { ACCOUNTS } from '../agents/definitions.js';
import { db } from '../lib/firebase.js';
import { sendPush } from '../routes/push.js';

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
        const dir = changePct > 0 ? '📈' : '📉';
        await sendPush(uid, {
          title: `${dir} ${ticker} alert — ${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%`,
          body: `${ticker} is ${changePct > 0 ? 'up' : 'down'} ${absChange.toFixed(1)}% from your cost basis of $${pos.cost.toFixed(2)}`,
          data: { ticker, account },
        }).catch(() => {});

        await alertDoc.ref.update({ lastNotified: Date.now() });
      }
    }
  }
}
