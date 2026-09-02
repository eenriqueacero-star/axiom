/**
 * Company fundamentals via Finnhub /stock/metric (free tier). Gives the council's
 * quality analyst (SAGE) real financials — growth, margins, leverage, cash flow —
 * instead of guessing from a price and headlines. 24h cache.
 *
 * Finnhub's metric units are inconsistent (some ratios, some already-percent), so
 * we normalise on the way out and label everything as approximate.
 */
import { safeJson } from './fetchJson.js';

const cache = new Map();
const TTL = 24 * 60 * 60 * 1000;

// A value that could be a ratio (0.42) or a percent (42) — Finnhub mixes them.
// Growth/margin figures above ~3 in magnitude are almost certainly already percent.
const asPct = (x) => {
  if (x == null || !Number.isFinite(x)) return null;
  return Math.abs(x) < 3 ? x * 100 : x;
};

export async function fundamentals(ticker) {
  const sym = String(ticker).toUpperCase();
  const hit = cache.get(sym);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  let data = { available: false };
  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(sym)}&metric=all&token=${process.env.FINNHUB_KEY}`,
    );
    const j = await safeJson(r);
    const m = j?.metric || {};
    const pick = (...keys) => {
      for (const k of keys) if (m[k] != null && Number.isFinite(Number(m[k]))) return Number(m[k]);
      return null;
    };
    const f = {
      available: true,
      revGrowth: asPct(pick('revenueGrowthTTMYoy', 'revenueGrowthQuarterlyYoy', 'revenueGrowth3Y')),
      epsGrowth: asPct(pick('epsGrowthTTMYoy', 'epsGrowthQuarterlyYoy', 'epsGrowth3Y')),
      grossMargin: asPct(pick('grossMarginTTM', 'grossMarginAnnual')),
      opMargin: asPct(pick('operatingMarginTTM', 'operatingMarginAnnual')),
      netMargin: asPct(pick('netProfitMarginTTM', 'netProfitMarginAnnual')),
      roe: asPct(pick('roeTTM', 'roeRfy')),
      debtToEquity: pick('totalDebt/totalEquityQuarterly', 'longTermDebt/equityQuarterly', 'totalDebt/totalEquityAnnual'),
      currentRatio: pick('currentRatioQuarterly', 'currentRatioAnnual'),
      fcfPerShare: pick('freeCashFlowPerShareTTM', 'freeCashFlowPerShareAnnual'),
      pe: pick('peTTM', 'peBasicExclExtraTTM', 'peAnnual'),
      ps: pick('psTTM', 'psAnnual'),
    };
    if (Object.entries(f).some(([k, v]) => k !== 'available' && typeof v === 'number')) data = f;
  } catch { /* leave unavailable */ }

  cache.set(sym, { ts: Date.now(), data });
  return data;
}

export function fundamentalsBlock(f) {
  if (!f?.available) return '';
  const p = (x, unit = '%') => (x == null ? 'n/a' : `${x >= 0 ? '' : ''}${x.toFixed(0)}${unit}`);
  const r = (x) => (x == null ? 'n/a' : x.toFixed(1));
  const lines = [
    `FUNDAMENTALS (approx, from Finnhub — use these for the quality/growth checks, don't guess):`,
    `- Revenue growth (YoY): ${p(f.revGrowth)} · EPS growth (YoY): ${p(f.epsGrowth)}`,
    `- Margins — gross ${p(f.grossMargin)}, operating ${p(f.opMargin)}, net ${p(f.netMargin)} · ROE ${p(f.roe)}`,
    `- Balance sheet — debt/equity ${r(f.debtToEquity)}, current ratio ${r(f.currentRatio)}, FCF/share ${f.fcfPerShare == null ? 'n/a' : '$' + f.fcfPerShare.toFixed(2)}`,
    `- Valuation — P/E ${r(f.pe)}, P/S ${r(f.ps)}`,
  ];
  return '\n' + lines.join('\n') + '\n';
}
