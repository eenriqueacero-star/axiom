import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { db } from '../lib/firebase.js';
import { AGENTS } from '../agents/definitions.js';
import { runCouncil } from '../lib/council.js';

const router = Router();

// Public-ish: agent metadata for the client to render cards (no prompts leaked).
router.get('/agents', (_req, res) => {
  res.json(AGENTS.map(({ id, name, emoji, color, role }) => ({ id, name, emoji, color, role })));
});

router.use(verifyToken);

const TICKER_RE = /^[A-Z.\-]{1,10}$/;

router.post('/run', async (req, res) => {
  const ticker = String(req.body?.ticker || '').toUpperCase().trim();
  if (!TICKER_RE.test(ticker)) return res.status(400).json({ error: 'Invalid ticker' });
  try {
    const result = await runCouncil(ticker);
    // Persist so every device sees it via a Firestore realtime listener.
    const ref = await db.collection(`users/${req.uid}/analyses`).add(result);
    res.json({ id: ref.id, ...result });
  } catch (err) {
    res.status(502).json({ error: `Council run failed: ${err.message}` });
  }
});

export default router;
