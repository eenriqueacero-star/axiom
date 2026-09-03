/**
 * DCA engine — where should this cycle's contribution go?
 * Rulebook §6: the most-underweight eligible name that passes the entry rule.
 *
 * Targets:
 *  - Core names: equal share of the Core sleeve (SPLIT.core / CORE_LIST.length)
 *  - Satellite holdings the council rates HIGH/MEDIUM conviction: a tier-based
 *    target weight (§7) — so a high-conviction satellite name you're underweight
 *    can win the contribution too, not only Core.
 *  - Everything else (incl. LOW/SPECULATIVE satellites): 0
 */
import { getPortfolio } from './portfolio.js';
import { diagnose, sectorOf, sleeveOf, SPLIT, CORE_LIST, BUFFER_ETF, CAPS, ENTRY } from './strategy.js';
import { priceFacts } from './metrics.js';
import { buildStances } from './stances.js';
import { getContributions, nextContribution, projectedInflow } from './contributions.js';
import { ACCOUNTS } from '../agents/definitions.js';

const TIER_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1, SPECULATIVE: 0 };
// The council has to have actively lost conviction (not just "no run yet") to veto a pick.
const TIER_BLOCKS = new Set(['LOW', 'SPECULATIVE']);
// §7 target weight for a satellite name by its conviction tier (mid of the band).
const SATELLITE_TARGET = { HIGH: 0.07, MEDIUM: 0.04 };

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

  // The contribution ledger is the source of truth if the user has set it;
  // otherwise fall back to the per-account defaults in definitions.js.
  const contrib = await getContributions(uid).catch(() => null);
  const next = contrib ? nextContribution(contrib) : { amount: 0, kind: 'none' };
  const weeklyTotal = next.amount > 0
    ? next.amount
    : Object.values(ACCOUNTS).reduce((s, a) => s + (a.dca || 0), 0);
  const inflow30 = contrib ? projectedInflow(contrib, 30) : null;

  if (!d.ready) {
    return {
      ready: false,
      note: 'Add or sync your holdings first — then the DCA engine can tell you where new money should go.',
      buffer: BUFFER_ETF,
    };
  }

  const currentOf = (t) => d.names.find(n => n.ticker === t)?.pct || 0;
  const coreTarget = SPLIT.core / CORE_LIST.length;

  // The council's standing conviction tier per name — a Core name it has soured
  // on (LOW / SPECULATIVE) shouldn't get fresh money even while underweight.
  const stances = await buildStances(uid).catch(() => ({ stances: {} }));
  const tierOf = (t) => stances.stances?.[t]?.tier || null;

  // Core names — underweight vs an equal share of the Core sleeve.
  const coreCandidates = CORE_LIST.map(ticker => {
    const current = currentOf(ticker);
    const gap = Math.max(0, coreTarget - current);
    const tier = tierOf(ticker);
    return { ticker, sleeve: 'core', sector: sectorOf(ticker), current, target: coreTarget, gap, tier };
  });

  // Satellite holdings the council rates HIGH/MEDIUM and you're underweight their
  // §7 tier target — a high-conviction growth name can win the contribution too.
  const satelliteCandidates = d.names
    .filter(n => sleeveOf(n.ticker) === 'satellite')
    .map(n => {
      const tier = tierOf(n.ticker);
      const target = SATELLITE_TARGET[tier] || 0;
      return { ticker: n.ticker, sleeve: 'satellite', sector: sectorOf(n.ticker), current: n.pct, target, gap: Math.max(0, target - n.pct), tier };
    })
    .filter(c => c.target > 0);

  const candidates = [...coreCandidates, ...satelliteCandidates].filter(c => c.gap > 0.002);

  // Rank: biggest gap first; then higher council conviction; then sectors we hold least of.
  const sectorPct = Object.fromEntries(d.sectors.map(s => [s.name, s.pct]));
  candidates.sort((a, b) =>
    (b.gap - a.gap)
    || ((TIER_RANK[b.tier] ?? 2) - (TIER_RANK[a.tier] ?? 2))
    || ((sectorPct[a.sector] || 0) - (sectorPct[b.sector] || 0)),
  );

  // Walk the ranked list; first that clears the entry rule, has sector room, and
  // the council hasn't soured on wins.
  const ranked = [];
  let pick = null;
  for (const c of candidates.slice(0, 8)) {
    const entry = await entryCheck(c.ticker);
    const sectorRoom = (sectorPct[c.sector] || 0) < CAPS.sector;
    const tierOk = !TIER_BLOCKS.has(c.tier);
    const row = { ...c, entryOk: entry.ok, entryWhy: entry.why, sectorRoom, tierOk };
    ranked.push(row);
    if (!pick && entry.ok === true && sectorRoom && tierOk) pick = row;
  }

  return {
    ready: true,
    weeklyTotal,
    contribution: { amount: next.amount, kind: next.kind, date: next.date || null, projected30d: inflow30 },
    accounts: Object.values(ACCOUNTS).map(a => ({ label: a.label, dca: a.dca, note: a.dcaNote })),
    pick: pick
      ? {
          ticker: pick.ticker, sector: pick.sector, tier: pick.tier, sleeve: pick.sleeve,
          reason: `Most underweight ${pick.sleeve === 'core' ? 'Core' : 'high-conviction satellite'} name `
            + `that's ${pick.entryWhy}`
            + `${pick.tier ? `, council conviction ${pick.tier}` : ''}. `
            + `You hold ${(pick.current * 100).toFixed(1)}%, target ~${(pick.target * 100).toFixed(1)}%.`,
        }
      : null,
    buffer: pick ? null : { etf: BUFFER_ETF, reason: 'Nothing eligible passed the entry rule this cycle — park it in the buffer and wait.' },
    ranked: ranked.map(r => ({
      ticker: r.ticker, sector: r.sector, sleeve: r.sleeve,
      current: r.current, target: r.target,
      entryOk: r.entryOk, entryWhy: r.entryWhy, sectorRoom: r.sectorRoom,
      tier: r.tier, tierOk: r.tierOk,
    })),
  };
}
