/**
 * The event desk — real-time reaction to things that just happened.
 *
 * A scanner writes a signal (material news, an 8-K, an insider cluster, a
 * congressional trade in a held name). It lands here. The boss (AXIOM) reads it
 * against the firm's book and decides:
 *
 *   act     → assign the relevant analysts targeted research right now, review
 *             what they bring back, send them out again if it's thin, then brief
 *             the investor.
 *   talk    → not clearly actionable. Open a private thread and ping the
 *             investor: "Hey, let's talk." They decide together.
 *   archive → not worth anyone's time. File it in the vault in case it matters
 *             later.
 *
 * Budget-gated by canSpendEvent() — its own slice, any hour, hard daily cap.
 */
import { AGENTS, PROTOCOLS, AXIOM_CONVERSATIONAL } from '../../agents/definitions.js';
import { db } from '../firebase.js';
import { callSynthesis, setAutonomous } from '../groq.js';
import { canSpendEvent, noteEvent } from '../budget.js';
import { extractJSON, runCouncil } from '../council.js';
import { saveMemo, listMemos } from '../memos.js';
import { notify } from '../notify.js';
import { firmContext, research } from './night.js';
import { saveToVault, listVault, vaultBlock } from './vault.js';

const byId = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
const json = extractJSON;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TICKER_RE = /^[A-Z.\-]{1,10}$/;

// Don't re-triage the same name more than once every ~90 min.
const PER_TICKER_COOLDOWN_MS = 90 * 60 * 1000;

async function recentlyTriaged(uid, ticker) {
  if (!ticker) return false;
  try {
    const doc = await db.doc(`users/${uid}/state/eventSeen`).get();
    const at = doc.data()?.[ticker] || 0;
    return Date.now() - at < PER_TICKER_COOLDOWN_MS;
  } catch { return false; }
}
async function markTriaged(uid, ticker) {
  if (!ticker) return;
  await db.doc(`users/${uid}/state/eventSeen`).set({ [ticker]: Date.now() }, { merge: true }).catch(() => {});
}

/* --------------------------------------------------------------- the boss */

async function bossTriage(signal, context, vault) {
  const roster = AGENTS.map((a) => `- ${a.name} (id "${a.id}"): ${a.role}`).join('\n');
  const system = `You are AXIOM, the partner running this investment firm. ${PROTOCOLS}
An event just came in on a name the firm follows. Decide, fast, what the firm should do:
- "act": it could plausibly move money — assign 1-4 analysts a specific angle each, right now.
- "talk": unclear or judgment-heavy — you want to talk it through with the investor before spending analyst time.
- "archive": noise, or already priced in, or irrelevant to the book — log it and move on.
Your analysts:
${roster}
Output ONLY raw JSON:
{"decision":"act|talk|archive","reason":"<one sentence>","urgency":"high|normal","assignments":[{"agentId":"<id>","task":"<one specific sentence>"}],"talkOpener":"<if talk: how you'd open the conversation with the investor, 1-2 sentences, casual>"}`;

  const text = await callSynthesis({
    system,
    user: `EVENT (${signal.source || 'signal'}): ${signal.headline}\n${signal.url ? `link: ${signal.url}\n` : ''}${signal.ticker ? `ticker: ${signal.ticker}\n` : ''}\nFIRM STATE:\n${context}${vaultBlock(vault)}\n\nReturn the JSON and nothing else.`,
    maxTokens: 1400, effort: 'low',
  });
  const p = json(text) || {};
  const decision = ['act', 'talk', 'archive'].includes(p.decision) ? p.decision : 'talk';
  const assignments = (Array.isArray(p.assignments) ? p.assignments : [])
    .filter((a) => byId[a.agentId] && a.task)
    .slice(0, 4)
    .map((a) => ({ agentId: a.agentId, task: String(a.task).slice(0, 280) }));
  return {
    decision: decision === 'act' && !assignments.length ? 'talk' : decision,
    reason: String(p.reason || '').slice(0, 240),
    urgency: p.urgency === 'high' ? 'high' : 'normal',
    assignments,
    talkOpener: String(p.talkOpener || '').slice(0, 400),
  };
}

