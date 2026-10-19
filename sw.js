// ShinkaLife service worker. Caches ONLY same-origin static app files. It never caches API/database responses or anything with credentials,
// so private user data is never stored by the worker. Bump VERSION when shipping; the page prompts before activating an update.
const VERSION = 'shinkalife-v4', PRECACHE = [
  './', 'index.html', 'offline.html', 'manifest.webmanifest', 'css/tokens.css', 'css/app.css', 'vendor/supabase.js',
  'assets/icon.png', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/icon-maskable-512.png',
  'js/app.js', 'js/assistant-local.js', 'js/auth.js', 'js/config.js', 'js/config-check.js', 'js/dbcheck.js', 'js/kv.js', 'js/notify.js', 'js/offline.js', 'js/pages.js', 'js/planner-ai.js', 'js/planner-core.js', 'js/quests.js', 'js/recur-core.js', 'js/reminders-core.js',
  'js/repo-mock.js', 'js/repo-supabase.js', 'js/repo.js', 'js/schedule-core.js', 'js/service.js', 'js/state.js', 'js/support.js', 'js/tasks-core.js', 'js/theme.js', 'js/ui.js', 'js/xp-core.js'];
self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(PRECACHE))));
self.addEventListener('notificationclick', e => {   // tapping a system notification brings ShinkaLife to the front
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => { const c = cs.find(x => x.url.startsWith(self.registration.scope)); return c ? c.focus() : self.clients.openWindow('./#/reminders'); }));
});
self.addEventListener('message', e => { if (e.data?.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || req.headers.has('authorization')) return;   // network only (database, auth, AI, anything cross-origin)
  if (req.mode === 'navigate') { e.respondWith(fetch(req).catch(async () => (await caches.match('index.html')) || caches.match('offline.html'))); return; }
  e.respondWith(caches.open(VERSION).then(async c => { const hit = await c.match(req); const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit || caches.match('offline.html')); return hit || net; }));
});
