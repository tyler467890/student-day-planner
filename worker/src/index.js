/**
 * Calo unlock Worker.
 *
 *   POST /activate            { code, deviceId } -> { token, devicesUsed, maxDevices }
 *   GET  /admin               password-protected admin page (HTML)
 *   POST /admin/api/generate  { count, note }    -> { codes: [{ code, id }], csv }
 *   POST /admin/api/lookup    { code }           -> code details + devices
 *   POST /admin/api/reset     { code }           -> frees all device slots
 *   POST /admin/api/revoke    { code, revoked }  -> stop a code activating new devices
 *   GET  /health
 *
 * Env (see wrangler.toml and README.md):
 *   DB                    D1 database
 *   CODE_PEPPER           secret, used to hash codes
 *   UNLOCK_SIGNING_KEY    secret, private JWK from scripts/generate-signing-key.js
 *   ADMIN_PASSWORD        secret, for /admin
 *   ALLOWED_ORIGINS       comma list of app origins allowed to call /activate
 *   MAX_DEVICES           default 3
 *   RATE_LIMIT_MAX        failed tries per window, default 5
 *   RATE_LIMIT_WINDOW_SECONDS  default 900 (15 minutes)
 */

import { parseCode, generateCodes } from '../../js/unlock-code.js';
import { importPrivateKey, signToken, isDeviceId } from '../../js/unlock-token.js';
import { hashCode, hmacHex, safeEqual, newCodeId } from './crypto.js';
import { adminPage } from './admin-page.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function settings(env) {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
  return {
    maxDevices: num(env.MAX_DEVICES, 3),
    limit: num(env.RATE_LIMIT_MAX, 5),
    window: num(env.RATE_LIMIT_WINDOW_SECONDS, 900),
    origins: String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
  };
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function corsHeaders(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

async function readJson(request) {
  if (Number(request.headers.get('content-length') || 0) > 4096) return null;
  try {
    const text = await request.text();
    if (text.length > 4096) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* ---------- rate limiting (fixed window, failures only) ---------- */

async function isLimited(env, key, cfg) {
  const row = await env.DB.prepare('SELECT window_start, count FROM attempts WHERE key = ?').bind(key).first();
  if (!row) return false;
  return row.window_start > nowSec() - cfg.window && row.count >= cfg.limit;
}

async function recordFailure(env, key, cfg) {
  const now = nowSec();
  const cutoff = now - cfg.window;
  await env.DB.prepare(
    `INSERT INTO attempts (key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN attempts.window_start <= ?3 THEN 1 ELSE attempts.count + 1 END,
       window_start = CASE WHEN attempts.window_start <= ?3 THEN ?2 ELSE attempts.window_start END`,
  ).bind(key, now, cutoff).run();
}

async function ipKey(env, request, prefix = 'ip') {
  // Store a keyed hash, never the raw IP address.
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  return `${prefix}:${(await hmacHex(env.CODE_PEPPER, `ip:${ip}`)).slice(0, 32)}`;
}

/* ---------- activation ---------- */

let cachedKey = null;
async function signingKey(env) {
  if (!cachedKey || cachedKey.src !== env.UNLOCK_SIGNING_KEY) {
    cachedKey = { src: env.UNLOCK_SIGNING_KEY, key: await importPrivateKey(env.UNLOCK_SIGNING_KEY) };
  }
  return cachedKey.key;
}

async function findCode(env, input) {
  const raw = String(input ?? '').trim();
  if (/^c_[A-Z0-9]{10}$/.test(raw)) {
    return env.DB.prepare('SELECT * FROM codes WHERE id = ?').bind(raw).first();
  }
  const parsed = parseCode(raw);
  if (!parsed.ok) return null;
  const hash = await hashCode(env.CODE_PEPPER, parsed.code);
  return env.DB.prepare('SELECT * FROM codes WHERE hash = ?').bind(hash).first();
}

async function handleActivate(request, env, cfg, cors) {
  const ipk = await ipKey(env, request);
  const tooMany = { error: 'rate_limited', message: 'Too many tries. Please wait 15 minutes and try again.' };
  if (await isLimited(env, ipk, cfg)) return json(tooMany, 429, { ...cors, 'retry-after': String(cfg.window) });

  const body = await readJson(request);
  if (!body || !isDeviceId(body.deviceId)) return json({ error: 'bad_request' }, 400, cors);

  const parsed = parseCode(body.code);
  const wrong = { error: 'wrong_code', message: 'That code didn’t work.' };
  if (!parsed.ok) {
    await recordFailure(env, ipk, cfg);
    return json(wrong, 400, cors);
  }
  const hash = await hashCode(env.CODE_PEPPER, parsed.code);
  const code = await env.DB.prepare('SELECT * FROM codes WHERE hash = ?').bind(hash).first();
  if (!code || code.revoked) {
    await recordFailure(env, ipk, cfg);
    return json(wrong, 404, cors);
  }

  const codeKey = `code:${code.id}`;
  if (await isLimited(env, codeKey, cfg)) return json(tooMany, 429, { ...cors, 'retry-after': String(cfg.window) });

  const now = nowSec();
  const max = code.max_devices || cfg.maxDevices;
  // Same device again (reinstall, new token): no new slot used.
  const known = await env.DB.prepare('UPDATE devices SET last_seen = ? WHERE code_id = ? AND device_id = ?')
    .bind(now, code.id, body.deviceId).run();
  if (!known.meta?.changes) {
    // Insert only while under the limit, in one statement, so two phones at once can't both take slot 3.
    const ins = await env.DB.prepare(
      `INSERT OR IGNORE INTO devices (code_id, device_id, created_at, last_seen)
       SELECT ?1, ?2, ?3, ?3 WHERE (SELECT COUNT(*) FROM devices WHERE code_id = ?1) < ?4`,
    ).bind(code.id, body.deviceId, now, max).run();
    if (!ins.meta?.changes) {
      await recordFailure(env, codeKey, cfg);
      return json({
        error: 'too_many_devices',
        message: `This code is already on ${max} devices. Contact support to reset it.`,
        maxDevices: max,
      }, 409, cors);
    }
  }
  const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM devices WHERE code_id = ?').bind(code.id).first();
  const token = await signToken(await signingKey(env), { v: 1, cid: code.id, did: body.deviceId, iat: now });
  return json({ token, devicesUsed: used?.n ?? null, maxDevices: max }, 200, cors);
}

/* ---------- admin ---------- */

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function adminAuth(request, env, cfg) {
  if (!env.ADMIN_PASSWORD || String(env.ADMIN_PASSWORD).length < 12) {
    return json({ error: 'admin_disabled', message: 'Set an ADMIN_PASSWORD secret (12+ characters) first.' }, 503);
  }
  const key = await ipKey(env, request, 'admin');
  if (await isLimited(env, key, cfg)) return json({ error: 'rate_limited', message: 'Too many wrong passwords. Wait 15 minutes.' }, 429);
  const header = request.headers.get('authorization') || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!given || !await safeEqual(given, env.ADMIN_PASSWORD)) {
    await recordFailure(env, key, cfg);
    return json({ error: 'unauthorized', message: 'Wrong admin password.' }, 401);
  }
  return null;
}

async function describe(env, code) {
  const { results } = await env.DB.prepare('SELECT device_id, created_at, last_seen FROM devices WHERE code_id = ? ORDER BY created_at')
    .bind(code.id).all();
  return {
    id: code.id,
    note: code.note,
    createdAt: new Date(code.created_at * 1000).toISOString(),
    maxDevices: code.max_devices,
    revoked: Boolean(code.revoked),
    devices: (results || []).map((d) => ({
      device: `${d.device_id.slice(0, 6)}…`,
      activatedAt: new Date(d.created_at * 1000).toISOString(),
      lastSeen: new Date(d.last_seen * 1000).toISOString(),
    })),
  };
}

async function handleAdminApi(request, env, cfg, action) {
  const denied = await adminAuth(request, env, cfg);
  if (denied) return denied;
  const body = (await readJson(request)) || {};

  if (action === 'generate') {
    const count = Math.floor(Number(body.count));
    if (!(count >= 1 && count <= 500)) return json({ error: 'bad_count', message: 'Pick 1 to 500 codes.' }, 400);
    const note = String(body.note || '').slice(0, 200);
    const now = nowSec();
    const codes = generateCodes(count);
    const rows = [];
    const stmts = [];
    for (const code of codes) {
      const id = newCodeId();
      rows.push({ code, id });
      stmts.push(env.DB.prepare('INSERT INTO codes (id, hash, created_at, note, max_devices) VALUES (?, ?, ?, ?, ?)')
        .bind(id, await hashCode(env.CODE_PEPPER, code), now, note, cfg.maxDevices));
    }
    await env.DB.batch(stmts);
    const created = new Date(now * 1000).toISOString();
    const csv = ['code,id,note,created', ...rows.map((r) => [r.code, r.id, note, created].map(csvCell).join(','))].join('\n');
    return json({ codes: rows, csv });
  }

  const code = await findCode(env, body.code);
  if (!code) return json({ error: 'not_found', message: 'No code like that.' }, 404);

  if (action === 'lookup') return json(await describe(env, code));
  if (action === 'reset') {
    const res = await env.DB.prepare('DELETE FROM devices WHERE code_id = ?').bind(code.id).run();
    await env.DB.prepare('DELETE FROM attempts WHERE key = ?').bind(`code:${code.id}`).run();
    return json({ ...(await describe(env, code)), removed: res.meta?.changes ?? 0 });
  }
  if (action === 'revoke') {
    const revoked = body.revoked !== false;
    await env.DB.prepare('UPDATE codes SET revoked = ? WHERE id = ?').bind(revoked ? 1 : 0, code.id).run();
    return json(await describe(env, { ...code, revoked: revoked ? 1 : 0 }));
  }
  return json({ error: 'not_found' }, 404);
}

/* ---------- router ---------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cfg = settings(env);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/activate') {
      const origin = (request.headers.get('origin') || '').replace(/\/+$/, '');
      if (!origin || !cfg.origins.includes(origin)) return json({ error: 'origin_not_allowed' }, 403);
      const cors = corsHeaders(origin);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (request.method !== 'POST') return json({ error: 'method' }, 405, cors);
      return handleActivate(request, env, cfg, cors);
    }

    if (path === '/admin' && request.method === 'GET') return adminPage();
    const m = path.match(/^\/admin\/api\/(generate|lookup|reset|revoke)$/);
    if (m) {
      if (request.method !== 'POST') return json({ error: 'method' }, 405);
      // Admin calls must come from the admin page itself (same origin), not from other sites.
      const origin = request.headers.get('origin');
      if (origin && origin !== url.origin) return json({ error: 'origin_not_allowed' }, 403);
      return handleAdminApi(request, env, cfg, m[1]);
    }

    if (path === '/health') return json({ ok: true });
    return json({ error: 'not_found' }, 404);
  },
};
