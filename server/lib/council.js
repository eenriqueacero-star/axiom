import { AGENTS, PROTOCOLS, AXIOM_SYSTEM } from '../agents/definitions.js';
import { callAgent, callSynthesis } from './groq.js';
import { safeJson } from './fetchJson.js';
import { tickerNews } from './signals.js';
import { priceFacts } from './metrics.js';
import { getPortfolio } from './portfolio.js';
import { diagnose, sectorOf, sleeveOf, CAPS, CORE_LIST } from './strategy.js';
import { relevantMemos, memoBlock } from './memos.js';
import { fundamentals, fundamentalsBlock } from './fundamentals.js';
import { congressTrades, congressConfigured } from './congress/index.js';
import { agentWeights } from './agentWeights.js';
import { getCalibration } from './calibration.js';
import { backtestVerdictLine } from './quant.js';
import { db } from './firebase.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export { safeJson };

export function extractJSON(text) {
  try {
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = fenceMatch ? fenceMatch[1] : text;
    const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    return JSON.parse(raw.slice(start, end + 1));
  } catch { return null; }
}

export async function fetchLiveData(ticker) {
  const FINNHUB = process.env.FINNHUB_KEY;
  const today = new Date().toISOString().slice(0, 10);
  const from  = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
  const in90d = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);

  const [qRes, eRes, news] = await Promise.all([
    fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB}`),
    fetch(`https://finnhub.io/api/v1/stock/earnings-calendar?from=${today}&to=${in90d}&symbol=${ticker}&token=${FINNHUB}`),
    tickerNews(ticker, { days: 7, limit: 8 }).catch(() => []),
  ]);

  const q = (await safeJson(qRes)) || {};
  const earnings = (await safeJson(eRes)) || {};

  const price = q.c > 0 ? q.c : q.pc;
  const changePct = q.dp ?? null;
  const nextEarnings = earnings.earningsCalendar?.[0]?.date || null;

  const timeStr = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
  const priceStr = price ? `$${price.toFixed(2)}` : 'N/A';
  const changeStr = changePct != null ? ` ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}% today` : '';
  const earningsLine = nextEarnings
    ? `Next earnings: ${nextEarnings} (in ${Math.round((new Date(nextEarnings) - new Date(today)) / 864e5)} days)`
    : 'Next earnings: none scheduled within 90 days';
  // Headline + first sentence of summary so NOVA/VEGA can reason about the event.
  const newsText = news.map(a => {
    const d = new Date(a.ts).toISOString().slice(0, 10);
    const gist = (a.summary || '').split(/(?<=[.!?])\s/)[0].slice(0, 180);
    return `- [${d}] ${a.headline}${gist ? ` — ${gist}` : ''} (${a.source})`;
  }).join('\n');

  const { facts, block: factsBlock } = await priceFacts(ticker, price).catch(() => ({ facts: { available: false }, block: '' }));

  // Congressional trades in this name — a NOVA/ATLAS signal when configured.
  let congressBlock = '';
  if (congressConfigured()) {
    try {
      const ct = await congressTrades({ ticker, days: 75 });
      if (ct.length) {
        const lines = ct.slice(0, 5).map(t =>
          `- ${t.member}${t.party ? ` (${t.party})` : ''} ${t.chamber}: ${t.type.toUpperCase()} `
          + `$${(t.amountLow || 0).toLocaleString()}–${(t.amountHigh || 0).toLocaleString()} on ${t.txDate}`,
        ).join('\n');
        const buys = ct.filter(t => t.type === 'buy').length;
        congressBlock = `\nCONGRESSIONAL TRADES in ${ticker} (last 75 days, ${buys} buys / ${ct.length - buys} sells):\n${lines}\n`;
      }
    } catch { /* non-fatal */ }
  }

  // On a big single-day move, pull the last ~2 days of headlines to the front so
  // VEGA and NOVA reason about WHY it moved, not just that it did.
  let moveBlock = '';
  if (changePct != null && Math.abs(changePct) >= 5) {
    const recent = news
      .filter(a => Date.now() - a.ts < 2.5 * 864e5)
      .slice(0, 3)
      .map(a => `- ${a.headline} (${a.source})`)
      .join('\n');
    moveBlock = `\nWHY IT'S MOVING — ${ticker} is ${changePct >= 0 ? 'up' : 'down'} ${Math.abs(changePct).toFixed(1)}% today. `
      + (recent ? `The freshest headlines:\n${recent}\n` : `No news explains the move — treat a move with no news behind it as noise, not a thesis change.\n`);
  }

  const liveDataBlock = `\nLIVE DATA (as of ${timeStr}): ${ticker} ${priceStr}${changeStr}. ${earningsLine}.\n${moveBlock}${congressBlock}${factsBlock ? factsBlock + '\n' : ''}RECENT NEWS:\n${newsText || 'No recent news.'}\n`;
  return { liveDataBlock, price, changePct, nextEarnings, news, facts };
}

