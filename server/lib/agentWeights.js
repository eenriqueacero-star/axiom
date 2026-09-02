/**
 * Scorecard → agent weights. Once verdicts have aged enough to score, this turns
 * each agent's track record into a multiplier on its vote in scoreCouncil:
 * an agent whose PASS calls actually went up (and FAIL calls went down) gets
 * weighted up; a coin-flip agent stays at 1.0; a reliably-wrong one gets damped.
 *
 * With no scored data yet, every weight is 1.0 — the system is a no-op until the
 * scorecard fills in, then it tunes itself.
 */
import { aggregate } from './scorecard.js';

const AGENT_IDS = ['quality', 'trend', 'catalyst', 'sector', 'sizing', 'bear'];
const cache = new Map();
const TTL = 60 * 60 * 1000;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** How well one agent's stance separated winners from losers, and on how many calls. */
function agentEdge(entry) {
  if (!entry) return { spread: 0, n: 0 };
  const pass = entry.PASS, fail = entry.FAIL, bearish = entry.BEARISH;

  if (pass?.pctUp != null || fail?.pctUp != null) {
    const p = pass?.pctUp ?? 0.5;
    const f = fail?.pctUp ?? 0.5;
    return { spread: p - f, n: (pass?.n || 0) + (fail?.n || 0) };
  }
  if (bearish?.pctUp != null) {
    // A BEARISH call should predict a DOWN move.
    return { spread: 0.5 - bearish.pctUp, n: bearish.n || 0 };
  }
  return { spread: 0, n: 0 };
}

export async function agentWeights(uid) {
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;

  const out = { weights: {}, detail: {}, scored: 0 };
  for (const id of AGENT_IDS) { out.weights[id] = 1; out.detail[id] = { spread: 0, n: 0, weight: 1 }; }

  try {
    const agg = await aggregate(uid);
    out.scored = agg.total || 0;
    for (const id of AGENT_IDS) {
      const { spread, n } = agentEdge(agg.byAgent?.[id]);
      const confidence = Math.min(1, n / 15);
      const w = clamp(1 + clamp(spread, -0.5, 0.5) * confidence, 0.4, 1.8);
      out.weights[id] = Math.round(w * 100) / 100;
      out.detail[id] = { spread: Math.round(spread * 100) / 100, n, weight: out.weights[id] };
    }
  } catch { /* keep the flat 1.0 defaults */ }

  cache.set(uid, { ts: Date.now(), data: out });
  return out;
}
