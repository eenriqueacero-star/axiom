import { Router } from 'express';
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

router.post('/subscribe', verifyToken, async (req, res) => {
  if (!pushReady) return res.status(503).json({ error: 'Push not configured' });
  const { subscription } = req.body;
  if (!subscription) return res.status(400).json({ error: 'subscription required' });
  await db.doc(`users/${req.uid}/push/subscription`).set({ subscription, updatedAt: Date.now() });
  res.json({ ok: true });
});

router.post('/unsubscribe', verifyToken, async (req, res) => {
  await db.doc(`users/${req.uid}/push/subscription`).delete().catch(() => {});
  res.json({ ok: true });
});

// Internal use — send a push to a specific uid
export async function sendPush(uid, payload) {
  if (!pushReady || !db) return;
  try {
    const snap = await db.doc(`users/${uid}/push/subscription`).get();
    if (!snap.exists) return;
    const { subscription } = snap.data();
    await webpush.sendNotification(subscription, JSON.stringify(payload));
  } catch (err) {
    if (err.statusCode === 410) {
      await db.doc(`users/${uid}/push/subscription`).delete().catch(() => {});
    }
  }
}

export default router;
