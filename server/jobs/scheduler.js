import cron from 'node-cron';
import { runDailyScout } from './scoutJob.js';
import { runPortfolioAlerts } from './alertJob.js';

export function initScheduler() {
  // Daily scout scan — 9:05 AM ET (market open + 5 min)
  cron.schedule('5 9 * * 1-5', () => {
    console.log('[scheduler] Running daily scout scan...');
    runDailyScout().catch(err => console.error('[scout] Error:', err.message));
  }, { timezone: 'America/New_York' });

  // Portfolio alerts — every 30 min during market hours
  cron.schedule('*/30 9-16 * * 1-5', () => {
    console.log('[scheduler] Checking portfolio alerts...');
    runPortfolioAlerts().catch(err => console.error('[alerts] Error:', err.message));
  }, { timezone: 'America/New_York' });

  console.log('[scheduler] Jobs registered: daily scout (9:05 AM ET), alerts (every 30min market hours)');
}
