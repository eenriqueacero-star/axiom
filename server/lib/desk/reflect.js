/**
 * Nightly self-improvement. One analyst reviews its own recent calls, researches
 * how its job is done best, and rewrites its own playbook (playbooks.js). The
 * new version is prepended to that agent's prompt on every future run.
 */
import { AGENTS, PROTOCOLS } from '../../agents/definitions.js';
import { db } from '../firebase.js';
import { callAgent } from '../groq.js';
import { getCalibration } from '../calibration.js';
import { getPlaybook, revisePlaybook } from './playbooks.js';

const byId = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
const json = (t) => { try { const m = String(t).match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; } catch { return null; } };

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
  const system = `${ag.conversationalPrompt}
You are ${ag.name}, ${ag.role} at Axiom. ${PROTOCOLS}
Tonight you're reviewing your own work and sharpening how you do your job. Look hard at your recent calls and their outcomes. Use web search to research how the best analysts in your specialty actually work — the checklists, the traps, the tells. Then rewrite YOUR PLAYBOOK: a tight set of rules and habits you'll follow from now on. Keep what's working, fix what isn't. Be specific and self-critical — vague advice is useless.
Your current playbook (v${pb.version}):
${pb.playbook || '(none yet — write your first)'}
${calNote ? `\nThe scorecard says: ${calNote}` : ''}
Output ONLY raw JSON: {"playbook":"<your revised playbook, <= 900 chars, concrete rules>","note":"<one-line changelog: what changed and why>"}`;

  const { text } = await callAgent({
    system,
    user: `FIRM STATE:\n${firmContext}\n\nYOUR RECENT CALLS:\n${calls.join('\n')}\n\nRevise your playbook. Return ONLY the JSON.`,
    useSearch: true,
    maxTokens: 700,
  });

  const p = json(text);
  if (!p?.playbook) return null;
  const next = await revisePlaybook(uid, agentId, { playbook: p.playbook, note: p.note });
  return next ? { agentId, agentName: ag.name, version: next.version, note: next.history.at(-1)?.note || p.note } : null;
}
