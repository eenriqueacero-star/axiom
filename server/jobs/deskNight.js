// The Desk — nightly run. Boss assigns overnight research, analysts work it,
// boss files a brief + desk notes, one analyst rewrites its own playbook.
//
// Budget-gated: skips if the user's been active or the autonomous Groq slice is
// spent. ~9 calls per user per night.

import { db } from '../lib/firebase.js';
import { runDeskNight } from '../lib/desk/night.js';
import { canSpendAutonomous, noteDialogue } from '../lib/budget.js';

const CALLS_PER_NIGHT = 14;

export async function runDeskNightAll() {
  const gate = canSpendAutonomous(CALLS_PER_NIGHT);
  if (!gate.ok) return { skipped: gate.why };

  let uids = [];
  try { uids = (await db.collection('users').get()).docs.map((d) => d.id); } catch { return { skipped: 'no users' }; }

  const done = [];
  for (const uid of uids) {
    if (!canSpendAutonomous(CALLS_PER_NIGHT).ok) break;
    try {
      const r = await runDeskNight(uid);
      if (r.ok) { noteDialogue(); done.push({ uid: uid.slice(0, 6), ...r }); }
    } catch (err) {
      console.error('[desk-night]', uid.slice(0, 6), err.message);
    }
  }
  console.log(`[desk-night] ran for ${done.length} users`);
  return { ok: true, ran: done.length };
}
