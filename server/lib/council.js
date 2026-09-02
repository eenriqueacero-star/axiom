import { AGENTS, PROTOCOLS, AXIOM_SYSTEM } from '../agents/definitions.js';
import { callAgent, callSynthesis } from './groq.js';
import { safeJson } from './fetchJson.js';
import { tickerNews } from './signals.js';
import { priceFacts } from './metrics.js';
import { getPortfolio } from './portfolio.js';
import { diagnose, sectorOf, sleeveOf, CAPS, CORE_LIST } from './strategy.js';
import { relevantMemos, memoBlock } from './memos.js';
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

  const liveDataBlock = `\nLIVE DATA (as of ${timeStr}): ${ticker} ${priceStr}${changeStr}. ${earningsLine}.\n${factsBlock ? factsBlock + '\n' : ''}RECENT NEWS:\n${newsText || 'No recent news.'}\n`;
  return { liveDataBlock, price, changePct, nextEarnings, news, facts };
}

const FALLBACK = { checks: {}, note: 'No response', headline: 'No response', error: true };

/**
 * Build the "here's what you already own" context for a council run.
 * Returns null when there's no uid or no portfolio yet.
 */
async function buildHoldingsContext(uid, sym) {
  if (!uid) return null;
  let portfolio;
  try { portfolio = await getPortfolio(uid); } catch { return null; }
  const d = diagnose(portfolio);
  if (!d.ready) return null;

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
    `HOLDINGS CONTEXT (the investor's actual portfolio, $${Math.round(d.total).toLocaleString()}):`,
    `- ${sym}: currently ${(positionPct * 100).toFixed(1)}% of the portfolio (${sleeve} sleeve; cap ${(nameCap * 100).toFixed(0)}%)`,
    `- ${sector} sector: currently ${(sectorPct * 100).toFixed(0)}% of the portfolio (cap ${CAPS.sector * 100}%)`,
    `- Core/Satellite mix: ${(d.sleeve.corePct * 100).toFixed(0)}% / ${(d.sleeve.satellitePct * 100).toFixed(0)}% (target ${d.sleeve.targetCore * 100}/${(1 - d.sleeve.targetCore) * 100})`,
  ];
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

  return { block: '\n' + lines.join('\n') + '\n', held: positionPct > 0, positionPct, sectorPct, sector, sleeve, breachIfAdd, breachSector, breachName };
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

/**
 * Compute the council verdict from the agents' binary checks — in code, no LLM.
 * Returns { verdict, conviction, score, broken, entryClear, tally }.
 */
