/**
 * The Queue — "what the desk wants you to do, right now." One ranked list:
 * every non-HOLD council verdict on a held name, the DCA pick, and boss
 * opportunities (discovery ADDs you don't own yet). Each item nets to a cash
 * effect so the Basket can show one number for the whole batch.
 *
 * Pure read of stances/dca/discovery — no LLM calls, cheap enough to load
 * with the Book.
 */
import { buildStances } from './stances.js';
import { dcaSuggestion } from './dca.js';
import { topDiscoveries } from './discovery.js';
import { listSkips } from './executions.js';

const STALE_MS = 3 * 24 * 60 * 60 * 1000;
const DEFAULT_TRIM_FRACTION = 0.25; // how much of a TRIM position we suggest freeing, absent a sharper rule
const DEFAULT_OPPORTUNITY_SIZE = 150; // starter size for a boss-opportunity ADD with no contribution context

function relSource(s) {
  const parts = [];
  if (s.tier || s.conviction != null) parts.push(`council ${s.conviction ?? '—'}/10`);
  if (s.ts) {
    const h = Math.round((Date.now() - s.ts) / 3600000);
    parts.push(h < 1 ? 'ran <1h ago' : `ran ${h}h ago`);
  }
  return parts.join(' · ');
}

const TAG = {
  EXIT: (s) => s.broken ? 'THESIS BROKEN' : s.downtrend ? 'DOWNTREND' : 'EXIT',
  TRIM: (s) => s.tierReasons?.[0]?.toUpperCase() || 'TRIM',
};

export async function buildQueue(uid) {
  const [stances, dca, discoveries, skips] = await Promise.all([
    buildStances(uid).catch(() => ({ stances: {} })),
    dcaSuggestion(uid).catch(() => null),
    topDiscoveries(uid).catch(() => []),
    listSkips(uid).catch(() => ({})),
  ]);

  const now = Date.now();
  const isSkipped = (id) => {
    const until = skips[id];
    return typeof until === 'number' && until > now;
  };

  const items = [];

  for (const [ticker, s] of Object.entries(stances.stances || {})) {
    if (s.verdict !== 'EXIT' && s.verdict !== 'TRIM') continue;
    const value = s.econ?.value || 0;
    const cash = s.verdict === 'EXIT' ? value : Math.round(value * DEFAULT_TRIM_FRACTION);
    const id = `${s.verdict}-${ticker}`;
    if (isSkipped(id)) continue;
    items.push({
      id, action: s.verdict, ticker,
      tag: TAG[s.verdict](s),
      note: s.summary || s.headline || '',
      cash, editable: s.verdict === 'TRIM',
      conviction: s.conviction, tier: s.tier,
      source: relSource(s), ts: s.ts, stale: s.stale,
    });
  }

  if (dca?.pick?.ticker) {
    const id = `ADD-${dca.pick.ticker}`;
    if (!isSkipped(id)) {
      items.push({
        id, action: 'ADD', ticker: dca.pick.ticker,
        tag: 'DCA PICK',
        note: dca.pick.reason || '',
        cash: -(dca.contribution?.amount || dca.weeklyTotal || DEFAULT_OPPORTUNITY_SIZE),
        editable: true,
        conviction: null, tier: dca.pick.tier,
        source: `contribution · ${dca.contribution?.kind || 'weekly'}`, ts: now, stale: false,
      });
    }
  }

  for (const d of discoveries) {
    if (d.verdict !== 'ADD') continue;
    const id = `opp-${d.ticker}`;
    if (isSkipped(id)) continue;
    if (items.some((i) => i.ticker === d.ticker)) continue; // already queued (e.g. the DCA pick)
    items.push({
      id, action: 'ADD', ticker: d.ticker,
      tag: 'BOSS OPPORTUNITY',
      note: d.headline || '',
      cash: -DEFAULT_OPPORTUNITY_SIZE, editable: true,
      conviction: d.conviction, tier: d.tier,
      source: relSource(d), ts: d.ts, stale: now - (d.ts || 0) > STALE_MS,
    });
  }

  // EXIT/TRIM first (capital to free is the more urgent call), then by conviction.
  const RANK = { EXIT: 3, TRIM: 2, ADD: 1 };
  items.sort((a, b) => (RANK[b.action] - RANK[a.action]) || ((b.conviction || 0) - (a.conviction || 0)));

  return { ready: true, generatedAt: now, items };
}
