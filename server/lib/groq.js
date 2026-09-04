import Groq from 'groq-sdk';
import { recordCall, keyCount, addTokens } from './budget.js';

const MODEL_BASE  = 'openai/gpt-oss-120b';
const MODEL_SYNTH = 'openai/gpt-oss-120b';
const MODEL_SEARCH = 'groq/compound';
const GROQ_URL    = 'https://api.groq.com/openai/v1/chat/completions';
const COMPOUND_CAP = 600;

// NVIDIA NIM — free OpenAI-compatible fallback. Serves the same gpt-oss-120b, so
// it's a drop-in when Groq's free keys are rate-limited. Set NVIDIA_API_KEY
// (one or more, comma-separated) from build.nvidia.com.
const NVIDIA_URL   = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_MODEL = 'openai/gpt-oss-120b';
// Stronger model for the judgment-heavy calls (AXIOM synthesis, the boss's
// nightly assignments + brief). Free on NIM, slower than gpt-oss-120b.
const NVIDIA_SYNTH_MODEL = process.env.NVIDIA_SYNTH_MODEL || 'nvidia/nemotron-3-super-120b-a12b';
const nvidiaKeys = () =>
  (process.env.NVIDIA_API_KEY || '').split(',').map((s) => s.trim()).filter(Boolean);
// Set SYNTH_PROVIDER=nvidia on the backend to route synthesis through the
// strong model first (Groq stays the fallback). Default keeps Groq primary.
const synthNvidiaFirst = () => process.env.SYNTH_PROVIDER === 'nvidia' && nvidiaKeys().length > 0;

async function callNvidia(system, user, maxTokens, effort = 'low', model = NVIDIA_MODEL) {
  const keys = nvidiaKeys();
  if (!keys.length) throw Object.assign(new Error('no NVIDIA key'), { status: 0 });
  recordCall({ autonomous: !!callBase.autonomous });
  for (const key of shuffled(keys)) {
    try {
      const res = await fetch(NVIDIA_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          max_tokens: maxTokens, temperature: 0, top_p: 1,
          ...(effort ? { reasoning_effort: effort } : {}),
        }),
      });
      if (res.status === 429) continue;
      if (!res.ok) throw Object.assign(new Error(`NVIDIA ${res.status}`), { status: res.status });
      const data = await res.json();
      addTokens(data.usage?.total_tokens ?? estimateTokens(system, user, maxTokens));
      return data.choices?.[0]?.message?.content || '';
    } catch (err) {
      if (err.status === 429) continue;
      throw err;
    }
  }
  throw Object.assign(new Error('all NVIDIA keys rate-limited'), { status: 429 });
}

// Deterministic sampling — the same facts must produce the same verdict
// (definitions.js STABILITY RULE). temperature:0 + a fixed seed.
const DETERMINISM = { temperature: 0, seed: 42, top_p: 1 };

function getKeys() {
  return trackKeys([
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4,
    process.env.GROQ_API_KEY_5,
  ]);
}

function trackKeys(list) {
  const keys = list.filter(Boolean);
  keyCount(keys.length);
  return keys;
}

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Rough fallback when a response has no usage block (~4 chars/token) — the
// real count from data.usage.total_tokens is used whenever the API returns one.
const estimateTokens = (system, user, maxTokens) =>
  Math.ceil((String(system).length + String(user).length) / 4) + maxTokens;

function trimForCompound(system, user) {
  for (const marker of ['\nCOUNCIL HISTORY ON', '\n\nEARLIER IN THIS ROUND:', '\nSECTOR CONTEXT TODAY:', '\nMARKET TAPE TODAY:']) {
    const idx = user.indexOf(marker);
    if (idx !== -1) user = user.slice(0, idx);
  }
  if (!user.includes('Return ONLY the JSON')) user += ' Return ONLY the JSON.';
  if (system.length + user.length <= COMPOUND_CAP) return { system, user };
  const sys = system.slice(0, 250);
  const budget = COMPOUND_CAP - sys.length;
  return { system: sys, user: user.slice(0, Math.max(budget, 0)) };
}

