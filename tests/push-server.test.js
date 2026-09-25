import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionDue, clampReminders } from '../push-server/src/schedule.js';
import { encryptPayload, decryptPayload, vapidJwt, base64UrlToBytes } from '../push-server/src/webpush.js';
import { handleFetch, dispatchDue } from '../push-server/src/index.js';

function mockKV(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix, cursor } = {}) {
      const keys = [...store.keys()].filter((name) => !prefix || name.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cursor };
    },
  };
}

test('partitionDue sends fresh reminders and drops stale ones', () => {
  const now = Date.parse('2026-09-25T15:00:00Z');
  const { due, keep, drop } = partitionDue([
    { id: 'a', fireAtUTC: '2026-09-25T15:00:00.000Z' },
    { id: 'b', fireAtUTC: '2026-09-25T16:00:00.000Z' },
    { id: 'c', fireAtUTC: '2026-09-25T10:00:00.000Z' },
    { id: 'd', fireAtUTC: '2026-10-25T15:00:00.000Z' },
  ], now);
  assert.deepEqual(due.map((i) => i.id), ['a']);
  assert.deepEqual(keep.map((i) => i.id), ['b']);
  assert.deepEqual(drop.map((i) => i.id).sort(), ['c', 'd']);
});

test('clampReminders keeps a week and drops the rest', () => {
  const now = Date.parse('2026-09-25T15:00:00Z');
  const kept = clampReminders([
    { id: 'soon', fireAtUTC: '2026-09-26T15:00:00.000Z' },
    { id: 'later', fireAtUTC: '2026-10-20T15:00:00.000Z' },
  ], now);
  assert.deepEqual(kept.map((i) => i.id), ['soon']);
});

test('aes128gcm payload round-trips and VAPID jwt verifies', async () => {
  const subscriber = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const userPub = new Uint8Array(await crypto.subtle.exportKey('raw', subscriber.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const message = new TextEncoder().encode('{"title":"Coming up","body":"You have something coming up"}');
  const body = await encryptPayload(userPub, auth, message);
  const plain = await decryptPayload(body, subscriber.privateKey, userPub, auth);
  assert.equal(new TextDecoder().decode(plain), new TextDecoder().decode(message));

  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', vapid.privateKey);
  const jwt = await vapidJwt('https://push.example/abc', jwk, 'mailto:dayli@example.com', 1_800_000_000);
  const [h, p, s] = jwt.split('.');
  const data = new TextEncoder().encode(`${h}.${p}`);
  const sig = base64UrlToBytes(s);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vapid.publicKey, sig, data);
  assert.equal(ok, true);
  const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(p)));
  assert.equal(payload.aud, 'https://push.example');
  assert.equal(payload.sub, 'mailto:dayli@example.com');
});

test('sync stores generic text, unsubscribe deletes it, cron removes sent reminders', async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(null, { status: 201 });
  };
  try {
    const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const privateJwk = await crypto.subtle.exportKey('jwk', vapid.privateKey);
    const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', vapid.publicKey));
    const publicKey = Buffer.from(publicRaw).toString('base64url');
    const env = {
      REMINDERS: mockKV(),
      VAPID_PUBLIC_KEY: publicKey,
      VAPID_PRIVATE_KEY: JSON.stringify(privateJwk),
      VAPID_SUBJECT: 'mailto:dayli@example.com',
      TICK_SECRET: 'test-secret',
    };
    const subscription = {
      endpoint: 'https://push.example/sub/1',
      keys: { p256dh: Buffer.from(publicRaw).toString('base64url'), auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64url') },
    };
    const future = new Date(Date.now() + 60_000).toISOString();
    const sync = await handleFetch(new Request('https://worker.test/sync', {
      method: 'POST',
      body: JSON.stringify({
        subscription,
        reminders: [{ id: 'r1', fireAtUTC: future, title: 'Coming up', body: 'You have something coming up' }],
      }),
    }), env);
    assert.equal(sync.status, 200);
    const stored = [...env.REMINDERS.store.values()].map((v) => JSON.parse(v));
    assert.equal(stored.length, 1);
    assert.equal(JSON.stringify(stored).includes('Biology'), false);
    assert.equal(stored[0].reminders[0].title, 'Coming up');

    stored[0].reminders[0].fireAtUTC = new Date(Date.now() - 1000).toISOString();
    const key = [...env.REMINDERS.store.keys()][0];
    env.REMINDERS.store.set(key, JSON.stringify(stored[0]));
    const result = await dispatchDue(env);
    assert.equal(result.sent, 1);
    const after = JSON.parse(env.REMINDERS.store.get(key));
    assert.equal(after.reminders.length, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.headers['Content-Encoding'], 'aes128gcm');

    const gone = await handleFetch(new Request('https://worker.test/unsubscribe', {
      method: 'POST',
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    }), env);
    assert.equal(gone.status, 200);
    assert.equal(env.REMINDERS.store.size, 0);

    const denied = await handleFetch(new Request('https://worker.test/tick', { method: 'POST' }), env);
    assert.equal(denied.status, 401);
  } finally {
    globalThis.fetch = original;
  }
});
