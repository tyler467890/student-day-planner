import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE_ALPHABET, checkChar, generateCode, generateCodes, parseCode, isValidCode, parseMessage,
} from '../js/unlock-code.js';
import { generateSigningKeys, importPrivateKey, signToken, verifyToken, newDeviceId, isDeviceId } from '../js/unlock-token.js';
import {
  decideGate, activate, loadUnlock, ensureDeviceId, testBypass, hasSavedData, UNLOCK_STORE_KEY, UNLOCK_FORCE_KEY,
  MAX_DEVICES_MESSAGE,
} from '../js/unlock-gate.js';

function memoryStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    map: m,
  };
}

const FORMAT = /^CALO(-[2-9A-HJ-NP-Z]{4}){4}$/;

/* ---------- code format ---------- */

test('alphabet has 32 characters and no 0 O 1 I', () => {
  assert.equal(CODE_ALPHABET.length, 32);
  assert.equal(new Set(CODE_ALPHABET).size, 32);
  for (const bad of '0O1I') assert.ok(!CODE_ALPHABET.includes(bad));
});

test('generated codes look like CALO-XXXX-XXXX-XXXX-XXXX and pass their own checksum', () => {
  const codes = generateCodes(500);
  assert.equal(new Set(codes).size, 500);
  for (const code of codes) {
    assert.match(code, FORMAT);
    assert.deepEqual(parseCode(code), { ok: true, code });
  }
});

test('generation uses every alphabet character (no bias toward a few)', () => {
  const counts = new Map();
  for (const code of generateCodes(400)) {
    for (const ch of code.slice(5).replace(/-/g, '').slice(0, 15)) counts.set(ch, (counts.get(ch) || 0) + 1);
  }
  assert.equal(counts.size, 32);
  // 6000 random chars / 32 = 187.5 each on average; a wildly skewed generator would fail this.
  for (const n of counts.values()) assert.ok(n > 100 && n < 300, `count ${n}`);
});

test('generation is driven by the random source', () => {
  const zero = generateCode(() => new Uint8Array(15));
  assert.equal(zero, `CALO-2222-2222-2222-222${checkChar('222222222222222')}`);
  assert.ok(isValidCode(zero));
});

test('parseCode forgives case, spaces, missing dashes and missing prefix', () => {
  const code = generateCode();
  const body = code.slice(5).replace(/-/g, '');
  for (const typed of [code.toLowerCase(), ` ${code} `, body, body.toLowerCase(), `calo ${body.match(/.{4}/g).join(' ')}`]) {
    assert.deepEqual(parseCode(typed), { ok: true, code }, typed);
  }
});

test('parseCode catches every single-character typo and adjacent swap', () => {
  const code = generateCode();
  const body = code.slice(5).replace(/-/g, '');
  for (let i = 0; i < body.length; i += 1) {
    for (const ch of CODE_ALPHABET) {
      if (ch === body[i]) continue;
      const typo = body.slice(0, i) + ch + body.slice(i + 1);
      assert.equal(parseCode(typo).reason, 'checksum', typo);
    }
  }
  for (let i = 0; i < body.length - 1; i += 1) {
    if (body[i] === body[i + 1]) continue;
    const swapped = body.slice(0, i) + body[i + 1] + body[i] + body.slice(i + 2);
    assert.equal(parseCode(swapped).ok, false, swapped);
  }
});

test('parseCode explains what is wrong', () => {
  assert.equal(parseCode('').reason, 'empty');
  assert.equal(parseCode('CALO-0000-AAAA-AAAA-AAAA').reason, 'chars');
  assert.equal(parseCode('CALO-AAAA-AAAA').reason, 'length');
  for (const r of ['empty', 'chars', 'length', 'checksum']) assert.ok(parseMessage(r).length > 10);
});

/* ---------- tokens ---------- */

async function keys() {
  const k = await generateSigningKeys();
  return { ...k, priv: await importPrivateKey(k.privateJwk) };
}

test('a signed token verifies for its own device only', async () => {
  const { priv, publicJwk } = await keys();
  const did = newDeviceId();
  assert.ok(isDeviceId(did));
  const token = await signToken(priv, { v: 1, cid: 'c_ABCDEFGHJK', did, iat: 1 });
  assert.deepEqual(await verifyToken(publicJwk, token, did), { v: 1, cid: 'c_ABCDEFGHJK', did, iat: 1 });
  assert.equal(await verifyToken(publicJwk, token, newDeviceId()), null);
});

