import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { getPortfolio } from '../lib/portfolio.js';
import { dcaSuggestion } from '../lib/dca.js';
import { getContributions, setContributions, addEntry, removeEntry } from '../lib/contributions.js';
import { upcomingMacro } from '../lib/macro.js';
import {
  SPLIT, CAPS, BUFFER_ETF, ENTRY, CORE_LIST, diagnose, sectorOf, sleeveOf,
} from '../lib/strategy.js';

const router = Router();

// Public: the rulebook config (no user data).
router.get('/', (_req, res) => {
  res.json({ split: SPLIT, caps: CAPS, bufferEtf: BUFFER_ETF, entry: ENTRY, coreList: CORE_LIST });
});

// Public: upcoming macro/econ events (no user data).
router.get('/macro', async (req, res) => {
  try {
    res.json({ events: await upcomingMacro({ days: Number(req.query.days) || 21 }) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
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

// The contribution ledger — recurring cadence + scheduled one-off deposits/withdrawals.
router.get('/contributions', async (req, res) => {
  try {
    res.json(await getContributions(req.uid));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.put('/contributions', async (req, res) => {
  try {
    res.json(await setContributions(req.uid, req.body || {}));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/contributions/entry', async (req, res) => {
  const { date, amount, direction, note } = req.body || {};
  if (!date || !(Number(amount) > 0)) return res.status(400).json({ error: 'date + amount required' });
  try {
    res.json(await addEntry(req.uid, { date, amount, direction, note }));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.delete('/contributions/entry/:id', async (req, res) => {
  try {
    res.json(await removeEntry(req.uid, req.params.id));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
