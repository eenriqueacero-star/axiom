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
import { buildFloorLive } from '../lib/floorLive.js';
import { buildStances } from '../lib/stances.js';
import { relevantMemos, memoBlock, saveMemo } from '../lib/memos.js';
import { markUserActivity } from '../lib/budget.js';

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

const MAX_CONSULTS = 2;

const ROSTER = (selfId) => AGENTS
  .map(a => `- ${a.name} (id "${a.id}")${a.id === selfId ? ' — you' : ''}: ${a.role}`)
  .join('\n');

const CONSULT_PROTOCOL = (selfId) => `
REACHING A COLLEAGUE — you have a real, working channel to them. If answering properly needs
another analyst's judgment, reply with ONLY this JSON object and nothing else:
{"ask":"<id>","question":"<one specific question>"}
${ROSTER(selfId)}
That message genuinely reaches them and they genuinely answer; you will be given their reply and
can then respond to the investor.

Hard rules:
- NEVER write that you have pinged, nudged, looped in, or messaged a colleague. Either emit the
  JSON (which actually reaches them) or answer from your own remit.
- NEVER say you are waiting on, or will follow up for, a colleague's reply. Replies are immediate.
- NEVER write dialogue for another agent or invent what they said.
- Use this only when you genuinely need their judgment — not for greetings or small talk.`;

