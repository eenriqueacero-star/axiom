/**
 * Unusual Whales congress-trading adapter — the best source (live, House +
 * Senate, per-politician, per-ticker). Bearer token from unusualwhales.com.
 * Docs: https://api.unusualwhales.com/docs  ·  agent guide: https://unusualwhales.com/skill.md
 */
import { safeJson } from '../fetchJson.js';

export const name = 'unusualwhales';
export const ready = () => Boolean(process.env.UNUSUAL_WHALES_API_KEY);

const HEADERS = () => ({
  Authorization: `Bearer ${process.env.UNUSUAL_WHALES_API_KEY}`,
  Accept: 'application/json',
});

async function get(path) {
  const r = await fetch(`https://api.unusualwhales.com/api/${path}`, { headers: HEADERS() });
  const d = await safeJson(r);
  // UW responses are usually { data: [...] }, sometimes a bare array
  return Array.isArray(d) ? d : Array.isArray(d?.data) ? d.data : [];
}

export async function pull({ ticker = null, days = 90 }) {
  const rows = ticker
    ? await get(`congress/congress-trader?ticker=${ticker}`)
    : await get(`congress/recent-trades?limit=500`);

  return rows.map((x) => ({
    member: x.reporter || x.politician || x.member || x.name || x.full_name,
    chamber: x.chamber || (/sen/i.test(x.reporter_type || x.type || '') ? 'Senate' : /rep|house/i.test(x.reporter_type || x.type || '') ? 'House' : ''),
    party: x.party || '',
    ticker: x.ticker,
    assetName: x.issuer || x.security || x.asset_description || '',
    type: x.txn_type || x.transaction_type || x.type,
    amount: x.amounts || x.amount || x.value,
    txDate: x.transaction_date || x.txn_date || x.traded,
    filedDate: x.report_date || x.disclosure_date || x.filed_at,
    url: x.pdf_url || x.filing_url || '',
    source: 'Unusual Whales',
  })).filter((r) => r.ticker);
}
