/* Axiom service worker — push notifications + install shell. No offline cache;
   the app needs the network anyway. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  await self.clients.claim();
  // A new service worker took over — tell open PWAs to pull the fresh bundle.
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => {});
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
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = wins.find((w) => w.url.startsWith(self.location.origin));
    if (existing) {
      // iOS standalone PWAs ignore navigate() on a live client — post the route
      // and let the app handle it in-place. Try navigate() too for other browsers.
      try { await existing.focus(); } catch (e) { /* ignore */ }
      existing.postMessage({ type: 'axiom-nav', path });
      if ('navigate' in existing) existing.navigate(target).catch(() => {});
      return;
    }
    await self.clients.openWindow(target);
  })());
});
