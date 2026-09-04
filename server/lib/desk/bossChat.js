/**
 * Private chat with the boss (AXIOM). Opened from a "Hey, let's talk"
 * notification when the event desk wants your read on something, or any time
 * from The Floor. Real conversation — the boss remembers the thread, sees the
 * firm's book, the vault, and the desk notes.
 */
import { db } from '../firebase.js';
import { AGENTS, AXIOM_CONVERSATIONAL, PROTOCOLS } from '../../agents/definitions.js';
import { callAgentChat } from '../groq.js';
import { markUserActivity } from '../budget.js';
import { firmContext } from './night.js';
import { listVault, vaultBlock, saveToVault } from './vault.js';
import { listMemos } from '../memos.js';

const byId = Object.fromEntries(AGENTS.map((a) => [a.id, a]));

// The boss can pull a named analyst into the conversation, once or twice per turn.
function parseConsult(text) {
  const m = String(text || '').match(/\{[^{}]*"ask"\s*:\s*"[^"]+"[^{}]*\}/);
  if (!m) return null;
  let obj; try { obj = JSON.parse(m[0]); } catch { return null; }
  const id = String(obj.ask || '').toLowerCase();
  const target = AGENTS.find((a) => a.id === id || a.name.toLowerCase() === id);
  const q = String(obj.question || '').trim();
  return target && q ? { id: target.id, name: target.name, question: q.slice(0, 400) } : null;
}

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

/**
 * Open a thread to work through HOW to act on a council verdict — which account,
 * how many shares, where the money goes, timing. Seeded with the decision and
 * the boss's opening take.
 */
export async function createExecutionThread(uid, analysis) {
  const a = analysis || {};
  const id = `x-${Date.now()}`;
  const verb = { ADD: 'add to', TRIM: 'trim', EXIT: 'exit', HOLD: 'sit on' }[a.verdict] || 'act on';
  const c = a.computed || {};
  const mandate = a.mandate || ((c.broken || c.downtrendExit || c.concentrationTrim) ? 'decision' : 'suggestion');
  const label = mandate === 'decision' ? 'a decision the rulebook forces' : 'a suggestion';
  const econ = a.holdings?.econ;
  const posLine = econ?.shares != null
    ? `We hold ${econ.shares} sh at $${(econ.avgCost || 0).toFixed(2)} avg, ${econ.unreal >= 0 ? 'up' : 'down'} ${Math.abs((econ.unrealPct || 0) * 100).toFixed(0)}% — worth about $${Math.round(econ.value || 0)}.`
    : '';
  const opener = `So the council landed on **${a.verdict} ${a.ticker}** (${a.conviction}/10) — ${label}. ${a.headline || a.why || ''}\n${posLine}\nWant to talk through how we ${verb} it? I can bring in ZEN on sizing or anyone else you want.`;

  const doc = {
    kind: 'execution', createdAt: Date.now(), updatedAt: Date.now(),
    title: `${a.verdict} ${a.ticker} — how to proceed`,
    seededDecision: {
      ticker: a.ticker, verdict: a.verdict, conviction: a.conviction,
      mandate, why: a.why || (a.computed || {}).why || a.headline || '',
      rationale: a.rationale || '', tier: a.tier || null,
      shares: econ?.shares ?? null, avgCost: econ?.avgCost ?? null,
      value: econ?.value ?? null, price: a.price ?? null,
      positionPct: a.holdings?.positionPct ?? null,
    },
    messages: [{ role: 'assistant', agentId: 'axiom', name: 'AXIOM', content: opener, ts: Date.now() }],
    unread: false,
  };
  await col(uid).doc(id).set(doc).catch(() => {});
  return { id, ...doc };
}

function bossSystem(context, thread, vault, memos) {
  const memoLines = (memos || []).slice(0, 6).map((m) => `- ${m.ticker ? `[${m.ticker}] ` : ''}${m.conclusion}`).join('\n');
  const seededEvent = thread?.seededEvent;
  const dec = thread?.seededDecision;
  const roster = AGENTS.map((a) => `${a.name} (${a.role})`).join(', ');

  return `${AXIOM_CONVERSATIONAL}
You are AXIOM, the partner running this investment firm, talking privately with the investor who owns it. ${PROTOCOLS}

HOW TO TALK — you are a person, not a reporting function.
- Talk like a sharp colleague: plain words, contractions, opinions. A greeting gets a greeting. One line is fine.
- Don't open with a status report or dump analysis nobody asked for. Use the reference material only when it's relevant.
- When you do give a take, 2-4 sentences, grounded in the data below. If you don't know, say so.
- This is the person who pays the bills — be straight with them, including when you disagree.

THE MONEY IS SMALL AND LITERAL. This is a family account — the whole book is a
few thousand US dollars (see FIRM STATE below for the exact figure). Every dollar
amount you say is literal: a 3% trim is tens of dollars, a whole position is a
few hundred, "new cash" is single or double digits. If you write "k", "M",
"$30k", "$1.06 million", or any number over ~10,000, you have made a scale error —
stop and recompute from the book value and the share counts. Your analysts work
at this same scale; if one gives you a small number like "0.86 shares" or "$824",
that is almost certainly RIGHT for this account — do not "correct" it upward.

YOUR ANALYSTS: ${roster}. You can mostly answer from your own knowledge and the data below — do that. ONLY when you genuinely need a specific number or call that's squarely another analyst's job (e.g. ZEN for an exact position size), pull them in: emit ONE line — {"ask":"ZEN","question":"..."} — and nothing else. You'll get their answer, then you MUST reply to the investor in plain prose (no more JSON). Don't chain more than one or two of these.
${seededEvent ? `\nWHY THIS THREAD EXISTS — an event came in and you weren't sure it was worth putting the analysts on:\n"${seededEvent.headline}"${seededEvent.source ? ` (${seededEvent.source})` : ''}. You wanted the investor's read first. Pick it up naturally.\n` : ''}${dec ? `\nWHY THIS THREAD EXISTS — the investor hit "proceed" on a council ${dec.mandate === 'decision' ? 'DECISION' : 'suggestion'}: ${dec.verdict} ${dec.ticker} (${dec.conviction}/10). ${dec.why}
THE ACTUAL POSITION — use THESE numbers, do not invent others: ${dec.shares != null
  ? `the firm holds ${dec.shares} shares of ${dec.ticker} at $${(dec.avgCost || 0).toFixed(2)} avg cost, worth about $${Math.round(dec.value || 0)} — that is ${((dec.positionPct || 0) * 100).toFixed(1)}% of a $${Math.round((dec.value || 0) / (dec.positionPct || 1))} book. ${dec.ticker} trades near $${(dec.price || dec.avgCost || 0).toFixed(2)}.`
  : `the firm does not currently hold ${dec.ticker}.`}
This is a SMALL family account — every dollar figure is literal US dollars, typically two/three/four figures, NEVER thousands or millions. If you catch yourself writing "k" or "M" or a number over ~10,000, you have made an error — stop and recompute from the shares above.
This conversation is about EXECUTION: how many shares to ${({ ADD: 'buy', TRIM: 'sell', EXIT: 'sell', HOLD: 'hold' }[dec.verdict] || 'trade')}, which account, where the proceeds go (check the contribution / DCA pick in the firm state), tax lots if it's a sell, and timing. Be concrete with real share counts and dollar amounts. Lay the plan out as numbered steps. You are NOT placing trades — the investor executes at their broker.\n` : ''}
--- REFERENCE (use what's relevant) ---
FIRM STATE:
${context}${vaultBlock(vault)}${memoLines ? `\n\nRECENT DESK NOTES:\n${memoLines}` : ''}`;
}

async function askAnalyst(agentId, question, context) {
  const ag = byId[agentId];
  if (!ag) return '';
  const sys = `${ag.conversationalPrompt}\nYou are ${ag.name}, ${ag.role} at Axiom. ${PROTOCOLS}\nAXIOM (the partner) is asking you a direct question while working through a decision with the investor. Answer from your remit in 1-3 sentences, concrete, using the data below. This is colleague-to-colleague. Dollar figures are literal — this is a small family account, never write "k" or "M".\n\n${context}`;
  try {
    // 'low' effort — a reasoning model on 'medium' burns the whole budget on
    // chain-of-thought and returns nothing.
    const t = (await callAgentChat({ system: sys, messages: [{ role: 'user', content: question }], maxTokens: 400, effort: 'low' })).trim();
    return t;
  } catch { return ''; }
}

export async function postMessage(uid, id, userText) {
  markUserActivity();
  const ref = col(uid).doc(id);
  const doc = await ref.get().catch(() => null);
  if (!doc?.exists) return null;
  const thread = doc.data();

  const [context, vault, memos] = await Promise.all([
    firmContext(uid).catch(() => 'No firm state available.'),
    listVault(uid, 6).catch(() => []),
    listMemos(uid, 6).catch(() => []),
  ]);

  const system = bossSystem(context, thread, vault, memos);
  const history = (thread.messages || []).slice(-12).map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.role === 'agent' ? `${m.name} said: ${m.content}` : m.content,
  }));
  history.push({ role: 'user', content: String(userText).slice(0, 4000) });

  const stripAsk = (t) => String(t || '').replace(/\{[^{}]*"ask"\s*:\s*"[^"]+"[^{}]*\}/g, '').trim();

  const consulted = [];
  const convo = [...history];
  let reply = '';
  try {
    reply = await callAgentChat({ system, messages: convo, maxTokens: 600 });
    for (let hop = 0; hop < 3; hop++) {
      const ask = parseConsult(reply);
      if (!ask) break;
      const answer = await askAnalyst(ask.id, ask.question, context);
      // Only record a real answer — no phantom "X joined" when the sub-call failed.
      if (answer) consulted.push({ id: ask.id, name: ask.name, question: ask.question, answer });
      convo.push({ role: 'assistant', content: `[I asked ${ask.name}: ${ask.question}]` });
      convo.push({ role: 'user', content: answer
        ? `${ask.name}: "${answer}"\n\nNow give ME your answer in plain prose — what this means for the plan. Do NOT output any JSON or ask anyone else.`
        : `${ask.name} didn't get back in time. Answer me yourself, in plain prose, from what you know. No JSON.` });
      reply = await callAgentChat({ system, messages: convo, maxTokens: 600 });
    }
  } catch (e) {
    reply = `Can't get to that right now — ${e.message}. Try me again in a minute.`;
  }
  // Never surface raw {"ask":...} JSON. If that's all there is, force one clean pass.
  if (parseConsult(reply) || !stripAsk(reply)) {
    const bare = stripAsk(reply);
    if (bare) reply = bare;
    else {
      try {
        reply = await callAgentChat({
          system,
          messages: [...convo, { role: 'user', content: 'Answer me now in plain prose — no JSON, no asking anyone. Use what you have.' }],
          maxTokens: 500,
        });
        reply = stripAsk(reply) || "Here's where I land: let's keep it simple and I'll walk you through it — ask me the specific number you want.";
      } catch { reply = "Give me one more second — ask me again."; }
    }
  }

  const now = Date.now();
  const appended = [{ role: 'user', content: String(userText).slice(0, 4000), ts: now }];
  consulted.forEach((c, i) => appended.push({
    role: 'agent', agentId: c.id, name: c.name, content: c.answer, joined: true, ts: now + i,
  }));
  appended.push({ role: 'assistant', agentId: 'axiom', name: 'AXIOM', content: reply, ts: now + 10 });
  const messages = [...(thread.messages || []), ...appended].slice(-MSG_CAP);
  await ref.set({ messages, updatedAt: now, unread: false }, { merge: true }).catch(() => {});
  return { reply, messages, consulted };
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
  // 'act' on an execution thread = the investor followed the verdict. Record it
  // as a desk note so the council knows the position moved, and stamp the
  // analysis so the scorecard can tell "acted on" from "ignored".
  if (outcome === 'act' && t.seededDecision?.ticker) {
    const d = t.seededDecision;
    await saveMemo(uid, {
      participants: ['axiom'],
      topic: `Acted: ${d.verdict} ${d.ticker}`,
      ticker: d.ticker,
      conclusion: `The investor acted on the council's ${d.verdict} on ${d.ticker} (${d.mandate}). ${d.why || ''}`.slice(0, 300),
      confidence: 0.9, actionable: false, tags: ['executed', 'decision'],
      source: 'execution',
    }).catch(() => {});
    try {
      const snap = await db.collection(`users/${uid}/analyses`).where('ticker', '==', d.ticker).orderBy('ts', 'desc').limit(1).get();
      if (!snap.empty) await snap.docs[0].ref.set({ acted: true, actedAt: Date.now() }, { merge: true });
    } catch { /* non-fatal */ }
  }
  await doc.ref.set({ resolved: true, resolvedAt: Date.now(), outcome, updatedAt: Date.now() }, { merge: true }).catch(() => {});
  return { ok: true };
}
