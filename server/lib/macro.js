/**
 * Macro / econ calendar — the recurring high-impact US events the council should
 * be grounded in (AXIOM asked for this: "Economic calendar (CPI, Fed rate
 * decisions) ... the macro-grounding rule forces us to cite only events that
 * actually appear in the live data").
 *
 * Finnhub's /calendar/economic is premium-only on the free tier, and the other
 * feeds are paid too. But these dates are published a year ahead and barely
 * move, so we keep a curated schedule and (if a key ever appears) merge a live
 * feed on top. Dates are the RELEASE / DECISION day, US Eastern.
 */
import { safeJson } from './fetchJson.js';
import { db } from './firebase.js';
import { notify } from './notify.js';

// FOMC decision days (2nd day of each 2-day meeting), CPI + PCE + jobs releases.
// Source: Federal Reserve 2026 calendar + BLS/BEA release schedules. Approximate
// to the day; refresh yearly.
const SCHEDULE_2026 = [
  { date: '2026-01-28', event: 'FOMC rate decision', kind: 'fed' },
  { date: '2026-03-18', event: 'FOMC rate decision + projections', kind: 'fed' },
  { date: '2026-04-29', event: 'FOMC rate decision', kind: 'fed' },
  { date: '2026-06-17', event: 'FOMC rate decision + projections', kind: 'fed' },
  { date: '2026-07-29', event: 'FOMC rate decision', kind: 'fed' },
  { date: '2026-09-16', event: 'FOMC rate decision + projections', kind: 'fed' },
  { date: '2026-10-28', event: 'FOMC rate decision', kind: 'fed' },
  { date: '2026-12-16', event: 'FOMC rate decision + projections', kind: 'fed' },
  { date: '2026-09-11', event: 'CPI (Aug)', kind: 'inflation' },
  { date: '2026-10-13', event: 'CPI (Sep)', kind: 'inflation' },
  { date: '2026-11-13', event: 'CPI (Oct)', kind: 'inflation' },
  { date: '2026-12-10', event: 'CPI (Nov)', kind: 'inflation' },
  { date: '2026-09-26', event: 'PCE price index (Aug)', kind: 'inflation' },
  { date: '2026-10-31', event: 'PCE price index (Sep)', kind: 'inflation' },
  { date: '2026-11-25', event: 'PCE price index (Oct)', kind: 'inflation' },
  { date: '2026-09-05', event: 'Jobs report (Aug NFP)', kind: 'jobs' },
  { date: '2026-10-02', event: 'Jobs report (Sep NFP)', kind: 'jobs' },
  { date: '2026-11-06', event: 'Jobs report (Oct NFP)', kind: 'jobs' },
  { date: '2026-12-04', event: 'Jobs report (Nov NFP)', kind: 'jobs' },
  { date: '2026-09-25', event: 'Q2 GDP (third estimate)', kind: 'growth' },
  { date: '2026-10-29', event: 'Q3 GDP (advance)', kind: 'growth' },
];

let liveCache = { ts: 0, events: [] };
const LIVE_TTL = 6 * 3600_000;

async function liveEvents() {
  const key = process.env.FINNHUB_KEY;
  if (!key) return [];
  if (Date.now() - liveCache.ts < LIVE_TTL) return liveCache.events;
  const from = new Date().toISOString().slice(0, 10);
  const to = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  try {
    const r = await fetch(`https://finnhub.io/api/v1/calendar/economic?from=${from}&to=${to}&token=${key}`);
    const j = await safeJson(r);
    const rows = j?.economicCalendar || [];
    const events = rows
      .filter((e) => (e.country === 'US' || e.country === 'United States') && (e.impact === 'high' || e.impact === 3))
      .map((e) => ({ date: String(e.time || '').slice(0, 10), event: e.event, kind: 'macro', actual: e.actual, estimate: e.estimate, prev: e.prev }))
      .filter((e) => e.date && e.event);
    liveCache = { ts: Date.now(), events };
    return events;
  } catch {
    liveCache = { ts: Date.now(), events: [] };
    return [];
  }
}

/** Upcoming events within `days`, merged + de-duped, soonest first. */
export async function upcomingMacro({ days = 21 } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
  const live = await liveEvents();
  const seen = new Set();
  const out = [];
  for (const e of [...SCHEDULE_2026, ...live]) {
    if (e.date < today || e.date > horizon) continue;
    const k = `${e.date}:${e.event}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const daysOut = Math.round((new Date(e.date) - new Date(today)) / 864e5);
    out.push({ ...e, daysOut });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Heads-up notification the day before / morning of a major event. Fed decisions
 * are 'review'; CPI/PCE/jobs are 'fyi' (they land in the digest). Deduped per
 * event so a job that runs twice a day only pings once.
 */
export async function runMacroWatch() {
  if (!db) return 0;
  const soon = (await upcomingMacro({ days: 1 })).filter((e) => e.daysOut <= 1);
  if (!soon.length) return 0;

  let users = [];
  try { users = (await db.collection('users').get()).docs.map((d) => d.id); } catch { return 0; }

  let sent = 0;
  for (const uid of users) {
    for (const e of soon) {
      const when = e.daysOut <= 0 ? 'today' : 'tomorrow';
      const r = await notify(uid, {
        kind: 'macro',
        severity: e.kind === 'fed' ? 'review' : 'fyi',
        title: `${e.event} — ${when}`,
        body: e.kind === 'fed'
          ? `Rate decision ${when} (${e.date}). Expect a volatility window across the book.`
          : `${e.event} lands ${when} (${e.date}).`,
        dedupeKey: `macro:${e.date}:${e.event}`,
      });
      if (r.pushed) sent += r.pushed;
    }
  }
  return sent;
}

/** One-line-per-event text block for the council LIVE DATA / firmContext. */
export async function macroBlock({ days = 21 } = {}) {
  const ev = await upcomingMacro({ days });
  if (!ev.length) return '';
  const lines = ev.slice(0, 6).map((e) =>
    `- ${e.date} (in ${e.daysOut}d): ${e.event}${e.estimate != null ? ` — est ${e.estimate}, prev ${e.prev}` : ''}`);
  return `MACRO CALENDAR (next ${days}d — cite these, don't invent dates):\n${lines.join('\n')}`;
}
