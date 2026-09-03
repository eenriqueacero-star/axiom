/**
 * The vault — events the boss looked at and set aside. "Saved to data in case
 * it's needed for the future." Every agent and chat can read it back; it's a
 * lighter store than desk notes (which are conclusions the council carries into
 * verdicts) — the vault is raw material, kept for context.
 */
import { db } from '../firebase.js';

const CAP = 120;
const col = (uid) => db.collection(`users/${uid}/vault`);

export async function saveToVault(uid, entry) {
  const doc = {
    ts: Date.now(),
    ticker: null,
    kind: 'event',           // event | note | chat-outcome
    headline: '',
    detail: '',
    bossNote: '',            // why the boss set it aside
    source: '',
    url: '',
    tags: [],
    ...entry,
  };
  const ref = await col(uid).add(doc).catch(() => null);
  try {
    const snap = await col(uid).orderBy('ts', 'desc').offset(CAP).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  } catch { /* non-fatal */ }
  return ref ? { id: ref.id, ...doc } : null;
}

export async function listVault(uid, limit = 40) {
  try {
    const snap = await col(uid).orderBy('ts', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

/** Compact block for an agent/boss prompt — the last few set-aside items. */
export function vaultBlock(items) {
  if (!items?.length) return '';
  const lines = items.slice(0, 6).map((v) => {
    const d = new Date(v.ts).toISOString().slice(0, 10);
    return `- [${d}]${v.ticker ? ` ${v.ticker}` : ''} ${v.headline}${v.bossNote ? ` — set aside: ${v.bossNote}` : ''}`;
  }).join('\n');
  return `\n\nVAULT (events the desk logged but didn't act on — context only):\n${lines}\n`;
}
