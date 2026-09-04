import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyToken } from '../lib/auth.js';
import { checkGroqKeys } from '../lib/groq.js';
import { jobsHealth, runJobByName, JOB_META } from '../jobs/heartbeat.js';
import { db } from '../lib/firebase.js';

const router = Router();
router.use(verifyToken);

const WEEK_MS = 7 * 24 * 3600 * 1000;

// Scheduled-job health — is everything running, and what failed + why.
router.get('/jobs', async (_req, res) => {
  try {
    res.json(await jobsHealth());
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Edit a job's schedule override. Body { enabled?, everyMs?, hours?, weekdaysOnly? };
// a null/absent value for a key resets that key to the coded default.
router.patch('/jobs/:name', async (req, res) => {
  const { name } = req.params;
  if (!JOB_META[name]) return res.status(404).json({ error: 'no such job' });

  const body = req.body || {};
  const patch = {};
  try {
    // enabled
    if (body.enabled == null) patch.enabled = FieldValue.delete();
    else if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    else throw new Error('enabled must be a boolean');

    // everyMs
    if (body.everyMs == null) patch.everyMs = FieldValue.delete();
    else if (typeof body.everyMs === 'number' && Number.isFinite(body.everyMs)
      && body.everyMs >= 60_000 && body.everyMs <= WEEK_MS) patch.everyMs = body.everyMs;
    else throw new Error('everyMs must be a number between 60000 and 604800000');

    // hours
    if (body.hours == null) patch.hours = FieldValue.delete();
    else if (Array.isArray(body.hours) && body.hours.length === 2
      && body.hours.every((h) => Number.isInteger(h) && h >= 0 && h <= 23)) patch.hours = body.hours;
    else throw new Error('hours must be a 2-element array of integers 0-23');

    // weekdaysOnly
    if (body.weekdaysOnly == null) patch.weekdaysOnly = FieldValue.delete();
    else if (typeof body.weekdaysOnly === 'boolean') patch.weekdaysOnly = body.weekdaysOnly;
    else throw new Error('weekdaysOnly must be a boolean');
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    await db.doc('state/schedule').set(
      { overrides: { [name]: patch }, updatedAt: Date.now() },
      { merge: true },
    );
    const health = await jobsHealth();
    res.json(health.jobs.find((j) => j.name === name) || null);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Run a job right now.
router.post('/jobs/:name/run', async (req, res) => {
  try {
    const r = await runJobByName(req.params.name, 'manual');
    if (r.error === 'no such job') return res.status(404).json(r);
    res.json(r);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Per-key Groq health. ?force=1 skips the 60s cache.
router.get('/groq-keys', async (req, res) => {
  try {
    const data = await checkGroqKeys({ force: req.query.force === '1' });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