async function bossReview(signal, context, findings) {
  const body = findings.map((f) => `${f.agentName} — ${f.task}\n→ ${f.findings} [conf ${f.confidence}]`).join('\n\n');
  const system = `You are AXIOM, the partner. ${AXIOM_CONVERSATIONAL}
Your analysts just came back on a live event. Read their work. If any of it is thin or leaves an obvious follow-up, send that analyst back out with a specific next question. Then write the investor a short, plain update: what happened, what your team found, what you're doing about it.
Output ONLY raw JSON:
{"needsMore":[{"agentId":"<id>","followup":"<one sentence>"}],"brief":"<2-4 sentences for the investor>","notes":[{"ticker":"<or null>","conclusion":"<one sentence to carry forward>","confidence":<0-1>,"actionable":<bool>}],"reconvene":<true if the council should re-run a full verdict on this ticker>}`;
  const text = await callSynthesis({
    system,
    user: `EVENT: ${signal.headline}\n\nFIRM STATE:\n${context}\n\nANALYST FINDINGS:\n${body}\n\nJSON only.`,
    maxTokens: 1600, effort: 'low',
  });
  const p = json(text) || {};
  return {
    needsMore: (Array.isArray(p.needsMore) ? p.needsMore : []).filter((x) => byId[x.agentId] && x.followup).slice(0, 3),
    brief: String(p.brief || '').slice(0, 600),
    notes: Array.isArray(p.notes) ? p.notes.slice(0, 6) : [],
    reconvene: !!p.reconvene,
  };
}

/* ----------------------------------------------------------------- the job */

async function runEventJob(uid, signal, plan, context) {
  const id = `event-${Date.now()}`;
  const ref = db.doc(`users/${uid}/deskWork/${id}`);
  const stamp = (patch) => ref.set({ id, kind: 'event', ts: Date.now(), ticker: signal.ticker || null, event: signal.headline, ...patch }, { merge: true }).catch(() => {});

  await stamp({ status: 'researching', reason: plan.reason, assignments: plan.assignments });

  const findings = [];
  for (const a of plan.assignments) {
    const r = await research(uid, a.agentId, a.task, context).catch(() => null);
    if (r) { findings.push(r); await stamp({ findings }); }
    await sleep(1200);
  }
  if (!findings.length) { await stamp({ status: 'failed', error: 'no analyst returned findings' }); return; }

  await stamp({ status: 'reviewing' });
  let review = await bossReview(signal, context, findings);

  // One extra round if the boss wants more.
  if (review.needsMore.length && findings.length < 7) {
    await stamp({ status: 'researching', round: 2 });
    for (const m of review.needsMore) {
      const r = await research(uid, m.agentId, m.followup, context).catch(() => null);
      if (r) { r.followup = true; findings.push(r); await stamp({ findings }); }
      await sleep(1200);
    }
    await stamp({ status: 'reviewing', round: 2 });
    review = await bossReview(signal, context, findings);
  }

  for (const n of review.notes) {
    await saveMemo(uid, {
      participants: ['axiom'],
      topic: (n.conclusion || signal.headline).slice(0, 120),
      ticker: n.ticker && TICKER_RE.test(n.ticker) ? n.ticker : (signal.ticker || null),
      conclusion: n.conclusion || '',
      confidence: typeof n.confidence === 'number' ? n.confidence : 0.5,
      actionable: !!n.actionable,
      tags: ['event', 'desk'],
      source: 'event-desk',
    }).catch(() => {});
  }

  await stamp({ status: 'done', brief: review.brief, findings, finishedAt: Date.now() });

  await notify(uid, {
    kind: 'desk', severity: 'review', ticker: signal.ticker || null,
    title: `${signal.ticker ? `${signal.ticker} — ` : ''}the desk looked into it`,
    body: (review.brief || 'The team worked the event; see the desk.').slice(0, 200),
    refKind: 'deskWork', refId: id,
    path: '/?tab=floor',
  });

  if (review.reconvene && signal.ticker && TICKER_RE.test(signal.ticker) && canSpendEvent(8).ok) {
    try {
      noteEvent();   // a full council re-run is ~7 more calls — count it
      const result = await runCouncil(signal.ticker, { mode: 'scout', uid });
      await db.collection(`users/${uid}/analyses`).add({ ...result, trigger: 'event' });
    } catch { /* non-fatal */ }
  }
}

