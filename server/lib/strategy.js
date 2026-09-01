/**
 * Axiom strategy rulebook, as data. See docs/STRATEGY.md for the prose.
 * This is the single source of truth the DCA engine, the agents, and the
 * portfolio diagnostics all read from.
 */

// §1 — Core/Satellite target. Council-adjustable; starts here.
export const SPLIT = { core: 0.5, satellite: 0.5 };

// §3 — hard caps (fraction of total portfolio)
export const CAPS = {
  name: { core: 0.10, satellite: 0.08 },
  sector: 0.35,
  preProfit: 0.10,
  sellTrigger: 1.5, // only actually sell if a name exceeds its cap by this much
};

// §6 — where a contribution parks if nothing passes the entry rule
export const BUFFER_ETF = 'QQQ';

// §4 — entry rule thresholds
export const ENTRY = {
  maxAboveSma50: 0.25,   // don't chase — skip if >25% above the 50-day average
  starterFraction: 0.5,  // new positions enter at half their target weight
};

// §1 / §7 — the Core list to build toward (buy-and-hold quality compounders)
export const CORE_LIST = [
  'MSFT', 'GOOGL', 'META', 'AMZN', 'COST',
  'V', 'MA', 'LLY', 'UNH', 'ISRG', 'JPM', 'BRK.B',
];

// Sector buckets for the concentration check. Not strict GICS — grouped the way
// the risk actually clusters for this book. Unknowns → 'Other'.
const SECTORS = {
  'Semiconductors': ['NVDA', 'MU', 'AMD', 'SNDK', 'CRDO', 'ALAB', 'AVGO', 'ARM', 'MRVL', 'TSM', 'ASML', 'LRCX', 'KLAC', 'SMCI'],
  'AI Infrastructure': ['NBIS', 'APLD', 'CEG'],
  'Software': ['MSFT', 'GOOGL', 'META', 'SNOW', 'NET', 'DDOG', 'PANW'],
  'Consumer': ['AMZN', 'COST', 'AAPL', 'TSLA'],
  'Payments & Fintech': ['V', 'MA', 'COIN', 'MSTR'],
  'Healthcare': ['LLY', 'UNH', 'ISRG', 'DXCM'],
  'Financials': ['JPM', 'BRK.B'],
  'Clean Energy': ['ENPH', 'FSLR'],
  'Aerospace': ['RKLB', 'FLY'],
  'Quantum': ['IONQ', 'RGTI', 'QBTS'],
};
const TICKER_SECTOR = {};
for (const [sector, tks] of Object.entries(SECTORS)) {
  for (const t of tks) TICKER_SECTOR[t] = sector;
}

export const sectorOf = (ticker) => TICKER_SECTOR[String(ticker).toUpperCase()] || 'Other';
export const sleeveOf = (ticker) =>
  CORE_LIST.includes(String(ticker).toUpperCase()) ? 'core' : 'satellite';

/**
 * Pure-math portfolio diagnostics — no LLM. Takes the shape returned by
 * getPortfolio() (accounts[].positions[], accounts[].cash, totals.value).
 * Returns sleeve mix, sector breakdown, and rulebook flags.
 */
export function diagnose(portfolio) {
  const positions = [];
  let cash = 0;
  for (const acct of portfolio.accounts || []) {
    cash += acct.cash || 0;
    for (const p of acct.positions || []) {
      if (p.value > 0) positions.push(p);
    }
  }
  const invested = positions.reduce((s, p) => s + p.value, 0);
  const total = invested + cash;
  if (total <= 0) return { total: 0, ready: false };

  // sleeve mix
  const bySleeve = { core: 0, satellite: 0 };
  const bySector = {};
  const byName = {};
  for (const p of positions) {
    const sleeve = sleeveOf(p.ticker);
    const sector = sectorOf(p.ticker);
    bySleeve[sleeve] += p.value;
    bySector[sector] = (bySector[sector] || 0) + p.value;
    byName[p.ticker] = (byName[p.ticker] || 0) + p.value;
  }

  const pct = (v) => v / total;
  const flags = [];

  // §1 — sleeve drift
  const corePct = pct(bySleeve.core);
  if (Math.abs(corePct - SPLIT.core) > 0.15) {
    flags.push({
      kind: 'sleeve',
      severity: corePct < SPLIT.core ? 'high' : 'medium',
      msg: `Core is ${(corePct * 100).toFixed(0)}% of the portfolio; target is ${SPLIT.core * 100}%. `
        + `Steer new contributions into Core names.`,
    });
  }

  // §3 — sector caps
  const sectors = Object.entries(bySector)
    .map(([name, v]) => ({ name, value: v, pct: pct(v) }))
    .sort((a, b) => b.pct - a.pct);
  for (const s of sectors) {
    if (s.pct > CAPS.sector) {
      flags.push({
        kind: 'sector',
        severity: s.pct > CAPS.sector * 1.5 ? 'high' : 'medium',
        msg: `${s.name} is ${(s.pct * 100).toFixed(0)}% of the portfolio — over the ${CAPS.sector * 100}% cap. `
          + `New money should avoid it until it's back under.`,
      });
    }
  }

  // §3 — single-name caps
  const names = Object.entries(byName)
    .map(([ticker, v]) => ({ ticker, value: v, pct: pct(v), sleeve: sleeveOf(ticker) }))
    .sort((a, b) => b.pct - a.pct);
  for (const n of names) {
    const cap = CAPS.name[n.sleeve];
    if (n.pct > cap) {
      const over15 = n.pct > cap * CAPS.sellTrigger;
      flags.push({
        kind: 'name',
        severity: over15 ? 'high' : 'medium',
        msg: `${n.ticker} is ${(n.pct * 100).toFixed(0)}% — over its ${(cap * 100).toFixed(0)}% cap`
          + (over15 ? `. Past the 1.5× line: trim.` : `. Redirect contributions away from it.`),
      });
    }
  }

  return {
    ready: true,
    total,
    invested,
    cash,
    sleeve: {
      corePct,
      satellitePct: pct(bySleeve.satellite),
      targetCore: SPLIT.core,
    },
    sectors,
    names,
    flags,
  };
}
