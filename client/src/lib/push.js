import { getVapidPublic, subscribePush, unsubscribePush } from '../api';

export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function urlB64ToUint8Array(base64) {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function ready() {
  await navigator.serviceWorker.register('/sw.js').catch(() => {});
  return navigator.serviceWorker.ready;
}

/** Current state: 'unsupported' | 'denied' | 'off' | 'on'. */
export async function pushState() {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await ready();
    const sub = await reg.pushManager.getSubscription();
    return sub ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

/** Ask permission, subscribe this device, tell the server. Returns the new state. */
export async function enablePush() {
  if (!pushSupported()) return 'unsupported';

  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';

  const { key } = await getVapidPublic();
  const reg = await ready();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(key),
    });
  }
  await subscribePush(sub.toJSON());
  return 'on';
}

/** Unsubscribe this device. */
export async function disablePush() {
  try {
    const reg = await ready();
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await unsubscribePush(sub.endpoint).catch(() => {});
      await sub.unsubscribe().catch(() => {});
    }
  } catch { /* ignore */ }
  return 'off';
}
