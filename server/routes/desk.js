import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { convene, deskState, pickPairing } from '../lib/dialogue.js';
import { listMemos } from '../lib/memos.js';

const router = Router();
router.use(verifyToken);

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

export default router;
