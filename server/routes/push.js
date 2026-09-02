import { Router } from 'express';
import crypto from 'node:crypto';
import webpush from 'web-push';
import { verifyToken } from '../lib/auth.js';
import { db } from '../lib/firebase.js';

const router = Router();

const pushReady = Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (pushReady) {
  webpush.setVapidDetails(
    'mailto:' + (process.env.VAPID_EMAIL || 'admin@axiom.app'),
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
} else {
  console.warn('[push] VAPID keys missing — push notifications disabled');
}

const subId = (endpoint) => crypto.createHash('sha1').update(endpoint).digest('hex').slice(0, 24);
const subsCol = (uid) => db.collection(`users/${uid}/pushSubs`);

// The public VAPID key — the client needs it to subscribe, and fetching it
// guarantees it matches the private key the server signs with.
router.get('/vapid-public', (_req, res) => {
  if (!pushReady) return res.status(503).json({ error: 'Push not configured' });
  res.json({ key: process.env.VAPID_PUBLIC_KEY });
});

router.use(verifyToken);

// Register (or refresh) a device. Keyed by endpoint hash → one row per browser.
router.post('/subscribe', async (req, res) => {
  if (!pushReady) return res.status(503).json({ error: 'Push not configured' });
  const sub = req.body?.subscription;
  if (!sub?.endpoint) return res.status(400).json({ error: 'subscription required' });
  await subsCol(req.uid).doc(subId(sub.endpoint)).set({
    subscription: sub,
    ua: String(req.get('user-agent') || '').slice(0, 200),
    updatedAt: Date.now(),
  });
  res.json({ ok: true });
});

router.post('/unsubscribe', async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (endpoint) {
    await subsCol(req.uid).doc(subId(endpoint)).delete().catch(() => {});
  } else {
    // no endpoint → drop every device (and the legacy single-doc)
    const snap = await subsCol(req.uid).get().catch(() => ({ docs: [] }));
    await Promise.all(snap.docs.map((d) => d.ref.delete().catch(() => {})));
  }
  await db.doc(`users/${req.uid}/push/subscription`).delete().catch(() => {});
  res.json({ ok: true });
});

// How many devices are registered — drives the toggle state in the UI.
router.get('/status', async (req, res) => {
  if (!pushReady) return res.json({ configured: false, devices: 0 });
  const snap = await subsCol(req.uid).get().catch(() => ({ size: 0 }));
  const legacy = await db.doc(`users/${req.uid}/push/subscription`).get().catch(() => ({ exists: false }));
  res.json({ configured: true, devices: (snap.size || 0) + (legacy.exists ? 1 : 0) });
});

/**
 * Send `payload` to every device a user has registered. Dead subscriptions
 * (404/410) are pruned. Returns the number that went out.
 */
export async function sendPush(uid, payload) {
  if (!pushReady || !db) return 0;
  const body = JSON.stringify(payload);

  const targets = [];
  try {
    const snap = await subsCol(uid).get();
    for (const d of snap.docs) targets.push({ ref: d.ref, sub: d.data().subscription });
  } catch { /* ignore */ }
  try {
    const legacy = await db.doc(`users/${uid}/push/subscription`).get();
    if (legacy.exists) targets.push({ ref: legacy.ref, sub: legacy.data().subscription });
  } catch { /* ignore */ }

  let sent = 0;
  await Promise.all(targets.map(async ({ ref, sub }) => {
    if (!sub?.endpoint) return;
    try {
      await webpush.sendNotification(sub, body);
      sent++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await ref.delete().catch(() => {});
      } else {
        console.error(`[push] send failed (${err.statusCode || '?'}) for ${uid.slice(0, 6)}…`);
      }
    }
  }));
  return sent;
}

export default router;