test('tampered, foreign-key and junk tokens are rejected', async () => {
  const { priv, publicJwk } = await keys();
  const other = await keys();
  const did = newDeviceId();
  const token = await signToken(priv, { v: 1, cid: 'c_ABCDEFGHJK', did, iat: 1 });
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ v: 1, cid: 'c_FREE', did, iat: 1 })).toString('base64url');
  assert.equal(await verifyToken(publicJwk, `${forged}.${sig}`, did), null);
  assert.equal(await verifyToken(publicJwk, `${body}.${sig.slice(0, -2)}AA`, did), null);
  assert.equal(await verifyToken(other.publicJwk, token, did), null);
  for (const junk of [null, '', 'x', 'a.b', 'a.b.c', `${token}.x`]) assert.equal(await verifyToken(publicJwk, junk, did), null);
  // A token for a different version is rejected.
  const v2 = await signToken(priv, { v: 2, cid: 'c_ABCDEFGHJK', did, iat: 1 });
  assert.equal(await verifyToken(publicJwk, v2, did), null);
});

/* ---------- gate logic ---------- */

async function setup() {
  const k = await keys();
  const cfg = { requireUnlock: true, apiUrl: 'https://unlock.test', publicKey: k.publicJwk, grandfatherExisting: true };
  return { ...k, cfg };
}

test('gate is open while REQUIRE_UNLOCK is off or setup is half done', async () => {
  const storage = memoryStorage();
  assert.equal((await decideGate({ cfg: { requireUnlock: false }, storage })).state, 'open');
  assert.equal((await decideGate({ cfg: { requireUnlock: true, apiUrl: '', publicKey: null }, storage })).state, 'open');
  assert.equal((await decideGate({ cfg: { requireUnlock: true, apiUrl: 'https://x', publicKey: null }, storage })).state, 'open');
  assert.equal(storage.map.size, 0, 'nothing saved');
});

test('gate locks a brand-new device', async () => {
  const { cfg } = await setup();
  const gate = await decideGate({ cfg, storage: memoryStorage(), hadData: false });
  assert.equal(gate.state, 'locked');
});

test('existing users with saved data are grandfathered (and it sticks); can be turned off', async () => {
  const { cfg } = await setup();
  const storage = memoryStorage();
  assert.equal((await decideGate({ cfg, storage, hadData: true })).state, 'grandfathered');
  assert.equal(loadUnlock(storage).grandfathered, true);
  assert.equal((await decideGate({ cfg, storage, hadData: false })).state, 'grandfathered');
  const strict = { ...cfg, grandfatherExisting: false };
  assert.equal((await decideGate({ cfg: strict, storage: memoryStorage(), hadData: true })).state, 'locked');
});

test('hasSavedData looks at finished setup or any goal', () => {
  assert.equal(hasSavedData({ settings: null, tasks: [] }), false);
  assert.equal(hasSavedData({ settings: { setupComplete: false }, tasks: [] }), false);
  assert.equal(hasSavedData({ settings: { setupComplete: true }, tasks: [] }), true);
  assert.equal(hasSavedData({ settings: null, tasks: [{ id: 1 }] }), true);
});

test('a saved valid token unlocks, offline, with no network call', async () => {
  const { cfg, priv } = await setup();
  const storage = memoryStorage();
  const did = ensureDeviceId(storage);
  assert.equal(ensureDeviceId(storage), did, 'device id is stable');
  const token = await signToken(priv, { v: 1, cid: 'c_X', did, iat: 1 });
  storage.setItem(UNLOCK_STORE_KEY, JSON.stringify({ deviceId: did, token }));
  const real = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('no network expected'); };
  try {
    assert.equal((await decideGate({ cfg, storage, hadData: false })).state, 'unlocked');
  } finally {
    globalThis.fetch = real;
  }
});

