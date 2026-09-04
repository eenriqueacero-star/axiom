import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { markUserActivity } from '../lib/budget.js';
import { buildQueue } from '../lib/queue.js';
import { skipQueueItem, approveItems, listLedger, markFilled, cancelWorking } from '../lib/executions.js';

const router = Router();
router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    res.json(await buildQueue(req.uid));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/skip', async (req, res) => {
  markUserActivity();
  const { id, mode } = req.body || {};
  if (!id) return res.status(400).json({ error: 'id required' });
  res.json(await skipQueueItem(req.uid, id, mode));
});

router.post('/approve', async (req, res) => {
  markUserActivity();
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: 'items required' });
  res.json({ created: await approveItems(req.uid, items) });
});

router.get('/ledger', async (req, res) => {
  try {
    res.json(await listLedger(req.uid));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/ledger/:id/fill', async (req, res) => {
  markUserActivity();
  const { price, shares } = req.body || {};
  res.json(await markFilled(req.uid, req.params.id, { price, shares }));
});

router.post('/ledger/:id/cancel', async (req, res) => {
  markUserActivity();
  res.json(await cancelWorking(req.uid, req.params.id));
});

export default router;
