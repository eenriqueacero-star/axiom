import { AGENTS, ACCOUNTS, DISCOVERY_POOL, PROTOCOLS } from '../agents/definitions.js';
import { callAgent, callSynthesis } from '../lib/groq.js';
import { db } from '../lib/firebase.js';
import { sendPush } from '../routes/push.js';
import { extractJSON, fetchLiveData } from '../lib/council.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

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
