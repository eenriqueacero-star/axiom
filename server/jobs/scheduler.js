import cron from 'node-cron';
import { runDailyScout } from './scoutJob.js';
import { runPortfolioAlerts, runMoveReview } from './alertJob.js';
import { scoreAllUsers } from '../lib/scorecard.js';
import { calibrateAllUsers } from '../lib/calibration.js';
import { deskTick } from './deskLoop.js';

export function initScheduler() {
  // Daily scout scan — 9:05 AM ET (market open + 5 min)
  cron.schedule('5 9 * * 1-5', () => {
    console.log('[scheduler] Running daily scout scan...');
    runDailyScout().catch(err => console.error('[scout] Error:', err.message));
  }, { timezone: 'America/New_York' });

  // Portfolio alerts + big-mover re-review — every 30 min during market hours
  cron.schedule('*/30 9-16 * * 1-5', () => {
    console.log('[scheduler] Checking portfolio alerts + big movers...');
    runPortfolioAlerts().catch(err => console.error('[alerts] Error:', err.message));
    runMoveReview().catch(err => console.error('[move-review] Error:', err.message));
  }, { timezone: 'America/New_York' });

  // Verdict scorecard + agent calibration — 4:30 PM ET
  cron.schedule('30 16 * * 1-5', () => {
    console.log('[scheduler] Scoring verdicts + recomputing agent calibration...');
    scoreAllUsers()
      .then(n => console.log(`[scorecard] scored ${n} analyses`))
      .then(() => calibrateAllUsers())
      .then(n => console.log(`[calibration] recomputed for ${n} users`))
      .catch(err => console.error('[scorecard/calibration] Error:', err.message));
  }, { timezone: 'America/New_York' });

  // The desk — agents talk among themselves when the user is away and there's
  // spare budget. Ticks often, acts rarely (budget.js does the gating).
  cron.schedule('*/20 * * * *', () => {
    deskTick()
      .then(r => { if (r?.ok) console.log('[desk] conversation recorded'); })
      .catch(err => console.error('[desk] Error:', err.message));
  }, { timezone: 'America/New_York' });

  console.log('[scheduler] Jobs registered: scout (9:05 ET), alerts + move-review (30min mkt hrs), scorecard (16:30 ET), desk (20min, budget-gated)');
}
