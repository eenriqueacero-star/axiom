// Autonomous desk conversations.
//
// When nobody's using the app and there's budget to spare, two agents with a
// real disagreement sit down and talk it out. The result is a desk note the
// whole council reads back later.
//
// Guardrails: never while the user is active, never over the autonomous slice
// of the daily Groq budget, never more than the daily dialogue cap, and never
// the same topic twice in a row.

import { db } from '../lib/firebase.js';
import { convene, pickPairing, deskState } from '../lib/dialogue.js';
import { listMemos } from '../lib/memos.js';
import { canSpendAutonomous, noteDialogue, budgetStatus } from '../lib/budget.js';
import { setAutonomous } from '../lib/groq.js';

const CALLS_PER_DIALOGUE = 5; // 4 turns + 1 distill
const REPEAT_WINDOW_MS = 6 * 3600 * 1000;

async function activeUids() {
  try {
    const snap = await db.collection('users').get();
    return snap.docs.map((d) => d.id);
  } catch {
    return [];
  }
}

// Don't re-run a pairing/topic we already covered recently.
async function isFresh(uid, pairing) {
  const recent = await listMemos(uid, 10).catch(() => []);
  const cutoff = Date.now() - REPEAT_WINDOW_MS;
  return !recent.some(
    (m) =>
      (m.ts || 0) > cutoff &&
      (m.participants || []).includes(pairing.a) &&
      (m.participants || []).includes(pairing.b) &&
      (m.ticker || null) === (pairing.ticker || null),
  );
}

export async function deskTick() {
  if (deskState().activeDialogue) return { skipped: 'already talking' };

  const gate = canSpendAutonomous(CALLS_PER_DIALOGUE);
  if (!gate.ok) return { skipped: gate.why };

  const uids = await activeUids();
  for (const uid of uids) {
    let pairing;
    try {
      pairing = await pickPairing(uid);
    } catch { continue; }
    if (!pairing) continue;
    if (!(await isFresh(uid, pairing))) continue;

    setAutonomous(true);
    try {
      const res = await convene(uid, pairing);
      if (res?.ok) {
        noteDialogue();
        console.log(
          `[desk] ${pairing.a} x ${pairing.b}`
          + `${pairing.ticker ? ` on ${pairing.ticker}` : ''} → "${res.memo?.conclusion?.slice(0, 80)}"`,
        );
        return { ok: true, uid, pairing, budget: budgetStatus() };
      }
      return { skipped: res?.skipped || 'convene produced nothing' };
    } catch (err) {
      console.error('[desk] error:', err.message);
      return { error: err.message };
    } finally {
      setAutonomous(false);
    }
  }
  return { skipped: 'nothing worth talking about' };
}
