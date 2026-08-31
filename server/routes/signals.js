import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { marketNews, tickerNews } from '../lib/signals.js';

const router = Router();
router.use(verifyToken);

const TICKER_RE = /^[A-Z.\-]{1,10}$/;

router.get('/market', async (_req, res) => {
  try {
    res.json(await marketNews());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/:ticker', async (req, res) => {
  const ticker = String(req.params.ticker || '').toUpperCase();
  if (!TICKER_RE.test(ticker)) return res.status(400).json({ error: 'Invalid ticker' });
  try {
    res.json(await tickerNews(ticker));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
