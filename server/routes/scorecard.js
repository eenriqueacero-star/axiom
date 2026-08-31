import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { aggregate, scoreUser } from '../lib/scorecard.js';

const router = Router();
router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    // opportunistic scoring so the view isn't stale between cron runs
    await scoreUser(req.uid).catch(() => {});
    res.json(await aggregate(req.uid));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
