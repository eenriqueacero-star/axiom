/**
 * kadoa-org/congress-trading-monitor — a free, no-key, actively maintained
 * dataset built from the House Clerk + Senate eFD disclosures. Structured JSON,
 * per-ticker and all-trades files, refreshed daily.
 *
 * https://github.com/kadoa-org/congress-trading-monitor
 * Set CONGRESS_KADOA=off to disable (e.g. if the repo goes stale).
 */
export const name = 'kadoa';
export const ready = () => process.env.CONGRESS_KADOA !== 'off';

const RAW = 'https://raw.githubusercontent.com/kadoa-org/congress-trading-monitor/HEAD/public/data';

// The all-trades file is ~4MB — cache it hard.
let allCache = null;
const ALL_TTL = 8 * 60 * 60 * 1000;

// raw.githubusercontent serves .json as text/plain — parse the body ourselves.
async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`kadoa ${r.status} for ${url.split('/').pop()}`);
  return JSON.parse(await r.text());
}

async function allTrades() {
  if (allCache && Date.now() - allCache.ts < ALL_TTL) return allCache.data;
  const d = await fetchJson(`${RAW}/trades.json`);
  const rows = Array.isArray(d) ? d : d?.trades || [];
  allCache = { ts: Date.now(), data: rows };
  return rows;
}

export async function pull({ ticker = null, days = 90 }) {
  let rows;
  if (ticker) {
    try {
      const d = await fetchJson(`${RAW}/ticker/${encodeURIComponent(ticker)}.json`);
      rows = Array.isArray(d) ? d : d?.trades || [];
    } catch {
      rows = (await allTrades()).filter((r) => String(r.ticker).toUpperCase() === ticker);
    }
  } else {
    const cutoff = Date.now() - days * 864e5;
    rows = (await allTrades()).filter((r) => {
      const t = new Date(r.transaction_date || r.filing_date).getTime();
      return Number.isFinite(t) && t >= cutoff;
    });
  }

  return rows.map((r) => ({
    id: r.id,
    member: r.filer_name || r.filer_id,
    chamber: (r.chamber || '').replace(/^\w/, (c) => c.toUpperCase()),
    party: r.party || '',
    ticker: r.ticker,
    assetName: r.asset_name || '',
    type: r.transaction_type,
    amountLow: r.amount_range_low ?? null,
    amountHigh: r.amount_range_high ?? null,
    amount: r.amount_range_label,
    txDate: r.transaction_date,
    filedDate: r.filing_date,
    url: r.doc_url || '',
    source: 'House Clerk / Senate eFD',
  })).filter((r) => r.ticker);
}
