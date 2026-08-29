import { AGENTS, ACCOUNTS, DISCOVERY_POOL, PROTOCOLS } from '../agents/definitions.js';
import { callAgent, callSynthesis } from '../lib/groq.js';
import { db } from '../lib/firebase.js';
import { sendPush } from '../routes/push.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function extractJSON(text) {
  try {
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = fenceMatch ? fenceMatch[1] : text;
    const start = raw.indexOf('{'), end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) return null;
    return JSON.parse(raw.slice(start, end + 1));
  } catch { return null; }
}

async function fetchLiveData(ticker) {
  const FINNHUB = process.env.FINNHUB_KEY;
  const today = new Date().toISOString().slice(0, 10);
  const from  = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
  const in90d = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);

  const [qRes, nRes, eRes] = await Promise.all([
    fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB}`),
    fetch(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${from}&to=${today}&token=${FINNHUB}`),
    fetch(`https://finnhub.io/api/v1/stock/earnings-calendar?from=${today}&to=${in90d}&symbol=${ticker}&token=${FINNHUB}`),
  ]);

  const q = qRes.ok ? await qRes.json() : {};
  const news = nRes.ok ? (await nRes.json()).slice(0, 5) : [];
  const earnings = eRes.ok ? await eRes.json() : {};

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
  return { liveDataBlock, price, changePct };
}

async function scoutOne(ticker) {
  const { liveDataBlock, price, changePct } = await fetchLiveData(ticker);
  const baseContent = `Ticker: ${ticker}. Investor considering BUYING.\n${liveDataBlock}\nReturn ONLY the JSON.`;

  const agentResults = {};
  for (let i = 0; i < AGENTS.length; i++) {
    try {
      const { text } = await callAgent({ system: AGENTS[i].system, user: baseContent, agentIndex: i });
      const parsed = extractJSON(text) || { stance: 'CAUTION', score: 5, headline: 'No parse', points: [] };
      agentResults[AGENTS[i].id] = parsed;
    } catch {
      agentResults[AGENTS[i].id] = { stance: 'CAUTION', score: 5, headline: 'Error', points: [] };
    }
    if (i < AGENTS.length - 1) await sleep(1200);
  }

  const summary = AGENTS.map(ag => {
    const r = agentResults[ag.id] || {};
    return `${ag.name} (${ag.role}): stance=${r.stance} score=${r.score} — ${r.headline}`;
  }).join('\n');

  const synthSys = `You are AXIOM delivering a quick scout verdict on ${ticker}. ${PROTOCOLS}
Output ONLY raw JSON: {"verdict":"BUY"|"WATCH"|"SKIP","conviction":<0-10>,"headline":"<one bold line>","rationale":"<1-2 sentences>"}
BUY = strong opportunity (conviction 7+). WATCH = interesting but not ready. SKIP = pass.`;

  let verdict = 'WATCH', conviction = 5, headline = '', rationale = '';
  try {
    const text = await callSynthesis({ system: synthSys, user: `Agent results:\n${summary}\nPrice: ${price ? '$' + price.toFixed(2) : 'unknown'}`, maxTokens: 512 });
    const parsed = extractJSON(text);
    if (parsed) { verdict = parsed.verdict || 'WATCH'; conviction = parsed.conviction ?? 5; headline = parsed.headline || ''; rationale = parsed.rationale || ''; }
  } catch {}

  return { ticker, verdict, conviction, headline, rationale, price, changePct, agents: agentResults, ts: Date.now() };
}

export async function runDailyScout() {
  const tickers = [...new Set([
    ...Object.values(ACCOUNTS).flatMap(a => a.holdings),
    ...DISCOVERY_POOL,
  ])];

  const results = [];
  for (const ticker of tickers) {
    try {
      const result = await scoutOne(ticker);
      results.push(result);
      await db.collection('scoutResults').add(result);
      console.log(`[scout] ${ticker}: ${result.verdict} (${result.conviction}/10)`);
    } catch (err) {
      console.error(`[scout] ${ticker} failed:`, err.message);
    }
    await sleep(2000);
  }

  // Notify all users with subscriptions about high-conviction buys
  const highConviction = results.filter(r => r.verdict === 'BUY' && r.conviction >= 7);
  if (highConviction.length > 0) {
    const usersSnap = await db.collection('users').get();
    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      for (const r of highConviction) {
        await sendPush(uid, {
          title: `AXIOM Scout: ${r.ticker} — ${r.verdict}`,
          body: r.headline || r.rationale || `Conviction ${r.conviction}/10`,
          data: { ticker: r.ticker, verdict: r.verdict },
        }).catch(() => {});
      }
    }
  }

  console.log(`[scout] Done. ${results.length} tickers scanned, ${highConviction.length} high-conviction buys.`);
  return results;
}
