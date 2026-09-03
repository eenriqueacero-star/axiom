/**
 * Interval-based catch-up scheduler.
 *
 * Render's free tier sleeps the process after ~15 min idle, which kills any
 * wall-clock cron. This runs jobs by "is it overdue?" instead — the last-run
 * time of each job lives in Firestore, and runDueJobs() fires anything past due.
 *
 * It's driven from three places so a job never sits missed for long:
 *   - a 60s in-process interval (while the service is awake),
 *   - the /health and /tick endpoints (so an external uptime pinger drives it
 *     even while the service would otherwise be asleep),
 *   - once on boot.
 */
import { db } from '../lib/firebase.js';
import { runDailyScout } from './scoutJob.js';
import { runPortfolioAlerts, runMoveReview } from './alertJob.js';
import { scanAllHoldingsNews } from '../lib/holdingsNews.js';
import { scanCongressForHoldings } from '../lib/congress/scan.js';
import { scoreAllUsers } from '../lib/scorecard.js';
import { calibrateAllUsers } from '../lib/calibration.js';
import { deskTick } from './deskLoop.js';
import { runDeskNightAll } from './deskNight.js';
import { runWeekendReflection } from './weekendReflection.js';

const MIN = 60_000;
const HOUR = 60 * MIN;

// ET wall-clock helpers (no external tz lib — use Intl).
function etParts() {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false,
  }).formatToParts(new Date());
  const wd = s.find((p) => p.type === 'weekday')?.value;
  const hour = Number(s.find((p) => p.type === 'hour')?.value);
  return { weekday: wd, hour, isWeekday: !['Sat', 'Sun'].includes(wd), isWeekend: ['Sat', 'Sun'].includes(wd) };
}

const JOBS = [
  {
    name: 'scan',                 // holdings news + 8-K filings + insider clusters → event desk
    every: 40 * MIN,              // all week, all hours — events don't keep office hours
    run: () => scanAllHoldingsNews(),
  },
  {
    name: 'movers',               // portfolio alerts + ±8% re-review
    every: 30 * MIN,
    when: () => { const e = etParts(); return e.isWeekday && e.hour >= 9 && e.hour <= 17; },
    run: async () => { await runPortfolioAlerts(); await runMoveReview(); },
  },
  {
    name: 'scout',                // daily discovery sweep on names you don't own
    every: 12 * HOUR,
    when: () => etParts().isWeekday,
    run: () => runDailyScout(),
  },
  {
    name: 'congress',             // congressional trades in held names
    every: 8 * HOUR,
    run: () => scanCongressForHoldings(),
  },
  {
    name: 'scorecard',            // score aged verdicts + recompute agent calibration
    every: 12 * HOUR,
    run: async () => { await scoreAllUsers(); await calibrateAllUsers(); },
  },
  {
    name: 'desk-tick',            // the desk chats among itself (budget-gated, acts rarely)
    every: 25 * MIN,
    run: () => deskTick(),
  },
  {
    name: 'desk-night',           // boss assigns overnight research + one analyst reflects
    every: 18 * HOUR,
    run: () => runDeskNightAll(),
  },
  {
    name: 'all-hands-reflect',    // all six analysts review + rewrite playbooks with the boss
    every: 6 * 24 * HOUR,         // ~weekly, whenever overdue (no weekend gate — the box may
                                  // never be awake-and-weekend on the free tier)
    run: () => runWeekendReflection(),
  },
];

const stateRef = () => db.doc('state/schedule');
let running = false;

export async function runDueJobs(trigger = 'interval') {
  if (running) return { skipped: 'already running' };
  running = true;
  try {
    const snap = await stateRef().get().catch(() => null);
    const last = snap?.data()?.lastRun || {};
    const now = Date.now();
    const ran = [];

    for (const job of JOBS) {
      if (now - (last[job.name] || 0) < job.every) continue;
      if (job.when && !job.when()) continue;
      last[job.name] = Date.now();
      await stateRef().set({ lastRun: last, updatedAt: Date.now(), trigger }, { merge: true }).catch(() => {});
      ran.push(job.name);
      // Awaited in series — the `running` guard only means something if we
      // don't return before the jobs finish. A slow job just delays the rest.
      try {
        const r = await job.run();
        console.log(`[heartbeat] ${job.name} ok${r ? ` ${JSON.stringify(r).slice(0, 120)}` : ''}`);
      } catch (e) {
        console.error(`[heartbeat] ${job.name} failed:`, e.message);
      }
    }
    return { ran, trigger };
  } finally {
    running = false;
  }
}

export function startHeartbeat() {
  setInterval(() => runDueJobs('interval').catch(() => {}), 60_000);
  setTimeout(() => runDueJobs('boot').catch(() => {}), 8_000);
  console.log('[heartbeat] catch-up scheduler armed — jobs run when overdue, driven by interval + /health + /tick');
}