const FALLBACK = { checks: {}, note: 'No response', headline: 'No response', error: true };

/** Aggregate the firm's position in one name across every account: shares, avg cost, unrealised P&L. */
export function positionEconomics(portfolio, sym) {
  let shares = 0, cost = 0, value = 0;
  for (const a of portfolio.accounts || []) {
    for (const p of a.positions || []) {
      if (p.ticker !== sym) continue;
      shares += p.shares || 0;
      value += p.value || 0;
      cost += (p.costBasis || 0) * (p.shares || 0);
    }
  }
  if (shares <= 0) return null;
  const known = cost > 0;
  return {
    shares,
    value,
    cost: known ? cost : null,
    avgCost: known ? cost / shares : null,
    unreal: known ? value - cost : null,
    unrealPct: known ? (value - cost) / cost : null,
  };
}

/**
 * Build the "here's what the firm already owns" context for a council run.
 * Returns null when there's no uid or no portfolio yet.
 */
async function buildHoldingsContext(uid, sym) {
  if (!uid) return null;
  let portfolio;
  try { portfolio = await getPortfolio(uid); } catch { return null; }
  const d = diagnose(portfolio);
  if (!d.ready) return null;

  const econ = positionEconomics(portfolio, sym);

  const sector = sectorOf(sym);
  const sleeve = sleeveOf(sym);
  const heldName = d.names.find(n => n.ticker === sym);
  const positionPct = heldName ? heldName.pct : 0;
  const sectorRow = d.sectors.find(s => s.name === sector);
  const sectorPct = sectorRow ? sectorRow.pct : 0;
  const nameCap = CAPS.name[sleeve];

  // Would adding a starter-size position push a cap over the line?
  const breachSector = sectorPct >= CAPS.sector;
  const breachName = positionPct >= nameCap;
  const breachIfAdd = breachSector || breachName;

  const lines = [
    `HOLDINGS CONTEXT — the firm's actual book, $${Math.round(d.total).toLocaleString()} under management:`,
  ];

  if (econ) {
    if (econ.avgCost != null) {
      const dir = econ.unreal >= 0 ? 'UP' : 'DOWN';
      lines.push(
        `- THE FIRM ALREADY OWNS ${sym}: ${econ.shares} sh at $${econ.avgCost.toFixed(2)} average cost. `
        + `Position is ${dir} ${Math.abs(econ.unrealPct * 100).toFixed(0)}% `
        + `(${econ.unreal >= 0 ? '+' : '-'}$${Math.abs(econ.unreal).toLocaleString(undefined, { maximumFractionDigits: 0 })} unrealised). `
        + `Underwater is not a sell reason on its own — judge the thesis. If the thesis holds and the name is cheap, averaging down is on the table; if it's broken, stop adding.`,
      );
    } else {
      lines.push(`- THE FIRM ALREADY OWNS ${sym}: ${econ.shares} sh (cost basis not recorded).`);
    }
  } else {
    lines.push(`- The firm does NOT own ${sym} yet — you are underwriting it as a new position.`);
  }

  lines.push(
    `- ${sym} weight: ${(positionPct * 100).toFixed(1)}% of the book (${sleeve} sleeve; cap ${(nameCap * 100).toFixed(0)}%)`,
    `- ${sector} sector: ${(sectorPct * 100).toFixed(0)}% of the book (cap ${CAPS.sector * 100}%)`,
    `- Core/Satellite mix: ${(d.sleeve.corePct * 100).toFixed(0)}% / ${(d.sleeve.satellitePct * 100).toFixed(0)}% (target ${d.sleeve.targetCore * 100}/${(1 - d.sleeve.targetCore) * 100})`,
  );
  if (d.flags.length) lines.push(`- Rulebook flags: ${d.flags.map(f => f.msg).join(' | ')}`);

  // The council's standing conviction tier on this name (from its last run) — so
  // a run reaffirms or deliberately changes the tier rather than starting blank.
  try {
    const snap = await db.collection(`users/${uid}/analyses`).where('ticker', '==', sym).get();
    const prior = snap.docs.map(x => x.data()).sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
    if (prior?.tier) {
      lines.push(`- Council's standing conviction tier on ${sym}: ${prior.tier}`
        + ` (set ${new Date(prior.ts).toISOString().slice(0, 10)}) — reaffirm it or change it on today's facts.`);
    }
  } catch { /* no prior run — fine */ }

  if (breachIfAdd) {
    lines.push(breachSector
      ? `- ADDING ${sym} IS BLOCKED: the ${sector} sector is already at/over its ${CAPS.sector * 100}% cap.`
      : `- ADDING ${sym} IS BLOCKED: the position is already at/over its ${(nameCap * 100).toFixed(0)}% cap.`);
  }

  return {
    block: '\n' + lines.join('\n') + '\n',
    held: positionPct > 0, positionPct, sectorPct, sector, sleeve,
    breachIfAdd, breachSector, breachName,
    econ,
  };
}

