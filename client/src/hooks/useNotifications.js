import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthProvider';
import { DEV_KEY, getNotifications } from '../api';

/** Live notification feed — Firestore realtime normally; REST poll in dev-key mode. */
export function useNotifications(max = 60) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!user) { setItems([]); return; }

    if (DEV_KEY) {
      let alive = true;
      const pull = () => getNotifications(max)
        .then((r) => alive && setItems(r.notifications || []))
        .catch(() => {});
      pull();
      const id = setInterval(pull, 20000);
      return () => { alive = false; clearInterval(id); };
    }

    const q = query(
      collection(db, `users/${user.uid}/notifications`),
      orderBy('ts', 'desc'),
      limit(max),
    );
    return onSnapshot(q, (snap) => {
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    }, () => {});
  }, [user, max]);

  const unread = useMemo(() => items.filter((n) => !n.read).length, [items]);
  return { items, unread };
}
