// Weekend all-hands — every analyst reviews their own recent calls, researches
// how their job is done best, and rewrites their playbook. The nightly desk only
// reflects one analyst at a time (rotating); this is the whole team at once.
//
// Budget-gated. ~2 calls per agent per user (6 agents ≈ 12 calls/user).

import { db } from '../lib/firebase.js';
import { AGENTS } from '../agents/definitions.js';
import { runReflection } from '../lib/desk/reflect.js';
import { firmContext } from '../lib/desk/night.js';
import { canSpendAutonomous, noteDialogue } from '../lib/budget.js';
import { setAutonomous } from '../lib/groq.js';
import { sendPush } from '../routes/push.js';

const CALLS_PER_USER = 14;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runWeekendReflection() {
  const gate = canSpendAutonomous(CALLS_PER_USER);
  if (!gate.ok) return { skipped: gate.why };

  let uids = [];
  try { uids = (await db.collection('users').get()).docs.map((d) => d.id); } catch { return { skipped: 'no users' }; }

  setAutonomous(true);
  let totalUsers = 0;
  try {
    for (const uid of uids) {
      if (!canSpendAutonomous(CALLS_PER_USER).ok) break;
      const ctx = await firmContext(uid).catch(() => '');
      const revised = [];
      for (const ag of AGENTS) {
        if (!canSpendAutonomous(3).ok) break;
        try {
          const r = await runReflection(uid, ag.id, ctx);
          if (r) revised.push(r);
        } catch (e) {
          console.error('[weekend-reflect]', ag.id, e.message);
        }
        await sleep(1500);
      }
      if (revised.length) {
        noteDialogue();
        totalUsers++;
        await sendPush(uid, {
          title: 'The team sharpened up this weekend',
          body: `${revised.length} analyst${revised.length > 1 ? 's' : ''} rewrote their playbook: ${revised.map((r) => r.agentName).join(', ')}.`,
          data: { path: '/?tab=floor' },
        }).catch(() => {});
      }
      console.log(`[weekend-reflect] ${uid.slice(0, 6)}… — ${revised.length}/6 playbooks revised`);
    }
  } finally {
    setAutonomous(false);
  }
  return { ok: true, users: totalUsers };
}
