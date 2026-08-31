/** Live quotes via Finnhub (free tier). 45s cache. */
import { safeJson } from './fetchJson.js';

const cache = new Map();
const TTL = 45_000;

export async function getQuote(ticker) {
  const sym = ticker.toUpperCase();
  const hit = cache.get(sym);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${process.env.FINNHUB_KEY}`;
  let data = { error: 'no_price' };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 800));
    const r = await fetch(url);
    if (r.status === 429) { data = { error: 'rate_limited' }; break; }
    const d = await safeJson(r);
    if (d && ((d.c ?? 0) > 0 || (d.pc ?? 0) > 0)) {
      data = { price: d.c, changePct: d.dp, change: d.d, high: d.h, low: d.l, open: d.o, prevClose: d.pc };
      break;
    }
  }
  cache.set(sym, { ts: Date.now(), data });
  return data;
}

export async function getQuotes(tickers) {
  const out = {};
  await Promise.all([...new Set(tickers)].map(async t => { out[t.toUpperCase()] = await getQuote(t); }));
  return out;
}
