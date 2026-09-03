/**
 * The contribution ledger — the firm's real cash cadence + scheduled one-off
 * deposits/withdrawals, as DATA (was: a number hardcoded in definitions.js and a
 * cadence the user only ever told the council verbally).
 *
 * Feeds firmContext (so the boss can plan against known inflows) and the DCA
 * engine (so "this week's $X" is the real number).
 *
 * Shape at users/{uid}/state/contributions:
 *   {
 *     weeklyAmount: number,            // recurring contribution per week, USD
 *     weekday: 0-6,                    // ET weekday it lands (1 = Mon)
 *     split: [{ ticker, pct }],        // optional preferred allocation
 *     entries: [{ id, date, amount, direction: 'in'|'out', note, done }],
 *   }
 */
import { db } from './firebase.js';

const ref = (uid) => db.doc(`users/${uid}/state/contributions`);
const DEFAULT = { weeklyAmount: 0, weekday: 1, split: [], entries: [] };

function clean(raw) {
  const c = raw || {};
  return {
    weeklyAmount: Math.max(0, Number(c.weeklyAmount) || 0),
    weekday: Number.isInteger(c.weekday) ? Math.max(0, Math.min(6, c.weekday)) : 1,
    split: Array.isArray(c.split)
      ? c.split
          .filter((s) => s && /^[A-Z.\-]{1,10}$/.test(String(s.ticker || '').toUpperCase()))
          .map((s) => ({ ticker: String(s.ticker).toUpperCase(), pct: Math.max(0, Math.min(1, Number(s.pct) || 0)) }))
          .slice(0, 12)
      : [],
    entries: Array.isArray(c.entries)
      ? c.entries
          .filter((e) => e && e.date && Number(e.amount) > 0)
          .map((e) => ({
            id: String(e.id || `e-${Math.random().toString(36).slice(2, 9)}`),
            date: String(e.date).slice(0, 10),
            amount: Math.round(Number(e.amount) * 100) / 100,
            direction: e.direction === 'out' ? 'out' : 'in',
            note: String(e.note || '').slice(0, 120),
            done: !!e.done,
          }))
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(0, 100)
      : [],
  };
}

export async function getContributions(uid) {
  try {
    const doc = await ref(uid).get();
    return clean(doc.exists ? doc.data() : DEFAULT);
  } catch {
    return { ...DEFAULT };
  }
}

export async function setContributions(uid, patch) {
  const cur = await getContributions(uid);
  const next = clean({ ...cur, ...patch });
  await ref(uid).set(next, { merge: false }).catch(() => {});
  return next;
}

export async function addEntry(uid, entry) {
  const cur = await getContributions(uid);
  cur.entries.push({ ...entry, id: `e-${Date.now().toString(36)}` });
  return setContributions(uid, cur);
}

export async function removeEntry(uid, id) {
  const cur = await getContributions(uid);
  cur.entries = cur.entries.filter((e) => e.id !== id);
  return setContributions(uid, cur);
}

/** Net scheduled cash over the next `days` — recurring + one-off, minus withdrawals. */
export function projectedInflow(c, days = 30) {
  const now = Date.now();
  const horizon = now + days * 864e5;
  let net = 0;
  const weeks = days / 7;
  net += (c.weeklyAmount || 0) * weeks;
  for (const e of c.entries || []) {
    const t = new Date(`${e.date}T12:00:00Z`).getTime();
    if (Number.isNaN(t) || t < now || t > horizon || e.done) continue;
    net += e.direction === 'out' ? -e.amount : e.amount;
  }
  return Math.round(net);
}

/** The next single contribution amount for the DCA engine. */
export function nextContribution(c) {
  const upcoming = (c.entries || [])
    .filter((e) => !e.done && e.direction === 'in')
    .find((e) => new Date(`${e.date}T12:00:00Z`).getTime() >= Date.now() - 864e5);
  if (upcoming) return { amount: upcoming.amount, date: upcoming.date, kind: 'one-off' };
  if (c.weeklyAmount > 0) return { amount: c.weeklyAmount, date: null, kind: 'weekly' };
  return { amount: 0, date: null, kind: 'none' };
}

/** Text block for firmContext / the boss. */
export async function contributionsBlock(uid) {
  const c = await getContributions(uid);
  if (!c.weeklyAmount && !c.entries.length) return '';
  const lines = [];
  if (c.weeklyAmount) {
    const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][c.weekday] || 'weekly';
    const split = c.split.length ? ` (${c.split.map((s) => `${s.ticker} ${Math.round(s.pct * 100)}%`).join(' / ')})` : '';
    lines.push(`Recurring: $${c.weeklyAmount}/week on ${wd}${split}.`);
  }
  const soon = c.entries.filter((e) => !e.done && new Date(`${e.date}T12:00:00Z`).getTime() >= Date.now() - 864e5).slice(0, 6);
  for (const e of soon) {
    lines.push(`${e.date}: ${e.direction === 'out' ? '−' : '+'}$${e.amount}${e.note ? ` (${e.note})` : ''}`);
  }
  lines.push(`Projected net cash next 30d: $${projectedInflow(c, 30)}.`);
  return `Contribution schedule:\n${lines.map((l) => `  ${l}`).join('\n')}`;
}
