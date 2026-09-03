/**
 * The one notification layer. Every alert in the app goes through notify() —
 * it writes a durable feed entry (users/{uid}/notifications), dedupes a repeat
 * of the same thing, and decides whether to push now, hold for the digest, or
 * stay feed-only, based on severity + the user's per-kind preferences.
 *
 * Replaces the scattered sendPush() calls that buried the phone in 15
 * near-identical alerts.
 *
 *   kind:     news | filing | insider | congress | move | rating | scout | desk | opportunity
 *   severity: critical (always pushes) | review (pushes unless the kind is dialed down) | fyi (feed/digest only)
 */
import { db } from './firebase.js';
import { sendPush } from '../routes/push.js';

const FEED_CAP_QUERY = 20 * 3600_000;   // dedupe window: same key within 20h updates, doesn't restack
const KINDS = ['news', 'filing', 'insider', 'congress', 'move', 'rating', 'scout', 'desk', 'opportunity'];

const DEFAULT_PREFS = {
  // 'push' → real-time when severity >= review; 'digest' → morning/close roundup only; 'off' → feed only
  kinds: {
    news: 'push', filing: 'push', insider: 'digest', congress: 'digest',
    move: 'push', rating: 'push', scout: 'digest', desk: 'push', opportunity: 'push',
  },
  quietStart: 22,   // ET hour — non-critical pushes held until quietEnd
  quietEnd: 7,
};

export async function getNotifyPrefs(uid) {
  try {
    const doc = await db.doc(`users/${uid}/state/notifyPrefs`).get();
    const p = doc.exists ? doc.data() : {};
    return {
      kinds: { ...DEFAULT_PREFS.kinds, ...(p.kinds || {}) },
      quietStart: Number.isInteger(p.quietStart) ? p.quietStart : DEFAULT_PREFS.quietStart,
      quietEnd: Number.isInteger(p.quietEnd) ? p.quietEnd : DEFAULT_PREFS.quietEnd,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function setNotifyPrefs(uid, patch) {
  const cur = await getNotifyPrefs(uid);
  const next = {
    kinds: { ...cur.kinds, ...(patch.kinds || {}) },
    quietStart: Number.isInteger(patch.quietStart) ? patch.quietStart : cur.quietStart,
    quietEnd: Number.isInteger(patch.quietEnd) ? patch.quietEnd : cur.quietEnd,
  };
  await db.doc(`users/${uid}/state/notifyPrefs`).set(next, { merge: true }).catch(() => {});
  return next;
}

function etHour() {
  return Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false,
  }).format(new Date()));
}

function inQuietHours(prefs) {
  const h = etHour();
  const { quietStart: s, quietEnd: e } = prefs;
  return s <= e ? (h >= s && h < e) : (h >= s || h < e);
}

const feedCol = (uid) => db.collection(`users/${uid}/notifications`);

/**
 * @param {string} uid
 * @param {object} n
 *   { kind, severity='review', ticker=null, title, body,
 *     refKind=null, refId=null, url=null, path=null, dedupeKey=null }
 * @returns {{ id, pushed, feedOnly?, deferred? }}
 */
export async function notify(uid, n) {
  if (!db || !uid || !n?.title) return { id: null, pushed: 0 };
  const kind = KINDS.includes(n.kind) ? n.kind : 'desk';
  const severity = ['critical', 'review', 'fyi'].includes(n.severity) ? n.severity : 'review';
  const now = Date.now();
  const ticker = n.ticker || null;
  const day = new Date(now).toISOString().slice(0, 10);
  const dedupeKey = n.dedupeKey || [kind, ticker, day].filter(Boolean).join(':');

  const doc = {
    kind, severity, ticker,
    title: String(n.title).slice(0, 140),
    body: String(n.body || '').slice(0, 300),
    refKind: n.refKind || null,
    refId: n.refId || null,
    url: n.url || null,
    path: n.path || null,
    dedupeKey, ts: now, updatedAt: now, read: false,
  };

  // dedupe — same key seen recently → bump it instead of stacking a new card.
  // Equality-only query (no composite index); the recency filter is applied in JS.
  let id;
  try {
    const dup = await feedCol(uid).where('dedupeKey', '==', dedupeKey).limit(5).get();
    const recent = dup.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((x) => now - (x.ts || 0) < FEED_CAP_QUERY)
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
    if (recent) {
      id = recent.id;
      await feedCol(uid).doc(id).set(
        { ...doc, ts: recent.ts, updatedAt: now, count: (recent.count || 1) + 1, read: false },
        { merge: true },
      );
    } else {
      const ref = await feedCol(uid).add({ ...doc, count: 1 });
      id = ref.id;
    }
  } catch (e) {
    // feed write failed — still try to push so we don't lose a critical alert
    console.error('[notify] feed write failed:', e.message);
  }

  // push decision
  const prefs = await getNotifyPrefs(uid);
  const pref = prefs.kinds[kind] || 'push';
  let push = false;
  if (severity === 'critical') push = true;
  else if (severity === 'review' && pref === 'push') push = true;
  // fyi, or kind dialed to digest/off → feed only (digest job sweeps it up)

  if (push && severity !== 'critical' && inQuietHours(prefs)) {
    return { id, pushed: 0, deferred: true };
  }
  if (!push) return { id, pushed: 0, feedOnly: true };

  const pushed = await sendPush(uid, {
    title: doc.title,
    body: doc.body,
    data: { n: id || undefined, kind, ticker: ticker || undefined },
  }).catch(() => 0);
  if (id) await feedCol(uid).doc(id).set({ pushed: true }, { merge: true }).catch(() => {});
  return { id, pushed };
}