function buildAgentSystem(agent, { context = '', allowConsult = false } = {}) {
  const checks = Object.values(agent.checks || {}).map(v => `- ${v}`).join('\n');
  return `${agent.conversationalPrompt}
You are ${agent.name} on Axiom's council. Your job on the council: ${agent.role}
You judge these things:
${checks}

THE COUNCIL — your colleagues. Never invent other agents or misstate what they do:
${ROSTER(agent.id)}
AXIOM is the synthesiser; it explains the verdict the council's checks compute, it doesn't overrule them.
${allowConsult ? CONSULT_PROTOCOL(agent.id) : ''}
HOW TO TALK — you are a person having a conversation, not a reporting function.
- Match the register you're given. "wassup" gets "not much, what's up?" — a greeting is a greeting.
  Small talk gets small talk. One line is a perfectly good answer.
- NEVER open with a status report, and never volunteer sector/portfolio analysis that wasn't
  asked for. The reference material below is there for when it's actually relevant — most
  messages don't need any of it.
- Answer the question that was asked. If they ask something outside your remit, say so plainly
  in a sentence, or reach the colleague it belongs to.
- Talk like a sharp colleague texting: plain words, contractions, no bullet lists unless they
  asked for a breakdown, no "from a sector-health view" preambles, no corporate filler.
- When you DO give analysis, keep it to 2-4 sentences and use only the data below — never
  invent a price, date, or event. If you don't know, say you don't know.

You're talking 1-on-1 with the investor who runs Axiom.${context
      ? `\n\n--- REFERENCE MATERIAL (only use what's relevant to what they actually asked) ---${context}`
      : ''}`;
}

// Returns { id, question } when the model asked to consult someone real.
function parseConsult(text, selfId) {
  const m = String(text || '').match(/\{[^{}]*"ask"\s*:\s*"[^"]+"[^{}]*\}/);
  if (!m) return null;
  let obj;
  try { obj = JSON.parse(m[0]); } catch { return null; }
  const id = String(obj.ask || '').toLowerCase();
  const target = AGENTS.find(a => a.id === id || a.name.toLowerCase() === id);
  const question = String(obj.question || '').trim();
  if (!target || target.id === selfId || !question) return null;
  return { id: target.id, question: question.slice(0, 400) };
}

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

    let live = { ready: false };
    try { live = await buildFloorLive(req.uid); } catch { /* non-fatal */ }

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
      live,
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Per-holding council stance — latest verdict on every name the user owns.
// Cheap Firestore read (no LLM); drives the stance badges on the Portfolio view.
router.get('/stances', async (req, res) => {
  try {
    res.json(await buildStances(req.uid));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// The latest stored council run for one ticker — the "why" behind its stance
// badge. Firestore read only; returns { found: false } when it's never been run.
router.get('/analysis/:ticker', async (req, res) => {
  const ticker = String(req.params.ticker || '').toUpperCase();
  if (!TICKER_RE.test(ticker)) return res.status(400).json({ error: 'Invalid ticker' });
  try {
    const snap = await db.collection(`users/${req.uid}/analyses`)
      .where('ticker', '==', ticker).get();
    const latest = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
    if (!latest) return res.json({ found: false });
    res.json({ found: true, analysis: latest });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Lean live-state poll for the 3D scene (no analyses/scorecard payload).
router.get('/floor/live', async (req, res) => {
  try {
    res.json(await buildFloorLive(req.uid));
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

  markUserActivity();
  try {
    const lastUser = messages[messages.length - 1].content;
    const t = (String(req.body?.ticker || '').toUpperCase().match(/^[A-Z.\-]{1,10}$/)?.[0]) || findTicker(lastUser);

    // Every agent chat is grounded in the user's real portfolio + any ticker mentioned.
    const [portfolio, priced, news, memos] = await Promise.all([
      getPortfolio(req.uid).catch(() => null),
      t ? priceFacts(t).catch(() => ({ block: '' })) : Promise.resolve({ block: '' }),
      t ? tickerNews(t, { days: 7, limit: 4 }).catch(() => []) : Promise.resolve([]),
      relevantMemos(req.uid, { ticker: t, agentId: agent.id }).catch(() => []),
    ]);

    let context = '';
    if (portfolio) {
      const d = diagnose(portfolio);
      if (d.ready) {
        const topSectors = d.sectors.slice(0, 3).map(s => `${s.name} ${Math.round(s.pct * 100)}%`).join(', ');
        const held = t && d.names.find(n => n.ticker === t);
        context += `\n\nSCALE: dollar figures below are EXACT US dollars. This is a small personal brokerage account, not a fund — never rescale into thousands, millions or billions, and never write "B" or "M".`;
        context += `\n\nTHE INVESTOR'S PORTFOLIO ($${Math.round(d.total).toLocaleString('en-US')} in total): Core/Satellite ${Math.round(d.sleeve.corePct * 100)}/${Math.round(d.sleeve.satellitePct * 100)} (target ${d.sleeve.targetCore * 100}/${(1 - d.sleeve.targetCore) * 100}). Sectors: ${topSectors}.`;
        if (held) context += ` They currently hold ${(held.pct * 100).toFixed(1)}% in ${t}.`;
        else if (t) context += ` They do NOT currently hold ${t}.`;
        if (d.flags.length) context += ` Rulebook flags: ${d.flags.map(f => f.msg).join(' | ')}`;
      }
    }
    if (t && priced.block) {
      const headlines = news.map(n => `- ${n.headline} (${n.source})`).join('\n');
      context += `\n\nLIVE DATA — ${t}:\n${priced.block}\n${headlines ? 'Recent news:\n' + headlines : ''}`;
    }
    context += memoBlock(memos, { agentId: agent.id });

    const system = buildAgentSystem(agent, { context, allowConsult: true });

    // The consult bridge: the agent can actually reach a colleague mid-answer.
    const consulted = [];
    let reply = await callAgentChat({ system, messages });

    for (let hop = 0; hop < MAX_CONSULTS; hop++) {
      const ask = parseConsult(reply, agent.id);
      if (!ask) break;

      const colleague = AGENTS.find(a => a.id === ask.id);
      const colleagueSystem = buildAgentSystem(colleague, { context, allowConsult: false });
      const answer = (await callAgentChat({
        system: colleagueSystem,
        messages: [{
          role: 'user',
          content: `${agent.name} (${agent.role}) is asking you directly at the council desk: `
            + `"${ask.question}"\nAnswer ${agent.name} in 1-3 sentences, from your own remit. `
            + `This is colleague-to-colleague, not a note to the investor.`,
        }],
        maxTokens: 240,
      })).trim();

      consulted.push({
        from: agent.id, fromName: agent.name,
        to: colleague.id, toName: colleague.name,
        question: ask.question, answer,
      });

      // Hand the real answer back and let the original agent continue.
      reply = await callAgentChat({
        system,
        messages: [
          ...messages,
          { role: 'assistant', content: `[asked ${colleague.name}: ${ask.question}]` },
          {
            role: 'user',
            content: `${colleague.name} replied: "${answer}"\n\nNow answer the investor. `
              + `Say what ${colleague.name} told you and what you make of it. Do not emit JSON.`,
          },
        ],
      });
    }

    // A colleague-to-colleague exchange is real shared knowledge — keep it.
    for (const c of consulted) {
      saveMemo(req.uid, {
        participants: [c.from, c.to],
        topic: c.question,
        ticker: t || null,
        keyPoints: [],
        conclusion: `${c.toName} to ${c.fromName}: ${c.answer}`.slice(0, 300),
        confidence: 0.5,
        actionable: false,
        tags: t ? [t, 'consult'] : ['consult'],
        source: 'consult',
      }).catch(() => {});
    }

    res.json({ reply: reply || "…couldn't get a response, try again.", consulted });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/run', async (req, res) => {
  markUserActivity();
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
