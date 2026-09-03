import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { convene, deskState, pickPairing } from '../lib/dialogue.js';
import { listMemos, deleteMemo } from '../lib/memos.js';
import { budgetStatus } from '../lib/budget.js';
import { AGENTS } from '../agents/definitions.js';
import { runDeskNight, lastDeskWork } from '../lib/desk/night.js';
import { getPlaybooks } from '../lib/desk/playbooks.js';
import { markUserActivity } from '../lib/budget.js';

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
