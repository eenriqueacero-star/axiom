import { getAuth } from 'firebase-admin/auth';
import { firebaseReady, db } from './firebase.js';

// Dev bypass: a request carrying x-dev-key == DEV_KEY is treated as the sole
// user. Lets the redesign be driven from browser automation (no Google popup).
// Inert unless DEV_KEY is set. Resolved once, cached.
let cachedDevUid = null;
async function devUid() {
  if (cachedDevUid) return cachedDevUid;
  try {
    const snap = await db.collection('users').get();
    if (snap.size === 1) cachedDevUid = snap.docs[0].id;
    return cachedDevUid;
  } catch {
    return null; // never cache a failed/ambiguous lookup — retry next request
  }
}

export async function verifyToken(req, res, next) {
  const key = process.env.DEV_KEY;
  if (key && req.get('x-dev-key') === key) {
    const uid = await devUid();
    if (uid) { req.uid = uid; return next(); }
    return res.status(409).json({ error: 'dev-key auth needs exactly one user' });
  }

  if (!firebaseReady) return res.status(503).json({ error: 'Auth not configured' });
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = await getAuth().verifyIdToken(header.slice(7));
    req.uid = decoded.uid;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
