import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';

const router = Router();
router.use(verifyToken);

const cache = new Map();
const CACHE_TTL = 120000;

router.post('/', async (req, res) => {
  const { ticker } = req.body;
  if (!ticker) return res.status(400).json({ error: 'ticker required' });
  const t = ticker.toUpperCase();

  const cached = cache.get(t);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return res.json(cached.data);

  const from = new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10);
  const to   = new Date().toISOString().slice(0, 10);

  try {
    const [newsRes, earningsRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/company-news?symbol=${t}&from=${from}&to=${to}&token=${process.env.FINNHUB_KEY}`),
      fetch(`https://finnhub.io/api/v1/stock/earnings-calendar?from=${to}&to=${new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10)}&symbol=${t}&token=${process.env.FINNHUB_KEY}`),
    ]);

    const rawNews = newsRes.ok ? await newsRes.json() : [];
    const articles = rawNews.slice(0, 10).map(a => ({
      date: new Date(a.datetime * 1000).toISOString().slice(0, 10),
      headline: a.headline,
      source: a.source,
      url: a.url,
    }));

    let nextEarnings = null, earningsEstimated = false;
    if (earningsRes.ok) {
      const ed = await earningsRes.json();
      const next = ed.earningsCalendar?.[0];
      if (next?.date) { nextEarnings = next.date; earningsEstimated = !next.epsActual && !next.revenueActual; }
    }

    const data = { articles, nextEarnings, earningsEstimated };
    cache.set(t, { data, ts: Date.now() });
    res.json(data);
  } catch (err) {
    res.json({ articles: [], nextEarnings: null, earningsEstimated: false });
  }
});

export default router;
