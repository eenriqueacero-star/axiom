/* Axiom service worker — push notifications + install shell. No offline cache;
   the app needs the network anyway. */

const NAV_CACHE = 'axiom-nav';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  await self.clients.claim();
  // A new worker took over. iOS PWAs ignore client.navigate(), so ask the page
  // to reload itself and pick up the fresh bundle.
  for (const c of await self.clients.matchAll({ type: 'window' })) {
    c.postMessage({ type: 'axiom-sw-updated' });
  }
})()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { title: 'Axiom', body: event.data ? event.data.text() : '' }; }

  const title = data.title || 'Axiom';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: (data.data && data.data.ticker) || 'axiom',
      renotify: true,
      data: data.data || {},
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const path = d.n ? `/?n=${encodeURIComponent(d.n)}`
    : d.path || (d.ticker ? `/?t=${encodeURIComponent(d.ticker)}` : '/');
  const target = new URL(path, self.location.origin).href;

  event.waitUntil((async () => {
    // Stash the route where the page can read it on resume. On iOS a backgrounded
    // PWA won't act on postMessage or navigate() — but it re-reads this cache
    // whenever it becomes visible again.
    try {
      const cache = await caches.open(NAV_CACHE);
      await cache.put('pending', new Response(path, { headers: { 'content-type': 'text/plain' } }));
    } catch (e) { /* ignore */ }

    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = wins.find((w) => w.url.startsWith(self.location.origin));
    if (existing) {
      existing.postMessage({ type: 'axiom-nav', path });
      if ('navigate' in existing) existing.navigate(target).catch(() => {});
      try { await existing.focus(); } catch (e) { /* ignore */ }
      return;
    }
    await self.clients.openWindow(target);
  })());
});
