import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';

const router = Router();
router.use(verifyToken);

const cache = new Map();
const CACHE_TTL = 45000;

async function fetchQuote(ticker) {
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(ticker)}&token=${process.env.FINNHUB_KEY}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1000));
    const r = await fetch(url);
    if (r.status === 429) return { error: 'rate_limited', rateLimited: true };
    if (!r.ok) continue;
    const d = await r.json();
    if ((d.c ?? 0) > 0 || (d.pc ?? 0) > 0) {
      return { price: d.c, changePct: d.dp, high: d.h, low: d.l, open: d.o, prevClose: d.pc };
    }
  }
  return { error: 'no_price' };
}

router.post('/', async (req, res) => {
  const { tickers, withEarnings = false } = req.body;
  if (!Array.isArray(tickers) || !tickers.length) return res.status(400).json({ error: 'tickers required' });

  const key = tickers.slice().sort().join(',') + (withEarnings ? '+e' : '');
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return res.json(cached.data);

  const results = {};
  await Promise.all(tickers.map(async ticker => {
    results[ticker] = await fetchQuote(ticker);
    if (withEarnings && !results[ticker]?.rateLimited) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const in90d = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
        const er = await fetch(`https://finnhub.io/api/v1/stock/earnings-calendar?from=${today}&to=${in90d}&symbol=${encodeURIComponent(ticker)}&token=${process.env.FINNHUB_KEY}`);
        if (er.ok) {
          const ed = await er.json();
          const next = ed.earningsCalendar?.[0];
          if (next?.date) results[ticker].nextEarnings = next.date;
        }
      } catch {}
    }
  }));

  cache.set(key, { data: results, ts: Date.now() });
  res.json(results);
});

export default router;
