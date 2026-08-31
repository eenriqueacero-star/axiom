/**
 * Per-user portfolio. Firestore users/{uid}/accounts/{accountId} holds
 * { label, sub, dca, dcaNote, holdings: { TICKER: { shares, costBasis } } }.
 * Seeded from agents/definitions.js ACCOUNTS on first read (shares 0).
 */
import { db } from './firebase.js';
import { ACCOUNTS } from '../agents/definitions.js';
import { getQuotes } from './quotes.js';

async function ensureSeeded(uid) {
  const col = db.collection(`users/${uid}/accounts`);
  const snap = await col.get();
  if (!snap.empty) return;
  await Promise.all(Object.entries(ACCOUNTS).map(([id, a]) =>
    col.doc(id).set({
      label: a.label, sub: a.sub, dca: a.dca, dcaNote: a.dcaNote,
      holdings: Object.fromEntries(a.holdings.map(t => [t, { shares: 0, costBasis: 0 }])),
      order: Object.keys(ACCOUNTS).indexOf(id),
    }),
  ));
}

export async function getPortfolio(uid) {
  await ensureSeeded(uid);
  const snap = await db.collection(`users/${uid}/accounts`).get();
  const accounts = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const tickers = [...new Set(accounts.flatMap(a => Object.keys(a.holdings || {})))];
  const quotes = await getQuotes(tickers);

  let totalValue = 0, totalCost = 0, dayChange = 0;
  const out = accounts.map(a => {
    const positions = Object.entries(a.holdings || {}).map(([ticker, h]) => {
      const q = quotes[ticker] || {};
      const value = (h.shares || 0) * (q.price || 0);
      const cost = (h.shares || 0) * (h.costBasis || 0);
      totalValue += value; totalCost += cost;
      dayChange += (h.shares || 0) * (q.change || 0);
      return {
        ticker, shares: h.shares || 0, costBasis: h.costBasis || 0,
        price: q.price ?? null, changePct: q.changePct ?? null,
        value, gain: cost ? value - cost : null,
        gainPct: cost ? (value - cost) / cost : null,
      };
    }).sort((x, y) => y.value - x.value);
    const acctValue = positions.reduce((s, p) => s + p.value, 0);
    return { id: a.id, label: a.label, sub: a.sub, dca: a.dca, dcaNote: a.dcaNote, value: acctValue, positions };
  });

  return {
    accounts: out,
    totals: {
      value: totalValue,
      cost: totalCost,
      gain: totalCost ? totalValue - totalCost : null,
      gainPct: totalCost ? (totalValue - totalCost) / totalCost : null,
      dayChange,
      dayChangePct: totalValue ? dayChange / (totalValue - dayChange) : null,
    },
    ts: Date.now(),
  };
}

export async function setHolding(uid, accountId, ticker, { shares, costBasis }) {
  const sym = ticker.toUpperCase();
  const ref = db.doc(`users/${uid}/accounts/${accountId}`);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('No such account');
  const holdings = doc.data().holdings || {};
  const cur = holdings[sym] || { shares: 0, costBasis: 0 };
  holdings[sym] = {
    shares: shares != null ? Number(shares) : cur.shares,
    costBasis: costBasis != null ? Number(costBasis) : cur.costBasis,
  };
  await ref.update({ holdings });
}

export async function addTicker(uid, accountId, ticker) {
  await setHolding(uid, accountId, ticker, { shares: 0, costBasis: 0 });
}

export async function removeTicker(uid, accountId, ticker) {
  const ref = db.doc(`users/${uid}/accounts/${accountId}`);
  const doc = await ref.get();
  if (!doc.exists) return;
  const holdings = doc.data().holdings || {};
  delete holdings[ticker.toUpperCase()];
  await ref.update({ holdings });
}
