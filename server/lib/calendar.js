/**
 * Holiday / liquidity calendar — the days trading is closed, thin, or unusually
 * concentrated (options expiration). Complements macro.js (Fed/CPI/jobs): that
 * file is "what's being announced," this one is "who's not trading and why."
 *
 * Everything here is free and computed/fetched, never a paid feed:
 *  - US market holidays: fixed observance rules, computed for any year.
 *  - Options expiration: 3rd Friday of every month; Mar/Jun/Sep/Dec is
 *    quarterly "triple witching" (stock + index options + futures all expire).
 *  - Jewish holidays: hebcal.com's free public API (no key required).
 */
import { safeJson } from './fetchJson.js';

const fmt = (d) => d.toISOString().slice(0, 10);

/** The Nth weekday (0=Sun..6=Sat) of a month, e.g. 3rd Monday of January. */
function nthWeekday(year, month, weekday, n) {
  const d = new Date(Date.UTC(year, month, 1));
  let count = 0;
  while (d.getUTCMonth() === month) {
    if (d.getUTCDay() === weekday) {
      count++;
      if (count === n) return new Date(d);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return null;
}

/** Last weekday of a month, e.g. last Monday of May (Memorial Day). */
function lastWeekday(year, month, weekday) {
  const d = new Date(Date.UTC(year, month + 1, 0)); // last day of month
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/** Meeus/Jones/Butcher Gregorian Easter algorithm — Good Friday is 2 days before. */
function goodFriday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-indexed
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = new Date(Date.UTC(year, month, day));
  easter.setUTCDate(easter.getUTCDate() - 2);
  return easter;
}

/** If a fixed holiday falls on Sat/Sun, NYSE observes the nearest weekday. */
function observed(date) {
  const day = date.getUTCDay();
  if (day === 6) { const d = new Date(date); d.setUTCDate(d.getUTCDate() - 1); return d; } // Sat -> Fri
  if (day === 0) { const d = new Date(date); d.setUTCDate(d.getUTCDate() + 1); return d; } // Sun -> Mon
  return date;
}

/** NYSE full-closure holidays for a given year. */
export function marketHolidays(year) {
  const fixed = (m, d, label) => ({ date: fmt(observed(new Date(Date.UTC(year, m, d)))), label });
  return [
    fixed(0, 1, "New Year's Day"),
    { date: fmt(nthWeekday(year, 0, 1, 3)), label: 'Martin Luther King Jr. Day' },
    { date: fmt(nthWeekday(year, 1, 1, 3)), label: "Presidents' Day" },
    { date: fmt(goodFriday(year)), label: 'Good Friday' },
    { date: fmt(lastWeekday(year, 4, 1)), label: 'Memorial Day' },
    fixed(5, 19, 'Juneteenth'),
    fixed(6, 4, 'Independence Day'),
    { date: fmt(nthWeekday(year, 8, 1, 1)), label: 'Labor Day' },
    { date: fmt(nthWeekday(year, 10, 4, 4)), label: 'Thanksgiving' },
    fixed(11, 25, 'Christmas'),
  ].sort((a, b) => a.date.localeCompare(b.date));
}

/** Options expiration Fridays. Mar/Jun/Sep/Dec is quarterly "triple witching". */
export function opexFridays(year) {
  const QUARTERLY = new Set([2, 5, 8, 11]);
  const out = [];
  for (let m = 0; m < 12; m++) {
    const f = nthWeekday(year, m, 5, 3);
    if (!f) continue;
    out.push({
      date: fmt(f),
      label: QUARTERLY.has(m) ? 'Quarterly options expiration (triple witching)' : 'Monthly options expiration',
    });
  }
  return out;
}

let hebcalCache = new Map(); // year -> { ts, holidays }
const HEBCAL_TTL = 30 * 864e5; // 30 days — these dates never change once published

/** Major Jewish holidays for a year, via hebcal.com's free public API. */
async function jewishHolidays(year) {
  const cached = hebcalCache.get(year);
  if (cached && Date.now() - cached.ts < HEBCAL_TTL) return cached.holidays;
  try {
    const r = await fetch(`https://www.hebcal.com/hebcal?cfg=json&v=1&year=${year}&maj=on`);
    const j = await safeJson(r);
    const holidays = (j?.items || [])
      .filter((it) => it.category === 'holiday' && it.date)
      .map((it) => ({ date: it.date.slice(0, 10), label: it.title }));
    hebcalCache.set(year, { ts: Date.now(), holidays });
    return holidays;
  } catch {
    return cached?.holidays || [];
  }
}

/**
 * Everything within `days` of today, one merged/sorted list. `type` lets the
 * prompt (and the client) badge each row: closed markets read very differently
 * from a same-day-open options event.
 */
export async function upcomingCalendar({ days = 14 } = {}) {
  const now = new Date();
  const today = fmt(now);
  const horizon = fmt(new Date(now.getTime() + days * 864e5));
  const years = [...new Set([now.getUTCFullYear(), new Date(horizon).getUTCFullYear()])];

  const holidays = years.flatMap((y) => marketHolidays(y)).map((h) => ({ ...h, type: 'market-closed' }));
  const opex = years.flatMap((y) => opexFridays(y)).map((o) => ({ ...o, type: 'opex' }));
  const jewish = (await Promise.all(years.map(jewishHolidays))).flat().map((h) => ({ ...h, type: 'jewish-holiday' }));

  const out = [...holidays, ...opex, ...jewish]
    .filter((e) => e.date >= today && e.date <= horizon)
    .sort((a, b) => a.date.localeCompare(b.date));

  return out.map((e) => ({ ...e, daysOut: Math.round((new Date(e.date) - new Date(today)) / 864e5) }));
}

const NOTE = {
  'market-closed': 'US markets closed — no trading.',
  'opex': 'Elevated volume into the close; moves can unwind the following session.',
  'jewish-holiday': 'Israeli markets closed; historically thinner global liquidity feeding into the US session.',
};

/** One-line-per-event text block for the council prompt, same shape as macroBlock. */
export async function calendarBlock({ days = 14 } = {}) {
  const ev = await upcomingCalendar({ days });
  if (!ev.length) return '';
  const lines = ev.slice(0, 6).map((e) => `- ${e.date} (in ${e.daysOut}d): ${e.label} — ${NOTE[e.type] || ''}`);
  return `LIQUIDITY CALENDAR (next ${days}d — context only, not a signal):\n${lines.join('\n')}`;
}
