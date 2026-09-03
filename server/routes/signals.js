import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { db } from '../lib/firebase.js';
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

// Material headlines the news scanner has flagged on the user's holdings (48h),
// grouped by ticker. Drives the news dot on the Portfolio view.
router.get('/holdings', async (req, res) => {
  try {
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    const snap = await db.collection(`users/${req.uid}/signals`).get();
    const byTicker = {};
    for (const d of snap.docs) {
      const s = d.data();
      if (!s.ticker || (s.ts || 0) < cutoff) continue;
      (byTicker[s.ticker] ||= []).push({
        headline: s.headline, url: s.url || '', source: s.source || '',
        ts: s.ts, thesis: !!s.thesis, kind: s.kind || 'news',
      });
    }
    for (const t of Object.keys(byTicker)) byTicker[t].sort((a, b) => b.ts - a.ts);
    res.json({ signals: byTicker });
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
