/**
 * Objective, code-computed facts about a ticker — trend, momentum, drawdown.
 * The council must NOT ask the LLM to eyeball these; we hand them over as fact.
 *
 * Source: Tiingo EOD daily closes (free tier 500/hr). 12h in-memory cache per
 * ticker keeps us far under the limit for a ~20-name basket.
 */
import { safeJson } from './fetchJson.js';

const DAY = 864e5;
const closesCache = new Map();   // ticker -> { ts, closes: [{date, close}] }
const industryCache = new Map(); // ticker -> { ts, industry }
const CLOSES_TTL = 12 * 3600_000;
const INDUSTRY_TTL = 7 * DAY;

async function dailyCloses(ticker) {
  const sym = ticker.toUpperCase();
  const hit = closesCache.get(sym);
  if (hit && Date.now() - hit.ts < CLOSES_TTL) return hit.closes;

  const token = process.env.TIINGO_TOKEN;
  if (!token) return [];
  const start = new Date(Date.now() - 400 * DAY).toISOString().slice(0, 10);
  const url = `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(sym)}/prices?startDate=${start}&token=${token}&format=json`;

  let closes = [];
  try {
    const res = await fetch(url);
    const data = await safeJson(res);
    if (Array.isArray(data)) {
      closes = data
        .map(d => ({ date: String(d.date).slice(0, 10), close: d.adjClose ?? d.close }))
        .filter(d => Number.isFinite(d.close));
    }
  } catch { /* leave empty — caller degrades gracefully */ }

  closesCache.set(sym, { ts: Date.now(), closes });
  return closes;
}

const sma = (arr, n) =>
  arr.length >= n ? arr.slice(-n).reduce((s, x) => s + x, 0) / n : null;

/**
 * Returns computed facts + a formatted block for agent prompts.
 * `livePrice` (from Finnhub quote) is appended so trend uses the freshest price.
 */
export async function priceFacts(ticker, livePrice = null) {
  const rows = await dailyCloses(ticker);
  if (rows.length < 60) {
    return { facts: { available: false }, block: '' };
  }

  const closes = rows.map(r => r.close);
  const price = livePrice && livePrice > 0 ? livePrice : closes[closes.length - 1];
  const series = [...closes.slice(0, -1), price];

  const sma50 = sma(series, 50);
  const sma200 = sma(series, 200);
  const win252 = series.slice(-252);
  const high52 = Math.max(...win252);
  const low52 = Math.min(...win252);
  const pctFromHigh = (price - high52) / high52;       // negative = below the high
  const pctFromLow = (price - low52) / low52;

  const ret = (n) => {
    const past = series[series.length - 1 - n];
    return past ? (price - past) / past : null;
  };
  const ret63 = ret(63);    // ~3 months
  const ret126 = ret(126);  // ~6 months
  const ret252 = ret(252);  // ~12 months

  const aboveSma200 = sma200 != null && price > sma200;
  const sma50Above200 = sma50 != null && sma200 != null && sma50 > sma200;
  const trend =
    sma200 == null ? 'unknown'
    : aboveSma200 && sma50Above200 ? 'uptrend'
    : !aboveSma200 && !sma50Above200 ? 'downtrend'
    : 'mixed';

  const facts = {
    available: true,
    price: round(price),
    sma50: round(sma50), sma200: round(sma200),
    trend,
    pctFromHigh52w: round4(pctFromHigh),
    pctFromLow52w: round4(pctFromLow),
    ret3m: round4(ret63), ret6m: round4(ret126), ret12m: round4(ret252),
  };

  const pctStr = (x) => (x == null ? 'n/a' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);
  const block =
`COMPUTED FACTS (from daily closes, do not re-estimate these):
- Price ${fmt(price)} vs 50-day avg ${fmt(sma50)} vs 200-day avg ${fmt(sma200)}
- Trend: ${trend.toUpperCase()} (price ${aboveSma200 ? 'above' : 'below'} 200-day; 50-day ${sma50Above200 ? 'above' : 'below'} 200-day)
- ${pctStr(pctFromHigh)} from the 52-week high, ${pctStr(pctFromLow)} above the 52-week low
- Momentum: 3mo ${pctStr(ret63)}, 6mo ${pctStr(ret126)}, 12mo ${pctStr(ret252)}`;

  return { facts, block };
}

export async function industryOf(ticker) {
  const sym = ticker.toUpperCase();
  const hit = industryCache.get(sym);
  if (hit && Date.now() - hit.ts < INDUSTRY_TTL) return hit.industry;

  let industry = null;
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(sym)}&token=${process.env.FINNHUB_KEY}`,
    );
    const d = await safeJson(res);
    industry = d?.finnhubIndustry || null;
  } catch { /* ignore */ }

  industryCache.set(sym, { ts: Date.now(), industry });
  return industry;
}

const round = (n) => (n == null ? null : Math.round(n * 100) / 100);
const round4 = (n) => (n == null ? null : Math.round(n * 10000) / 10000);
const fmt = (n) => (n == null ? 'n/a' : `$${n.toFixed(2)}`);
