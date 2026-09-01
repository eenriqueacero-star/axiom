// Agent-to-agent conversations at the desk.
//
// Two agents with a genuine reason to disagree leave their stations, talk it
// through, and the exchange is distilled into a desk note (lib/memos.js) that
// every agent reads back later. The scene in the client animates whatever this
// module reports via /api/desk/state.

import { AGENTS } from '../agents/definitions.js';
import { db } from './firebase.js';
import { getPortfolio } from './portfolio.js';
import { diagnose, sectorOf, CAPS, SPLIT, CORE_LIST, BUFFER_ETF } from './strategy.js';
import { priceFacts } from './metrics.js';
import { callAgentChat, callAgent } from './groq.js';
import { saveMemo, listMemos, memoBlock } from './memos.js';

const byId = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
const nameOf = (id) => byId[id]?.name || id;
const TURNS = 4;

// In-memory: what's happening at the table right now (drives the 3D scene).
// The model answers in ~5s, which is far too fast to watch. We hold the
// finished dialogue on screen long enough for the room to actually play it out:
// walk to the table, one gesture per turn, walk back.
const HOLD_MS = 26_000;
let active = null;
let holdTimer = null;
const recent = [];

export const deskState = () => ({
  activeDialogue: active,
  lastFinished: recent[0] || null,
});

function releaseAfterHold() {
  clearTimeout(holdTimer);
  if (!active) return;
  active.finishedAt = Date.now();
  const elapsed = active.finishedAt - active.startedAt;
  holdTimer = setTimeout(() => { active = null; }, Math.max(0, HOLD_MS - elapsed));
}

/* ------------------------------------------------------------- pairing */
// Pick two agents who actually have something to argue about, from real state.
export async function pickPairing(uid) {
  const portfolio = await getPortfolio(uid).catch(() => null);
  const d = diagnose(portfolio || {});
  if (!d.ready) return null;

  const names = d.names || [];
  const top = names.slice(0, 8);

  // trend of the biggest positions
  const trends = {};
  await Promise.all(
    top.map(async (n) => {
      try {
        const { facts } = await priceFacts(n.ticker);
        trends[n.ticker] = facts?.trend || 'unknown';
      } catch { trends[n.ticker] = 'unknown'; }
    }),
  );

  const overCapSector = (d.sectors || []).find((s) => s.pct > CAPS.sector);
  const sleeveOff = Math.abs((d.sleeve?.corePct ?? 0) - SPLIT.core) > 0.15;
  const overCapName = names.find((n) => n.pct > CAPS.name[n.sleeve]);
  const brokenName = top.find((n) => trends[n.ticker] === 'downtrend');

  // 1. concentration argument — the sector is too big AND the sleeve is wrong
  if (overCapSector && sleeveOff) {
    return {
      a: 'sector', b: 'sizing', ticker: null,
      topic: `${overCapSector.name} is ${(overCapSector.pct * 100).toFixed(0)}% of the book `
        + `(cap ${CAPS.sector * 100}%) while Core sits at ${((d.sleeve.corePct) * 100).toFixed(0)}% `
        + `against a ${SPLIT.core * 100}% target — how do we fix it without forced selling?`,
    };
  }
  // 2. a name is broken on the chart but may still be a fine business
  if (brokenName) {
    return {
      a: 'bear', b: 'quality', ticker: brokenName.ticker,
      topic: `${brokenName.ticker} is in a downtrend and is ${(brokenName.pct * 100).toFixed(0)}% `
        + `of the book. Is the thesis actually broken, or is this just price?`,
    };
  }
  // 3. oversized winner
  if (overCapName) {
    return {
      a: 'sizing', b: 'trend', ticker: overCapName.ticker,
      topic: `${overCapName.ticker} is ${(overCapName.pct * 100).toFixed(0)}% — over its `
        + `${(CAPS.name[overCapName.sleeve] * 100).toFixed(0)}% cap. Trim into strength, or let it run?`,
    };
  }
  // 4. fallback — biggest position, catalyst vs trend
  const big = names[0];
  if (!big) return null;
  return {
    a: 'catalyst', b: 'trend', ticker: big.ticker,
    topic: `${big.ticker} is our largest position at ${(big.pct * 100).toFixed(0)}%. `
      + `What would have to happen for us to add, and what would make us cut?`,
  };
}

