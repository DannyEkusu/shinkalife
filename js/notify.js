// Three separate tiers: (1) in-app toasts while the app is open, (2) browser notifications while a tab/PWA is alive (this file),
// (3) server push when the app is closed: NOT implemented here; needs a server function + VAPID keys (see docs/NOTIFICATIONS_AND_ANDROID.md).
export const supported = () => typeof Notification !== 'undefined';
export const permission = () => (supported() ? Notification.permission : 'unsupported');
export const request = async () => (supported() ? Notification.requestPermission() : 'unsupported');
export async function show(title, body) {
  if (permission() !== 'granted') return false;
  try { const reg = await navigator.serviceWorker?.getRegistration?.(); if (reg?.showNotification) await reg.showNotification(title, { body, icon: 'assets/icon-192.png', tag: title + body }); else new Notification(title, { body }); return true; } catch { return false; }
}
