/**
 * The Ledger — what got approved out of the Queue, whether it filled, and
 * (once filled) how it's doing. No broker orders yet: "approve" writes a
 * Working item (a tracked intent); the investor places the trade themselves
 * and comes back to mark it filled.
 *
 * Working: approved, not yet filled. Done: filled, tracked against entry price.
 * Skips (not now / snooze / dismiss) live in a small state doc so the Queue
 * can exclude them without a full collection scan.
 */
import { db } from './firebase.js';

const col = (uid) => db.collection(`users/${uid}/executions`);
const skipsDoc = (uid) => db.doc(`users/${uid}/state/queueSkips`);
const DAY = 86400000;

const SKIP_UNTIL = {
  now: () => Date.now() + DAY,        // "not now" — back tomorrow
  week: () => Date.now() + 7 * DAY,   // snooze a week
  dismiss: () => Date.now() + 3650 * DAY, // effectively forever
};

export async function listSkips(uid) {
  try {
    const doc = await skipsDoc(uid).get();
    return doc.exists ? (doc.data() || {}) : {};
  } catch {
    return {};
  }
}

export async function skipQueueItem(uid, id, mode = 'now') {
  const until = (SKIP_UNTIL[mode] || SKIP_UNTIL.now)();
  await skipsDoc(uid).set({ [id]: until }, { merge: true }).catch(() => {});
  return { ok: true, id, mode, until };
}

/** Turn approved Queue items into Working ledger entries. */
export async function approveItems(uid, items) {
  const batch = db.batch();
  const created = [];
  for (const it of items) {
    const ref = col(uid).doc();
    const doc = {
      status: 'working',
      action: it.action, ticker: it.ticker, tag: it.tag || '',
      plannedCash: it.cash, note: it.note || '',
      createdAt: Date.now(), updatedAt: Date.now(),
      filledAt: null, fillPrice: null, fillShares: null,
    };
    batch.set(ref, doc);
    created.push({ id: ref.id, ...doc });
  }
  await batch.commit().catch(() => {});
  return created;
}

export async function listLedger(uid, limit = 40) {
  try {
    const snap = await col(uid).orderBy('createdAt', 'desc').limit(limit).get();
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return {
      working: all.filter((e) => e.status === 'working'),
      done: all.filter((e) => e.status === 'done'),
    };
  } catch {
    return { working: [], done: [] };
  }
}

export async function markFilled(uid, id, { price, shares } = {}) {
  const ref = col(uid).doc(id);
  const doc = await ref.get().catch(() => null);
  if (!doc?.exists) return { ok: false };
  await ref.set({
    status: 'done', filledAt: Date.now(), updatedAt: Date.now(),
    fillPrice: price ?? null, fillShares: shares ?? null,
  }, { merge: true }).catch(() => {});

  // Stamp the analysis this decision came from so the scorecard can tell
  // "acted on" from "ignored" — same convention as the execution-thread flow.
  const t = doc.data();
  if (t?.ticker) {
    try {
      const aSnap = await db.collection(`users/${uid}/analyses`)
        .where('ticker', '==', t.ticker).orderBy('ts', 'desc').limit(1).get();
      if (!aSnap.empty) await aSnap.docs[0].ref.set({ acted: true, actedAt: Date.now() }, { merge: true });
    } catch { /* non-fatal */ }
  }
  return { ok: true };
}

export async function cancelWorking(uid, id) {
  await col(uid).doc(id).set({ status: 'cancelled', updatedAt: Date.now() }, { merge: true }).catch(() => {});
  return { ok: true };
}
