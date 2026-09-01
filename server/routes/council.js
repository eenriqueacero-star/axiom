import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { db } from '../lib/firebase.js';
import { AGENTS } from '../agents/definitions.js';
import { runCouncil } from '../lib/council.js';
import { aggregate } from '../lib/scorecard.js';
import { callAgentChat } from '../lib/groq.js';
import { priceFacts } from '../lib/metrics.js';
import { tickerNews } from '../lib/signals.js';
import { getPortfolio } from '../lib/portfolio.js';
import { diagnose } from '../lib/strategy.js';

const COMMON_WORDS = new Set(['I', 'A', 'THE', 'MY', 'IS', 'IT', 'DO', 'OK', 'ADD', 'HOLD', 'TRIM', 'EXIT', 'AI', 'US', 'CEO', 'ETF', 'YOU', 'AND', 'OR', 'FOR', 'ARE', 'NOT', 'BUY', 'SELL', 'WHY', 'HOW']);
const findTicker = (text) => {
  const m = String(text).match(/\b[A-Z]{2,5}(?:\.[A-Z])?\b/g) || [];
  return m.find(t => !COMMON_WORDS.has(t)) || null;
};

const SCHEDULE = [
  { job: 'Daily scout scan', cadence: 'Weekdays 9:05 AM ET', does: 'Runs the full council on every holding + the discovery pool; pushes ADD/EXIT alerts.' },
  { job: 'Portfolio alerts', cadence: 'Every 30 min, market hours', does: 'Checks each holding vs your cost basis, pushes on big moves.' },
  { job: 'Verdict scorecard', cadence: 'Weekdays 4:30 PM ET', does: 'Scores past verdicts against what the stock actually did.' },
];

const router = Router();

// Public-ish: agent metadata for the client to render cards (no prompts leaked).
router.get('/agents', (_req, res) => {
  res.json(AGENTS.map(({ id, name, emoji, color, role, checks }) => ({ id, name, emoji, color, role, checks })));
});

router.use(verifyToken);

const TICKER_RE = /^[A-Z.\-]{1,10}$/;
const FRESH_MS = 6 * 60 * 60 * 1000; // reuse a verdict for 6h unless forced

// "The Floor" — agent rooms: metadata, each agent's recent calls + hit stats, schedule.
router.get('/floor', async (req, res) => {
  try {
    const snap = await db.collection(`users/${req.uid}/analyses`).get();
    const runs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0));

    let stats = { byAgent: {}, byVerdict: {}, total: 0 };
    try { stats = await aggregate(req.uid); } catch { /* empty */ }

    const perAgent = {};
    for (const ag of AGENTS) {
      const recent = [];
      for (const r of runs) {
        const a = r.agents?.[ag.id];
        if (!a) continue;
        recent.push({
          ticker: r.ticker, ts: r.ts, verdict: r.verdict,
          stance: a.stance, note: a.note || a.headline || '',
        });
        if (recent.length >= 8) break;
      }
      perAgent[ag.id] = {
        calls: runs.filter(r => r.agents?.[ag.id]).length,
        recent,
        stanceStats: stats.byAgent?.[ag.id] || {},
      };
    }

    res.json({
      agents: AGENTS.map(({ id, name, emoji, color, role, checks, conversationalPrompt }) => ({
        id, name, emoji, color, role, checks, blurb: conversationalPrompt,
      })),
      perAgent,
      schedule: SCHEDULE,
      recentRuns: runs.slice(0, 12).map(r => ({
        id: r.id, ticker: r.ticker, ts: r.ts, verdict: r.verdict,
        conviction: r.conviction, headline: r.headline || '',
      })),
      scored: stats.total,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// 1-on-1 chat with a single agent, in character, grounded in live data.
router.post('/agent/:id/chat', async (req, res) => {
  const agent = AGENTS.find(a => a.id === req.params.id);
  if (!agent) return res.status(404).json({ error: 'No such agent' });

  const messages = (req.body?.messages || [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-10);
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'Need a user message' });
  }

  try {
    const lastUser = messages[messages.length - 1].content;
    const t = (String(req.body?.ticker || '').toUpperCase().match(/^[A-Z.\-]{1,10}$/)?.[0]) || findTicker(lastUser);

    // Every agent chat is grounded in the user's real portfolio + any ticker mentioned.
    const [portfolio, priced, news] = await Promise.all([
      getPortfolio(req.uid).catch(() => null),
      t ? priceFacts(t).catch(() => ({ block: '' })) : Promise.resolve({ block: '' }),
      t ? tickerNews(t, { days: 7, limit: 4 }).catch(() => []) : Promise.resolve([]),
    ]);

    let context = '';
    if (portfolio) {
      const d = diagnose(portfolio);
      if (d.ready) {
        const topSectors = d.sectors.slice(0, 3).map(s => `${s.name} ${Math.round(s.pct * 100)}%`).join(', ');
        const held = t && d.names.find(n => n.ticker === t);
        context += `\n\nTHE INVESTOR'S PORTFOLIO ($${Math.round(d.total).toLocaleString()}): Core/Satellite ${Math.round(d.sleeve.corePct * 100)}/${Math.round(d.sleeve.satellitePct * 100)} (target ${d.sleeve.targetCore * 100}/${(1 - d.sleeve.targetCore) * 100}). Sectors: ${topSectors}.`;
        if (held) context += ` They currently hold ${(held.pct * 100).toFixed(1)}% in ${t}.`;
        else if (t) context += ` They do NOT currently hold ${t}.`;
        if (d.flags.length) context += ` Rulebook flags: ${d.flags.map(f => f.msg).join(' | ')}`;
      }
    }
    if (t && priced.block) {
      const headlines = news.map(n => `- ${n.headline} (${n.source})`).join('\n');
      context += `\n\nLIVE DATA — ${t}:\n${priced.block}\n${headlines ? 'Recent news:\n' + headlines : ''}`;
    }

    const checks = Object.entries(agent.checks || {}).map(([k, v]) => `- ${v}`).join('\n');
    const system = `${agent.conversationalPrompt}
You are ${agent.name} on Axiom's council. Your job on the council: ${agent.role}
You judge these things:
${checks}
You're talking 1-on-1 with the investor who runs Axiom. Stay in character, be concise (2-4 sentences), plain-spoken, no corporate filler. Use ONLY the data provided — never invent a price, date, or event. If you don't know, say so.${context}`;

    const reply = await callAgentChat({ system, messages });
    res.json({ reply: reply || "…couldn't get a response, try again." });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/run', async (req, res) => {
  const ticker = String(req.body?.ticker || '').toUpperCase().trim();
  if (!TICKER_RE.test(ticker)) return res.status(400).json({ error: 'Invalid ticker' });

  const col = db.collection(`users/${req.uid}/analyses`);

  // The model isn't bitwise-deterministic; reuse a recent verdict so the same
  // ticker doesn't flip ratings on a refresh. `force: true` overrides.
  if (!req.body?.force) {
    try {
      // Equality-only query (no composite index needed); newest picked in JS.
      const snap = await col.where('ticker', '==', ticker).get();
      const latest = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
      if (latest && Date.now() - (latest.ts || 0) < FRESH_MS) {
        return res.json({ cached: true, ...latest });
      }
    } catch { /* fall through to a fresh run */ }
  }

  try {
    const result = await runCouncil(ticker, { uid: req.uid });
    const ref = await col.add(result);
    res.json({ id: ref.id, ...result });
  } catch (err) {
    res.status(502).json({ error: `Council run failed: ${err.message}` });
  }
});

export default router;