// Positive-signal agents — their yes-checks build the score. VEGA is scored
// separately (its checks are inverted: true = a problem).
const POSITIVE_AGENTS = ['quality', 'trend', 'catalyst', 'sector', 'sizing'];

const asBool = (v) => (v === true ? true : v === false ? false : null);

/** Derive a per-agent display stance from its checks. */
function agentStance(id, checks) {
  const vals = Object.values(checks || {}).map(asBool).filter(v => v !== null);
  if (id === 'bear') {
    return vals.some(v => v === true) ? 'BEARISH' : 'PASS';
  }
  if (!vals.length) return 'CAUTION';
  const yes = vals.filter(v => v).length;
  if (yes === vals.length) return 'PASS';
  if (yes === 0) return 'FAIL';
  return 'CAUTION';
}

// How much each check moves the council score. Quality is the spine; the chart
// and the catalyst matter less. A "yes" adds the weight, a "no" subtracts it,
// "null" is skipped. `weights` (from the scorecard) scales an agent's whole vote.
const CHECK_WEIGHTS = {
  quality: { qualityBusiness: 3, growthIntact: 3, noRedFlags: 2 },
  trend:   { aboveLongTermAvg: 2, notOverextended: 1, trendConstructive: 2 },
  catalyst: { catalystAhead: 1, newsSupportsThesis: 2 },
  sector:  { sectorHealthy: 2, noPolicyOverhang: 1 },
  sizing:  { volatilityManageable: 1 },
};
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * Compute the council verdict from the agents' binary checks — in code, no LLM.
 * A weighted 0-100 score sets ADD/HOLD/TRIM; hard gates (broken thesis, real
 * downtrend + weak fundamentals, >1.5x cap) can still override it either way.
 * `facts` guards the trend rule for young stocks; `weights` are per-agent
 * multipliers from the scorecard (default 1.0).
 */
