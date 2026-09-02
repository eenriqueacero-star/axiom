/**
 * Agent calibration notes — the qualitative half of self-improvement
 * (`agentWeights.js` is the numeric half). A weekly job reads the scored
 * verdicts, spots where an agent has been systematically too optimistic or too
 * harsh, and writes it a one-line note. runCouncil prepends that note to the
 * agent's system prompt so it self-corrects on the next run.
 *
 * Dormant until the scorecard has data — same as agentWeights.
 */
import { db } from './firebase.js';

const AGENT_IDS = ['quality', 'trend', 'catalyst', 'sector', 'sizing', 'bear'];
const MIN_N = 4;
const cache = new Map();
const TTL = 6 * 60 * 60 * 1000;

const pctStr = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;

function noteFor(id, byStance) {
  const pass = byStance.PASS, fail = byStance.FAIL, bear = byStance.BEARISH;

  if (id === 'bear') {
    if (bear && bear.n >= MIN_N && bear.avgPerf > 0.01) {
      return `Your bear flags haven't panned out — names you flagged averaged ${pctStr(bear.avgPerf)} afterward (n=${bear.n}). `
        + `Reserve thesisBreaker / structuralBearCase for a genuine, cited break, not a wobble.`;
    }
    return null;
  }
  if (pass && pass.n >= MIN_N && pass.avgPerf < -0.02) {
    return `Your recent PASS calls have underperformed — avg ${pctStr(pass.avgPerf)} after (n=${pass.n}). `
      + `Raise your bar: be slower to approve a name.`;
  }
  if (fail && fail.n >= MIN_N && fail.avgPerf > 0.03) {
    return `Names you FAILED have risen — avg ${pctStr(fail.avgPerf)} after (n=${fail.n}). `
      + `You may be too harsh; a soft quarter or an ugly chart is not a broken business.`;
  }
  return null;
}

/** Recompute one user's calibration from their scored analyses. */
export async function computeCalibration(uid) {
  let scored = [];
  try {
    const snap = await db.collection(`users/${uid}/analyses`).get();
    scored = snap.docs.map((d) => d.data()).filter((a) => a.score?.perf != null);
  } catch {
    return { ts: Date.now(), scored: 0, notes: {} };
  }

  const notes = {};
  for (const id of AGENT_IDS) {
    const byStance = {};
    for (const st of ['PASS', 'FAIL', 'BEARISH']) {
      const rows = scored.filter((a) => a.agents?.[id]?.stance === st);
      if (rows.length) {
        byStance[st] = { n: rows.length, avgPerf: rows.reduce((s, r) => s + r.score.perf, 0) / rows.length };
      }
    }
    notes[id] = noteFor(id, byStance);
  }

  const out = { ts: Date.now(), scored: scored.length, notes };
  await db.doc(`users/${uid}/state/calibration`).set(out).catch(() => {});
  cache.set(uid, { ts: Date.now(), data: out });
  return out;
}

export async function getCalibration(uid) {
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;
  let data = { ts: 0, scored: 0, notes: {} };
  try {
    const doc = await db.doc(`users/${uid}/state/calibration`).get();
    if (doc.exists) data = doc.data();
  } catch { /* none yet */ }
  cache.set(uid, { ts: Date.now(), data });
  return data;
}

/** Nightly (piggybacks on the scorecard cron). */
export async function calibrateAllUsers() {
  let n = 0;
  try {
    const users = await db.collection('users').get();
    for (const u of users.docs) { await computeCalibration(u.id).catch(() => {}); n++; }
  } catch { /* ignore */ }
  return n;
}
