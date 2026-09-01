import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { db } from '../lib/firebase.js';
import { AGENTS } from '../agents/definitions.js';
import { runCouncil } from '../lib/council.js';

const router = Router();

// Public-ish: agent metadata for the client to render cards (no prompts leaked).
router.get('/agents', (_req, res) => {
  res.json(AGENTS.map(({ id, name, emoji, color, role, checks }) => ({ id, name, emoji, color, role, checks })));
});

router.use(verifyToken);

const TICKER_RE = /^[A-Z.\-]{1,10}$/;
const FRESH_MS = 6 * 60 * 60 * 1000; // reuse a verdict for 6h unless forced

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
    const result = await runCouncil(ticker);
    const ref = await col.add(result);
    res.json({ id: ref.id, ...result });
  } catch (err) {
    res.status(502).json({ error: `Council run failed: ${err.message}` });
  }
});

export default router;