/* ------------------------------------------------------------ private talk */

async function openBossThread(uid, signal, opener) {
  const threadId = `t-${Date.now()}`;
  const text = opener || `Something came up on ${signal.ticker || 'a name we follow'} — "${signal.headline}". Not sure it's worth acting on yet. What's your read?`;
  await db.doc(`users/${uid}/chats/${threadId}`).set({
    kind: 'boss',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    title: signal.ticker ? `${signal.ticker} — let's talk` : "Let's talk",
    seededEvent: { ticker: signal.ticker || null, headline: signal.headline, url: signal.url || '', source: signal.source || '' },
    messages: [{ role: 'assistant', agentId: 'axiom', name: 'AXIOM', content: text, ts: Date.now() }],
    unread: true,
  }).catch(() => {});

  await notify(uid, {
    kind: 'desk', severity: 'review', ticker: signal.ticker || null,
    title: 'The boss wants your read',
    body: signal.ticker ? `${signal.ticker}: ${signal.headline}`.slice(0, 200) : signal.headline.slice(0, 200),
    refKind: 'thread', refId: threadId,
    path: `/?chat=${threadId}`,
  });
  return threadId;
}

/* --------------------------------------------------------------- entry pt */

/**
 * Triage one signal. Safe to call fire-and-forget from a scanner.
 * @param {object} signal { ticker, kind, headline, url, source, thesis }
 */
export async function triageSignal(uid, signal) {
  if (!signal?.headline) return { decision: 'skip', why: 'empty' };
  const ticker = signal.ticker && TICKER_RE.test(signal.ticker) ? signal.ticker : null;

  const gate = canSpendEvent(10);
  if (!gate.ok) {
    await saveToVault(uid, { ...vaultEntry(signal), bossNote: `auto-archived: ${gate.why}` });
    return { decision: 'archive', why: gate.why };
  }
  if (await recentlyTriaged(uid, ticker)) {
    await saveToVault(uid, { ...vaultEntry(signal), bossNote: 'auto-archived: same name triaged recently' });
    return { decision: 'archive', why: 'cooldown' };
  }
  // Claim the cooldown slot BEFORE any async work, so a second signal for the
  // same ticker in the same cycle can't slip past the check above.
  await markTriaged(uid, ticker);

  setAutonomous(true);
  noteEvent();
  try {
    const [context, vault] = await Promise.all([
      firmContext(uid).catch(() => 'No firm state available.'),
      listVault(uid, 6).catch(() => []),
    ]);

    const plan = await bossTriage({ ...signal, ticker }, context, vault);

    if (plan.decision === 'act') {
      await runEventJob(uid, { ...signal, ticker }, plan, context).catch((e) => console.error('[event-desk] job', e.message));
      return { decision: 'act', assignments: plan.assignments.length };
    }
    if (plan.decision === 'talk') {
      const threadId = await openBossThread(uid, { ...signal, ticker }, plan.talkOpener);
      return { decision: 'talk', threadId };
    }
    await saveToVault(uid, { ...vaultEntry(signal), bossNote: plan.reason || 'set aside by the boss' });
    return { decision: 'archive', reason: plan.reason };
  } catch (err) {
    console.error('[event-desk] triage failed:', err.message);
    await saveToVault(uid, { ...vaultEntry(signal), bossNote: `triage error: ${err.message}` }).catch(() => {});
    return { decision: 'error', why: err.message };
  } finally {
    setAutonomous(false);
  }
}

function vaultEntry(signal) {
  return {
    kind: 'event',
    ticker: signal.ticker && TICKER_RE.test(signal.ticker) ? signal.ticker : null,
    headline: signal.headline,
    detail: '',
    source: signal.source || '',
    url: signal.url || '',
    tags: [signal.kind || 'signal'],
  };
}

/** Recent event-desk jobs (the boss acted on these). */
export async function listEventJobs(uid, limit = 15) {
  try {
    const snap = await db.collection(`users/${uid}/deskWork`).orderBy('ts', 'desc').limit(40).get();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((w) => w.kind === 'event')
      .slice(0, limit);
  } catch {
    return [];
  }
}

export { listVault };
