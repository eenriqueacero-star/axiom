/**
 * Per-user portfolio. Firestore users/{uid}/accounts/{accountId} holds
 * { label, sub, dca, dcaNote, holdings: { TICKER: { shares, costBasis } } }.
 * Seeded from agents/definitions.js ACCOUNTS on first read (shares 0).
 */
import { db } from './firebase.js';
import { ACCOUNTS } from '../agents/definitions.js';
import { getQuotes } from './quotes.js';

// Fidelity/Schwab/Vanguard core cash sweeps — treat as cash, not a stock.
const CASH_FUNDS = new Set([
  'SPAXX', 'FDRXX', 'FZFXX', 'FZDXX', 'SPRXX', 'FDLXX', 'FGXX',
  'VMFXX', 'VMRXX', 'VUSXX', 'SWVXX', 'SNVXX', 'SNSXX', 'CASH', 'USD',
]);

async function ensureSeeded(uid) {
  // No auto-seed — new portfolios start empty; user links a broker or pastes positions.
  // (Old seeded Edwin/Dad/Bro accounts stay until the user deletes them.)
  const col = db.collection(`users/${uid}/accounts`);
  const seeded = await db.doc(`users/${uid}`).get().then(d => d.data()?.portfolioSeeded);
  if (seeded) return;
  const snap = await col.limit(1).get();
  if (snap.empty) {
    await Promise.all(Object.entries(ACCOUNTS).map(([id, a]) =>
      col.doc(id).set({
        label: a.label, sub: a.sub, dca: a.dca, dcaNote: a.dcaNote,
        holdings: Object.fromEntries(a.holdings.map(t => [t, { shares: 0, costBasis: 0 }])),
        order: Object.keys(ACCOUNTS).indexOf(id),
      }),
    ));
  }
  await db.doc(`users/${uid}`).set({ portfolioSeeded: true }, { merge: true });
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
    let cash = 0;
    const positions = Object.entries(a.holdings || {}).flatMap(([ticker, h]) => {
      const shares = h.shares || 0;
      if (CASH_FUNDS.has(ticker)) {          // money-market sweep → cash, $1 NAV
        cash += shares;
        totalValue += shares;
        return [];
      }
      const q = quotes[ticker] || {};
      const value = shares * (q.price || 0);
      const cost = shares * (h.costBasis || 0);
      totalValue += value; totalCost += cost;
      dayChange += shares * (q.change || 0);
      return [{
        ticker, shares, costBasis: h.costBasis || 0,
        price: q.price ?? null, changePct: q.changePct ?? null,
        value, gain: cost ? value - cost : null,
        gainPct: cost ? (value - cost) / cost : null,
      }];
    }).sort((x, y) => y.value - x.value);
    const acctValue = positions.reduce((s, p) => s + p.value, 0) + cash;
    return {
      id: a.id, label: a.label, sub: a.sub, dca: a.dca, dcaNote: a.dcaNote,
      linked: a.linked || false, syncedAt: a.syncedAt || null,
      cash, value: acctValue, positions,
    };
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

/**
 * Parse a pasted positions blob. Tolerant of broker copy-paste and CSV:
 *   NVDA 12
 *   NVDA, 12, 180.50
 *   NVDA   12 shares   $180.50 avg
 *   "NVIDIA Corp"  NVDA  12  $2,649.36
 * Returns [{ ticker, shares, costBasis }].
 */
const isTicker = (t) => /^[A-Z]{1,5}([.\-][A-Z])?$/.test(t);
const num = (t) => parseFloat(String(t).replace(/[,$\s"]/g, ''));

// CSV split that respects "quoted, fields"
function csvSplit(line) {
  const out = [];
  let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function parseLine(line) {
  // a real comma delimiter has a non-digit on at least one side; "2,649" is a number
  const looksCsv = /\D\s*,/.test(line) || /,\s*(?:\D|$)/.test(line);
  const fields = looksCsv ? csvSplit(line) : line.replace(/\$/g, ' ').split(/\s+/).filter(Boolean);
  // each field may itself hold whitespace-separated sub-tokens (broker paste in one cell)
  const parts = fields.flatMap(f => f.split(/\s+/).filter(Boolean));

  const idx = parts.findIndex(isTicker);
  if (idx === -1) return null;
  const nums = parts.slice(idx + 1).map(num).filter(n => Number.isFinite(n) && n > 0);
  if (!nums.length) return null;
  return { ticker: parts[idx], shares: nums[0], costBasis: nums.length > 1 ? nums[1] : 0 };
}

export function parsePositions(text) {
  const map = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const row = line.trim() && parseLine(line.trim());
    if (row) map.set(row.ticker, row);            // de-dupe, last wins
  }
  return [...map.values()];
}

export async function importPositions(uid, accountId, text) {
  const parsed = parsePositions(text);
  if (!parsed.length) throw new Error('Could not find any positions in that text');
  const ref = db.doc(`users/${uid}/accounts/${accountId}`);
  const doc = await ref.get();
  if (!doc.exists) throw new Error('No such account');
  const holdings = { ...(doc.data().holdings || {}) };
  for (const p of parsed) {
    holdings[p.ticker] = { shares: p.shares, costBasis: p.costBasis || holdings[p.ticker]?.costBasis || 0 };
  }
  await ref.update({ holdings });
  return parsed;
}

export async function removeTicker(uid, accountId, ticker) {
  const ref = db.doc(`users/${uid}/accounts/${accountId}`);
  const doc = await ref.get();
  if (!doc.exists) return;
  const holdings = doc.data().holdings || {};
  delete holdings[ticker.toUpperCase()];
  await ref.update({ holdings });
}

export async function deleteAccount(uid, accountId) {
  await db.doc(`users/${uid}/accounts/${accountId}`).delete();
}