export function scoreCouncil(agents, holdings = null, facts = null, weights = {}) {
  let earned = 0, possible = 0, answeredChecks = 0;
  for (const [agentId, checks] of Object.entries(CHECK_WEIGHTS)) {
    const mult = weights[agentId] ?? 1;
    for (const [key, w] of Object.entries(checks)) {
      const b = asBool(agents[agentId]?.checks?.[key]);
      if (b === null) continue;
      answeredChecks++;
      const ww = w * mult;
      possible += ww;
      earned += b ? ww : -ww;
    }
  }

  const q = agents.quality?.checks || {};
  const trend = agents.trend?.checks || {};
  const bear = agents.bear?.checks || {};

  const broken = asBool(bear.thesisBreaker) === true;
  const structuralBear = asBool(bear.structuralBearCase) === true;
  const qualityFails = asBool(q.qualityBusiness) === false || asBool(q.growthIntact) === false;

  // VEGA's structural bear case is a real drag on the score.
  if (structuralBear) { earned -= 4 * (weights.bear ?? 1); possible += 4 * (weights.bear ?? 1); }

  // -1..+1 → 0..100
  const score01 = possible > 0 ? (earned / possible + 1) / 2 : 0.5;
  const score100 = Math.round(score01 * 100);
  const score = Math.round(score01 * 10); // legacy 0-10, kept for compatibility

  // A "downtrend" needs both: below the 200-day AND not making higher lows.
  const rawDowntrend = asBool(trend.aboveLongTermAvg) === false && asBool(trend.trendConstructive) === false;
  const shortHistory = !facts?.available || (facts?.bars != null && facts.bars < 240);
  const underwater = holdings?.econ?.unrealPct != null && holdings.econ.unrealPct < -0.08;
  const downtrendExit = rawDowntrend && !shortHistory && (qualityFails || structuralBear || underwater);
  const downtrendTrim = rawDowntrend && !downtrendExit;

  const entryClear = asBool(trend.aboveLongTermAvg) !== false && asBool(trend.notOverextended) !== false;

  // Not enough of the checks came back to form a real opinion — don't fake confidence.
  const thinData = answeredChecks < 4;

  let verdict, conviction, why = null;
  if (broken) { verdict = 'EXIT'; conviction = 9; why = 'the thesis is broken'; }
  else if (downtrendExit) { verdict = 'EXIT'; conviction = 7; why = 'confirmed downtrend and the fundamentals are weak'; }
  else if (thinData) { verdict = 'HOLD'; conviction = 3; why = 'not enough data came back to judge — treat as unrated'; }
  else if (score100 >= 68 && entryClear && !structuralBear) {
    verdict = 'ADD'; conviction = clamp(Math.round(score100 / 10), 6, 10);
  }
  else if (downtrendTrim) { verdict = 'TRIM'; conviction = 6; why = 'downtrend — reduce, but the thesis still holds'; }
  else if (score100 < 42) {
    verdict = 'TRIM'; conviction = clamp(Math.round((100 - score100) / 10), 5, 9); why = 'the council score is weak';
  }
  else { verdict = 'HOLD'; conviction = clamp(Math.round(score100 / 10), 4, 7); }

  // ---- concentration (a portfolio-shape problem, kept distinct from a per-name judgement) ----
  let concentrationBlock = false, concentrationTrim = false, atCap = false;
  const nameCap = holdings ? CAPS.name[holdings.sleeve] : null;
  const overCapX = holdings && nameCap && holdings.positionPct ? holdings.positionPct / nameCap : 0;

  // Good name, no room to add → HOLD, not ADD. This is a *positive* signal, flagged as "at cap".
  if (verdict === 'ADD' && holdings?.breachIfAdd) {
    verdict = 'HOLD';
    conviction = clamp(conviction, 6, 8); // a would-add HOLD is a strong hold, but not a 10
    concentrationBlock = true;
  }
  if (holdings?.breachIfAdd && verdict === 'HOLD') atCap = true;

  // Genuinely oversized — past 1.5× its own cap (rulebook §5) — trim for SIZE even if the
  // business is fine. Below 1.5×, "at cap" just means stop adding; it does not mean sell.
  if (overCapX >= CAPS.sellTrigger && !broken && verdict !== 'EXIT') {
    verdict = 'TRIM';
    conviction = 6;
    concentrationTrim = true;
    why = `the position is ${overCapX.toFixed(1)}× its ${(nameCap * 100).toFixed(0)}% cap — trim to size`;
  }

  return {
    verdict, conviction, score, score100, why, thinData,
    broken, downtrend: rawDowntrend, downtrendExit, entryClear, structuralBear,
    concentrationBlock, concentrationTrim, atCap, overCapX: Math.round(overCapX * 100) / 100,
  };
}

/**
 * Conviction tier — how strongly this name belongs in the long-term basket,
 * independent of today's entry timing. Where the verdict (ADD/HOLD/TRIM/EXIT) is
 * the *action*, the tier is the *belief*. Computed in code from the same binary
 * checks, same as scoreCouncil — the LLM supplies judgment, code assigns the label.
 *
 * HIGH        — quality compounder, own it, size it up toward the cap
 * MEDIUM      — solid, keep it at a normal weight
 * LOW         — thin conviction; hold what you have, don't add
 * SPECULATIVE — a punt: broken thesis, unprofitable/story-stock, or unsizable vol
 */
