/**
 * Developer-only channel. Guarded by a shared secret (DEV_KEY) in the
 * x-dev-key header — NOT user auth. Lets the developer talk to the boss and
 * inspect the context he's given, to verify changes without driving the UI.
 *
 * Disabled entirely if DEV_KEY is unset.
 */
import { Router } from 'express';
import { db } from '../lib/firebase.js';
import { firmContext } from '../lib/desk/night.js';
import { createThread, postMessage, getThread } from '../lib/desk/bossChat.js';
import { notify, listNotifications } from '../lib/notify.js';

const router = Router();

router.use((req, res, next) => {
  const key = process.env.DEV_KEY;
  if (!key) return res.status(404).json({ error: 'dev channel disabled' });
  if (req.get('x-dev-key') !== key) return res.status(403).json({ error: 'bad dev key' });
  next();
});

// Resolve the target user — an explicit id, or the sole user if there's one.
async function resolveUid(explicit) {
  if (explicit) return explicit;
  const snap = await db.collection('users').get();
  if (snap.size === 1) return snap.docs[0].id;
  throw new Error(`${snap.size} users — pass "uid"`);
}

// The exact context string the boss/desk get for this user.
router.get('/context', async (req, res) => {
  try {
    const uid = await resolveUid(req.query.uid);
    res.json({ uid, context: await firmContext(uid) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Talk to the boss. Body: { message, threadId?, uid? }. Reuses a thread if given.
router.post('/boss', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) return res.status(400).json({ error: 'message required' });
  try {
    const uid = await resolveUid(req.body?.uid);
    let threadId = req.body?.threadId;
    if (!threadId) {
      const t = await createThread(uid, { title: 'Dev channel' });
      threadId = t.id;
    }
    const r = await postMessage(uid, threadId, message);
    if (!r) return res.status(404).json({ error: 'thread not found' });
    res.json({
      uid, threadId, reply: r.reply,
      consulted: (r.consulted || []).map((c) => ({ name: c.name, answer: c.answer })),
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Fire a test notification (real feed entry + push) to the user.
router.post('/push-test', async (req, res) => {
  try {
    const uid = await resolveUid(req.body?.uid);
    const r = await notify(uid, {
      kind: 'desk',
      severity: 'critical',
      title: req.body?.title || 'Axiom — test',
      body: req.body?.body || 'End-to-end notification check. If you can read this in the feed, the chain works.',
      dedupeKey: `dev-test:${Date.now()}`,
    });
    res.json({ uid, ...r });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Inspect the notification feed.
router.get('/notifications', async (req, res) => {
  try {
    const uid = await resolveUid(req.query.uid);
    const items = await listNotifications(uid, 30);
    res.json({ uid, count: items.length, items: items.map((n) => ({ ts: n.ts, kind: n.kind, severity: n.severity, title: n.title, pushed: n.pushed || false, read: n.read })) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Inspect the analyses collection for junk tickers.
router.get('/analyses', async (req, res) => {
  try {
    const uid = await resolveUid(req.query.uid);
    const snap = await db.collection(`users/${uid}/analyses`).get();
    const byTicker = {};
    const suspect = [];
    for (const d of snap.docs) {
      const a = d.data();
      const t = a.ticker || '(none)';
      byTicker[t] = (byTicker[t] || 0) + 1;
      if (!/^[A-Z][A-Z.\-]{0,5}$/.test(t)) {
        suspect.push({ id: d.id, ticker: t, verdict: a.verdict, ts: a.ts, trigger: a.trigger || null });
      }
    }
    res.json({ uid, total: snap.size, tickers: byTicker, suspect });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Delete specific analysis docs by id (after inspecting via GET /analyses).
router.post('/analyses/purge', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: 'ids[] required' });
  try {
    const uid = await resolveUid(req.body?.uid);
    await Promise.all(ids.map((id) => db.doc(`users/${uid}/analyses/${id}`).delete().catch(() => {})));
    res.json({ uid, deleted: ids.length });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Read a thread back.
router.get('/boss/:id', async (req, res) => {
  try {
    const uid = await resolveUid(req.query.uid);
    const t = await getThread(uid, req.params.id);
    if (!t) return res.status(404).json({ error: 'not found' });
    res.json({
      threadId: t.id,
      messages: (t.messages || []).map((m) => ({ role: m.role, name: m.name || null, content: m.content })),
    });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

export default router;
