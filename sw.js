/* Dayli service worker: offline shell, push, and notification actions. */

const CACHE = 'dayli-v12';

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
  './js/week-parser.js',
  './js/pet-stage.js',
  './js/cube-pet.js',
  './js/pet-palette.js',
  './js/celebrations.js',
  './js/sounds.js',
  './js/shop.js',
  './js/accessories.js',
  './vendor/three.module.js',
  './vendor/examples/jsm/loaders/GLTFLoader.js',
  './vendor/examples/jsm/utils/BufferGeometryUtils.js',
  './vendor/examples/jsm/libs/meshopt_decoder.module.js',
  './models/dog.glb',
  './models/cat.glb',
  './models/bunny.glb',
  './models/penguin.glb',
  './models/monkey.glb',
  './models/tiger.glb',
  './models/pig.glb',
  './models/lion.glb',
  './models/panda.glb',
  './models/fox.glb',
  './models/koala.glb',
  './models/chick.glb',
  './models/Textures/colormap.png',
  './items/glbs/mini/aid-glasses.glb',
  './items/glbs/mini/aid-sunglasses.glb',
  './items/glbs/mini/Textures/colormap.png',
  './items/glbs/holiday/snowman-hat.glb',
  './items/glbs/holiday/snowflake-a.glb',
  './items/glbs/holiday/snowflake-b.glb',
  './items/glbs/holiday/snowflake-c.glb',
  './items/glbs/holiday/Textures/colormap.png',
  './items/glbs/platformer/heart.glb',
  './items/glbs/platformer/star.glb',
  './items/glbs/platformer/jewel.glb',
  './items/glbs/platformer/Textures/colormap.png',
  './items/thumbs/thumb_party_hat.png',
  './items/thumbs/thumb_round_glasses.png',
  './items/thumbs/thumb_bow_tie.png',
  './items/thumbs/thumb_beanie.png',
  './items/thumbs/thumb_heart_cheeks.png',
  './items/thumbs/thumb_bell_collar.png',
  './items/thumbs/thumb_cap.png',
  './items/thumbs/thumb_backpack.png',
  './items/thumbs/thumb_sunglasses.png',
  './items/thumbs/thumb_scarf.png',
  './items/thumbs/thumb_flower_crown.png',
  './items/thumbs/thumb_tutu.png',
  './items/thumbs/thumb_hero_mask.png',
  './items/thumbs/thumb_hearts.png',
  './items/thumbs/thumb_sweater.png',
  './items/thumbs/thumb_top_hat.png',
  './items/thumbs/thumb_sparkles.png',
  './items/thumbs/thumb_cape.png',
  './items/thumbs/thumb_grad_cap.png',
  './items/thumbs/thumb_snowfall.png',
  './items/thumbs/thumb_wings.png',
  './items/thumbs/thumb_wizard_hat.png',
  './items/thumbs/thumb_jetpack.png',
  './items/thumbs/thumb_sprout.png',
  './items/thumbs/thumb_flame_band.png',
  './items/thumbs/thumb_star_medal.png',
  './items/thumbs/thumb_rainbow_aura.png',
  './items/thumbs/thumb_crown.png',
  './items/thumbs/thumb_golden_wings.png',
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
  // Separate prototype: never intercept or cache /pets-preview/.
  if (url.pathname.includes('/pets-preview')) return;
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
