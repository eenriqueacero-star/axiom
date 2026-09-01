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

const FALLBACK = { stance: 'CAUTION', score: 5, headline: 'No response', points: [] };

// Run all six agents against a ticker, then AXIOM's synthesis verdict.
// mode: 'scout' = terse per-agent pass (fast, used by cron); 'full' = conversational.
export async function runCouncil(ticker, { mode = 'full' } = {}) {
  const sym = ticker.toUpperCase().trim();
  const { liveDataBlock, price, changePct, nextEarnings, news, facts } = await fetchLiveData(sym);
  const user = `Ticker: ${sym}. Investor considering BUYING.\n${liveDataBlock}\nReturn ONLY the JSON.`;

  const agents = {};
  for (let i = 0; i < AGENTS.length; i++) {
    try {
      const { text } = await callAgent({ system: AGENTS[i].system, user, agentIndex: i });
      agents[AGENTS[i].id] = extractJSON(text) || { ...FALLBACK };
    } catch (err) {
      agents[AGENTS[i].id] = { ...FALLBACK, headline: 'Error', error: err.message };
    }
    if (i < AGENTS.length - 1) await sleep(mode === 'scout' ? 1200 : 600);
  }

  const summary = AGENTS.map(ag => {
    const r = agents[ag.id] || {};
    return `${ag.name} (${ag.role}): stance=${r.stance} score=${r.score} — ${r.headline}`;
  }).join('\n');

  const synthSys = `You are AXIOM delivering the council's verdict on ${sym}. ${PROTOCOLS}
Output ONLY raw JSON: {"verdict":"BUY"|"WATCH"|"SKIP","conviction":<0-10>,"headline":"<one bold line>","rationale":"<2-4 sentences, direct and casual>","catalyst":"<the single news item or event most driving this call, or null>"}
BUY = strong opportunity (conviction 7+). WATCH = interesting but not ready. SKIP = pass.`;

  let synth = { verdict: 'WATCH', conviction: 5, headline: '', rationale: '', catalyst: null };
  try {
    const text = await callSynthesis({
      system: synthSys,
      user: `${liveDataBlock}\nAgent results:\n${summary}\nPrice: ${price ? '$' + price.toFixed(2) : 'unknown'}`,
      maxTokens: 512,
    });
    synth = { ...synth, ...(extractJSON(text) || {}) };
  } catch { /* keep default */ }

  return {
    ticker: sym, price, changePct, nextEarnings, facts,
    // exactly the headlines the agents saw — the panel renders these, not a separate fetch
    news: news.map(a => ({
      headline: a.headline, url: a.url, source: a.source,
      date: new Date(a.ts).toISOString().slice(0, 10), ts: a.ts,
    })),
    agents, ...synth, ts: Date.now(),
  };
}
