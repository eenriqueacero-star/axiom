import { Router } from 'express';
import { verifyToken } from '../lib/auth.js';
import { db } from '../lib/firebase.js';

const router = Router();
router.use(verifyToken);

router.get('/', async (req, res) => {
  const { account } = req.query;
  let q = db.collection(`users/${req.uid}/rulings`).orderBy('ts', 'desc').limit(100);
  if (account) q = q.where('account', '==', account);
  const snap = await q.get();
  res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
});

router.post('/', async (req, res) => {
  const ruling = { ...req.body, uid: req.uid, ts: Date.now() };
  const ref = await db.collection(`users/${req.uid}/rulings`).add(ruling);
  res.json({ id: ref.id });
});

router.patch('/:id', async (req, res) => {
  await db.doc(`users/${req.uid}/rulings/${req.params.id}`).update(req.body);
  res.json({ ok: true });
});

router.delete('/:id', async (req, res) => {
  await db.doc(`users/${req.uid}/rulings/${req.params.id}`).delete();
  res.json({ ok: true });
});

export default router;
