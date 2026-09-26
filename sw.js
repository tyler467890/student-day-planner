/* Dayli service worker: offline shell, push, and notification actions. */

const CACHE = 'dayli-v2';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/config.js',
  './js/model.js',
  './js/db.js',
  './js/push.js',
  './js/app.js',
  './fonts/fonts.css',
  './fonts/OFL.txt',
  './fonts/nunito-400.woff2',
  './fonts/nunito-600.woff2',
  './fonts/nunito-700.woff2',
  './fonts/inter-400.woff2',
  './fonts/inter-600.woff2',
  './fonts/inter-700.woff2',
  './fonts/lexend-400.woff2',
  './fonts/lexend-600.woff2',
  './fonts/lexend-700.woff2',
  './fonts/caveat-600.woff2',
  './fonts/caveat-700.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const fresh = await fetch(request);
      if (fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    } catch {
      const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw new Error('offline');
    }
  })());
});

self.addEventListener('push', (event) => {
  let payload = { title: 'Coming up', body: 'You have something coming up' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch { /* keep the generic text */ }
  event.waitUntil(self.registration.showNotification(payload.title || 'Coming up', {
    body: payload.body || '',
    tag: payload.tag || payload.id || 'dayli',
    data: payload,
    actions: [
      { action: 'done', title: 'Done' },
      { action: 'snooze', title: 'Snooze' },
    ],
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const action = event.action || 'open';
  const url = new URL('./', self.registration.scope);
  url.searchParams.set('action', action === 'done' || action === 'snooze' ? action : 'open');
  if (data.taskId) url.searchParams.set('task', data.taskId);
  if (data.date) url.searchParams.set('date', data.date);
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (client.url && 'focus' in client) {
        if (client.navigate) {
          try { await client.navigate(url.href); } catch { /* fall through */ }
        }
        client.postMessage({ type: 'notification', action, data });
        return client.focus();
      }
    }
    return self.clients.openWindow(url.href);
  })());
});
