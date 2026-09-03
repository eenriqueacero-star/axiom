/**
 * Private chat with the boss (AXIOM). Opened from a "Hey, let's talk"
 * notification when the event desk wants your read on something, or any time
 * from The Floor. Real conversation — the boss remembers the thread, sees the
 * firm's book, the vault, and the desk notes.
 */
import { db } from '../firebase.js';
import { AXIOM_CONVERSATIONAL, PROTOCOLS } from '../../agents/definitions.js';
import { callAgentChat } from '../groq.js';
import { markUserActivity } from '../budget.js';
import { firmContext } from './night.js';
import { listVault, vaultBlock, saveToVault } from './vault.js';
import { listMemos } from '../memos.js';

const col = (uid) => db.collection(`users/${uid}/chats`);
const MSG_CAP = 60;

export async function listThreads(uid) {
  try {
    const snap = await col(uid).orderBy('updatedAt', 'desc').limit(30).get();
    return snap.docs.map((d) => {
      const t = d.data();
      const last = (t.messages || []).at(-1);
      return {
        id: d.id, title: t.title || 'Boss', kind: t.kind || 'boss',
        updatedAt: t.updatedAt || t.createdAt || 0, unread: !!t.unread,
        preview: last ? String(last.content).slice(0, 100) : '',
        seededEvent: t.seededEvent || null,
      };
    });
  } catch { return []; }
}

export async function getThread(uid, id) {
  const doc = await col(uid).doc(id).get().catch(() => null);
  if (!doc?.exists) return null;
  if (doc.data().unread) await doc.ref.set({ unread: false }, { merge: true }).catch(() => {});
  return { id: doc.id, ...doc.data(), unread: false };
}

export async function createThread(uid, { title = 'Boss', seededEvent = null } = {}) {
  const id = `t-${Date.now()}`;
  const doc = {
    kind: 'boss', createdAt: Date.now(), updatedAt: Date.now(),
    title, seededEvent, messages: [], unread: false,
  };
  await col(uid).doc(id).set(doc).catch(() => {});
  return { id, ...doc };
}

function bossSystem(context, seededEvent, vault, memos) {
  const memoLines = (memos || []).slice(0, 6).map((m) => `- ${m.ticker ? `[${m.ticker}] ` : ''}${m.conclusion}`).join('\n');
  return `${AXIOM_CONVERSATIONAL}
You are AXIOM, the partner running this investment firm, talking privately with the investor who owns it. ${PROTOCOLS}

HOW TO TALK — you are a person, not a reporting function.
- Talk like a sharp colleague: plain words, contractions, opinions. A greeting gets a greeting. One line is fine.
- Don't open with a status report or dump analysis nobody asked for. Use the reference material only when it's relevant.
- When you do give a take, 2-4 sentences, grounded in the data below. If you don't know, say so.
- This is the person who pays the bills — be straight with them, including when you disagree.
${seededEvent ? `\nWHY THIS THREAD EXISTS — an event came in and you weren't sure it was worth putting the analysts on:\n"${seededEvent.headline}"${seededEvent.source ? ` (${seededEvent.source})` : ''}. You wanted the investor's read before spending the team's time. Pick up that thread naturally.\n` : ''}
--- REFERENCE (use what's relevant) ---
FIRM STATE:
${context}${vaultBlock(vault)}${memoLines ? `\n\nRECENT DESK NOTES:\n${memoLines}` : ''}`;
}

export async function postMessage(uid, id, userText) {
  markUserActivity();
  const ref = col(uid).doc(id);
  const doc = await ref.get().catch(() => null);
  if (!doc?.exists) return null;
  const thread = doc.data();
  const seededEvent = thread.seededEvent || null;

  const [context, vault, memos] = await Promise.all([
    firmContext(uid).catch(() => 'No firm state available.'),
    listVault(uid, 6).catch(() => []),
    listMemos(uid, 6).catch(() => []),
  ]);

  const history = (thread.messages || []).slice(-12).map((m) => ({ role: m.role, content: m.content }));
  history.push({ role: 'user', content: String(userText).slice(0, 4000) });

  let reply = '';
  try {
    reply = await callAgentChat({ system: bossSystem(context, seededEvent, vault, memos), messages: history, maxTokens: 600 });
  } catch (e) {
    reply = `Can't get to that right now — ${e.message}. Try me again in a minute.`;
  }

  const now = Date.now();
  const messages = [
    ...(thread.messages || []),
    { role: 'user', content: String(userText).slice(0, 4000), ts: now },
    { role: 'assistant', content: reply, ts: now + 1 },
  ].slice(-MSG_CAP);
  await ref.set({ messages, updatedAt: now, unread: false }, { merge: true }).catch(() => {});
  return { reply, messages };
}

/** Close the thread. 'archive' files the event in the vault for later. */
export async function resolveThread(uid, id, outcome = 'archive') {
  const doc = await col(uid).doc(id).get().catch(() => null);
  if (!doc?.exists) return { ok: false };
  const t = doc.data();
  if (outcome === 'archive' && t.seededEvent?.headline) {
    const lastUser = [...(t.messages || [])].reverse().find((m) => m.role === 'user');
    await saveToVault(uid, {
      kind: 'chat-outcome',
      ticker: t.seededEvent.ticker || null,
      headline: t.seededEvent.headline,
      source: t.seededEvent.source || '',
      url: t.seededEvent.url || '',
      bossNote: lastUser ? `after talking it through: ${String(lastUser.content).slice(0, 200)}` : 'talked through, set aside',
      tags: ['chat', 'event'],
    }).catch(() => {});
  }
  await doc.ref.set({ resolved: true, resolvedAt: Date.now(), outcome, updatedAt: Date.now() }, { merge: true }).catch(() => {});
  return { ok: true };
}
