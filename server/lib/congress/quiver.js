/**
 * Quiver Quantitative congress-trading adapter ($25/mo — the cleanest, most
 * current source; House + Senate, per-member, per-ticker).
 * Key + docs: https://www.quiverquant.com/api
 */
import { safeJson } from '../fetchJson.js';

export const name = 'quiver';
export const ready = () => Boolean(process.env.QUIVER_API_KEY);

const HEADERS = () => ({ Authorization: `Bearer ${process.env.QUIVER_API_KEY}`, Accept: 'application/json' });

export async function fetch_({ ticker = null }) {
  const url = ticker
    ? `https://api.quiverquant.com/beta/historical/congresstrading/${ticker}`
    : 'https://api.quiverquant.com/beta/live/congresstrading';
  const r = await fetch(url, { headers: HEADERS() });
  const d = await safeJson(r);
  const rows = Array.isArray(d) ? d : [];

  return rows.map((x) => ({
    member: x.Representative || x.Senator || x.Name,
    chamber: x.House || /house/i.test(x.Chamber || '') ? 'House' : 'Senate',
    party: x.Party || '',
    ticker: x.Ticker,
    assetName: x.Company || '',
    type: x.Transaction,
    amount: x.Range || x.Amount,
    txDate: x.TransactionDate || x.Traded,
    filedDate: x.ReportDate || x.Filed,
    url: '',
    source: 'Quiver',
  }));
}

export { fetch_ as pull };
