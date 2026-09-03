/**
 * Self-improvement. An analyst reviews its own recent calls, researches how its
 * job is done best, then:
 *   1. reports what it found + what it wants to change to the boss,
 *   2. the boss (AXIOM) gives an opinion,
 *   3. the analyst finalises its playbook with that feedback.
 * The research and the exchange are filed as desk notes the whole council reads.
 */
import { AGENTS, PROTOCOLS, AXIOM_CONVERSATIONAL } from '../../agents/definitions.js';
import { db } from '../firebase.js';
import { callAgent, callSynthesis } from '../groq.js';
import { getCalibration } from '../calibration.js';
import { saveMemo } from '../memos.js';
import { getPlaybook, revisePlaybook } from './playbooks.js';

const byId = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
const json = (t) => { try { const m = String(t).match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch { return null; } };
const clip = (s, n) => String(s || '').slice(0, n);

/** This agent's last ~3 weeks of calls, with the outcome where the scorecard has one. */
async function recentCalls(uid, agentId) {
  let rows = [];
  try {
    const snap = await db.collection(`users/${uid}/analyses`).get();
    rows = snap.docs.map((d) => d.data())
      .filter((a) => a.agents?.[agentId] && Date.now() - (a.ts || 0) < 21 * 864e5)
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, 20);
  } catch { /* ignore */ }

  return rows.map((a) => {
    const r = a.agents[agentId];
    const checks = Object.entries(r.checks || {}).map(([k, v]) => `${k}=${v === null ? '?' : v ? 'y' : 'n'}`).join(',');
    const outcome = a.score?.perf != null ? ` → stock ${a.score.perf >= 0 ? '+' : ''}${(a.score.perf * 100).toFixed(0)}% in ${a.score.days}d` : '';
    return `${a.ticker}: ${r.stance} [${checks}] "${r.note || r.headline}" (verdict ${a.verdict})${outcome}`;
  });
}

export async function runReflection(uid, agentId, firmContext = '') {
  const ag = byId[agentId];
  if (!ag) return null;

  const [calls, pb, cal] = await Promise.all([
    recentCalls(uid, agentId),
    getPlaybook(uid, agentId),
    getCalibration(uid).catch(() => ({ notes: {} })),
  ]);
  if (calls.length < 3) return null; // not enough of a track record to learn from
  const calNote = cal?.notes?.[agentId];

  // 1 — the analyst researches and proposes (web-grounded).
  const proposeSys = `${ag.conversationalPrompt}
You are ${ag.name}, ${ag.role} at Axiom. ${PROTOCOLS}
You're sharpening how you do your job. Look hard at your recent calls and their outcomes. Use web search to research how the best analysts in your specialty actually work — the checklists, the traps, the tells. Then write up, for the partner (AXIOM):
- what you found that's worth adopting,
- what in your current playbook you want to change and why,
- a DRAFT of the revised playbook.
Your current playbook (v${pb.version}):
${pb.playbook || '(none yet — write your first)'}
${calNote ? `\nThe scorecard says: ${calNote}` : ''}
Output ONLY raw JSON: {"research":"<3-5 sentences: what you found, concrete>","sources":["<url or publication>","..."],"proposedChanges":"<2-4 sentences: what you'd change and why>","draftPlaybook":"<<=900 chars, concrete rules>","note":"<one-line changelog>"}`;

  const { text: proposeText } = await callAgent({
    system: proposeSys,
    user: `FIRM STATE:\n${firmContext}\n\nYOUR RECENT CALLS:\n${calls.join('\n')}\n\nResearch, then report to the partner. Return ONLY the JSON.`,
    useSearch: true,
    maxTokens: 800,
  });
  const prop = json(proposeText);
  if (!prop?.draftPlaybook) return null;

  // 2 — the boss weighs in.
  const bossSys = `You are AXIOM, the partner. ${AXIOM_CONVERSATIONAL}
${ag.name} (${ag.role}) reviewed their own work, did some research, and wants to revise their playbook. Give them a straight opinion: is the direction right? What should they keep from the old playbook? What's missing or overfit to a small sample? Be specific — you're their manager, not a rubber stamp.
Output ONLY raw JSON: {"verdict":"approve|revise","feedback":"<2-4 sentences, direct>","keep":"<anything from the current playbook they must not drop, or empty>"}`;
  let boss = { verdict: 'approve', feedback: '', keep: '' };
  try {
    const bossText = await callSynthesis({
      system: bossSys,
      user: `${ag.name}'S CURRENT PLAYBOOK (v${pb.version}):\n${pb.playbook || '(none)'}\n\nWHAT THEY FOUND:\n${prop.research}\n\nWHAT THEY WANT TO CHANGE:\n${prop.proposedChanges}\n\nTHEIR DRAFT:\n${prop.draftPlaybook}\n\nYour call. JSON only.`,
      maxTokens: 900, effort: 'low',
    });
    boss = { ...boss, ...(json(bossText) || {}) };
  } catch { /* boss unreachable — proceed with the draft */ }

  // 3 — the analyst finalises with the boss's feedback.
  let finalPlaybook = prop.draftPlaybook;
  let finalNote = prop.note || 'revised after research';
  if (boss.feedback && boss.verdict === 'revise') {
    try {
      const { text: finalText } = await callAgent({
        system: `${ag.conversationalPrompt}\nYou are ${ag.name} at Axiom. ${PROTOCOLS}\nAXIOM reviewed your draft playbook and gave feedback. Produce the FINAL playbook — take the feedback on board, keep what he said to keep.\nOutput ONLY raw JSON: {"playbook":"<<=900 chars>","note":"<one-line changelog>"}`,
        user: `YOUR DRAFT:\n${prop.draftPlaybook}\n\nAXIOM'S FEEDBACK: ${boss.feedback}\n${boss.keep ? `MUST KEEP: ${boss.keep}\n` : ''}\nFinal version. JSON only.`,
        useSearch: false,
        maxTokens: 700,
      });
      const fin = json(finalText);
      if (fin?.playbook) { finalPlaybook = fin.playbook; finalNote = fin.note || finalNote; }
    } catch { /* keep the draft */ }
  }

  const next = await revisePlaybook(uid, agentId, { playbook: finalPlaybook, note: finalNote });
  if (!next) return null;

  // File the research + the exchange so the whole council carries it forward.
  await saveMemo(uid, {
    participants: [agentId, 'axiom'],
    topic: `${ag.name} playbook v${next.version}`,
    conclusion: `${ag.name} researched their craft: ${clip(prop.research, 240)} — AXIOM: ${clip(boss.feedback || 'signed off', 180)}`,
    confidence: 0.6, actionable: false,
    tags: ['reflection', 'playbook', ag.name.toLowerCase()],
    source: 'reflection',
  }).catch(() => {});

  return {
    agentId, agentName: ag.name, version: next.version,
    note: next.history.at(-1)?.note || finalNote,
    research: clip(prop.research, 400),
    sources: Array.isArray(prop.sources) ? prop.sources.slice(0, 5) : [],
    bossVerdict: boss.verdict, bossFeedback: clip(boss.feedback, 400),
  };
}
