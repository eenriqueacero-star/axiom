/**
 * The Desk — the nightly run.
 *
 *   1. The boss (AXIOM) reads the firm's state and assigns each analyst one
 *      specific piece of research.
 *   2. Each analyst works it independently, web-grounded, filtered through
 *      their own playbook.
 *   3. The boss reads all six back, writes a morning brief, and files
 *      everything: `deskWork/{date}` for the raw night, and each finding as a
 *      desk note (lib/memos.js) that every future council run + chat reads.
 *
 * Budget-gated (lib/budget.js) — only runs idle, only on the autonomous slice.
 */
import { AGENTS, AXIOM_CONVERSATIONAL, PROTOCOLS } from '../../agents/definitions.js';
import { db } from '../firebase.js';
import { getPortfolio } from '../portfolio.js';
import { diagnose } from '../strategy.js';
import { callAgent, callSynthesis, setAutonomous } from '../groq.js';
import { saveMemo, listMemos } from '../memos.js';
import { getCalibration } from '../calibration.js';
import { getPlaybook, getPlaybooks, playbookBlock } from './playbooks.js';
import { runReflection } from './reflect.js';

const byId = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (t) => { try { const m = String(t).match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch { return null; } };
const today = () => new Date().toISOString().slice(0, 10);

async function firmContext(uid) {
  const portfolio = await getPortfolio(uid).catch(() => null);
  const d = diagnose(portfolio || {});
  const lines = [];
  if (d.ready) {
    lines.push(`Book: $${Math.round(d.total).toLocaleString()}, Core/Satellite ${Math.round(d.sleeve.corePct * 100)}/${Math.round(d.sleeve.satellitePct * 100)} (target ${d.sleeve.targetCore * 100}/${(1 - d.sleeve.targetCore) * 100}).`);
    lines.push(`Holdings: ${d.names.map((n) => `${n.ticker} ${(n.pct * 100).toFixed(0)}%`).join(', ')}.`);
    lines.push(`Sectors: ${d.sectors.slice(0, 4).map((s) => `${s.name} ${Math.round(s.pct * 100)}%`).join(', ')}.`);
    if (d.flags.length) lines.push(`Rulebook flags: ${d.flags.map((f) => f.msg).join(' | ')}`);
  } else {
    lines.push('No holdings yet.');
  }

  // latest verdict per ticker
  try {
    const snap = await db.collection(`users/${uid}/analyses`).get();
    const latest = new Map();
    for (const a of snap.docs.map((x) => x.data())) {
      if (!a.ticker) continue;
      const cur = latest.get(a.ticker);
      if (!cur || (a.ts || 0) > (cur.ts || 0)) latest.set(a.ticker, a);
    }
    const v = [...latest.values()].filter((a) => ['ADD', 'HOLD', 'TRIM', 'EXIT'].includes(a.verdict));
    if (v.length) lines.push(`Current verdicts: ${v.map((a) => `${a.ticker} ${a.verdict}/${a.conviction} (${a.tier || '?'})`).join(', ')}.`);
  } catch { /* ignore */ }

  const memos = await listMemos(uid, 8).catch(() => []);
  if (memos.length) lines.push(`Recent desk notes:\n${memos.map((m) => `- ${m.ticker ? `[${m.ticker}] ` : ''}${m.conclusion}`).join('\n')}`);

  return lines.join('\n');
}

/* ---------------------------------------------------------------- assign */

async function assign(context) {
  const roster = AGENTS.map((a) => `- ${a.name} (id "${a.id}"): ${a.role} — ${a.conversationalPrompt}`).join('\n');
  const system = `You are AXIOM, the partner running this investment firm. ${PROTOCOLS}
It's after hours. Give each of your six analysts ONE specific overnight assignment — real research that would sharpen the firm's edge. Anything is fair game: a filing to read, a supply-chain check, a policy calendar, a competitor teardown, a bear thesis to stress-test, a name outside the book worth underwriting. Make each task concrete and answerable by morning, and matched to that analyst's remit.
Analysts:
${roster}
Output ONLY raw JSON: {"focus":"<one line — the firm's biggest open question tonight>","assignments":[{"agentId":"quality","task":"..."},{"agentId":"trend","task":"..."},{"agentId":"catalyst","task":"..."},{"agentId":"bear","task":"..."},{"agentId":"sector","task":"..."},{"agentId":"sizing","task":"..."}]}`;
  const text = await callSynthesis({ system, user: `FIRM STATE:\n${context}\n\nAssign tonight's work.`, maxTokens: 900 });
  const parsed = json(text);
  return parsed?.assignments?.length ? parsed : { focus: '', assignments: [] };
}

/* -------------------------------------------------------------- research */

async function research(uid, agentId, task, context) {
  const ag = byId[agentId];
  if (!ag) return null;
  const pb = await getPlaybook(uid, agentId);
  const cal = await getCalibration(uid).catch(() => ({ notes: {} }));
  const calNote = cal?.notes?.[agentId];

  const system = `${ag.conversationalPrompt}
You are ${ag.name}, ${ag.role} at Axiom, an investment firm managing real capital. ${PROTOCOLS}
The partner has given you an overnight research assignment. Do it properly — use live web search, be specific, cite what you find. If you can't verify something, say so.${playbookBlock(pb)}${calNote ? `\n\nCALIBRATION: ${calNote}` : ''}
Output ONLY raw JSON: {"findings":"<3-6 sentences, concrete, the actual answer>","sources":["<url or publication>", "..."],"ticker":"<the single most relevant ticker, or null>","confidence":<0-1>,"actionable":<true|false>,"headline":"<8 words max>"}`;

  const { text } = await callAgent({
    system,
    user: `FIRM STATE:\n${context}\n\nYOUR ASSIGNMENT: ${task}\n\nReturn ONLY the JSON.`,
    useSearch: true,
    maxTokens: 700,
  });
  const p = json(text) || {};
  return {
    agentId, agentName: ag.name, task,
    findings: String(p.findings || '').slice(0, 900),
    sources: Array.isArray(p.sources) ? p.sources.slice(0, 5) : [],
    ticker: p.ticker && /^[A-Z.\-]{1,10}$/.test(p.ticker) ? p.ticker : null,
    confidence: typeof p.confidence === 'number' ? Math.max(0, Math.min(1, p.confidence)) : 0.5,
    actionable: !!p.actionable,
    headline: String(p.headline || '').slice(0, 80),
  };
}

/* ----------------------------------------------------------------- brief */

async function brief(context, focus, findings) {
  const body = findings.map((f) => `${f.agentName} — ${f.task}\n→ ${f.findings} [conf ${f.confidence}]`).join('\n\n');
  const system = `You are AXIOM, the partner. ${AXIOM_CONVERSATIONAL}
Your analysts worked overnight. Read their findings and write the morning brief for the firm: what changed, what matters, what to do about it. 3-5 sentences, direct.
Then pull out the durable conclusions worth keeping as desk notes.
Output ONLY raw JSON: {"brief":"<the morning brief>","notes":[{"ticker":"<or null>","conclusion":"<one sentence the council should carry forward>","confidence":<0-1>,"actionable":<bool>,"tags":["..."]}]}`;
  const text = await callSynthesis({ system, user: `TONIGHT'S FOCUS: ${focus}\n\nFIRM STATE:\n${context}\n\nFINDINGS:\n${body}`, maxTokens: 1200 });
  return json(text) || { brief: '', notes: [] };
}

/* --------------------------------------------------------------- the run */

export async function runDeskNight(uid, { reflect = true } = {}) {
  setAutonomous(true);
  const date = today();
  const workRef = db.doc(`users/${uid}/deskWork/${date}`);
  const stamp = (patch) => workRef.set({ date, ts: Date.now(), ...patch }, { merge: true }).catch(() => {});

  try {
    await stamp({ status: 'assigning', startedAt: Date.now() });
    const context = await firmContext(uid);
    const plan = await assign(context);
    if (!plan.assignments.length) {
      await stamp({ status: 'failed', error: 'the boss produced no assignments' });
      return { ok: false, why: 'no assignments produced' };
    }
    await stamp({ status: 'researching', focus: plan.focus, assignments: plan.assignments });

    const findings = [];
    for (const a of plan.assignments) {
      const r = await research(uid, a.agentId, a.task, context).catch((e) => { console.error('[desk-night] research', a.agentId, e.message); return null; });
      if (r) { findings.push(r); await stamp({ findings }); }
      await sleep(1500);
    }
    if (!findings.length) {
      await stamp({ status: 'failed', error: 'no analyst returned usable findings' });
      return { ok: false, why: 'no findings' };
    }

    await stamp({ status: 'briefing' });
    const b = await brief(context, plan.focus, findings);

    await stamp({
      status: 'done',
      focus: plan.focus,
      assignments: plan.assignments,
      findings,
      brief: b.brief || '',
      finishedAt: Date.now(),
    });

    // Each conclusion becomes a desk note the whole council reads back.
    for (const n of (b.notes || []).slice(0, 8)) {
      await saveMemo(uid, {
        participants: ['axiom'],
        topic: n.conclusion?.slice(0, 120) || plan.focus,
        ticker: n.ticker && /^[A-Z.\-]{1,10}$/.test(n.ticker) ? n.ticker : null,
        keyPoints: [],
        conclusion: n.conclusion || '',
        confidence: typeof n.confidence === 'number' ? n.confidence : 0.5,
        actionable: !!n.actionable,
        tags: Array.isArray(n.tags) ? n.tags.slice(0, 5) : ['desk'],
        source: 'desk-night',
      }).catch(() => {});
    }

    // One analyst reflects on and rewrites its own playbook (rotating).
    let reflection = null;
    if (reflect) {
      const rotate = AGENTS[new Date().getDate() % AGENTS.length];
      reflection = await runReflection(uid, rotate.id, context).catch(() => null);
    }

    console.log(`[desk-night] ${uid.slice(0, 6)}… — ${findings.length} findings, ${(b.notes || []).length} notes${reflection ? `, ${reflection.agentId} playbook v${reflection.version}` : ''}`);
    return { ok: true, date, focus: plan.focus, findings: findings.length, notes: (b.notes || []).length, reflection };
  } catch (err) {
    console.error('[desk-night] failed:', err.stack || err.message);
    await stamp({ status: 'failed', error: String(err.message).slice(0, 200) });
    return { ok: false, why: err.message };
  } finally {
    setAutonomous(false);
  }
}

export async function lastDeskWork(uid) {
  try {
    const snap = await db.collection(`users/${uid}/deskWork`).orderBy('ts', 'desc').limit(1).get();
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch {
    return null;
  }
}

export { getPlaybooks };
