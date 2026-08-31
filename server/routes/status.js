import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { checkGroqKeys } from '../lib/groq.js';

const router = Router();
router.use(verifyToken);

// Per-key Groq health. ?force=1 skips the 60s cache.
router.get('/groq-keys', async (req, res) => {
  try {
    const data = await checkGroqKeys({ force: req.query.force === '1' });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
