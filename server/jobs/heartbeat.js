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
 *
 * Every run records its outcome (ok / error + message / duration) into
 * state/schedule.jobs so the app can show whether everything's running in order
 * — see jobsHealth() and GET /api/status/jobs.
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
import { runNotifyDigest } from '../lib/notify.js';
import { runBossSweepAll } from '../lib/desk/sweep.js';
import { runMacroWatch } from '../lib/macro.js';

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

const marketHours = () => { const e = etParts(); return e.isWeekday && e.hour >= 9 && e.hour <= 17; };

const JOBS = [
  {
    name: 'scan',                 // holdings news + 8-K filings + insider clusters → event desk
    label: 'News / filings / insider scan',
    every: 40 * MIN,              // all week, all hours — events don't keep office hours
    run: () => scanAllHoldingsNews(),
  },
  {
    name: 'movers',               // portfolio alerts + ±8% re-review
    label: 'Price movers + ±8% re-review',
    every: 30 * MIN,
    when: marketHours,
    window: 'market hours (weekday 9–17 ET)',
    run: async () => { await runPortfolioAlerts(); await runMoveReview(); },
  },
  {
    name: 'scout',                // daily discovery sweep on names you don't own
    label: 'Discovery sweep',
    every: 12 * HOUR,
    when: () => etParts().isWeekday,
    window: 'weekdays',
    run: () => runDailyScout(),
  },
  {
    name: 'congress',             // congressional trades in held names
    label: 'Congressional trades',
    every: 8 * HOUR,
    run: () => scanCongressForHoldings(),
  },
  {
    name: 'scorecard',            // score aged verdicts + recompute agent calibration
    label: 'Scorecard + agent calibration',
    every: 12 * HOUR,
    run: async () => { await scoreAllUsers(); await calibrateAllUsers(); },
  },
  {
    name: 'boss-sweep',           // the boss reviews every new notification for an angle (held or not)
    label: 'Boss inbox sweep',
    every: 35 * MIN,
    run: () => runBossSweepAll(),
  },
  {
    name: 'desk-tick',            // the desk chats among itself (budget-gated, acts rarely)
    label: 'Desk chatter tick',
    every: 25 * MIN,
    run: () => deskTick(),
  },
  {
    name: 'desk-night',           // boss assigns overnight research + one analyst reflects
    label: 'Overnight desk research',
    every: 18 * HOUR,
    run: () => runDeskNightAll(),
  },
  {
    name: 'macro-watch',          // heads-up the day before a Fed decision / CPI / jobs report
    label: 'Macro calendar watch',
    every: 12 * HOUR,
    when: () => { const e = etParts(); return e.hour >= 7 && e.hour <= 20; },
    window: '7am–8pm ET',
    run: () => runMacroWatch(),
  },
  {
    name: 'digest-am',            // morning roll-up of everything that landed feed-only overnight
    label: 'Morning notification digest',
    every: 20 * HOUR,
    when: () => { const e = etParts(); return e.isWeekday && e.hour >= 9 && e.hour < 12; },
    window: 'weekday morning ET',
    run: () => runNotifyDigest('morning brief'),
  },
  {
    name: 'digest-pm',            // close roll-up
    label: 'Close notification digest',
    every: 20 * HOUR,
    when: () => { const e = etParts(); return e.isWeekday && e.hour >= 16 && e.hour < 19; },
    window: 'weekday close ET',
    run: () => runNotifyDigest('close recap'),
  },
  {
    name: 'all-hands-reflect',    // all six analysts review + rewrite playbooks with the boss
    label: 'All-hands playbook review',
    every: 6 * 24 * HOUR,         // ~weekly, whenever overdue (no weekend gate — the box may
                                  // never be awake-and-weekend on the free tier)
    run: () => runWeekendReflection(),
  },
];

const JOB_META = Object.fromEntries(JOBS.map((j) => [j.name, j]));