export function convictionTier(agents, sym) {
  const q = agents.quality?.checks || {};
  const b = agents.bear?.checks || {};
  const s = agents.sector?.checks || {};
  const z = agents.sizing?.checks || {};

  // Not enough of the quality/sector checks resolved to rate conviction at all.
  const answered = [...Object.values(q), ...Object.values(s), ...Object.values(z), ...Object.values(b)]
    .filter(v => asBool(v) !== null).length;
  if (answered < 3) return { tier: null, tierScore: 0, tierReasons: ['not enough data to rate conviction'] };
  const n = agents.catalyst?.checks || {};
  const T = (v) => asBool(v) === true;
  const F = (v) => asBool(v) === false;

  let pts = 0;
  const reasons = [];
  const add = (val, msg) => { pts += val; if (msg) reasons.push(msg); };

  // Quality of the business is the spine of conviction.
  if (T(q.qualityBusiness)) add(2, 'durable, moaty business');
  if (F(q.qualityBusiness)) add(-2, 'business quality in doubt');
  // Real growth is worth as much as the moat.
  if (T(q.growthIntact)) add(2, 'growth intact');
  if (F(q.growthIntact)) add(-2, 'growth stalling');
  if (F(q.noRedFlags)) add(-2, 'dilution / governance red flag');
  if (T(s.sectorHealthy)) add(1);
  if (F(s.sectorHealthy)) add(-1, 'sector rolling over');
  if (F(s.noPolicyOverhang)) add(-1, 'policy overhang on the sector');
  if (T(n.newsSupportsThesis)) add(1, 'news backs the thesis');
  // Volatility caps the SIZE, not the conviction — a light penalty, not a veto.
  if (F(z.volatilityManageable)) add(-1, 'high volatility — size it small');
  // A structural bear case only counts if VEGA could actually name a mechanism.
  if (T(b.structuralBearCase)) add(-2, 'a specific structural bear case');

  const brokenThesis = T(b.thesisBreaker);
  const condemned = F(q.qualityBusiness) || T(b.structuralBearCase); // the business itself is in question

  let tier;
  if (brokenThesis) tier = 'SPECULATIVE';
  else if (pts >= 4) tier = 'HIGH';
  else if (pts >= 1) tier = 'MEDIUM';
  else if (condemned) tier = 'SPECULATIVE'; // weak score + a real knock on the business = a punt
  else tier = 'LOW';                        // weak, but the business isn't condemned — a soft hold

  // Core-list names are pre-vetted compounders — floor them at MEDIUM unless the
  // thesis is actually broken.
  if (!brokenThesis && CORE_LIST.includes(String(sym).toUpperCase())
      && (tier === 'LOW' || tier === 'SPECULATIVE')) {
    tier = 'MEDIUM';
    reasons.unshift('Core-list compounder (floored at Medium)');
  }

  return { tier, tierScore: pts, tierReasons: reasons.slice(0, 3) };
}

