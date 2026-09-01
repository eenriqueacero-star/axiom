import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { db } from '../lib/firebase.js';
import { AGENTS } from '../agents/definitions.js';
import { runCouncil } from '../lib/council.js';
import { aggregate } from '../lib/scorecard.js';

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
