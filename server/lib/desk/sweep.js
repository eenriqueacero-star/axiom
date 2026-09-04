/**
 * The boss's sweep.
 *
 * The user asked: "the boss should get all the same notifications I do, review
 * them, and see if we could profit from the news even if we're not in that
 * stock." This is that.
 *
 * Every notification (via lib/notify.js) lands in the user's feed. On a timer
 * the boss reads everything he hasn't seen yet — held or not — in ONE batched
 * pass against the book, and for each decides: dismiss / act on a holding /
 * buy something we don't own / watch it. Opportunities become desk cards and a
 * single "the boss sees an angle" notification; a strong new-name idea gets a
 * full council run within budget.
 */
import { db } from '../firebase.js';
import { PROTOCOLS, AXIOM_CONVERSATIONAL } from '../../agents/definitions.js';
import { callSynthesis, setAutonomous } from '../groq.js';
import { canSpendEvent, noteEvent } from '../budget.js';
import { extractJSON, runCouncil } from '../council.js';
import { getPortfolio } from '../portfolio.js';
import { firmContext } from './night.js';
import { saveAnalysis } from '../analyses.js';
import { notify } from '../notify.js';

const TICKER_RE = /^[A-Z.\-]{1,10}$/;
const CALLS = ['dismiss', 'act_held', 'buy_new', 'watch'];
const MAX_ITEMS = 20;

const feedCol = (uid) => db.collection(`users/${uid}/notifications`);
const oppCol = (uid) => db.collection(`users/${uid}/deskOpportunities`);

async function heldSet(uid) {
  try {
    const p = await getPortfolio(uid);
    const s = new Set();
    for (const a of p.accounts || []) for (const pos of a.positions || []) {
      if (pos.ticker && (pos.shares || 0) > 0) s.add(pos.ticker);
    }
    return s;
  } catch { return new Set(); }
}

async function unseen(uid) {
  try {
    const snap = await feedCol(uid).orderBy('ts', 'desc').limit(60).get();
    const cutoff = Date.now() - 24 * 3600_000;
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((n) => !n.bossSeen && (n.ts || 0) > cutoff && n.kind !== 'opportunity')
      .slice(0, MAX_ITEMS);
  } catch { return []; }
}

