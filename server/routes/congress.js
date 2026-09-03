import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { congressTrades, congressConfigured, congressProvider } from '../lib/congress/index.js';
import { getPortfolio } from '../lib/portfolio.js';

const router = Router();
router.use(verifyToken);

function heldTickers(portfolio) {
  const s = new Set();
  for (const a of portfolio?.accounts || []) {
    for (const p of a.positions || []) if ((p.shares || 0) > 0) s.add(p.ticker);
  }
  return s;
}

// The filter system. Everything optional.
//   ?ticker=NVDA  ?member=pelosi  ?chamber=House  ?type=buy
//   ?minAmount=50000  ?days=90  ?heldOnly=1
router.get('/', async (req, res) => {
  if (!congressConfigured()) {
    return res.json({ configured: false, provider: null, trades: [], held: [] });
  }
  try {
    const q = req.query;
    const days = Math.min(365, Math.max(7, Number(q.days) || 90));
    let trades = await congressTrades({ ticker: q.ticker?.toUpperCase() || null, days });

    const portfolio = await getPortfolio(req.uid).catch(() => null);
    const held = heldTickers(portfolio);

    if (q.member) {
      const m = String(q.member).toLowerCase();
      trades = trades.filter((t) => t.member.toLowerCase().includes(m));
    }
    if (q.chamber) trades = trades.filter((t) => t.chamber.toLowerCase() === String(q.chamber).toLowerCase());
    if (q.type) trades = trades.filter((t) => t.type === String(q.type).toLowerCase());
    if (q.minAmount) {
      const min = Number(q.minAmount);
      trades = trades.filter((t) => (t.amountHigh ?? t.amountLow ?? 0) >= min);
    }
    if (q.heldOnly === '1' || q.heldOnly === 'true') {
      trades = trades.filter((t) => held.has(t.ticker));
    }

    res.json({
      configured: true,
      provider: congressProvider(),
      held: [...held],
      trades: trades.slice(0, 200).map((t) => ({ ...t, isHeld: held.has(t.ticker) })),
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/status', (_req, res) => {
  res.json({ configured: congressConfigured(), provider: congressProvider() });
});

export default router;
