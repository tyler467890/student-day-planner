/* Dayli service worker: offline shell, push, and notification actions. */

const CACHE = 'dayli-v15';

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
  './js/pet-fit.js',
  './js/accessories.js',
  './js/glb-items.js',
  './items/overrides.json',
  './items/fits.json',
  './items/v2/fits.json',
  './items/v2/backpack-lion.glb',
  './items/v2/backpack-monkey.glb',
  './items/v2/backpack-winged.glb',
  './items/v2/backpack.glb',
  './items/v2/beanie.glb',
  './items/v2/bell_collar.glb',
  './items/v2/bow_tie.glb',
  './items/v2/cap.glb',
  './items/v2/cape.glb',
  './items/v2/crown.glb',
  './items/v2/flame_band.glb',
  './items/v2/flower_crown.glb',
  './items/v2/golden_wings.glb',
  './items/v2/grad_cap.glb',
  './items/v2/heart_cheeks.glb',
  './items/v2/hero_mask-bunny.glb',
  './items/v2/hero_mask-cat.glb',
  './items/v2/hero_mask-chick.glb',
  './items/v2/hero_mask-dog.glb',
  './items/v2/hero_mask-fox.glb',
  './items/v2/hero_mask-koala.glb',
  './items/v2/hero_mask-lion.glb',
  './items/v2/hero_mask-monkey.glb',
  './items/v2/hero_mask-panda.glb',
  './items/v2/hero_mask-penguin.glb',
  './items/v2/hero_mask-pig.glb',
  './items/v2/hero_mask-tiger.glb',
  './items/v2/jetpack.glb',
  './items/v2/party_hat.glb',
  './items/v2/rainbow_aura.glb',
  './items/v2/round_glasses-bunny.glb',
  './items/v2/round_glasses-cat.glb',
  './items/v2/round_glasses-chick.glb',
  './items/v2/round_glasses-dog.glb',
  './items/v2/round_glasses-fox.glb',
  './items/v2/round_glasses-koala.glb',
  './items/v2/round_glasses-lion.glb',
  './items/v2/round_glasses-monkey.glb',
  './items/v2/round_glasses-panda.glb',
  './items/v2/round_glasses-penguin.glb',
  './items/v2/round_glasses-pig.glb',
  './items/v2/round_glasses-tiger.glb',
  './items/v2/scarf.glb',
  './items/v2/snowfall.glb',
  './items/v2/sprout.glb',
  './items/v2/star_medal.glb',
  './items/v2/sunglasses-bunny.glb',
  './items/v2/sunglasses-cat.glb',
  './items/v2/sunglasses-chick.glb',
  './items/v2/sunglasses-dog.glb',
  './items/v2/sunglasses-fox.glb',
  './items/v2/sunglasses-koala.glb',
  './items/v2/sunglasses-lion.glb',
  './items/v2/sunglasses-monkey.glb',
  './items/v2/sunglasses-panda.glb',
  './items/v2/sunglasses-penguin.glb',
  './items/v2/sunglasses-pig.glb',
  './items/v2/sunglasses-tiger.glb',
  './items/v2/tutu.glb',
  './items/v2/wings.glb',
  './items/v2/wizard_hat.glb',
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
