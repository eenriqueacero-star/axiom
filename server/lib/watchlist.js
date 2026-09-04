/**
 * Per-user watchlist — names you're tracking but don't own. Plain CRUD on
 * users/{uid}/watchlist/{ticker}; no LLM calls.
 */
import { db } from './firebase.js';

const TICKER_RE = /^[A-Z.\-]{1,10}$/;
const col = (uid) => db.collection(`users/${uid}/watchlist`);

export async function listWatchlist(uid) {
  try {
    const snap = await col(uid).orderBy('addedAt', 'desc').get();
    return snap.docs.map((d) => ({ ticker: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

export async function addToWatchlist(uid, ticker, note = '') {
  const t = String(ticker || '').toUpperCase().trim();
  if (!TICKER_RE.test(t)) return { ok: false, error: 'invalid ticker' };
  await col(uid).doc(t).set({ addedAt: Date.now(), note: String(note).slice(0, 200) }, { merge: true });
  return { ok: true, ticker: t };
}

export async function removeFromWatchlist(uid, ticker) {
  const t = String(ticker || '').toUpperCase().trim();
  await col(uid).doc(t).delete().catch(() => {});
  return { ok: true, ticker: t };
}
