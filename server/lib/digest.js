/**
 * The overnight digest — "while you were away." Aggregates what happened
 * since the investor last looked: last night's desk brief, new signals
 * (news/filing/insider/congress), fresh verdicts, and the current DCA pick.
 * Pure reads of data that already exists elsewhere; no LLM calls.
 */
import { db } from './firebase.js';
import { lastDeskWork } from './desk/night.js';
import { dcaSuggestion } from './dca.js';

const DAY = 86400000;
const seenDoc = (uid) => db.doc(`users/${uid}/state/digest`);

async function lastSeen(uid) {
  try {
    const doc = await seenDoc(uid).get();
    return doc.exists && doc.data()?.lastSeen ? doc.data().lastSeen : Date.now() - DAY;
  } catch {
    return Date.now() - DAY;
  }
}

export async function markDigestSeen(uid) {
  await seenDoc(uid).set({ lastSeen: Date.now() }, { merge: true }).catch(() => {});
  return { ok: true };
}

export async function buildDigest(uid) {
  const since = await lastSeen(uid);

  const [work, signalsSnap, analysesSnap, dca] = await Promise.all([
    lastDeskWork(uid).catch(() => null),
    db.collection(`users/${uid}/signals`).orderBy('ts', 'desc').limit(30).get().catch(() => null),
    db.collection(`users/${uid}/analyses`).where('ts', '>', since).orderBy('ts', 'desc').limit(30).get().catch(() => null),
    dcaSuggestion(uid).catch(() => null),
  ]);

  const signals = (signalsSnap?.docs || [])
    .map((d) => d.data())
    .filter((s) => (s.ts || 0) > since)
    .slice(0, 10);

  // Newest verdict per ticker since `since` — a compact "what changed" list.
  const byTicker = new Map();
  for (const d of analysesSnap?.docs || []) {
    const a = d.data();
    if (!a.ticker) continue;
    const cur = byTicker.get(a.ticker);
    if (!cur || (a.ts || 0) > (cur.ts || 0)) byTicker.set(a.ticker, a);
  }
  const newVerdicts = [...byTicker.values()]
    .filter((a) => ['ADD', 'HOLD', 'TRIM', 'EXIT'].includes(a.verdict))
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const workIsNew = work && (work.ts || 0) > since;

  return {
    since,
    hasContent: !!(workIsNew || signals.length || newVerdicts.length),
    work: workIsNew ? { brief: work.brief, error: work.error || null, ts: work.ts } : null,
    signals: signals.map((s) => ({ kind: s.kind, ticker: s.ticker, headline: s.headline || s.title || '', ts: s.ts })),
    newVerdicts: newVerdicts.map((a) => ({ ticker: a.ticker, verdict: a.verdict, conviction: a.conviction, tier: a.tier || null, ts: a.ts })),
    dcaPick: dca?.ready && dca.pick ? { ticker: dca.pick.ticker, reason: dca.pick.reason } : null,
  };
}
