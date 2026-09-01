import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { brokerReady, syncHoldings, brokerStatus } from '../lib/broker.js';
import { getPortfolio } from '../lib/portfolio.js';

const router = Router();
router.use(verifyToken);

router.get('/status', async (req, res) => {
  try {
    res.json(await brokerStatus(req.uid));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/sync', async (req, res) => {
  if (!brokerReady) return res.status(501).json({ error: 'Broker linking not configured' });
  try {
    const synced = await syncHoldings(req.uid);
    res.json({ synced, portfolio: await getPortfolio(req.uid) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