/**
 * A burst of related items (e.g. the scout re-rating 8 holdings). More than
 * `threshold` collapses into ONE summary notification instead of N pushes.
 * Below that, each goes through notify() normally.
 *
 * @param {Array<object>} items  each an arg for notify() (must share a `kind`)
 * @param {object} summary       { title, body, path, severity } for the collapsed case
 */
export async function notifyBatch(uid, items, summary, threshold = 3) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return { pushed: 0, collapsed: false };

  if (list.length <= threshold) {
    let pushed = 0;
    for (const it of list) pushed += (await notify(uid, it)).pushed || 0;
    return { pushed, collapsed: false, count: list.length };
  }

  // write each to the feed silently, then one summary push
  for (const it of list) {
    await notify(uid, { ...it, severity: 'fyi' }).catch(() => {});
  }
  const res = await notify(uid, {
    kind: list[0].kind,
    severity: summary?.severity || 'review',
    title: summary?.title || `${list.length} updates`,
    body: summary?.body || list.map((i) => i.ticker).filter(Boolean).slice(0, 6).join(', '),
    path: summary?.path || '/?tab=notifications',
    dedupeKey: `batch:${list[0].kind}:${new Date().toISOString().slice(0, 13)}`,
  });
  return { pushed: res.pushed, collapsed: true, count: list.length, id: res.id };
}

export async function listNotifications(uid, limit = 50) {
  try {
    const snap = await feedCol(uid).orderBy('ts', 'desc').limit(Math.min(limit, 100)).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    return [];
  }
}

export async function markRead(uid, ids) {
  const list = Array.isArray(ids) ? ids : (ids ? [ids] : null);
  try {
    if (!list) {
      // mark all
      const snap = await feedCol(uid).where('read', '==', false).limit(200).get();
      await Promise.all(snap.docs.map((d) => d.ref.set({ read: true }, { merge: true })));
      return snap.size;
    }
    await Promise.all(list.map((id) => feedCol(uid).doc(id).set({ read: true }, { merge: true })));
    return list.length;
  } catch {
    return 0;
  }
}

/** Unpushed feed items since `since` — the digest job's input. */
export async function pendingDigest(uid, since) {
  try {
    const snap = await feedCol(uid)
      .where('ts', '>', since)
      .orderBy('ts', 'desc').limit(50).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => !x.pushed);
  } catch {
    return [];
  }
}

/**
 * Roll up everything that landed feed-only since the last digest into a single
 * "here's what you missed" push. Called twice a weekday (open + close) from the
 * heartbeat. Critical items already pushed in real time and are skipped here.
 */
export async function runNotifyDigest(label = 'brief') {
  if (!db) return 0;
  let users = [];
  try { users = (await db.collection('users').get()).docs.map((d) => d.id); } catch { return 0; }

  let sent = 0;
  for (const uid of users) {
    const stateRef = db.doc(`users/${uid}/state/notifyDigest`);
    const since = (await stateRef.get().catch(() => null))?.data()?.lastAt || (Date.now() - 12 * 3600_000);
    const items = await pendingDigest(uid, since);
    await stateRef.set({ lastAt: Date.now() }, { merge: true }).catch(() => {});
    if (!items.length) continue;

    const byKind = {};
    for (const it of items) byKind[it.kind] = (byKind[it.kind] || 0) + 1;
    const parts = Object.entries(byKind).map(([k, n]) => `${n} ${k}`);
    const tickers = [...new Set(items.map((i) => i.ticker).filter(Boolean))].slice(0, 6);

    const n = await sendPush(uid, {
      title: `Axiom ${label} — ${items.length} update${items.length > 1 ? 's' : ''}`,
      body: `${parts.join(', ')}${tickers.length ? ` · ${tickers.join(', ')}` : ''}`,
      data: { path: '/?tab=notifications' },
    }).catch(() => 0);
    if (n) {
      sent += n;
      await Promise.all(items.map((it) => feedCol(uid).doc(it.id).set({ pushed: true }, { merge: true }).catch(() => {})));
    }
  }
  return sent;
}
