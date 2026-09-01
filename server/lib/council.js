import { AGENTS, PROTOCOLS, AXIOM_SYSTEM } from '../agents/definitions.js';
import { callAgent, callSynthesis } from './groq.js';
import { safeJson } from './fetchJson.js';
import { tickerNews } from './signals.js';
import { priceFacts } from './metrics.js';

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
export function scoreCouncil(agents) {
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

  return {
    verdict, conviction, score,
    broken, downtrend, entryClear,
    tally: { yes, no, answered },
  };
}

// Run all agents against a ticker; the verdict is computed in code, then AXIOM
// writes the human explanation of that (fixed) verdict.
// mode: 'scout' = fast cron pass; 'full' = conversational.
export async function runCouncil(ticker, { mode = 'full' } = {}) {
  const sym = ticker.toUpperCase().trim();
  const { liveDataBlock, price, changePct, nextEarnings, news, facts } = await fetchLiveData(sym);
  const user = `Ticker: ${sym}. Judge it for Axiom's long-term basket (belongs / broken / entry / size).\n${liveDataBlock}\nReturn ONLY the JSON.`;

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

  const computed = scoreCouncil(agents);

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
      user: `${liveDataBlock}\nRULEBOOK VERDICT: ${computed.verdict} (conviction ${computed.conviction}/10). `
        + `${computed.broken ? 'Thesis flagged BROKEN. ' : ''}${computed.downtrend ? 'Confirmed downtrend. ' : ''}`
        + `${!computed.entryClear ? 'Entry not clear (trend/extension). ' : ''}\n`
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
    computed: { broken: computed.broken, downtrend: computed.downtrend, entryClear: computed.entryClear, tally: computed.tally },
    ...synth,
    ts: Date.now(),
  };
}
