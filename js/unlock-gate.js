/**
 * Unlock gate logic (no DOM). Decides whether Calo opens straight away or
 * shows the unlock screen, and talks to the unlock Worker once.
 *
 * Saved on the device in localStorage under UNLOCK_STORE_KEY:
 *   { deviceId, token, grandfathered, hint }
 * The planner's own data (IndexedDB 'dayli', other 'dayli.*' keys) is never
 * read or changed here, apart from the yes/no "had saved data" passed in.
 */

import { parseCode, parseMessage } from './unlock-code.js';
import { newDeviceId, isDeviceId, verifyToken } from './unlock-token.js';

export const UNLOCK_STORE_KEY = 'dayli.unlock.v1';
/** Playwright sets this to see the gate even under automation. */
export const UNLOCK_FORCE_KEY = 'dayli.unlock.force';
export const MAX_DEVICES_MESSAGE = 'This code is already on 3 devices. Contact support to reset it.';

const TEST_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function loadUnlock(storage) {
  let saved = {};
  try { saved = JSON.parse(storage?.getItem(UNLOCK_STORE_KEY) || '{}') || {}; } catch { saved = {}; }
  return {
    deviceId: isDeviceId(saved.deviceId) ? saved.deviceId : null,
    token: typeof saved.token === 'string' ? saved.token : null,
    grandfathered: saved.grandfathered === true,
    hint: typeof saved.hint === 'string' ? saved.hint : null,
  };
}

export function saveUnlock(storage, state) {
  try { storage?.setItem(UNLOCK_STORE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
}

/** The device ID is made once and kept, so re-entering a code on the same phone never uses a new slot. */
export function ensureDeviceId(storage) {
  const state = loadUnlock(storage);
  if (!state.deviceId) {
    state.deviceId = newDeviceId();
    saveUnlock(storage, state);
  }
  return state.deviceId;
}

/**
 * The test-only bypass: automation (navigator.webdriver) AND a local test
 * server AND no opt-in flag. It can never apply on github.io or calo.ca.
 */
export function testBypass({ automation, hostname, storage }) {
  if (!automation || !TEST_HOSTS.has(String(hostname || ''))) return false;
  try { return !storage?.getItem(UNLOCK_FORCE_KEY); } catch { return true; }
}

/**
 * Work out what to show.
 * cfg: { requireUnlock, apiUrl, publicKey, grandfatherExisting }
 * Returns { state, reason }, state is one of:
 *   'open'          lock is off (or not configured): app opens as today
 *   'bypass'        automated test on localhost
 *   'grandfathered' this device had saved planner data before the lock
 *   'unlocked'      a valid signed token for this device is saved
 *   'locked'        show the unlock screen
 */
export async function decideGate({ cfg, storage, hadData, automation = false, hostname = '' }) {
  if (!cfg?.requireUnlock) return { state: 'open', reason: 'flag-off' };
  if (!cfg.apiUrl || !cfg.publicKey) {
    // Never lock people out because setup is half done.
    return { state: 'open', reason: 'not-configured' };
  }
  if (testBypass({ automation, hostname, storage })) return { state: 'bypass', reason: 'test' };
  const saved = loadUnlock(storage);
  if (saved.token && saved.deviceId && await verifyToken(cfg.publicKey, saved.token, saved.deviceId)) {
    return { state: 'unlocked', reason: 'token' };
  }
  if (saved.grandfathered) return { state: 'grandfathered', reason: 'saved-flag' };
  if (cfg.grandfatherExisting && hadData) {
    saveUnlock(storage, { ...saved, grandfathered: true });
    return { state: 'grandfathered', reason: 'existing-data' };
  }
  return { state: 'locked', reason: saved.token ? 'bad-token' : 'no-token' };
}

/** True when the planner has anything saved (finished setup or any goal). */
export function hasSavedData(loaded) {
  return Boolean(loaded?.settings?.setupComplete) || (loaded?.tasks?.length || 0) > 0;
}

/**
 * Send the code to the Worker once. Returns
 *   { ok: true, token }  or
 *   { ok: false, kind: 'format'|'wrong'|'too_many'|'rate_limited'|'offline'|'server'|'bad_token', message }
 */
export async function activate({ cfg, storage, input, fetchImpl = globalThis.fetch }) {
  const parsed = parseCode(input);
  if (!parsed.ok) return { ok: false, kind: 'format', message: parseMessage(parsed.reason) };
  const deviceId = ensureDeviceId(storage);
  let res;
  try {
    res = await fetchImpl(`${String(cfg.apiUrl).replace(/\/+$/, '')}/activate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: parsed.code, deviceId }),
    });
  } catch {
    return { ok: false, kind: 'offline', message: 'Calo couldn’t reach the internet. Connect once to unlock, then it works offline.' };
  }
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  if (res.ok && typeof data.token === 'string') {
    if (!await verifyToken(cfg.publicKey, data.token, deviceId)) {
      return { ok: false, kind: 'bad_token', message: 'Something went wrong unlocking. Please try again in a minute.' };
    }
    const saved = loadUnlock(storage);
    saveUnlock(storage, { ...saved, deviceId, token: data.token, hint: parsed.code.slice(-4) });
    return { ok: true, token: data.token, devicesUsed: data.devicesUsed, maxDevices: data.maxDevices };
  }
  if (res.status === 409 || data.error === 'too_many_devices') {
    const contact = cfg.supportContact ? ` (${cfg.supportContact})` : '';
    return { ok: false, kind: 'too_many', message: MAX_DEVICES_MESSAGE.replace('Contact support', `Contact support${contact}`) };
  }
  if (res.status === 429) {
    return { ok: false, kind: 'rate_limited', message: 'Too many tries. Please wait 15 minutes and try again.' };
  }
  if (res.status === 404 || res.status === 400 || data.error === 'wrong_code') {
    return { ok: false, kind: 'wrong', message: 'That code didn’t work. Check it matches your Etsy download exactly.' };
  }
  return { ok: false, kind: 'server', message: 'Calo’s unlock service is having a moment. Please try again soon.' };
}
