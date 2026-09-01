// The Floor — live per-agent state, computed from the user's real portfolio.
// Every field here drives something visible in the 3D scene, so keep it small
// and always return a shape (never throw).

import { getPortfolio } from './portfolio.js';
import { diagnose, sectorOf, CAPS, SPLIT } from './strategy.js';
import { priceFacts } from './metrics.js';
import { tickerNews } from './signals.js';

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const FRESH_NEWS_MS = 48 * 3600 * 1000;

// Which cron jobs are "running now" — a loose window after each ET start time.
function busyJobsNow() {
  const now = new Date();
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();
  const weekday = day >= 1 && day <= 5;
  const within = (start, len) => mins >= start && mins < start + len;
  return {
    scout: weekday && within(9 * 60 + 5, 8),        // daily scout ~9:05 ET
    alerts: weekday && mins % 30 < 2 && mins >= 9 * 60 + 30 && mins <= 16 * 60,
    scorecard: weekday && within(16 * 60 + 30, 6),
  };
}

// agent id -> which cron makes it "work"
const AGENT_JOB = {
  catalyst: 'scout', trend: 'alerts', quality: 'scorecard',
  bear: 'scout', sector: 'scout', sizing: 'scorecard',
};

export async function buildFloorLive(uid) {
  const base = { ready: false, busy: busyJobsNow(), agents: {} };
  let portfolio;
  try {
    portfolio = await getPortfolio(uid);
  } catch {
    return base;
  }

  const d = diagnose(portfolio || {});
  if (!d.ready) return { ...base, ready: false, note: 'No holdings yet.' };

  // top holdings by weight (cap the work we do against rate-limited APIs)
  const holdings = (d.names || []).slice(0, 8);

  // trend of each holding vs its 200-day (REX)
  const trends = await Promise.all(
    holdings.map(async (n) => {
      try {
        const { facts } = await priceFacts(n.ticker);
        return { ticker: n.ticker, weight: n.pct, trend: facts?.trend || 'unknown' };
      } catch {
        return { ticker: n.ticker, weight: n.pct, trend: 'unknown' };
      }
    }),
  );
  const trendScore = (() => {
    let num = 0, den = 0;
    for (const t of trends) {
      if (t.trend === 'unknown') continue;
      const s = t.trend === 'uptrend' ? 1 : t.trend === 'downtrend' ? -1 : 0;
      num += s * t.weight;
      den += t.weight;
    }
    return den ? clamp(num / den, -1, 1) : 0;
  })();
  const downtrending = trends.filter((t) => t.trend === 'downtrend').map((t) => t.ticker);

  // fresh news on holdings (NOVA)
  const freshTickers = [];
  await Promise.all(
    holdings.slice(0, 6).map(async (n) => {
      try {
        const items = await tickerNews(n.ticker, { days: 3, limit: 6 });
        if ((items || []).some((it) => Date.now() - (it.ts || 0) < FRESH_NEWS_MS)) {
          freshTickers.push(n.ticker);
        }
      } catch { /* ignore */ }
    }),
  );

  // sector concentration (ATLAS)
  const sectors = (d.sectors || []).map((s) => ({
    name: s.name,
    pct: Math.round(s.pct * 1000) / 1000,
    overCap: s.pct > CAPS.sector,
  }));
  const hottest = sectors[0] || null;

  // sleeve balance (ZEN): tilt -1 (all satellite) .. +1 (all core), 0 = at target
  const corePct = d.sleeve?.corePct ?? 0;
  const tilt = clamp((corePct - SPLIT.core) / SPLIT.core, -1, 1);

  // structural flags (VEGA)
  const flags = d.flags || [];
  const highFlags = flags.filter((f) => f.severity === 'high').length;

  // quality names intact (SAGE) — a held Core name in a downtrend is a concern
  const coreHeld = holdings.filter((n) => n.sleeve === 'core').map((n) => n.ticker);
  const coreBroken = coreHeld.filter((t) => downtrending.includes(t));

  const react = {
    quality: coreBroken.length ? 'no' : coreHeld.length ? 'yes' : 'idle',
    trend: trendScore > 0.3 ? 'thumbsup' : trendScore < -0.3 ? 'no' : 'idle',
    catalyst: freshTickers.length >= 3 ? 'dance' : freshTickers.length ? 'wave' : 'idle',
    bear: highFlags ? 'punch' : flags.length ? 'no' : 'idle',
    sector: sectors.some((s) => s.overCap) ? 'no' : 'idle',
    sizing: Math.abs(tilt) > 0.5 ? 'no' : Math.abs(tilt) < 0.15 ? 'thumbsup' : 'idle',
  };

  const busy = busyJobsNow();
  const mkAgent = (id, metric) => ({
    reaction: react[id],
    busy: !!busy[AGENT_JOB[id]],
    metric,
  });

  return {
    ready: true,
    busy,
    total: d.total,
    agents: {
      quality: mkAgent('quality', { coreHeld: coreHeld.length, coreBroken }),
      trend: mkAgent('trend', { trendScore: Math.round(trendScore * 100) / 100, downtrending }),
      catalyst: mkAgent('catalyst', { freshNews: freshTickers.length, tickers: freshTickers }),
      bear: mkAgent('bear', {
        flags: flags.length,
        high: highFlags,
        brokenTickers: downtrending.slice(0, 4),
      }),
      sector: mkAgent('sector', { sectors: sectors.slice(0, 5), hottest }),
      sizing: mkAgent('sizing', {
        corePct: Math.round(corePct * 100) / 100,
        satPct: Math.round((d.sleeve?.satellitePct ?? 0) * 100) / 100,
        tilt: Math.round(tilt * 100) / 100,
      }),
    },
  };
}
