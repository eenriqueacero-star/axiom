import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthProvider';

/** Live notification feed — the source for the Alerts tab, the bell, and the Pulse strip. */
export function useNotifications(max = 60) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);

  useEffect(() => {
    if (!user) { setItems([]); return; }
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
