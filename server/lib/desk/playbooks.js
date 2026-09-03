/**
 * Agent playbooks — each analyst's own, self-authored refinement of how it does
 * its job. Written by the agent during nightly self-reflection, versioned, and
 * prepended to that agent's system prompt on every future council run + chat.
 *
 * This is the deep half of self-improvement. `calibration.js` is the numeric
 * nudge from the scorecard; the playbook is the agent rewriting its own process.
 */
import { db } from '../firebase.js';

const cache = new Map();
const TTL = 30 * 60 * 1000;
const ref = (uid, agentId) => db.doc(`users/${uid}/playbooks/${agentId}`);

/** { playbook, version, updatedAt, history: [{ version, ts, note, playbook }] } */
export async function getPlaybook(uid, agentId) {
  const k = `${uid}:${agentId}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  let data = { playbook: '', version: 0, history: [] };
  try {
    const doc = await ref(uid, agentId).get();
    if (doc.exists) data = { history: [], ...doc.data() };
  } catch { /* none yet */ }
  cache.set(k, { ts: Date.now(), data });
  return data;
}

/** All six at once — for the nightly run and the Floor view. */
export async function getPlaybooks(uid, agentIds) {
  const out = {};
  await Promise.all(agentIds.map(async (id) => { out[id] = await getPlaybook(uid, id); }));
  return out;
}

/** Apply a reflection's proposed revision. `note` is the one-line changelog. */
export async function revisePlaybook(uid, agentId, { playbook, note }) {
  const clean = String(playbook || '').trim().slice(0, 1200);
  if (!clean) return null;

  const cur = await getPlaybook(uid, agentId);
  const version = (cur.version || 0) + 1;
  const history = [
    ...(cur.history || []),
    { version: cur.version || 0, ts: Date.now(), note: note || '', playbook: cur.playbook || '' },
  ].slice(-12);

  const next = { playbook: clean, version, updatedAt: Date.now(), history };
  await ref(uid, agentId).set(next).catch(() => {});
  cache.set(`${uid}:${agentId}`, { ts: Date.now(), data: next });
  return next;
}

/** The block to splice into an agent's system prompt. Empty when it has no playbook yet. */
export function playbookBlock(pb) {
  if (!pb?.playbook) return '';
  return `\n\nYOUR PLAYBOOK (v${pb.version} — rules you set for yourself from reviewing your own track record; follow them):\n${pb.playbook}`;
}
