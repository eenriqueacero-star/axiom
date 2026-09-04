/**
 * users/{uid}/analyses — the collection every council run writes to and
 * almost every surface (stances, floor, calibration, scorecard, digest,
 * chat context) reads from. It grows forever unless something prunes it, and
 * several of those readers do a full-collection `.get()`.
 *
 * saveAnalysis() is the one write path everything should use: it writes the
 * result, then prunes in the background (fire-and-forget, never blocks or
 * fails the caller) — newest ~15 runs per ticker, newest ~100 overall.
 */
import { db } from './firebase.js';

const KEEP_PER_TICKER = 15;
const KEEP_TOTAL = 100;

export async function saveAnalysis(uid, result) {
  const col = db.collection(`users/${uid}/analyses`);
  const ref = await col.add(result);
  pruneAnalyses(uid, result.ticker).catch(() => {});
  return ref;
}

async function pruneAnalyses(uid, ticker) {
  const col = db.collection(`users/${uid}/analyses`);

  if (ticker) {
    const snap = await col.where('ticker', '==', ticker).orderBy('ts', 'desc').get();
    if (snap.docs.length > KEEP_PER_TICKER) {
      await Promise.all(snap.docs.slice(KEEP_PER_TICKER).map((d) => d.ref.delete()));
    }
  }

  const all = await col.orderBy('ts', 'desc').limit(KEEP_TOTAL + 50).get();
  if (all.size > KEEP_TOTAL) {
    await Promise.all(all.docs.slice(KEEP_TOTAL).map((d) => d.ref.delete()));
  }
}
