/**
 * DCA engine — where should this cycle's contribution go?
 * Rulebook §6: the most-underweight eligible name that passes the entry rule.
 *
 * Targets (until per-holding conviction tiers exist):
 *  - Core names: equal share of the Core sleeve (SPLIT.core / CORE_LIST.length)
 *  - Existing satellite holdings: their CURRENT weight (hold, don't grow)
 *  - Anything else: 0
 * So new money naturally flows into the under-built Core = diversification.
 */
import { getPortfolio } from './portfolio.js';
import { diagnose, sectorOf, SPLIT, CORE_LIST, BUFFER_ETF, CAPS, ENTRY } from './strategy.js';
import { priceFacts } from './metrics.js';
import { ACCOUNTS } from '../agents/definitions.js';

async function entryCheck(ticker) {
  try {
    const { facts } = await priceFacts(ticker);
    if (!facts.available) return { ok: null, why: 'no price history' };
    const aboveSma200 = facts.sma200 != null && facts.price > facts.sma200;
    const over50 = facts.sma50 ? (facts.price - facts.sma50) / facts.sma50 : 0;
    if (!aboveSma200) return { ok: false, why: 'below its 200-day average (downtrend)' };
    if (over50 > ENTRY.maxAboveSma50) return { ok: false, why: `${(over50 * 100).toFixed(0)}% above its 50-day — too extended` };
    return { ok: true, why: 'uptrend, not extended' };
  } catch {
    return { ok: null, why: 'price check failed' };
  }
}

export async function dcaSuggestion(uid) {
  const portfolio = await getPortfolio(uid);
  const d = diagnose(portfolio);

  const weeklyTotal = Object.values(ACCOUNTS).reduce((s, a) => s + (a.dca || 0), 0);

  if (!d.ready) {
    return {
      ready: false,
      note: 'Add or sync your holdings first — then the DCA engine can tell you where new money should go.',
      buffer: BUFFER_ETF,
    };
  }

  const currentOf = (t) => d.names.find(n => n.ticker === t)?.pct || 0;
  const coreTarget = SPLIT.core / CORE_LIST.length;

  // Build the candidate list: Core names (underweight vs equal share) + note satellites.
  const candidates = CORE_LIST.map(ticker => {
    const current = currentOf(ticker);
    const gap = Math.max(0, coreTarget - current);
    return { ticker, sleeve: 'core', sector: sectorOf(ticker), current, target: coreTarget, gap };
  }).filter(c => c.gap > 0.002);

  // Rank: biggest gap first; tie-break toward sectors we hold least of.
  const sectorPct = Object.fromEntries(d.sectors.map(s => [s.name, s.pct]));
  candidates.sort((a, b) =>
    (b.gap - a.gap) || ((sectorPct[a.sector] || 0) - (sectorPct[b.sector] || 0)),
  );

  // Walk the ranked list; first that clears the entry rule and no cap breach wins.
  const ranked = [];
  let pick = null;
  for (const c of candidates.slice(0, 8)) {
    const entry = await entryCheck(c.ticker);
    const sectorRoom = (sectorPct[c.sector] || 0) < CAPS.sector;
    const row = { ...c, entryOk: entry.ok, entryWhy: entry.why, sectorRoom };
    ranked.push(row);
    if (!pick && entry.ok === true && sectorRoom) pick = row;
  }

  return {
    ready: true,
    weeklyTotal,
    accounts: Object.values(ACCOUNTS).map(a => ({ label: a.label, dca: a.dca, note: a.dcaNote })),
    pick: pick
      ? { ticker: pick.ticker, sector: pick.sector, reason: `Most underweight Core name that's ${pick.entryWhy}. You hold ${(pick.current * 100).toFixed(1)}%, target ~${(pick.target * 100).toFixed(1)}%.` }
      : null,
    buffer: pick ? null : { etf: BUFFER_ETF, reason: 'Nothing eligible passed the entry rule this cycle — park it in the buffer and wait.' },
    ranked: ranked.map(r => ({
      ticker: r.ticker, sector: r.sector,
      current: r.current, target: r.target,
      entryOk: r.entryOk, entryWhy: r.entryWhy, sectorRoom: r.sectorRoom,
    })),
  };
}