export function scoreCouncil(agents, holdings = null) {
  let yes = 0, no = 0;
  for (const id of POSITIVE_AGENTS) {
    for (const v of Object.values(agents[id]?.checks || {})) {
      const b = asBool(v);
      if (b === true) yes++;
      else if (b === false) no++;
    }
  }
  const answered = yes + no;
  const yesRate = answered ? yes / answered : 0.5;
  const score = Math.round(yesRate * 10);

  const trend = agents.trend?.checks || {};
  const bear = agents.bear?.checks || {};
  const broken = asBool(bear.thesisBreaker) === true;
  const downtrend = asBool(trend.aboveLongTermAvg) === false && asBool(trend.trendConstructive) === false;
  const entryClear = asBool(trend.aboveLongTermAvg) !== false && asBool(trend.notOverextended) !== false;
  const structuralBear = asBool(bear.structuralBearCase) === true;

  let verdict, conviction;
  if (broken) { verdict = 'EXIT'; conviction = 9; }
  else if (downtrend) { verdict = 'EXIT'; conviction = 7; }
  else if (score >= 7 && entryClear && !structuralBear) { verdict = 'ADD'; conviction = score; }
  else if (score <= 3) { verdict = 'TRIM'; conviction = Math.max(5, 10 - score); }
  else { verdict = 'HOLD'; conviction = 5; }

  // Holdings-aware: a good name you can't fit under the caps is a HOLD, not an ADD.
  let concentrationBlock = false;
  if (verdict === 'ADD' && holdings?.breachIfAdd) {
    verdict = 'HOLD';
    conviction = 5;
    concentrationBlock = true;
  }
  // Already oversized in this name → lean TRIM even if the business is fine.
  if (holdings?.breachName && !broken && verdict === 'HOLD') {
    verdict = 'TRIM';
    conviction = 6;
  }

  return {
    verdict, conviction, score,
    broken, downtrend, entryClear, concentrationBlock,
    tally: { yes, no, answered },
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
  const T = (v) => asBool(v) === true;
  const F = (v) => asBool(v) === false;

  let pts = 0;
  const reasons = [];
  const add = (n, msg) => { pts += n; if (msg) reasons.push(msg); };

  if (T(q.qualityBusiness)) add(2, 'durable, moaty business');
  if (F(q.qualityBusiness)) add(-2, 'business quality in doubt');
  if (T(q.growthIntact)) add(1);
  if (F(q.growthIntact)) add(-1, 'growth stalling');
  if (F(q.noRedFlags)) add(-2, 'dilution / governance red flag');
  if (T(s.sectorHealthy)) add(1);
  if (F(s.sectorHealthy)) add(-1, 'sector rolling over');
  if (F(s.noPolicyOverhang)) add(-1, 'policy overhang on the sector');
  if (F(z.volatilityManageable)) add(-2, 'too volatile to size with conviction');
  if (T(b.structuralBearCase)) add(-2, 'a real structural bear case');

  const brokenThesis = T(b.thesisBreaker);

  let tier;
  if (brokenThesis) tier = 'SPECULATIVE';
  else if (pts >= 4) tier = 'HIGH';
  else if (pts >= 1) tier = 'MEDIUM';
  else if (pts >= -2) tier = 'LOW';
  else tier = 'SPECULATIVE';

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
  const [{ liveDataBlock, price, changePct, nextEarnings, news, facts }, holdings, memos] = await Promise.all([
    fetchLiveData(sym),
    buildHoldingsContext(uid, sym).catch(() => null),
    uid ? relevantMemos(uid, { ticker: sym }).catch(() => []) : Promise.resolve([]),
  ]);
  const desk = memoBlock(memos);
  const user = `Ticker: ${sym}. Judge it for Axiom's long-term basket (belongs / broken / entry / size).\n${liveDataBlock}${holdings?.block || ''}${desk}\nReturn ONLY the JSON.`;

  const agents = {};
  for (let i = 0; i < AGENTS.length; i++) {
    const ag = AGENTS[i];
    try {
      const { text } = await callAgent({ system: ag.system, user, agentIndex: i });
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

  const computed = scoreCouncil(agents, holdings);
  const tier = convictionTier(agents, sym);

  const checkLines = AGENTS.map(ag => {
    const r = agents[ag.id] || {};
    const cs = Object.entries(r.checks || {})
      .map(([k, v]) => `${k}=${v === null ? '?' : v ? 'yes' : 'no'}`).join(', ');
    return `${ag.name} (${ag.role}): ${cs} — ${r.note || r.headline}`;
  }).join('\n');

  const synthSys = `You are AXIOM, chair of THE COUNCIL, explaining a verdict on ${sym} to a sharp friend. ${PROTOCOLS}
The verdict and conviction are ALREADY DECIDED by the rulebook math below — your job is to explain WHY in plain language, not to change it.
VERDICT MEANINGS: ADD = buy / add to this. HOLD = keep it, no action. TRIM = reduce the position. EXIT = sell out.
Output ONLY raw JSON: {"headline":"<one bold line>","rationale":"<2-4 sentences, direct and casual, cite the checks that drove it>","catalyst":"<the single event most relevant, or null>"}`;

  let synth = { headline: '', rationale: '', catalyst: null };
  try {
    const text = await callSynthesis({
      system: synthSys,
      user: `${liveDataBlock}${holdings?.block || ''}\nRULEBOOK VERDICT: ${computed.verdict} (conviction ${computed.conviction}/10). `
        + `CONVICTION TIER: ${tier.tier}${tier.tierReasons.length ? ` (${tier.tierReasons.join('; ')})` : ''}. `
        + `${computed.broken ? 'Thesis flagged BROKEN. ' : ''}${computed.downtrend ? 'Confirmed downtrend. ' : ''}`
        + `${!computed.entryClear ? 'Entry not clear (trend/extension). ' : ''}`
        + `${computed.concentrationBlock ? 'The business is fine but ADD was blocked — the sector/name is already at its cap, so HOLD. ' : ''}\n`
        + `Council checks:\n${checkLines}`,
      maxTokens: 512,
    });
    synth = { ...synth, ...(extractJSON(text) || {}) };
  } catch { /* keep default */ }

  return {
    ticker: sym, price, changePct, nextEarnings, facts,
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
      broken: computed.broken, downtrend: computed.downtrend, entryClear: computed.entryClear,
      concentrationBlock: computed.concentrationBlock, tally: computed.tally,
    },
    holdings: holdings && {
      held: holdings.held, positionPct: holdings.positionPct,
      sector: holdings.sector, sectorPct: holdings.sectorPct,
      sleeve: holdings.sleeve, breachIfAdd: holdings.breachIfAdd,
    },
    ...synth,
    ts: Date.now(),
  };
}
