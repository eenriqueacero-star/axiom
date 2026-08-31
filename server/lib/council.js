import { AGENTS, PROTOCOLS, AXIOM_SYSTEM } from '../agents/definitions.js';
import { callAgent, callSynthesis } from './groq.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Finnhub endpoints not on the free tier 302-redirect to their marketing site,
// which fetch follows to a 200 HTML page — so never trust res.ok alone.
async function safeJson(res) {
  if (!res.ok) return null;
  if (!res.headers.get('content-type')?.includes('application/json')) return null;
  try { return await res.json(); } catch { return null; }
}

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

  const [qRes, nRes, eRes] = await Promise.all([
    fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB}`),
    fetch(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${from}&to=${today}&token=${FINNHUB}`),
    fetch(`https://finnhub.io/api/v1/stock/earnings-calendar?from=${today}&to=${in90d}&symbol=${ticker}&token=${FINNHUB}`),
  ]);

  const q = (await safeJson(qRes)) || {};
  const newsRaw = await safeJson(nRes);
  const news = Array.isArray(newsRaw) ? newsRaw.slice(0, 5) : [];
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
  const newsText = news.map(a => `- [${new Date(a.datetime * 1000).toISOString().slice(0, 10)}] ${a.headline}`).join('\n');

  const liveDataBlock = `\nLIVE DATA (as of ${timeStr}): ${ticker} ${priceStr}${changeStr}. ${earningsLine}.\n${newsText || 'No recent news.'}\n`;
  return { liveDataBlock, price, changePct, nextEarnings, news };
}

const FALLBACK = { stance: 'CAUTION', score: 5, headline: 'No response', points: [] };

// Run all six agents against a ticker, then AXIOM's synthesis verdict.
// mode: 'scout' = terse per-agent pass (fast, used by cron); 'full' = conversational.
export async function runCouncil(ticker, { mode = 'full' } = {}) {
  const sym = ticker.toUpperCase().trim();
  const { liveDataBlock, price, changePct, nextEarnings, news } = await fetchLiveData(sym);
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
Output ONLY raw JSON: {"verdict":"BUY"|"WATCH"|"SKIP","conviction":<0-10>,"headline":"<one bold line>","rationale":"<2-4 sentences, direct and casual>"}
BUY = strong opportunity (conviction 7+). WATCH = interesting but not ready. SKIP = pass.`;

  let synth = { verdict: 'WATCH', conviction: 5, headline: '', rationale: '' };
  try {
    const text = await callSynthesis({
      system: synthSys,
      user: `Agent results:\n${summary}\nPrice: ${price ? '$' + price.toFixed(2) : 'unknown'}`,
      maxTokens: 512,
    });
    synth = { ...synth, ...(extractJSON(text) || {}) };
  } catch { /* keep default */ }

  return {
    ticker: sym, price, changePct, nextEarnings,
    news: news.map(a => ({ headline: a.headline, url: a.url, date: new Date(a.datetime * 1000).toISOString().slice(0, 10) })),
    agents, ...synth, ts: Date.now(),
  };
}
