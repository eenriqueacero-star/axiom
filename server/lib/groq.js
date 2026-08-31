import Groq from 'groq-sdk';

const MODEL_BASE  = 'openai/gpt-oss-120b';
const MODEL_SYNTH = 'openai/gpt-oss-120b';
const MODEL_SEARCH = 'groq/compound';
const GROQ_URL    = 'https://api.groq.com/openai/v1/chat/completions';
const COMPOUND_CAP = 600;

// Deterministic sampling — the same facts must produce the same verdict
// (definitions.js STABILITY RULE). temperature:0 + a fixed seed.
const DETERMINISM = { temperature: 0, seed: 42, top_p: 1 };

function getKeys() {
  return [
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEY_4,
    process.env.GROQ_API_KEY_5,
  ].filter(Boolean);
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
  return data.choices?.[0]?.message?.content || '';
}

async function callCompound(apiKey, system, user, maxTokens) {
  const client = new Groq({ apiKey });
  const c = await client.chat.completions.create({
    model: MODEL_SEARCH, max_tokens: maxTokens,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    ...DETERMINISM,
  });
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

  for (let k = 0; k < keyOrder.length; k++) {
    try {
      let text = await callBase(keyOrder[k], system, user, maxTokens, effort);
      if (!text) { await sleep(500); text = await callBase(keyOrder[k], system, user, maxTokens, effort); }
      return { text, grounded: false };
    } catch (err) {
      if (err.status === 429 && k < keyOrder.length - 1) continue;
      if (err.status === 429) { await sleep(8000); continue; }
      return { text: '', grounded: false, warning: `Agent error: ${err.message}` };
    }
  }
  return { text: '', grounded: false, warning: 'All keys exhausted' };
}

// --- Key health --------------------------------------------------------------

let _keyCache = { ts: 0, data: null };

async function probeKey(apiKey, i) {
  const started = Date.now();
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const ms = Date.now() - started;
    if (res.ok) return { index: i + 1, ok: true, status: res.status, ms };
    const body = await res.json().catch(() => ({}));
    return { index: i + 1, ok: false, status: res.status, ms, error: body.error?.message || `HTTP ${res.status}` };
  } catch (err) {
    return { index: i + 1, ok: false, status: 0, ms: Date.now() - started, error: err.message };
  }
}

// Checks every configured Groq key against the API. Cached for 60s.
export async function checkGroqKeys({ force = false } = {}) {
  if (!force && _keyCache.data && Date.now() - _keyCache.ts < 60_000) return _keyCache.data;

  const keys = getKeys();
  const slots = [
    'GROQ_API_KEY', 'GROQ_API_KEY_2', 'GROQ_API_KEY_3', 'GROQ_API_KEY_4', 'GROQ_API_KEY_5',
  ];
  const configured = slots.filter(s => process.env[s]);
  const results = await Promise.all(keys.map((k, i) => probeKey(k, i)))
    .then(rs => rs.map((r, i) => ({ ...r, name: configured[i] || `key ${i + 1}` })));

  const data = {
    total: keys.length,
    live: results.filter(r => r.ok).length,
    checkedAt: Date.now(),
    keys: results,
  };
  _keyCache = { ts: Date.now(), data };
  return data;
}

export async function callSynthesis({ system, user, maxTokens = 2000 }) {
  const keys = getKeys();
  const key = keys[keys.length - 1];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL_SYNTH, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, reasoning_effort: 'medium', ...DETERMINISM }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw Object.assign(new Error(e.error?.message), { status: res.status }); }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (err) {
      if (attempt === 0) { await sleep(err.status === 429 ? 20000 : 2000); continue; }
      throw err;
    }
  }
}
