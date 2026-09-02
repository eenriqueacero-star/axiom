import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { backtest, holdingsNow, quantStatus } from '../lib/quant.js';

const router = Router();
router.use(verifyToken);

router.get('/status', async (_req, res) => {
  res.json(await quantStatus());
});

router.get('/backtest', async (_req, res) => {
  try {
    res.json(await backtest());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/holdings-now', async (_req, res) => {
  try {
    res.json(await holdingsNow());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
