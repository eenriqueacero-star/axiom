// Tiny ring-buffer log for diagnosing notification routing on devices where we
// can't see a console (iOS PWA). Read it in System Status → Notification routing.
const KEY = 'axiom-navlog';

export function navlog(msg) {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]');
    arr.unshift(`${new Date().toLocaleTimeString()} · ${msg}`);
    localStorage.setItem(KEY, JSON.stringify(arr.slice(0, 40)));
  } catch { /* ignore */ }
}

export function navlogRead() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}

export function navlogClear() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}

export async function swReport() {
  const out = { supported: 'serviceWorker' in navigator };
  if (!out.supported) return out;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    out.controller = navigator.serviceWorker.controller?.scriptURL || null;
    out.active = reg?.active?.scriptURL || null;
    out.waiting = !!reg?.waiting;
    out.installing = !!reg?.installing;
  } catch (e) { out.error = e.message; }
  try {
    const cache = await caches.open('axiom-nav');
    const res = await cache.match('pending');
    out.pendingNav = res ? await res.text() : null;
    const sl = await cache.match('sw-log');
    out.swLog = sl ? JSON.parse(await sl.text()) : [];
  } catch (e) { out.cacheError = e.message; }
  out.standalone = window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  return out;
}