test('a token copied from another device, or edited, does not unlock', async () => {
  const { cfg, priv } = await setup();
  const token = await signToken(priv, { v: 1, cid: 'c_X', did: newDeviceId(), iat: 1 });
  const storage = memoryStorage({ [UNLOCK_STORE_KEY]: JSON.stringify({ deviceId: newDeviceId(), token }) });
  assert.equal((await decideGate({ cfg, storage, hadData: false })).state, 'locked');
  storage.setItem(UNLOCK_STORE_KEY, JSON.stringify({ deviceId: newDeviceId(), token: 'garbage' }));
  assert.equal((await decideGate({ cfg, storage, hadData: false })).state, 'locked');
});

test('test bypass only works for automation on a local test server', () => {
  const s = memoryStorage();
  assert.equal(testBypass({ automation: true, hostname: '127.0.0.1', storage: s }), true);
  assert.equal(testBypass({ automation: true, hostname: 'localhost', storage: s }), true);
  assert.equal(testBypass({ automation: false, hostname: '127.0.0.1', storage: s }), false);
  assert.equal(testBypass({ automation: true, hostname: 'tyler467890.github.io', storage: s }), false);
  assert.equal(testBypass({ automation: true, hostname: 'calo.ca', storage: s }), false);
  s.setItem(UNLOCK_FORCE_KEY, '1');
  assert.equal(testBypass({ automation: true, hostname: '127.0.0.1', storage: s }), false);
});

function fakeServer(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const { status, body } = await handler(JSON.parse(init.body));
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { calls, fetchImpl };
}

test('activate: success saves the token and the gate then opens', async () => {
  const { cfg, priv } = await setup();
  const storage = memoryStorage();
  const code = generateCode();
  const server = fakeServer(async ({ deviceId }) => ({
    status: 200, body: { token: await signToken(priv, { v: 1, cid: 'c_X', did: deviceId, iat: 1 }), devicesUsed: 1, maxDevices: 3 },
  }));
  const res = await activate({ cfg, storage, input: code.toLowerCase(), fetchImpl: server.fetchImpl });
  assert.equal(res.ok, true);
  assert.equal(server.calls.length, 1);
  assert.equal(server.calls[0].url, 'https://unlock.test/activate');
  assert.equal(server.calls[0].body.code, code);
  assert.equal(server.calls[0].body.deviceId, loadUnlock(storage).deviceId);
  assert.equal(loadUnlock(storage).hint, code.slice(-4));
  assert.equal((await decideGate({ cfg, storage, hadData: false })).state, 'unlocked');
});

test('activate: a typo is caught locally, with no network call', async () => {
  const { cfg } = await setup();
  const server = fakeServer(() => { throw new Error('should not be called'); });
  const res = await activate({ cfg, storage: memoryStorage(), input: 'CALO-ABCD', fetchImpl: server.fetchImpl });
  assert.equal(res.kind, 'format');
  assert.equal(server.calls.length, 0);
});

test('activate: maps server answers to friendly messages', async () => {
  const { cfg, priv } = await setup();
  const cases = [
    [409, { error: 'too_many_devices' }, 'too_many'],
    [404, { error: 'wrong_code' }, 'wrong'],
    [429, { error: 'rate_limited' }, 'rate_limited'],
    [500, {}, 'server'],
    // A token signed by someone else's key is not accepted.
    [200, { token: await signToken((await keys()).priv, { v: 1, cid: 'c', did: 'x'.repeat(22), iat: 1 }) }, 'bad_token'],
  ];
  for (const [status, body, kind] of cases) {
    const res = await activate({ cfg, storage: memoryStorage(), input: generateCode(), fetchImpl: fakeServer(() => ({ status, body })).fetchImpl });
    assert.equal(res.kind, kind, `${status}`);
    assert.ok(res.message.length > 10);
  }
  const tooMany = await activate({ cfg, storage: memoryStorage(), input: generateCode(), fetchImpl: fakeServer(() => ({ status: 409, body: {} })).fetchImpl });
  assert.equal(tooMany.message, MAX_DEVICES_MESSAGE);
  const withContact = await activate({ cfg: { ...cfg, supportContact: 'hi@calo.ca' }, storage: memoryStorage(), input: generateCode(), fetchImpl: fakeServer(() => ({ status: 409, body: {} })).fetchImpl });
  assert.equal(withContact.message, 'This code is already on 3 devices. Contact support (hi@calo.ca) to reset it.');
  const offline = await activate({ cfg, storage: memoryStorage(), input: generateCode(), fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  assert.equal(offline.kind, 'offline');
  void priv;
});