async function callBase(apiKey, system, user, maxTokens, effort = 'low') {
  recordCall({ autonomous: !!callBase.autonomous });
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL_BASE, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, reasoning_effort: effort, ...DETERMINISM }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(err.error?.message || `Groq ${res.status}`);
    e.status = res.status;
    throw e;
  }
  const data = await res.json();
  addTokens(data.usage?.total_tokens ?? estimateTokens(system, user, maxTokens));
  return data.choices?.[0]?.message?.content || '';
}

async function callCompound(apiKey, system, user, maxTokens) {
  recordCall({ autonomous: !!callBase.autonomous });
  const client = new Groq({ apiKey });
  const c = await client.chat.completions.create({
    model: MODEL_SEARCH, max_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    ...DETERMINISM,
  });
  addTokens(c.usage?.total_tokens ?? estimateTokens(system, user, maxTokens));
  return c.choices?.[0]?.message?.content || '';
}

// Main exported call — handles search path, key rotation, retries
export async function callAgent({ system, user, useSearch = false, maxTokens = 700, agentIndex = null, effort = 'low' }) {
  const keys = getKeys();
  if (!keys.length) throw new Error('No GROQ keys configured');

  if (useSearch) {
    const { system: s, user: u } = trimForCompound(system, user);
    const key = shuffled(keys)[0];
    try {
      const text = await callCompound(key, s, u, maxTokens);
      return { text, grounded: true };
    } catch {
      const text = await callBase(key, system, u, maxTokens, effort).catch(() => '');
      return { text, grounded: false, warning: 'Ungrounded — compound failed, used base model' };
    }
  }

  const start = agentIndex !== null ? agentIndex % keys.length : 0;
  const keyOrder = agentIndex !== null
    ? [...keys.slice(start), ...keys.slice(0, start)]
    : shuffled(keys);

  let lastErr = null;
  for (let k = 0; k < keyOrder.length; k++) {
    try {
      let text = await callBase(keyOrder[k], system, user, maxTokens, effort);
      if (!text) { await sleep(500); text = await callBase(keyOrder[k], system, user, maxTokens, effort); }
      return { text, grounded: false };
    } catch (err) {
      lastErr = err;
      // 429, 5xx, network — all retryable on the next key. Only a hard 401/403
      // (bad key) is worth skipping, and even then keep trying the others.
      if (k < keyOrder.length - 1) continue;
    }
  }
  // Every Groq key failed (rate-limited or erroring) — fall through to NVIDIA.
  try {
    const text = await callNvidia(system, user, maxTokens, effort);
    return { text, grounded: false, provider: 'nvidia' };
  } catch {
    return { text: '', grounded: false, warning: `All keys exhausted (Groq: ${lastErr?.message || '?'}; NVIDIA failed)` };
  }
}

// Multi-turn chat with an agent persona. A little warmth (temp 0.4), no seed —
// this is conversation, not a verdict.
// 'low' effort — gpt-oss-120b on 'medium' routinely spends the whole token
// budget on chain-of-thought and returns an empty string for a chat-length reply.
export async function callAgentChat({ system, messages, maxTokens = 600, effort = 'low' }) {
  const keys = getKeys();
  if (!keys.length) throw new Error('No GROQ keys configured');
  const order = shuffled(keys);
  for (let k = 0; k < order.length; k++) {
    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${order[k]}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL_BASE,
          messages: [{ role: 'system', content: system }, ...messages],
          max_tokens: maxTokens, reasoning_effort: effort,
          temperature: 0.6, top_p: 1,
        }),
      });
      if (!res.ok) {
        if (res.status === 429 && k < order.length - 1) continue;
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error?.message || `Groq ${res.status}`);
      }
      const data = await res.json();
      const userText = messages.map((m) => m.content).join(' ');
      addTokens(data.usage?.total_tokens ?? estimateTokens(system, userText, maxTokens));
      return data.choices?.[0]?.message?.content || '';
    } catch (err) {
      if (k === order.length - 1) throw err;
    }
  }
  return '';
}

