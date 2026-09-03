/**
 * Financial Modeling Prep congress-trading adapter.
 * Free-tier API key at https://site.financialmodelingprep.com/developer/docs
 * Endpoints: /v4/senate-trading, /v4/senate-disclosure, and the RSS-style
 * /v4/senate-trading-rss-feed / /v4/senate-disclosure-rss-feed for "latest".
 */
import { safeJson } from '../fetchJson.js';

export const name = 'fmp';
export const ready = () => Boolean(process.env.FMP_API_KEY);

const KEY = () => process.env.FMP_API_KEY;

async function feed(path) {
  const r = await fetch(`https://financialmodelingprep.com/api/v4/${path}${path.includes('?') ? '&' : '?'}apikey=${KEY()}`);
  const d = await safeJson(r);
  return Array.isArray(d) ? d : [];
}

export async function fetch_({ ticker = null, days = 90 }) {
  let raw;
  if (ticker) {
    const [s, h] = await Promise.all([
      feed(`senate-trading?symbol=${ticker}`),
      feed(`senate-disclosure?symbol=${ticker}`),
    ]);
    raw = [...s, ...h];
  } else {
    // "latest across everyone" — the RSS feeds are paginated; grab the first pages
    const pages = Math.min(4, Math.ceil(days / 20));
    const all = await Promise.all(
      Array.from({ length: pages }, (_, i) => feed(`senate-trading-rss-feed?page=${i}`)),
    );
    const houseAll = await Promise.all(
      Array.from({ length: pages }, (_, i) => feed(`senate-disclosure-rss-feed?page=${i}`)),
    );
    raw = [...all.flat(), ...houseAll.flat()];
  }

  return raw.map((r) => ({
    member: r.representative || r.senator || `${r.firstName || ''} ${r.lastName || ''}`.trim() || r.office,
    chamber: r.representative || /house/i.test(r.office || '') ? 'House' : 'Senate',
    party: r.party || '',
    ticker: r.symbol,
    assetName: r.assetDescription || r.assetName || '',
    type: r.type || r.transactionType || r.transactionDate,
    amount: r.amount || r.range,
    txDate: r.transactionDate || r.dateRecieved,
    filedDate: r.disclosureDate || r.dateRecieved,
    url: r.link || '',
    source: 'FMP',
  }));
}

export { fetch_ as pull };
