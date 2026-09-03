/**
 * SEC EDGAR 8-K filings — the source-of-truth catalyst feed for held names.
 * Free, no key. 8-Ks are what a company MUST file within ~4 business days of a
 * material event (earnings, an officer leaving, a big contract, a restatement),
 * so they often lead or sharpen the news headlines the scanner already watches.
 *
 * SEC asks for a descriptive User-Agent with a contact; they rate-limit to
 * ~10 req/s per IP. Set EDGAR_OFF=1 to disable.
 */
const UA = { 'User-Agent': 'Axiom Stock Research (+https://axiom-client.onrender.com)' };
const SUBMISSIONS = (cik10) => `https://data.sec.gov/submissions/CIK${cik10}.json`;
const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';

export const edgarConfigured = () => process.env.EDGAR_OFF !== '1';

// 8-K item codes worth surfacing, with plain-language labels. The `thesis` set
// justifies a full council re-review, not just a ping.
const ITEM_LABELS = {
  '1.01': 'entered a material agreement',
  '1.02': 'terminated a material agreement',
  '1.03': 'bankruptcy or receivership',
  '2.01': 'completed an acquisition or disposition',
  '2.02': 'reported quarterly results',
  '2.03': 'took on a material financial obligation',
  '2.04': 'a debt covenant was triggered',
  '2.05': 'approved exit or disposal costs',
  '2.06': 'recorded a material impairment',
  '3.01': 'received a delisting notice',
  '3.02': 'sold unregistered equity',
  '4.01': 'changed its accounting firm',
  '4.02': 'said prior financials can no longer be relied on',
  '5.01': 'a change in control',
  '5.02': 'a director or officer departure or appointment',
  '5.03': 'amended its charter or bylaws',
  '7.01': 'a Regulation FD disclosure',
  '8.01': 'other material events',
};
const THESIS_ITEMS = new Set(['1.01', '1.02', '1.03', '2.01', '2.02', '2.04', '2.06', '3.01', '4.01', '4.02', '5.01', '5.02']);
// Always-attached / procedural items — keep the filing, drop them from the summary.
const NOISE_ITEMS = new Set(['9.01', '5.07']);

export const itemLabel = (code) => ITEM_LABELS[code] || `item ${code}`;
export const isThesisFiling = (items = []) => items.some((i) => THESIS_ITEMS.has(i));

let _tickerMap = { ts: 0, data: null };

async function tickerToCik(ticker) {
  const sym = String(ticker || '').toUpperCase();
  if (!sym) return null;
  if (!_tickerMap.data || Date.now() - _tickerMap.ts > 24 * 3600 * 1000) {
    const res = await fetch(TICKERS_URL, { headers: UA });
    if (!res.ok) throw new Error(`EDGAR tickers ${res.status}`);
    const raw = await res.json();
    const map = {};
    for (const row of Object.values(raw)) map[String(row.ticker).toUpperCase()] = String(row.cik_str).padStart(10, '0');
    _tickerMap = { ts: Date.now(), data: map };
  }
  return _tickerMap.data[sym] || null;
}

/**
 * Recent filings for a ticker.
 * @returns {Promise<Array<{form,filedAt,reportDate,items,itemLabels,thesis,url,accession}>>}
 */
export async function recentFilings(ticker, { days = 14, forms = ['8-K', '8-K/A'] } = {}) {
  if (!edgarConfigured()) return [];
  const cik10 = await tickerToCik(ticker).catch(() => null);
  if (!cik10) return [];

  const res = await fetch(SUBMISSIONS(cik10), { headers: UA });
  if (!res.ok) throw new Error(`EDGAR submissions ${res.status}`);
  const data = await res.json();
  const r = data.filings?.recent;
  if (!r?.form?.length) return [];

  const cutoff = Date.now() - days * 864e5;
  const cikInt = String(parseInt(cik10, 10));
  const out = [];
  for (let i = 0; i < r.form.length; i++) {
    if (!forms.includes(r.form[i])) continue;
    const filedAt = new Date(`${r.filingDate[i]}T12:00:00Z`).getTime();
    if (filedAt < cutoff) continue;
    const items = (r.items?.[i] || '').split(/,\s*/).filter(Boolean);
    const shown = items.filter((c) => !NOISE_ITEMS.has(c));
    const accNoDash = (r.accessionNumber[i] || '').replace(/-/g, '');
    out.push({
      form: r.form[i],
      filedAt,
      reportDate: r.reportDate?.[i] || r.filingDate[i],
      items,
      itemLabels: shown.map(itemLabel),
      thesis: isThesisFiling(items),
      accession: r.accessionNumber[i],
      url: `https://www.sec.gov/Archives/edgar/data/${cikInt}/${accNoDash}/${r.primaryDocument[i] || ''}`,
    });
  }
  return out.sort((a, b) => b.filedAt - a.filedAt);
}

/** One-line-per-filing block for the council's LIVE DATA. */
export function edgarBlock(filings, ticker) {
  if (!filings?.length) return '';
  const lines = filings.slice(0, 4).map((f) => {
    const d = new Date(f.filedAt).toISOString().slice(0, 10);
    const what = f.itemLabels.length ? f.itemLabels.join('; ') : 'a material event';
    return `- [${d}] ${f.form}: ${ticker} ${what}`;
  }).join('\n');
  return `\nSEC 8-K FILINGS (last 2 weeks — the company's own disclosure):\n${lines}\n`;
}
