import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { getPortfolio } from '../lib/portfolio.js';
import { dcaSuggestion } from '../lib/dca.js';
import {
  SPLIT, CAPS, BUFFER_ETF, ENTRY, CORE_LIST, diagnose, sectorOf, sleeveOf,
} from '../lib/strategy.js';

const router = Router();

// Public: the rulebook config (no user data).
router.get('/', (_req, res) => {
  res.json({ split: SPLIT, caps: CAPS, bufferEtf: BUFFER_ETF, entry: ENTRY, coreList: CORE_LIST });
});

router.use(verifyToken);

// Portfolio diagnostics against the rulebook — pure math, no LLM.
router.get('/diagnostics', async (req, res) => {
  try {
    const portfolio = await getPortfolio(req.uid);
    res.json(diagnose(portfolio));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Where should this cycle's contribution go? (rulebook §6)
router.get('/dca', async (req, res) => {
  try {
    res.json(await dcaSuggestion(req.uid));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