export async function bossSweep(uid) {
  const items = await unseen(uid);
  if (!items.length) return { skipped: 'nothing new in the inbox' };

  const gate = canSpendEvent(3);
  if (!gate.ok) return { skipped: gate.why, pending: items.length };

  const held = await heldSet(uid);
  const context = await firmContext(uid).catch(() => 'No firm state.');

  const list = items.map((n, i) =>
    `${i}. [${n.kind}${n.ticker ? ` ${n.ticker}${held.has(n.ticker) ? ' — HELD' : ''}` : ''}] ${n.title}${n.body ? ` — ${n.body}` : ''}`,
  ).join('\n');

  const system = `You are AXIOM, the partner running this investment firm. ${AXIOM_CONVERSATIONAL} ${PROTOCOLS}
You're doing a fast pass over everything that's crossed the wire since you last looked. For EACH item decide what, if anything, the firm should do — and specifically look for a way to make money even in a name we DON'T hold (a supplier, a competitor, a sector read, a read-through).
- "dismiss": noise, already priced in, or irrelevant.
- "act_held": it changes the case on a name we already hold — say add / trim / exit.
- "buy_new": there's a real opportunity in a name we do NOT hold. Name the ticker.
- "watch": interesting, not actionable yet — put it on the watchlist.
Be strict. Most items are "dismiss". Only flag "buy_new" when you'd genuinely put money to work.
Output ONLY a raw JSON array, one object per item:
[{"i":<index>,"call":"dismiss|act_held|buy_new|watch","ticker":"<relevant ticker or null>","note":"<one sentence>","conviction":<0-10>}]`;

  setAutonomous(true);
  let parsed;
  try {
    noteEvent();
    const text = await callSynthesis({
      system,
      user: `FIRM STATE:\n${context}\n\nINBOX (${items.length}):\n${list}\n\nReturn the JSON array and nothing else.`,
      maxTokens: 1800, effort: 'low',
    });
    parsed = extractJSON(text);
  } catch (e) {
    setAutonomous(false);
    return { error: e.message, pending: items.length };
  }
  setAutonomous(false);

  const calls = Array.isArray(parsed) ? parsed : [];
  const byIdx = new Map(calls.filter((c) => Number.isInteger(c.i)).map((c) => [c.i, c]));

  // mark everything seen + attach the boss's take
  await Promise.all(items.map((n, i) => {
    const c = byIdx.get(i);
    return feedCol(uid).doc(n.id).set({
      bossSeen: true,
      bossCall: c && CALLS.includes(c.call) ? { call: c.call, ticker: c.ticker || null, note: String(c.note || '').slice(0, 240), conviction: Number(c.conviction) || 0 } : { call: 'dismiss' },
    }, { merge: true }).catch(() => {});
  }));

  // opportunities worth surfacing
  const opps = [];
  for (let i = 0; i < items.length; i++) {
    const c = byIdx.get(i);
    if (!c || !CALLS.includes(c.call) || c.call === 'dismiss') continue;
    const conv = Number(c.conviction) || 0;
    const ticker = c.ticker && TICKER_RE.test(c.ticker) ? c.ticker : (items[i].ticker || null);
    if ((c.call === 'buy_new' || c.call === 'act_held') && conv >= 6 && ticker) {
      opps.push({ call: c.call, ticker, note: String(c.note || '').slice(0, 240), conviction: conv, from: items[i].title, held: held.has(ticker) });
    } else if (c.call === 'watch' && ticker) {
      opps.push({ call: 'watch', ticker, note: String(c.note || '').slice(0, 240), conviction: conv, from: items[i].title, held: held.has(ticker) });
    }
  }

  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  for (const o of opps) {
    await oppCol(uid).doc(`${o.ticker}-${day}`).set({ ...o, ts: now }, { merge: true }).catch(() => {});
  }

  const actionable = opps.filter((o) => o.call !== 'watch');
  if (actionable.length) {
    const summary = actionable
      .map((o) => `${o.ticker} ${o.call === 'buy_new' ? 'buy' : 'act'}`)
      .join(' · ');
    await notify(uid, {
      kind: 'opportunity',
      severity: actionable.some((o) => o.conviction >= 8) ? 'review' : 'fyi',
      title: `The boss sees ${actionable.length} angle${actionable.length > 1 ? 's' : ''}`,
      body: `${summary} — ${actionable[0].note}`,
      path: '/?tab=floor',
      dedupeKey: `boss-sweep:${day}`,
    });
  }

  // a strong new-name idea earns a full council run, budget permitting
  let convened = null;
  const strong = actionable.find((o) => o.call === 'buy_new' && o.conviction >= 8 && !o.held);
  if (strong && canSpendEvent(8).ok) {
    try {
      noteEvent();
      setAutonomous(true);
      const result = await runCouncil(strong.ticker, { mode: 'scout', uid });
      await saveAnalysis(uid, { ...result, trigger: 'boss-sweep' });
      convened = strong.ticker;
    } catch { /* non-fatal */ } finally { setAutonomous(false); }
  }

  return { reviewed: items.length, opportunities: opps.length, actionable: actionable.length, convened };
}

/** Every user (cron). */
export async function runBossSweepAll() {
  let users = [];
  try { users = (await db.collection('users').get()).docs.map((d) => d.id); } catch { return 0; }
  let total = 0;
  for (const uid of users) {
    const r = await bossSweep(uid).catch((e) => ({ error: e.message }));
    if (r?.actionable) total += r.actionable;
    console.log(`[boss-sweep] ${uid.slice(0, 6)}… ${JSON.stringify(r).slice(0, 160)}`);
  }
  return total;
}

export async function listOpportunities(uid, limit = 12) {
  try {
    const snap = await oppCol(uid).orderBy('ts', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch { return []; }
}
