import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { listNotifications, markRead, getNotifyPrefs, setNotifyPrefs } from '../lib/notify.js';

const router = Router();
router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const items = await listNotifications(req.uid, Number(req.query.limit) || 50);
    res.json({ notifications: items, unread: items.filter((n) => !n.read).length });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/read', async (req, res) => {
  try {
    const n = await markRead(req.uid, req.body?.ids ?? null);  // ids array, single id, or null = all
    res.json({ ok: true, marked: n });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/prefs', async (req, res) => {
  try {
    res.json(await getNotifyPrefs(req.uid));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.put('/prefs', async (req, res) => {
  try {
    res.json(await setNotifyPrefs(req.uid, req.body || {}));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
