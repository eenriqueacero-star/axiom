/**
 * Insider transactions (SEC Form 4) via Finnhub — the "do the people who run
 * this company buy their own stock?" signal. Open-market purchases by officers
 * and directors are one of the few insider signals with real predictive weight;
 * cluster selling is a softer caution flag (often scheduled 10b5-1, so a higher
 * bar). Degrades to empty when the data isn't available.
 */
import { safeJson } from './fetchJson.js';

// Form 4 transaction codes. P = open-market buy, S = open-market sell — the
// discretionary ones. A/M/F/G (grants, option exercises, tax, gifts) are noise.
const BUY = 'P';
const SELL = 'S';

const fmtUsd = (n) => (n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}k`);

export async function insiderActivity(ticker, { days = 90 } = {}) {
  const FINNHUB = process.env.FINNHUB_KEY;
  if (!FINNHUB) return null;
  const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);

  let raw;
  try {
    const res = await fetch(`https://finnhub.io/api/v1/stock/insider-transactions?symbol=${ticker}&from=${from}&to=${to}&token=${FINNHUB}`);
    raw = await safeJson(res);
  } catch { return null; }
  const rows = raw?.data;
  if (!Array.isArray(rows) || !rows.length) return null;

  const cutoff = Date.now() - days * 864e5;
  const buyers = new Map();   // name -> { shares, value }
  const sellers = new Map();
  let buyValue = 0, sellValue = 0;

  for (const r of rows) {
    const code = String(r.transactionCode || '').toUpperCase();
    if (code !== BUY && code !== SELL) continue;
    const when = new Date(r.transactionDate || r.filingDate || 0).getTime();
    if (!when || when < cutoff) continue;
    const shares = Math.abs(r.change || 0);
    const price = r.transactionPrice || 0;
    const value = shares * price;
    const bucket = code === BUY ? buyers : sellers;
    const cur = bucket.get(r.name) || { shares: 0, value: 0 };
    cur.shares += shares; cur.value += value;
    bucket.set(r.name, cur);
    if (code === BUY) buyValue += value; else sellValue += value;
  }
  if (!buyers.size && !sellers.size) return null;

  // A real cluster buy: 2+ distinct insiders buying, and buying outweighs selling.
  const clusterBuy = buyers.size >= 2 && buyValue >= sellValue;
  // Selling is noisier — need 3+ sellers and selling dwarfing any buying.
  const clusterSell = sellers.size >= 3 && sellValue > Math.max(buyValue * 5, 1e6);

  return {
    ticker, days,
    buyers: [...buyers.keys()], sellers: [...sellers.keys()],
    buyValue, sellValue, clusterBuy, clusterSell,
  };
}

/** One-line block for the council's LIVE DATA. */
export function insiderBlock(a) {
  if (!a) return '';
  const parts = [];
  if (a.buyers.length) parts.push(`${a.buyers.length} insider${a.buyers.length > 1 ? 's' : ''} bought ${fmtUsd(a.buyValue)}`);
  if (a.sellers.length) parts.push(`${a.sellers.length} sold ${fmtUsd(a.sellValue)}`);
  if (!parts.length) return '';
  let tag = '';
  if (a.clusterBuy) tag = ' — CLUSTER BUY (multiple insiders adding, a genuine positive)';
  else if (a.clusterSell) tag = ' — heavy insider selling (often scheduled; weigh lightly)';
  return `\nINSIDER ACTIVITY in ${a.ticker} (last ${a.days} days): ${parts.join(', ')}.${tag}\n`;
}

/** Short headline for a signal / push. */
export function insiderHeadline(a) {
  if (a?.clusterBuy) return `${a.buyers.length} insiders bought ${a.ticker} (${fmtUsd(a.buyValue)}) — cluster buy`;
  if (a?.clusterSell) return `${a.sellers.length} insiders sold ${a.ticker} (${fmtUsd(a.sellValue)})`;
  return '';
}
