import cron from 'node-cron';
import { runDailyScout } from './scoutJob.js';
import { runPortfolioAlerts, runMoveReview } from './alertJob.js';
import { scanAllHoldingsNews } from '../lib/holdingsNews.js';
import { scanCongressForHoldings } from '../lib/congress/scan.js';
import { scoreAllUsers } from '../lib/scorecard.js';
import { calibrateAllUsers } from '../lib/calibration.js';
import { deskTick } from './deskLoop.js';
import { runDeskNightAll } from './deskNight.js';
import { runWeekendReflection } from './weekendReflection.js';

export function initScheduler() {
  // Daily scout scan + congressional trades — 9:05 AM ET
  cron.schedule('5 9 * * 1-5', () => {
    console.log('[scheduler] Running daily scout scan...');
    runDailyScout().catch(err => console.error('[scout] Error:', err.message));
    scanCongressForHoldings().catch(err => console.error('[congress] Error:', err.message));
  }, { timezone: 'America/New_York' });

  // Portfolio alerts + big-mover re-review + holdings news — every 30 min, market hours
  cron.schedule('*/30 9-16 * * 1-5', () => {
    console.log('[scheduler] alerts / big movers / holdings news...');
    runPortfolioAlerts().catch(err => console.error('[alerts] Error:', err.message));
    runMoveReview().catch(err => console.error('[move-review] Error:', err.message));
    scanAllHoldingsNews().catch(err => console.error('[holdings-news] Error:', err.message));
  }, { timezone: 'America/New_York' });

  // After-close sweep — earnings and other 8-Ks land 4:05–5:30 PM ET, after the
  // last market-hours scan. One extra pass catches them the same day.
  cron.schedule('20 17 * * 1-5', () => {
    console.log('[scheduler] after-close holdings news + filings sweep...');
    scanAllHoldingsNews().catch(err => console.error('[holdings-news] Error:', err.message));
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

  // The Desk nightly run — 2:10 AM ET. Boss assigns overnight research, analysts
  // work it, boss files a brief, one analyst rewrites its own playbook.
  cron.schedule('10 2 * * *', () => {
    console.log('[scheduler] Desk nightly run...');
    runDeskNightAll()
      .then(r => console.log(`[desk-night] ${JSON.stringify(r)}`))
      .catch(err => console.error('[desk-night] Error:', err.message));
  }, { timezone: 'America/New_York' });

  // Weekend all-hands — every analyst reviews their work and rewrites their
  // playbook. Saturday 10:00 AM ET, budget-gated.
  cron.schedule('0 10 * * 6', () => {
    console.log('[scheduler] Weekend all-hands reflection...');
    runWeekendReflection()
      .then(r => console.log(`[weekend-reflect] ${JSON.stringify(r)}`))
      .catch(err => console.error('[weekend-reflect] Error:', err.message));
  }, { timezone: 'America/New_York' });

  console.log('[scheduler] Jobs registered: scout (9:05 ET), alerts + move-review (30min mkt hrs), scorecard (16:30 ET), desk (20min, budget-gated), weekend all-hands (Sat 10:00 ET)');
}
