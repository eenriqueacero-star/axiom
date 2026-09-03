/**
 * Congressional trading disclosures — provider-agnostic.
 *
 * Free no-signup sources are all dead as of 2026. Set ONE of these and the
 * feature switches on:
 *   UNUSUAL_WHALES_API_KEY — Unusual Whales (best: live, House + Senate, per-name)
 *   QUIVER_API_KEY         — Quiver Quantitative ($25/mo, live)
 *   FMP_API_KEY            — Financial Modeling Prep (free tier: senate + house)
 *
 * With none, congressConfigured() is false and the app hides the panel.
 */
import * as unusualwhales from './unusualwhales.js';
import * as quiver from './quiver.js';
import * as fmp from './fmp.js';

const providers = [unusualwhales, quiver, fmp];   // preference order

function active() {
  return providers.find((p) => p.ready());
}

export const congressConfigured = () => Boolean(active());
export const congressProvider = () => active()?.name || null;

const cache = new Map();
const TTL = 6 * 60 * 60 * 1000;

/**
 * Normalised trades, newest first. Every provider maps to:
 *   { id, member, chamber, party, ticker, assetName, type, amountLow,
 *     amountHigh, txDate, filedDate, source, url }
 * type ∈ 'buy' | 'sell' | 'exchange'
 */
export async function congressTrades({ ticker = null, days = 90 } = {}) {
  const p = active();
  if (!p) return [];

  const key = `${p.name}:${ticker || 'all'}:${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  let rows = [];
  try {
    rows = await p.pull({ ticker, days });
  } catch (err) {
    console.error(`[congress:${p.name}]`, err.message);
    return hit?.data || [];
  }

  const cutoff = Date.now() - days * 864e5;
  const out = rows
    .filter((r) => r.ticker && r.txDate)
    .map(normalise)
    .filter((r) => new Date(r.txDate).getTime() >= cutoff)
    .sort((a, b) => new Date(b.filedDate || b.txDate) - new Date(a.filedDate || a.txDate));

  cache.set(key, { ts: Date.now(), data: out });
  return out;
}

const AMOUNT_BANDS = [
  [1, 1000, 15000], [1001, 1001, 15000], [15001, 15001, 50000],
  [50001, 50001, 100000], [100001, 100001, 250000], [250001, 250001, 500000],
  [500001, 500001, 1000000], [1000001, 1000001, 5000000],
];

function parseAmount(s) {
  if (typeof s === 'number') return { low: s, high: s };
  const nums = String(s || '').match(/[\d,]+/g)?.map((n) => Number(n.replace(/,/g, ''))) || [];
  if (nums.length >= 2) return { low: nums[0], high: nums[1] };
  if (nums.length === 1) {
    const band = AMOUNT_BANDS.find(([lo]) => nums[0] <= lo) || AMOUNT_BANDS.at(-1);
    return { low: band[1], high: band[2] };
  }
  return { low: null, high: null };
}

function normType(t) {
  const s = String(t || '').toLowerCase();
  if (s.includes('sale') || s.includes('sell') || s === 's') return 'sell';
  if (s.includes('exchange')) return 'exchange';
  return 'buy';
}

function normalise(r) {
  const amt = parseAmount(r.amount ?? r.range ?? r.amountRange);
  const ticker = String(r.ticker || r.symbol || '').toUpperCase().replace(/\.US$/, '');
  return {
    id: r.id || `${r.member}|${ticker}|${r.txDate}|${r.type}`,
    member: r.member || r.representative || r.senator || r.name || 'Unknown',
    chamber: r.chamber || (r.senator ? 'Senate' : r.representative ? 'House' : r.chamber) || '',
    party: r.party || '',
    ticker,
    assetName: r.assetName || r.asset || r.company || '',
    type: normType(r.type || r.transactionType),
    amountLow: r.amountLow ?? amt.low,
    amountHigh: r.amountHigh ?? amt.high,
    txDate: (r.txDate || r.transactionDate || r.transaction_date || '').slice(0, 10),
    filedDate: (r.filedDate || r.disclosureDate || r.reportDate || '').slice(0, 10) || null,
    source: r.source || active()?.name || '',
    url: r.url || r.link || r.ptr_link || '',
  };
}
