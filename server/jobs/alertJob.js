import { db } from '../lib/firebase.js';
import { notify, notifyBatch } from '../lib/notify.js';
import { getPortfolio } from '../lib/portfolio.js';
import { runCouncil } from '../lib/council.js';
import { saveAnalysis } from '../lib/analyses.js';

const BIG_MOVE_PCT = 8;              // a day move this large re-opens the case
const REVIEW_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/**
 * Event-driven re-review. Runs on the market-hours cron: any holding that's moved
 * ≥8% on the day gets a fresh council run (which now pulls "why it's moving" news),
 * and the user gets pushed the new verdict. No waiting for tomorrow's 9:05 scout.
 */
export async function runMoveReview() {
  let users = [];
  try { users = (await db.collection('users').get()).docs.map(d => d.id); } catch { return 0; }

  let reviewed = 0;
  for (const uid of users) {
    let portfolio;
    try { portfolio = await getPortfolio(uid); } catch { continue; }

    const movers = new Map();
    for (const acct of portfolio.accounts || []) {
      for (const p of acct.positions || []) {
        if ((p.shares || 0) > 0 && p.changePct != null && Math.abs(p.changePct) >= BIG_MOVE_PCT) {
          movers.set(p.ticker, p.changePct);
        }
      }
    }
    if (!movers.size) continue;

    const col = db.collection(`users/${uid}/analyses`);
    const pending = [];
    for (const [ticker, changePct] of movers) {
      try {
        const snap = await col.where('ticker', '==', ticker).get();
        const latest = snap.docs.map(d => d.data()).sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
        if (latest && Date.now() - (latest.ts || 0) < REVIEW_COOLDOWN_MS) continue;

        const result = await runCouncil(ticker, { mode: 'scout', uid });
        const added = await saveAnalysis(uid, { ...result, trigger: 'move' });
        reviewed++;
        pending.push({
          kind: 'move',
          severity: Math.abs(changePct) >= 12 ? 'critical' : 'review',
          ticker,
          title: `${ticker} ${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}% — council re-reviewed`,
          body: `${result.verdict} ${result.conviction}/10${result.headline ? ` · ${result.headline}` : ''}`,
          refKind: 'analysis', refId: added?.id || null,
        });
      } catch (err) {
        console.error(`[move-review] ${ticker}:`, err.message);
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    // A broad selloff can move many names at once — coalesce the routine ones.
    const critical = pending.filter((p) => p.severity === 'critical');
    const routine = pending.filter((p) => p.severity !== 'critical');
    for (const p of critical) await notify(uid, p);
    if (routine.length) {
      await notifyBatch(uid, routine, {
        title: `${routine.length} holdings moved — re-reviewed`,
        body: routine.map((p) => `${p.ticker} ${p.title.match(/[+-][\d.]+%/)?.[0] || ''}`).join(', '),
        path: '/?tab=notifications',
      });
    }
  }
  if (reviewed) console.log(`[move-review] re-reviewed ${reviewed} big movers`);
  return reviewed;
}