// --- Key health --------------------------------------------------------------

let _keyCache = { ts: 0, data: null };

async function probeKey(url, apiKey, i) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    const ms = Date.now() - started;
    if (res.ok) return { index: i + 1, ok: true, status: res.status, ms };
    const body = await res.json().catch(() => ({}));
    return { index: i + 1, ok: false, status: res.status, ms, error: body.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { index: i + 1, ok: false, status: 0, ms: Date.now() - started, error: err.message };
  }
}

// Checks every configured Groq + NVIDIA key against its API. Cached for 60s.
export async function checkGroqKeys({ force = false } = {}) {
  if (!force && _keyCache.data && Date.now() - _keyCache.ts < 60_000) return _keyCache.data;

  const keys = getKeys();
  const slots = [
    'GROQ_API_KEY', 'GROQ_API_KEY_2', 'GROQ_API_KEY_3', 'GROQ_API_KEY_4', 'GROQ_API_KEY_5',
  ];
  const configured = slots.filter(s => process.env[s]);
  const results = await Promise.all(keys.map((k, i) => probeKey('https://api.groq.com/openai/v1/models', k, i)))
    .then(rs => rs.map((r, i) => ({ ...r, provider: 'groq', name: configured[i] || `Groq ${i + 1}` })));

  const nvKeys = nvidiaKeys();
  const nvResults = await Promise.all(nvKeys.map((k, i) => probeKey(NVIDIA_URL.replace('/chat/completions', '/models'), k, i)))
    .then(rs => rs.map((r, i) => ({ ...r, provider: 'nvidia', name: nvKeys.length > 1 ? `NVIDIA ${i + 1}` : 'NVIDIA' })));

  const all = [...results, ...nvResults];
  const data = {
    total: keys.length,
    live: results.filter(r => r.ok).length,
    nvidiaTotal: nvKeys.length,
    nvidiaLive: nvResults.filter(r => r.ok).length,
    synthProvider: synthNvidiaFirst() ? 'nvidia' : 'groq',
    checkedAt: Date.now(),
    keys: all,
  };
  _keyCache = { ts: Date.now(), data };
  return data;
}

export async function callSynthesis({ system, user, maxTokens = 2000, effort = 'medium' }) {
  // When SYNTH_PROVIDER=nvidia, try the strong NIM model before Groq.
  if (synthNvidiaFirst()) {
    try {
      const text = await callNvidia(system, user, maxTokens, effort, NVIDIA_SYNTH_MODEL);
      if (text) return text;
    } catch (err) {
      if (err.status !== 429 && err.status !== 0) console.warn('[synth] nvidia-first failed:', err.message);
    }
  }
  const keys = shuffled(getKeys());
  let lastErr;
  for (const key of keys) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        recordCall({ autonomous: !!callBase.autonomous });
        const res = await fetch(GROQ_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: MODEL_SYNTH, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, reasoning_effort: effort, ...DETERMINISM }),
        });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw Object.assign(new Error(e.error?.message || `Groq ${res.status}`), { status: res.status }); }
        const data = await res.json();
        addTokens(data.usage?.total_tokens ?? estimateTokens(system, user, maxTokens));
        const text = data.choices?.[0]?.message?.content || '';
        if (text) return text;
        lastErr = new Error('empty synthesis response');
      } catch (err) {
        lastErr = err;
        if (err.status === 429) break;              // next key
        if (attempt === 0) { await sleep(2000); continue; }
        break;
      }
    }
  }
  // Every Groq key is rate-limited or failing — fall through to NVIDIA NIM
  // (strong model — this is the synthesis path, quality matters here).
  try {
    return await callNvidia(system, user, maxTokens, effort, NVIDIA_SYNTH_MODEL);
  } catch (err) {
    throw lastErr || err;
  }
}

// The desk loop flags its own calls so budget.js can meter autonomous spend
// separately from anything the user is waiting on.
export function setAutonomous(v) { callBase.autonomous = !!v; }
