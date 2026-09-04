/**
 * Verdict stability watchdog — pure logging, zero influence on the verdict
 * itself. scoreCouncil() is supposed to be deterministic: the same agent
 * checks on the same day must always produce the same verdict. This module
 * fingerprints the checks that went into a run and, if it's seen that exact
 * fingerprint before today, flags whether the verdict actually matched.
 *
 * Never called synchronously in the request path in a way that can throw —
 * every export is safe to fire-and-forget.
 */
import { db } from './firebase.js';

const dayKey = () => new Date().toISOString().slice(0, 10);

/** A stable fingerprint of what the agents actually answered — order-independent. */
export function fingerprintChecks(agents) {
  const parts = Object.keys(agents).sort().map((id) => {
    const checks = agents[id]?.checks || {};
    const kv = Object.keys(checks).sort().map((k) => `${k}:${checks[k]}`).join(',');
    return `${id}[${kv}]`;
  });
  return parts.join('|');
}

/**
 * Log this run and check it against same-day runs with an identical fingerprint.
 * Returns a mismatch record if one is found (for the caller to optionally
 * surface), or null. Never throws.
 */
export async function auditVerdict(uid, ticker, agents, verdict, conviction) {
  try {
    const fp = fingerprintChecks(agents);
    const day = dayKey();
    const col = db.collection(`users/${uid}/verdictAudit`);

    const prior = await col
      .where('ticker', '==', ticker).where('day', '==', day).where('fingerprint', '==', fp)
      .limit(5).get();

    let mismatch = null;
    for (const doc of prior.docs) {
      const p = doc.data();
      if (p.verdict !== verdict) {
        mismatch = { priorVerdict: p.verdict, priorConviction: p.conviction, priorTs: p.ts, newVerdict: verdict };
        break;
      }
    }

    await col.add({ ticker, day, fingerprint: fp, verdict, conviction, ts: Date.now(), mismatch: !!mismatch });

    if (mismatch) {
      await db.doc('state/verdictStabilityAlerts').set({
        [`${uid}:${ticker}:${Date.now()}`]: { uid, ticker, ...mismatch, day },
      }, { merge: true }).catch(() => {});
    }
    return mismatch;
  } catch {
    return null; // never let audit logging affect the real request
  }
}

export async function listStabilityAlerts() {
  try {
    const doc = await db.doc('state/verdictStabilityAlerts').get();
    return doc.exists ? doc.data() : {};
  } catch {
    return {};
  }
}
