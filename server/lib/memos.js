// Desk notes — the durable output of agent-to-agent conversations at the table.
// These are NOT written for the user; they are memory the agents read back when
// they answer later, so a conversation at the table changes future verdicts.

import { db } from './firebase.js';

const CAP = 50;
const col = (uid) => db.collection(`users/${uid}/deskNotes`);

export async function saveMemo(uid, memo) {
  const doc = {
    ts: Date.now(),
    participants: [],
    topic: '',
    ticker: null,
    keyPoints: [],
    conclusion: '',
    confidence: 0.5,
    actionable: false,
    tags: [],
    ...memo,
  };
  const ref = await col(uid).add(doc);

  // prune to the newest CAP
  try {
    const snap = await col(uid).orderBy('ts', 'desc').offset(CAP).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  } catch { /* ordering/offset unsupported on some emulators — non-fatal */ }

  return { id: ref.id, ...doc };
}

export async function listMemos(uid, limit = 30) {
  try {
    const snap = await col(uid).orderBy('ts', 'desc').limit(limit).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

// The notes an agent should have in mind right now.
export async function relevantMemos(uid, { ticker = null, agentId = null, limit = 4 } = {}) {
  const all = await listMemos(uid, 40);
  const sym = ticker ? String(ticker).toUpperCase() : null;

  const scored = all.map((m) => {
    let s = 0;
    if (sym && m.ticker && m.ticker.toUpperCase() === sym) s += 10;
    if (sym && (m.tags || []).some((t) => String(t).toUpperCase() === sym)) s += 6;
    if (agentId && (m.participants || []).includes(agentId)) s += 4;
    if (m.actionable) s += 2;
    s += Math.max(0, 3 - (Date.now() - (m.ts || 0)) / (7 * 864e5)); // recency
    return { m, s };
  });

  return scored
    .filter((x) => x.s > 1)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.m);
}

// Prompt block. Empty string when there's nothing worth injecting.
export function memoBlock(memos, { agentId = null } = {}) {
  if (!memos?.length) return '';
  const lines = memos.map((m) => {
    const who = (m.participants || []).join(' & ');
    const mine = agentId && (m.participants || []).includes(agentId);
    const tag = m.ticker ? `[${m.ticker}] ` : '';
    return `- ${tag}${who}${mine ? ' (you were in this one)' : ''}: ${m.conclusion}`;
  });
  return `\nDESK NOTES (conclusions the council already reached at the table — treat these as your own memory, don't contradict them without saying why):\n${lines.join('\n')}`;
}
