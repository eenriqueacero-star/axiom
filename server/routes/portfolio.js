import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { getPortfolio, setHolding, addTicker, removeTicker } from '../lib/portfolio.js';

const router = Router();
router.use(verifyToken);

const TICKER_RE = /^[A-Z.\-]{1,10}$/;

router.get('/', async (req, res) => {
  try {
    res.json(await getPortfolio(req.uid));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.put('/:accountId/:ticker', async (req, res) => {
  const { accountId, ticker } = req.params;
  if (!TICKER_RE.test(ticker.toUpperCase())) return res.status(400).json({ error: 'Invalid ticker' });
  try {
    await setHolding(req.uid, accountId, ticker, {
      shares: req.body?.shares,
      costBasis: req.body?.costBasis,
    });
    res.json(await getPortfolio(req.uid));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/:accountId/:ticker', async (req, res) => {
  const { accountId, ticker } = req.params;
  if (!TICKER_RE.test(ticker.toUpperCase())) return res.status(400).json({ error: 'Invalid ticker' });
  try {
    await addTicker(req.uid, accountId, ticker);
    res.json(await getPortfolio(req.uid));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:accountId/:ticker', async (req, res) => {
  try {
    await removeTicker(req.uid, req.params.accountId, req.params.ticker);
    res.json(await getPortfolio(req.uid));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
