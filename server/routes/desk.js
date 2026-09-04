import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { convene, deskState, pickPairing } from '../lib/dialogue.js';
import { listMemos, deleteMemo } from '../lib/memos.js';
import { budgetStatus } from '../lib/budget.js';
import { AGENTS } from '../agents/definitions.js';
import { runDeskNight, lastDeskWork } from '../lib/desk/night.js';
import { getPlaybooks } from '../lib/desk/playbooks.js';
import { markUserActivity } from '../lib/budget.js';
import { listVault } from '../lib/desk/vault.js';
import { listThreads, getThread, createThread, createExecutionThread, postMessage, resolveThread } from '../lib/desk/bossChat.js';
import { db } from '../lib/firebase.js';
import { triageSignal, listEventJobs } from '../lib/desk/triage.js';
import { listOpportunities } from '../lib/desk/sweep.js';

const router = Router();
router.use(verifyToken);

// Last night's work — the boss's brief + each analyst's assignment and findings.
router.get('/work', async (req, res) => {
  try {
    res.json({ work: await lastDeskWork(req.uid) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Every analyst's current self-authored playbook + its version history.
router.get('/playbooks', async (req, res) => {
  try {
    res.json({ playbooks: await getPlaybooks(req.uid, AGENTS.map((a) => a.id)) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Run the nightly desk pass now (manual trigger — ~90s).
const running = new Set();
router.post('/run-night', async (req, res) => {
  markUserActivity();
  if (running.has(req.uid)) return res.json({ started: false, alreadyRunning: true });
  running.add(req.uid);
  runDeskNight(req.uid)
    .catch((err) => console.error('[desk-night:manual]', err.message))
    .finally(() => running.delete(req.uid));
  res.json({ started: true });
});

// What's happening at the table right now — polled by the 3D room.
router.get('/state', async (req, res) => {
  try {
    const state = deskState();
    const notes = await listMemos(req.uid, 12);
    res.json({ ...state, notes });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// All desk notes.
router.get('/notes', async (req, res) => {
  try {
    res.json({ notes: await listMemos(req.uid, 50) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// What the council would talk about, without running it.
router.get('/next', async (req, res) => {
  try {
    res.json({ pairing: await pickPairing(req.uid) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Run one conversation now. Takes ~10-20s (4 turns + a distill call).
router.post('/convene', async (req, res) => {
  try {
    res.json(await convene(req.uid));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// How much Groq budget the autonomous desk has left today.
router.get('/budget', (_req, res) => res.json(budgetStatus()));

// Recent event-desk jobs — the events the boss put the analysts on.
router.get('/events', async (req, res) => {
  try {
    res.json({ events: await listEventJobs(req.uid, 15) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Opportunities the boss flagged sweeping the inbox — held names to act on + new names to buy.
router.get('/opportunities', async (req, res) => {
  try {
    res.json({ opportunities: await listOpportunities(req.uid, 12) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- The vault: events the boss looked at and set aside. ---------------------
router.get('/vault', async (req, res) => {
  try {
    res.json({ vault: await listVault(req.uid, 50) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// --- Private chat with the boss --------------------------------------------
router.get('/chats', async (req, res) => {
  try {
    res.json({ threads: await listThreads(req.uid) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/chats', async (req, res) => {
  try {
    res.json({ thread: await createThread(req.uid, { title: String(req.body?.title || 'Boss').slice(0, 80) }) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/chats/:id', async (req, res) => {
  try {
    const t = await getThread(req.uid, req.params.id);
    if (!t) return res.status(404).json({ error: 'no such thread' });
    res.json({ thread: t });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/chats/:id/message', async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'empty message' });
  const c = req.body?.context;
  const viewContext = (c && typeof c === 'object')
    ? { view: String(c.view || '').slice(0, 40), focus: String(c.focus || '').slice(0, 200) }
    : undefined;
  try {
    const r = await postMessage(req.uid, req.params.id, text, viewContext);
    if (!r) return res.status(404).json({ error: 'no such thread' });
    res.json(r);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// "Proceed" on a council verdict — open an execution thread with the boss.
router.post('/execute', async (req, res) => {
  const ticker = String(req.body?.ticker || '').toUpperCase();
  if (!/^[A-Z.\-]{1,10}$/.test(ticker)) return res.status(400).json({ error: 'bad ticker' });
  markUserActivity();
  try {
    const snap = await db.collection(`users/${req.uid}/analyses`).where('ticker', '==', ticker).get();
    const latest = snap.docs.map((d) => d.data()).sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
    if (!latest) return res.status(404).json({ error: 'no analysis for that name yet' });
    const thread = await createExecutionThread(req.uid, latest);
    res.json({ threadId: thread.id });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/chats/:id/resolve', async (req, res) => {
  try {
    res.json(await resolveThread(req.uid, req.params.id, req.body?.outcome === 'act' ? 'act' : 'archive'));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Manually hand something to the event desk (from the UI).
router.post('/triage', async (req, res) => {
  const { ticker, headline, url, source } = req.body || {};
  if (!headline) return res.status(400).json({ error: 'need a headline' });
  markUserActivity();
  triageSignal(req.uid, { ticker, headline: String(headline).slice(0, 300), url, source: source || 'manual', kind: 'manual', thesis: true })
    .catch((e) => console.error('[event-desk:manual]', e.message));
  res.json({ started: true });
});

// Drop a note the council shouldn't be carrying around any more.
router.delete('/notes/:id', async (req, res) => {
  try {
    await deleteMemo(req.uid, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