/* ------------------------------------------------------- grounding block */
const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

async function grounding(uid, ticker) {
  const portfolio = await getPortfolio(uid).catch(() => null);
  const d = diagnose(portfolio || {});
  const lines = [];
  if (d.ready) {
    lines.push(
      'SCALE — READ CAREFULLY: every dollar figure below is an EXACT amount in US dollars. '
      + 'This is a small personal brokerage account, not a fund. Never rescale a number into '
      + 'thousands, millions or billions, and never write "B" or "M". '
      + `The whole portfolio is ${usd(d.total)}.`,
    );
    lines.push(
      `PORTFOLIO: ${usd(d.total)} total (${usd(d.invested)} invested, ${usd(d.cash)} cash). `
      + `Core ${(d.sleeve.corePct * 100).toFixed(0)}% / Satellite ${(d.sleeve.satellitePct * 100).toFixed(0)}% `
      + `(target ${SPLIT.core * 100}/${SPLIT.satellite * 100}).`,
    );
    lines.push(`SECTORS: ${(d.sectors || []).slice(0, 4).map((s) => `${s.name} ${(s.pct * 100).toFixed(0)}%`).join(', ')}`);
    lines.push(
      'HOLDINGS: '
      + (d.names || []).slice(0, 8)
        .map((n) => `${n.ticker} ${usd(n.value)} (${(n.pct * 100).toFixed(0)}%, ${n.sleeve})`)
        .join('; '),
    );
    lines.push(
      `CORE LIST (the only names that count as Core — everything else is Satellite): ${CORE_LIST.join(', ')}. `
      + `Buffer ETF when nothing is eligible: ${BUFFER_ETF}.`,
    );
    lines.push(
      'RULEBOOK: sector cap ' + `${CAPS.sector * 100}%` + ', name cap '
      + `${CAPS.name.core * 100}% core / ${CAPS.name.satellite * 100}% satellite. `
      + `Only SELL a name if it is past ${CAPS.sellTrigger}x its cap; otherwise the fix is to `
      + 'steer NEW CONTRIBUTIONS, never a forced sale. Weekly contributions are small — '
      + 'proposals must be affordable at this account size.',
    );
    if (d.flags?.length) lines.push(`RULEBOOK FLAGS: ${d.flags.slice(0, 4).map((f) => f.msg).join(' | ')}`);
  }
  if (ticker) {
    try {
      const { block } = await priceFacts(ticker);
      if (block) lines.push(block);
    } catch { /* ignore */ }
  }
  const memos = await listMemos(uid, 6).catch(() => []);
  const mb = memoBlock(memos);
  if (mb) lines.push(mb.trim());
  return lines.join('\n');
}