const stateRef = () => db.doc('state/schedule');
let running = false;

/**
 * Per-job overrides live at state/schedule.overrides[name] =
 *   { enabled?:bool, everyMs?:number, hours?:[startHour,endHour], weekdaysOnly?:bool }
 * All keys optional. ET hours 0-23.
 */
function effEnabled(ov) { return (ov?.enabled ?? true) !== false; }
function effEveryMs(job, ov) { return typeof ov?.everyMs === 'number' ? ov.everyMs : job.every; }
function isOverridden(ov) { return !!ov && Object.keys(ov).length > 0; }

// Effective schedule gate. An override gate (hours and/or weekdaysOnly) REPLACES
// the coded job.when; with neither override gate set, fall back to job.when.
function gateOpen(job, ov) {
  const hasHours = Array.isArray(ov?.hours) && ov.hours.length === 2;
  const hasWeekdays = ov?.weekdaysOnly === true;
  if (hasHours || hasWeekdays) {
    const e = etParts();
    if (hasWeekdays && !e.isWeekday) return false;
    if (hasHours) {
      const [start, end] = ov.hours;
      if (!(e.hour >= start && e.hour <= end)) return false;
    }
    return true;
  }
  return job.when ? Boolean(job.when()) : true;
}

export async function runDueJobs(trigger = 'interval') {
  if (running) return { skipped: 'already running' };
  running = true;
  try {
    const snap = await stateRef().get().catch(() => null);
    const data = snap?.data() || {};
    const last = data.lastRun || {};
    const jobs = data.jobs || {};
    const overrides = data.overrides || {};
    const now = Date.now();
    const ran = [];

    for (const job of JOBS) {
      const ov = overrides[job.name] || {};
      if (!effEnabled(ov)) continue;
      if (now - (last[job.name] || 0) < effEveryMs(job, ov)) continue;
      if (!gateOpen(job, ov)) continue;

      const startedAt = Date.now();
      last[job.name] = startedAt;
      const prev = jobs[job.name] || {};
      let outcome;
      try {
        const r = await job.run();
        outcome = {
          ok: true,
          lastRunAt: startedAt,
          lastOkAt: Date.now(),
          durationMs: Date.now() - startedAt,
          result: r ? JSON.stringify(r).slice(0, 300) : null,
          error: null,
          consecutiveFailures: 0,
          runs: (prev.runs || 0) + 1,
          fails: prev.fails || 0,
          trigger,
        };
        console.log(`[heartbeat] ${job.name} ok${outcome.result ? ` ${outcome.result.slice(0, 120)}` : ''}`);
      } catch (e) {
        outcome = {
          ok: false,
          lastRunAt: startedAt,
          lastOkAt: prev.lastOkAt || null,
          durationMs: Date.now() - startedAt,
          result: prev.result || null,
          error: e.message || String(e),
          consecutiveFailures: (prev.consecutiveFailures || 0) + 1,
          runs: (prev.runs || 0) + 1,
          fails: (prev.fails || 0) + 1,
          trigger,
        };
        console.error(`[heartbeat] ${job.name} failed:`, e.message);
      }
      jobs[job.name] = outcome;
      ran.push(job.name);
      await stateRef().set(
        { lastRun: last, jobs, updatedAt: Date.now(), trigger },
        { merge: true },
      ).catch(() => {});
    }
    return { ran, trigger };
  } finally {
    running = false;
  }
}

/**
 * Run a single job right now, ignoring the every/when gates but writing the same
 * outcome record + lastRun stamp as a scheduled run.
 * Returns { name, ok, error, durationMs, result } or { error:'no such job' }.
 */
