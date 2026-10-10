import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { verifyToken, newDeviceId } from '../../js/unlock-token.js';
import { generateCode } from '../../js/unlock-code.js';
import { makeDb, storeStub } from '../src/store.js';
import { ipBucket } from '../src/index.js';

const APP = 'https://tyler467890.github.io';
const ADMIN = 'test-admin-password-123';
let ipCounter = 0;

function call(path, { body, origin = APP, ip, method = 'POST', auth } = {}) {
  const headers = { 'content-type': 'application/json', 'cf-connecting-ip': ip || '203.0.113.1' };
  if (origin) headers.origin = origin;
  if (auth) headers.authorization = `Bearer ${auth}`;
  return exports.default.fetch(`https://calo-unlock.example.workers.dev${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function makeCodes(count = 1, note = 'test') {
  const res = await call('/admin/api/generate', { body: { count, note }, auth: ADMIN, origin: null });
  expect(res.status).toBe(200);
  return res.json();
}

function activate(code, deviceId, ip) {
  return call('/activate', { body: { code, deviceId }, ip });
}

beforeEach(async () => {
  ipCounter += 1;
  await storeStub(env).reset();
});

const freshIp = (n = 0) => `198.51.100.${(ipCounter * 10 + n) % 250}`;

describe('activation', () => {
  it('lets one code onto 3 devices and turns the 4th away', async () => {
    const { codes: [{ code, id }] } = await makeCodes(1);
    const devices = [newDeviceId(), newDeviceId(), newDeviceId(), newDeviceId()];
    for (let i = 0; i < 3; i += 1) {
      const res = await activate(code, devices[i], freshIp());
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(APP);
      const data = await res.json();
      expect(data.devicesUsed).toBe(i + 1);
      expect(data.maxDevices).toBe(3);
      const payload = await verifyToken(env.TEST_PUBLIC_KEY, data.token, devices[i]);
      expect(payload).toMatchObject({ v: 1, cid: id, did: devices[i] });
      // A token is tied to its device.
      expect(await verifyToken(env.TEST_PUBLIC_KEY, data.token, devices[(i + 1) % 4])).toBeNull();
    }
    const fourth = await activate(code, devices[3], freshIp());
    expect(fourth.status).toBe(409);
    const body = await fourth.json();
    expect(body.error).toBe('too_many_devices');
    expect(body.message).toBe('This code is already on 3 devices. Contact support to reset it.');
  });

  it('never lets more than 3 devices in, even when they all try at once', async () => {
    const { codes: [{ code }] } = await makeCodes(1);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => activate(code, newDeviceId(), freshIp(i))));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(3);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
  });

  it('re-activating the same device does not use another slot', async () => {
    const { codes: [{ code }] } = await makeCodes(1);
    const phone = newDeviceId();
    for (let i = 0; i < 4; i += 1) expect((await activate(code, phone, freshIp())).status).toBe(200);
    const res = await activate(code, newDeviceId(), freshIp());
    expect((await res.json()).devicesUsed).toBe(2);
  });

  it('accepts lower case and missing dashes', async () => {
    const { codes: [{ code }] } = await makeCodes(1);
    const sloppy = code.toLowerCase().replace(/-/g, ' ');
    expect((await activate(sloppy, newDeviceId(), freshIp())).status).toBe(200);
  });

  it('stores only hashes, never the plain code', async () => {
    const { codes: [{ code }] } = await makeCodes(1);
    const row = await makeDb(env).prepare('SELECT * FROM codes').first();
    expect(JSON.stringify(row)).not.toContain(code);
    expect(JSON.stringify(row)).not.toContain(code.replace(/-/g, ''));
    expect(row.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects a wrong code, then rate-limits that IP after 5 wrong tries', async () => {
    const { codes: [{ code }] } = await makeCodes(1);
    const ip = freshIp(1);
    for (let i = 0; i < 5; i += 1) {
      const res = await activate(generateCode(), newDeviceId(), ip);
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe('wrong_code');
    }
    // Even the right code is blocked from this IP for the window.
    const blocked = await activate(code, newDeviceId(), ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBe('900');
    // Another IP is fine.
    expect((await activate(code, newDeviceId(), freshIp(2))).status).toBe(200);
  });

  it('counts badly formatted codes as wrong tries too', async () => {
    const ip = freshIp(3);
    for (let i = 0; i < 5; i += 1) expect((await activate('CALO-AAAA', newDeviceId(), ip)).status).toBe(400);
    expect((await activate('CALO-AAAA', newDeviceId(), ip)).status).toBe(429);
  });

  it('rate-limits a code that keeps hitting the device limit, across IPs', async () => {
    const { codes: [{ code }] } = await makeCodes(1);
    for (let i = 0; i < 3; i += 1) await activate(code, newDeviceId(), freshIp());
    for (let i = 0; i < 5; i += 1) expect((await activate(code, newDeviceId(), freshIp(4 + i))).status).toBe(409);
    expect((await activate(code, newDeviceId(), freshIp(9))).status).toBe(429);
  });

  it('reset frees the slots (and clears the code rate limit)', async () => {
    const { codes: [{ code }] } = await makeCodes(1);
    for (let i = 0; i < 3; i += 1) await activate(code, newDeviceId(), freshIp());
    for (let i = 0; i < 5; i += 1) await activate(code, newDeviceId(), freshIp());
    expect((await activate(code, newDeviceId(), freshIp())).status).toBe(429);

    const reset = await call('/admin/api/reset', { body: { code }, auth: ADMIN, origin: null });
    expect(reset.status).toBe(200);
    const info = await reset.json();
    expect(info.removed).toBe(3);
    expect(info.devices).toHaveLength(0);

    for (let i = 0; i < 3; i += 1) expect((await activate(code, newDeviceId(), freshIp())).status).toBe(200);
    expect((await activate(code, newDeviceId(), freshIp())).status).toBe(409);
  });

  it('a blocked (revoked) code cannot activate new devices', async () => {
    const { codes: [{ code }] } = await makeCodes(1);
    await call('/admin/api/revoke', { body: { code, revoked: true }, auth: ADMIN, origin: null });
    expect((await activate(code, newDeviceId(), freshIp())).status).toBe(404);
  });

  it('only allows the app origins (CORS)', async () => {
    const { codes: [{ code }] } = await makeCodes(1);
    const evil = await call('/activate', { body: { code, deviceId: newDeviceId() }, origin: 'https://evil.example' });
    expect(evil.status).toBe(403);
    const none = await call('/activate', { body: { code, deviceId: newDeviceId() }, origin: null });
    expect(none.status).toBe(403);
    const pre = await call('/activate', { method: 'OPTIONS', origin: 'https://www.caloplanner.com' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://www.caloplanner.com');
    expect((await call('/activate', { body: { code, deviceId: newDeviceId() }, origin: 'https://caloplanner.com' })).status).toBe(200);
  });

  it('rejects a missing or junk device id without counting a wrong try', async () => {
    const res = await activate('CALO-AAAA', 'x', freshIp(5));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('bad_request');
  });
});

describe('admin', () => {
  it('needs the password and locks out after 5 wrong ones', async () => {
    const ip = freshIp(6);
    for (let i = 0; i < 5; i += 1) {
      expect((await call('/admin/api/generate', { body: { count: 1 }, auth: 'nope', origin: null, ip })).status).toBe(401);
    }
    expect((await call('/admin/api/generate', { body: { count: 1 }, auth: ADMIN, origin: null, ip })).status).toBe(429);
    expect((await call('/admin/api/generate', { body: { count: 1 }, origin: null, ip: freshIp(7) })).status).toBe(401);
  });

  it('refuses admin calls from another website', async () => {
    const res = await call('/admin/api/generate', { body: { count: 1 }, auth: ADMIN, origin: 'https://evil.example' });
    expect(res.status).toBe(403);
  });

  it('generates a batch with a CSV, and looks a code up by code or id', async () => {
    const data = await makeCodes(25, 'Etsy, batch "A"');
    expect(data.codes).toHaveLength(25);
    expect(new Set(data.codes.map((c) => c.code)).size).toBe(25);
    for (const { code } of data.codes) expect(code).toMatch(/^CALO(-[2-9A-HJ-NP-Z]{4}){4}$/);
    const lines = data.csv.split('\n');
    expect(lines[0]).toBe('code,id,note,created');
    expect(lines).toHaveLength(26);
    expect(lines[1]).toContain('"Etsy, batch ""A"""');

    const [{ code, id }] = data.codes;
    await activate(code, newDeviceId(), freshIp());
    for (const key of [code, id]) {
      const res = await call('/admin/api/lookup', { body: { code: key }, auth: ADMIN, origin: null });
      const info = await res.json();
      expect(info.id).toBe(id);
      expect(info.devices).toHaveLength(1);
      expect(info.note).toBe('Etsy, batch "A"');
    }
    const missing = await call('/admin/api/lookup', { body: { code: 'CALO-2222-2222-2222-2222' }, auth: ADMIN, origin: null });
    expect(missing.status).toBe(404);
  });

  it('serves the admin page with a strict content security policy', async () => {
    const res = await call('/admin', { method: 'GET', origin: null });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const html = await res.text();
    expect(html).toContain('Calo codes');
    expect(html).toContain('New code');
    expect(html).toContain('Copy message');
    // Etsy message: no web address, the link is in the Start Here PDF.
    expect(html).toContain('Open Calo with the link in your Start Here PDF (in your Etsy Purchases).');
    expect(html).not.toContain('caloplanner.com');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain('up to 3 of your devices');
    expect(html).not.toContain('__NONCE__');
    expect(html).not.toContain('__START__');
    // The script only runs with this response's nonce.
    const nonce = res.headers.get('content-security-policy').match(/'nonce-([^']+)'/)[1];
    expect(html).toContain(`<script nonce="${nonce}">`);
  });

  it('lists issued codes newest first with note, date, devices used and blocked state (never the code)', async () => {
    const first = await makeCodes(1, 'Order #111 Sam');
    await new Promise((r) => { setTimeout(r, 1100); });
    const second = await makeCodes(1, 'Order #222 Alex');
    await activate(second.codes[0].code, newDeviceId(), freshIp());
    await activate(second.codes[0].code, newDeviceId(), freshIp());
    await call('/admin/api/revoke', { body: { code: first.codes[0].id, revoked: true }, auth: ADMIN, origin: null });

    const res = await call('/admin/api/list', { body: {}, auth: ADMIN, origin: null });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.total).toBe(2);
    expect(data.codes.map((c) => c.note)).toEqual(['Order #222 Alex', 'Order #111 Sam']);
    expect(data.codes[0]).toMatchObject({ id: second.codes[0].id, devicesUsed: 2, maxDevices: 3, revoked: false });
    expect(data.codes[1]).toMatchObject({ id: first.codes[0].id, devicesUsed: 0, revoked: true });
    expect(Date.parse(data.codes[0].createdAt)).toBeGreaterThan(0);
    expect(JSON.stringify(data)).not.toContain(second.codes[0].code);

    // Reset by id frees the slots; a blocked code can't unlock new devices.
    const reset = await call('/admin/api/reset', { body: { code: second.codes[0].id }, auth: ADMIN, origin: null });
    expect((await reset.json()).devices).toHaveLength(0);
    expect((await activate(first.codes[0].code, newDeviceId(), freshIp(3))).status).toBe(404);

    expect((await call('/admin/api/list', { body: {}, auth: 'nope', origin: null, ip: freshIp(8) })).status).toBe(401);
  });
});

describe('ipBucket', () => {
  it('groups IPv6 addresses by /64 and leaves IPv4 alone', () => {
    expect(ipBucket('203.0.113.9')).toBe('203.0.113.9');
    expect(ipBucket('2a09:bac5:1602:4aa::77:e6')).toBe('2a09:bac5:1602:4aa::/64');
    expect(ipBucket('2a09:bac5:1602:04aa:0:0:77:2e')).toBe('2a09:bac5:1602:4aa::/64');
    expect(ipBucket('2001:db8::1')).toBe('2001:db8:0:0::/64');
  });

  it('counts wrong guesses from one IPv6 /64 together', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await activate(generateCode(), newDeviceId(), `2001:db8:aa:bb::${i + 1}`)).status).toBe(404);
    }
    expect((await activate(generateCode(), newDeviceId(), '2001:db8:aa:bb::99')).status).toBe(429);
  });
});
