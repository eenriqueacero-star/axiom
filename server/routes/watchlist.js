import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { listWatchlist, addToWatchlist, removeFromWatchlist } from '../lib/watchlist.js';
import { markUserActivity } from '../lib/budget.js';

const router = Router();
router.use(verifyToken);

router.get('/', async (req, res) => {
  res.json({ items: await listWatchlist(req.uid) });
});

router.post('/', async (req, res) => {
  markUserActivity();
  const { ticker, note } = req.body || {};
  if (!ticker) return res.status(400).json({ error: 'ticker required' });
  res.json(await addToWatchlist(req.uid, ticker, note));
});

router.delete('/:ticker', async (req, res) => {
  markUserActivity();
  res.json(await removeFromWatchlist(req.uid, req.params.ticker));
});

export default router;
