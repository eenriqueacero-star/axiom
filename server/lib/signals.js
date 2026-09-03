/**
 * Real-world signal feeds. v1: news via Finnhub (free tier).
 * Congressional trades / SEC filings to be added when a data source is settled.
 */
import { safeJson } from './fetchJson.js';

const FINNHUB = () => process.env.FINNHUB_KEY;

const _cache = new Map();
const cached = async (key, ttlMs, fn) => {
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.ts < ttlMs) return hit.data;
  const data = await fn();
  _cache.set(key, { ts: Date.now(), data });
  return data;
};

const normalize = (a, kind) => ({
  id: String(a.id ?? a.url ?? `${a.datetime}-${a.headline}`),
  kind,                                   // 'market' | 'company'
  headline: a.headline,
  summary: a.summary || '',
  source: a.source || '',
  url: a.url || '',
  ts: (a.datetime || 0) * 1000,
  tickers: a.related ? a.related.split(',').filter(Boolean) : [],
});

export async function marketNews({ limit = 20 } = {}) {
  return cached('market', 10 * 60_000, async () => {
    const res = await fetch(
      `https://finnhub.io/api/v1/news?category=general&token=${FINNHUB()}`,
    );
    const raw = (await safeJson(res)) || [];
    return raw
      .map((a) => normalize(a, 'market'))
      .sort((x, y) => y.ts - x.ts)
      .slice(0, limit);
  });
}

export async function tickerNews(ticker, { days = 7, limit = 15 } = {}) {
  const sym = ticker.toUpperCase();
  return cached(`co:${sym}:${days}:${limit}`, 10 * 60_000, async () => {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const res = await fetch(
      `https://finnhub.io/api/v1/company-news?symbol=${sym}&from=${from}&to=${to}&token=${FINNHUB()}`,
    );
    const raw = (await safeJson(res)) || [];
    return raw
      .map((a) => normalize(a, 'company'))
      .sort((x, y) => y.ts - x.ts)
      .slice(0, limit);
  });
}
