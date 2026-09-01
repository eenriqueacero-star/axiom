// Groq call accounting.
//
// The free-tier keys are a shared, finite resource. Scheduled work (the scout,
// alerts, the scorecard) and anything the user is waiting on always win; the
// autonomous desk conversations only spend what's left over.

const DAY = 864e5;

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

// Per-key/day free-tier request allowance, times the number of keys we hold.
const PER_KEY_DAILY = num(process.env.GROQ_DAILY_CALLS_PER_KEY, 900);
const AUTONOMOUS_SHARE = Math.min(0.9, num(process.env.DESK_BUDGET_SHARE, 0.15));
const MAX_DIALOGUES_DAY = num(process.env.DESK_MAX_DIALOGUES_PER_DAY, 8);

// Interactive work (a chat reply, a council run the user triggered) counts as
// "activity" — the desk stays quiet while the user is around.
const IDLE_MS = num(process.env.DESK_IDLE_MINUTES, 4) * 60_000;

let dayStamp = 0;
let calls = 0;          // every Groq request this process has made today
let autonomousCalls = 0; // the subset spent by the desk loop
let dialoguesToday = 0;
let lastUserActivity = 0;

function roll() {
  const today = Math.floor(Date.now() / DAY);
  if (today !== dayStamp) {
    dayStamp = today;
    calls = 0;
    autonomousCalls = 0;
    dialoguesToday = 0;
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
}

export function budgetStatus() {
  roll();
  const total = dailyBudget();
  return {
    callsToday: calls,
    dailyBudget: total,
    autonomousCalls,
    autonomousPool: Math.floor(total * AUTONOMOUS_SHARE),
    dialoguesToday,
    maxDialoguesPerDay: MAX_DIALOGUES_DAY,
    idle: isIdle(),
    lastUserActivity: lastUserActivity || null,
  };
}
