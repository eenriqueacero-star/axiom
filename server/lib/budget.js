// Groq call accounting.
//
// The free-tier keys are a shared, finite resource. Scheduled work (the scout,
// alerts, the scorecard) and anything the user is waiting on always win; the
// autonomous desk conversations only spend what's left over.
//
// The day's counters are persisted to Firestore (state/budget) and re-hydrated
// on boot — Render's free tier discards process memory every ~15 min, so an
// in-memory-only counter would reset all day and the caps would never bite.

import { db } from './firebase.js';

const DAY = 864e5;
const dayKey = () => new Date().toISOString().slice(0, 10);

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

// Per-key/day free-tier request allowance, times the number of keys we hold.
const PER_KEY_DAILY = num(process.env.GROQ_DAILY_CALLS_PER_KEY, 900);
const AUTONOMOUS_SHARE = Math.min(0.9, num(process.env.DESK_BUDGET_SHARE, 0.15));
const MAX_DIALOGUES_DAY = num(process.env.DESK_MAX_DIALOGUES_PER_DAY, 8);

// The event desk reacts to real-world events at any hour, so it is NOT idle-
// gated — but it gets its own slice of the day's budget and a hard event cap.
const EVENT_SHARE = Math.min(0.5, num(process.env.EVENT_BUDGET_SHARE, 0.2));
const MAX_EVENTS_DAY = num(process.env.EVENT_MAX_PER_DAY, 12);

// Interactive work (a chat reply, a council run the user triggered) counts as
// "activity" — the desk stays quiet while the user is around.
const IDLE_MS = num(process.env.DESK_IDLE_MINUTES, 4) * 60_000;

let dayStamp = '';
let calls = 0;          // every Groq request this process has made today
let autonomousCalls = 0; // the subset spent by the desk loop
let dialoguesToday = 0;
let eventsToday = 0;     // event-desk triage runs today
let lastUserActivity = 0;

// --- Firestore persistence (survives Render's 15-min process recycling) ------
const budgetDoc = () => db.doc('state/budget');
let hydrated = false;
let flushTimer = null;

async function hydrate() {
  const key = dayKey();
  try {
    const snap = await budgetDoc().get();
    const d = snap.exists ? snap.data() : null;
    if (d && d.day === key) {
      calls = Math.max(calls, d.calls || 0);
      autonomousCalls = Math.max(autonomousCalls, d.autonomousCalls || 0);
      dialoguesToday = Math.max(dialoguesToday, d.dialoguesToday || 0);
      eventsToday = Math.max(eventsToday, d.eventsToday || 0);
    }
  } catch { /* Firestore not ready — fall back to in-memory */ }
  dayStamp = key;
  hydrated = true;
}
hydrate();

function scheduleFlush(immediate = false) {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    budgetDoc().set({
      day: dayStamp, calls, autonomousCalls, dialoguesToday, eventsToday, updatedAt: Date.now(),
    }, { merge: true }).catch(() => {});
  }, immediate ? 0 : 10_000);
}

function roll() {
  const key = dayKey();
  if (key !== dayStamp) {
    dayStamp = key;
    calls = 0;
    autonomousCalls = 0;
    dialoguesToday = 0;
    eventsToday = 0;
    hydrated = false;
    hydrate();
  }
}

export function keyCount(n) { keyCount.n = n || keyCount.n || 1; return keyCount.n; }

export function dailyBudget() {
  return PER_KEY_DAILY * (keyCount.n || 1);
}

/** Every Groq request routes through here. */
export function recordCall({ autonomous = false } = {}) {
  roll();
  calls += 1;
  if (autonomous) autonomousCalls += 1;
  scheduleFlush();
}

/** The user did something we spent tokens on — hold the desk back for a bit. */
export function markUserActivity() {
  lastUserActivity = Date.now();
}

export function isIdle() {
  return Date.now() - lastUserActivity > IDLE_MS;
}

/**
 * May the desk loop spend `n` calls right now?
 * Autonomous work gets a slice of the day's budget and a hard dialogue cap, and
 * never runs while the user is active.
 */
export function canSpendAutonomous(n = 5) {
  roll();
  if (!isIdle()) return { ok: false, why: 'user is active' };
  if (dialoguesToday >= MAX_DIALOGUES_DAY) {
    return { ok: false, why: `daily cap reached (${MAX_DIALOGUES_DAY} conversations)` };
  }
  const pool = Math.floor(dailyBudget() * AUTONOMOUS_SHARE);
  if (autonomousCalls + n > pool) {
    return { ok: false, why: `autonomous budget spent (${autonomousCalls}/${pool} calls)` };
  }
  if (calls + n > dailyBudget() * 0.9) {
    return { ok: false, why: 'overall daily budget nearly spent' };
  }
  return { ok: true };
}

export function noteDialogue() {
  roll();
  dialoguesToday += 1;
  scheduleFlush(true);
}

/**
 * May the event desk spend `n` calls to triage/work an event right now?
 * Not idle-gated (events don't wait), but capped by its own pool + event count
 * + the overall daily ceiling. EVENT_DESK_OFF=1 disables it entirely.
 */
export function canSpendEvent(n = 8) {
  roll();
  if (process.env.EVENT_DESK_OFF === '1') return { ok: false, why: 'event desk disabled' };
  if (eventsToday >= MAX_EVENTS_DAY) return { ok: false, why: `event cap reached (${MAX_EVENTS_DAY}/day)` };
  const pool = Math.floor(dailyBudget() * EVENT_SHARE);
  if (autonomousCalls + n > pool + Math.floor(dailyBudget() * AUTONOMOUS_SHARE)) {
    return { ok: false, why: 'event budget spent' };
  }
  if (calls + n > dailyBudget() * 0.95) return { ok: false, why: 'overall daily budget nearly spent' };
  return { ok: true };
}

export function noteEvent() {
  roll();
  eventsToday += 1;
  scheduleFlush(true);
}

export function budgetStatus() {
  roll();
  const total = dailyBudget();
  return {
    callsToday: calls,
    hydrated,
    dailyBudget: total,
    autonomousCalls,
    autonomousPool: Math.floor(total * AUTONOMOUS_SHARE),
    dialoguesToday,
    maxDialoguesPerDay: MAX_DIALOGUES_DAY,
    eventsToday,
    maxEventsPerDay: MAX_EVENTS_DAY,
    idle: isIdle(),
    lastUserActivity: lastUserActivity || null,
  };
}
