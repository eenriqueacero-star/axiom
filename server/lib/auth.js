import { getAuth } from 'firebase-admin/auth';
import { firebaseReady } from './firebase.js';

export async function verifyToken(req, res, next) {
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