// Run all agents against a ticker; the verdict is computed in code, then AXIOM
// writes the human explanation of that (fixed) verdict.
// mode: 'scout' = fast cron pass; 'full' = conversational.
export async function runCouncil(ticker, { mode = 'full', uid = null } = {}) {
  const sym = ticker.toUpperCase().trim();
  const [{ liveDataBlock, price, changePct, nextEarnings, news, facts }, holdings, memos, fund, aw, cal] = await Promise.all([
    fetchLiveData(sym),
    buildHoldingsContext(uid, sym).catch(() => null),
    uid ? relevantMemos(uid, { ticker: sym }).catch(() => []) : Promise.resolve([]),
    fundamentals(sym).catch(() => ({ available: false })),
    uid ? agentWeights(uid).catch(() => ({ weights: {} })) : Promise.resolve({ weights: {} }),
    uid ? getCalibration(uid).catch(() => ({ notes: {} })) : Promise.resolve({ notes: {} }),
  ]);
  const btLine = await backtestVerdictLine(sym).catch(() => '');
  const desk = memoBlock(memos);
  const fundBlock = fundamentalsBlock(fund);
  const user = `${sym}: rule on it for the firm's book — does it belong, is the thesis broken, is the entry OK, can it be sized.\n${liveDataBlock}${fundBlock}${holdings?.block || ''}${desk}\nReturn ONLY the JSON.`;

  const agents = {};
  for (let i = 0; i < AGENTS.length; i++) {
    const ag = AGENTS[i];
    const calNote = cal?.notes?.[ag.id];
    const system = calNote
      ? `${ag.system}\n\nCALIBRATION (your own track record — adjust accordingly): ${calNote}`
      : ag.system;
    try {
      const { text } = await callAgent({ system, user, agentIndex: i });
      const parsed = extractJSON(text) || { ...FALLBACK };
      const checks = {};
      for (const key of Object.keys(ag.checks)) checks[key] = asBool(parsed.checks?.[key]);
      agents[ag.id] = {
        checks,
        note: String(parsed.note || '').slice(0, 160),
        headline: String(parsed.headline || '').slice(0, 120),
        stance: agentStance(ag.id, checks),
        score: (() => {
          const vals = Object.values(checks).filter(v => v !== null);
          return vals.length ? Math.round((vals.filter(Boolean).length / vals.length) * 10) : null;
        })(),
      };
    } catch (err) {
      agents[ag.id] = { ...FALLBACK, checks: {}, stance: 'CAUTION', score: null, error: err.message };
    }
    if (i < AGENTS.length - 1) await sleep(mode === 'scout' ? 1200 : 600);
  }

  const computed = scoreCouncil(agents, holdings, facts, aw.weights);
  const tier = convictionTier(agents, sym);

  const checkLines = AGENTS.map(ag => {
    const r = agents[ag.id] || {};
    const cs = Object.entries(r.checks || {})
      .map(([k, v]) => `${k}=${v === null ? '?' : v ? 'yes' : 'no'}`).join(', ');
    return `${ag.name} (${ag.role}): ${cs} — ${r.note || r.headline}`;
  }).join('\n');

  const synthSys = `You are AXIOM, chair of THE COUNCIL, briefing the firm's partner on ${sym}. ${PROTOCOLS}
The verdict and conviction are ALREADY DECIDED by the rulebook math below — your job is to explain WHY in plain language, not to change it.
VERDICT MEANINGS: ADD = buy / add to the position. HOLD = keep it, no action. TRIM = reduce it. EXIT = sell out.
If the firm already holds this name, speak to the position we actually have — its size, its cost basis, whether we're up or down — and what this verdict means for it (add more / sit / cut). If we're underwater but the thesis holds, say plainly whether this is an averaging-down opportunity or a wait.
Output ONLY raw JSON: {"headline":"<one bold line>","rationale":"<2-4 sentences, direct and casual, cite the checks that drove it>","catalyst":"<the single event most relevant, or null>"}`;

  let synth = { headline: '', rationale: '', catalyst: null };
  try {
    const text = await callSynthesis({
      system: synthSys,
      user: `${liveDataBlock}${fundBlock}${holdings?.block || ''}${btLine}\nRULEBOOK VERDICT: ${computed.verdict} (conviction ${computed.conviction}/10). `
        + `CONVICTION TIER: ${tier.tier}${tier.tierReasons.length ? ` (${tier.tierReasons.join('; ')})` : ''}. `
        + `WHAT DROVE IT: ${computed.why || (computed.verdict === 'ADD' ? 'strong council score, entry clear, room to add' : 'mixed checks, nothing decisive')}. `
        + `${computed.concentrationTrim ? 'This is a TRIM FOR SIZE — the business is fine, the position is just too big; say so plainly. ' : ''}`
        + `${computed.atCap && !computed.concentrationTrim ? 'The council likes this name and would ADD, but the sector/position is at its cap — so HOLD. Frame it as "we would buy more if we could". ' : ''}`
        + `${computed.downtrendExit ? 'EXIT is driven by a real downtrend PLUS weak fundamentals — not the chart alone. ' : ''}\n`
        + `Council checks:\n${checkLines}`,
      maxTokens: 512,
    });
    synth = { ...synth, ...(extractJSON(text) || {}) };
  } catch { /* keep default */ }

  return {
    ticker: sym, price, changePct, nextEarnings, facts,
    fundamentals: fund?.available ? fund : null,
    news: news.map(a => ({
      headline: a.headline, url: a.url, source: a.source,
      date: new Date(a.ts).toISOString().slice(0, 10), ts: a.ts,
    })),
    agents,
    verdict: computed.verdict,
    conviction: computed.conviction,
    tier: tier.tier,
    tierScore: tier.tierScore,
    tierReasons: tier.tierReasons,
    computed: {
      broken: computed.broken, downtrend: computed.downtrend, downtrendExit: computed.downtrendExit,
      entryClear: computed.entryClear, structuralBear: computed.structuralBear,
      concentrationBlock: computed.concentrationBlock, concentrationTrim: computed.concentrationTrim,
      atCap: computed.atCap, overCapX: computed.overCapX, why: computed.why,
      score100: computed.score100, thinData: computed.thinData,
    },
    holdings: holdings && {
      held: holdings.held, positionPct: holdings.positionPct,
      sector: holdings.sector, sectorPct: holdings.sectorPct,
      sleeve: holdings.sleeve, breachIfAdd: holdings.breachIfAdd,
      econ: holdings.econ || null,
    },
    ...synth,
    ts: Date.now(),
  };
}