/* ------------------------------------------------------------- dialogue */
export async function runDialogue(uid, pairing) {
  const { a, b, topic, ticker } = pairing;
  const A = byId[a];
  const B = byId[b];
  if (!A || !B) throw new Error('unknown agent in pairing');

  const facts = await grounding(uid, ticker);
  const turns = [];

  active = {
    a, b, aName: A.name, bName: B.name, topic, ticker,
    startedAt: Date.now(), turns, phase: 'talking',
  };

  const persona = (agent, other) =>
    `${agent.conversationalPrompt}\n`
    + `You are at the council's desk, talking directly with ${other.name} (${other.role}). `
    + `This is a working conversation between colleagues, not a report to the user. `
    + `Be concrete and short — 2-3 sentences, max 50 words. Quote dollar amounts exactly as given `
    + `(this account is a few thousand dollars, not a fund — never write B or M). Push back where you genuinely disagree, `
    + `concede where ${other.name} is right, and work toward something you can both act on.\n`
    + `GROUND TRUTH (do not invent numbers outside this):\n${facts}`;

  try {
    for (let i = 0; i < TURNS; i++) {
      const speaker = i % 2 === 0 ? A : B;
      const listener = i % 2 === 0 ? B : A;
      const history = turns.map((t) => ({
        role: t.agent === speaker.id ? 'assistant' : 'user',
        content: t.text,
      }));
      const opening = i === 0
        ? `${listener.name} has raised this at the desk: ${topic}\nGive your opening read.`
        : `Respond to ${listener.name}.`;

      const text = await callAgentChat({
        system: persona(speaker, listener),
        messages: [...history, { role: 'user', content: opening }],
        maxTokens: 220,
      });
      const clean = String(text || '').trim().slice(0, 500);
      if (!clean) break;
      turns.push({ agent: speaker.id, name: speaker.name, text: clean, ts: Date.now() });
    }
  } finally {
    // keep `active` populated until distill finishes so the scene can animate
  }

  return { ...pairing, turns };
}

/* -------------------------------------------------------------- distill */
export async function distill(uid, dialogue) {
  const transcript = dialogue.turns.map((t) => `${t.name}: ${t.text}`).join('\n');
  const system =
    'You compress a two-analyst conversation into a durable note for the council\'s own memory. '
    + 'This is machine-read by the agents later, not shown to the user. Be specific and useful: '
    + 'name tickers, numbers, and the condition that would change the conclusion. '
    + 'Output ONLY raw JSON.';
  const user =
    `TOPIC: ${dialogue.topic}\nPARTICIPANTS: ${nameOf(dialogue.a)}, ${nameOf(dialogue.b)}\n\n`
    + `${transcript}\n\n`
    + 'Return {"keyPoints":["<=20 words each, max 4"],"conclusion":"<=35 words, what the council now believes",'
    + '"confidence":<0-1>,"actionable":<true|false>,"tags":["TICKER or theme", ...]}';

  const { text } = await callAgent({ system, user, maxTokens: 420 });
  let parsed = {};
  try {
    const m = String(text).match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : {};
  } catch { /* fall through to defaults */ }

  return saveMemo(uid, {
    participants: [dialogue.a, dialogue.b],
    topic: dialogue.topic,
    ticker: dialogue.ticker || null,
    keyPoints: (parsed.keyPoints || []).slice(0, 4).map((s) => String(s).slice(0, 160)),
    conclusion: String(parsed.conclusion || '').slice(0, 300)
      || 'No conclusion reached.',
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5)),
    actionable: !!parsed.actionable,
    tags: (parsed.tags || []).slice(0, 5).map((s) => String(s).slice(0, 24)),
    turns: dialogue.turns.map((t) => ({ agent: t.agent, name: t.name, text: t.text })),
  });
}

/* -------------------------------------------------------------- convene */
export async function convene(uid, override = null) {
  if (active) return { skipped: 'A conversation is already in progress.', activeDialogue: active };
  const pairing = override || (await pickPairing(uid));
  if (!pairing) return { skipped: 'Nothing worth convening about yet — no holdings.' };

  try {
    const dialogue = await runDialogue(uid, pairing);
    if (!dialogue.turns.length) throw new Error('no turns produced');
    if (active) active.phase = 'writing';   // they're writing the note up
    const memo = await distill(uid, dialogue);
    const finished = { ...dialogue, memo, finishedAt: Date.now() };
    recent.unshift(finished);
    recent.length = Math.min(recent.length, 5);
    if (active) active.memo = memo;
    return { ok: true, dialogue: finished, memo };
  } finally {
    // keep it on screen so the room can play the scene out
    releaseAfterHold();
  }
}

// Recent analyses feed the "who should talk" heuristic later; exported for tests.
export async function recentVerdicts(uid, limit = 20) {
  try {
    const snap = await db.collection(`users/${uid}/analyses`).get();
    return snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, limit);
  } catch {
    return [];
  }
}