export async function runJobByName(name, trigger = 'manual') {
  const job = JOB_META[name];
  if (!job) return { error: 'no such job' };

  const snap = await stateRef().get().catch(() => null);
  const data = snap?.data() || {};
  const last = data.lastRun || {};
  const jobs = data.jobs || {};
  const prev = jobs[job.name] || {};
  const startedAt = Date.now();
  last[job.name] = startedAt;

  let outcome;
  let result = null;
  let error = null;
  let ok = true;
  try {
    const r = await job.run();
    result = r ?? null;
    outcome = {
      ok: true,
      lastRunAt: startedAt,
      lastOkAt: Date.now(),
      durationMs: Date.now() - startedAt,
      result: r ? JSON.stringify(r).slice(0, 300) : null,
      error: null,
      consecutiveFailures: 0,
      runs: (prev.runs || 0) + 1,
      fails: prev.fails || 0,
      trigger,
    };
    console.log(`[heartbeat] ${job.name} ok (${trigger})`);
  } catch (e) {
    ok = false;
    error = e.message || String(e);
    outcome = {
      ok: false,
      lastRunAt: startedAt,
      lastOkAt: prev.lastOkAt || null,
      durationMs: Date.now() - startedAt,
      result: prev.result || null,
      error,
      consecutiveFailures: (prev.consecutiveFailures || 0) + 1,
      runs: (prev.runs || 0) + 1,
      fails: (prev.fails || 0) + 1,
      trigger,
    };
    console.error(`[heartbeat] ${job.name} failed (${trigger}):`, error);
  }
  jobs[job.name] = outcome;
  await stateRef().set(
    { lastRun: last, jobs, updatedAt: Date.now(), trigger },
    { merge: true },
  ).catch(() => {});

  return { name, ok, error, durationMs: outcome.durationMs, result };
}

/**
 * Snapshot of every scheduled job for the app's system view.
 * status: ok | failing | overdue | pending  (pending = never run yet)
 */
export async function jobsHealth() {
  const snap = await stateRef().get().catch(() => null);
  const data = snap?.data() || {};
  const jobs = data.jobs || {};
  const overrides = data.overrides || {};
  const now = Date.now();

  const list = JOBS.map((job) => {
    const j = jobs[job.name] || {};
    const ov = overrides[job.name] || {};
    const enabled = effEnabled(ov);
    const everyMs = effEveryMs(job, ov);
    const overridden = isOverridden(ov);
    const gatedOut = !enabled || !gateOpen(job, ov);
    // overdue = more than 2× its interval since the last run, and it isn't
    // simply outside its scheduled window right now.
    const overdue = !gatedOut && j.lastRunAt != null && now - j.lastRunAt > everyMs * 2;
    let status = 'pending';
    if (j.lastRunAt != null) {
      if (j.ok === false) status = 'failing';
      else if (overdue) status = 'overdue';
      else status = 'ok';
    }
    return {
      name: job.name,
      label: job.label,
      everyMs,
      window: job.window || 'always',
      enabled,
      overridden,
      override: overridden ? ov : null,
      nextDueAt: j.lastRunAt != null ? j.lastRunAt + everyMs : null,
      gatedOut,
      status,
      ok: j.ok ?? null,
      lastRunAt: j.lastRunAt ?? null,
      lastOkAt: j.lastOkAt ?? null,
      durationMs: j.durationMs ?? null,
      error: j.error ?? null,
      consecutiveFailures: j.consecutiveFailures || 0,
      runs: j.runs || 0,
      fails: j.fails || 0,
      lastResult: j.result ?? null,
    };
  });

  return {
    ts: now,
    healthy: list.every((j) => j.status === 'ok' || j.status === 'pending'),
    failing: list.filter((j) => j.status === 'failing').map((j) => j.name),
    overdue: list.filter((j) => j.status === 'overdue').map((j) => j.name),
    jobs: list,
  };
}

export { JOB_META };

export function startHeartbeat() {
  setInterval(() => runDueJobs('interval').catch(() => {}), 60_000);
  setTimeout(() => runDueJobs('boot').catch(() => {}), 8_000);
  console.log('[heartbeat] catch-up scheduler armed — jobs run when overdue, driven by interval + /health + /tick');
}
