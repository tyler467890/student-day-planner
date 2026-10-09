import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { generateCode } from '../js/unlock-code.js';
import { generateSigningKeys, importPrivateKey, signToken } from '../js/unlock-token.js';

// The unlock screen with REQUIRE_UNLOCK switched on and a mocked unlock Worker.
// Screenshots go to /workspace/unlock-artifacts when SHOTS=1.

const API = 'https://unlock.calo.test';
const SHOTS = process.env.SHOTS ? (process.env.SHOTS_DIR || '/workspace/unlock-artifacts') : null;

// Network routing needs the page (not the service worker) to make requests.
test.use({ serviceWorkers: 'block' });

let keys;
let priv;
test.beforeAll(async () => {
  keys = await generateSigningKeys();
  priv = await importPrivateKey(keys.privateJwk);
});

/** A tiny in-memory stand-in for the Worker: one code, 3 device slots. */
function mockWorker({ validCode, max = 3 } = {}) {
  const devices = new Set();
  const seen = [];
  return {
    seen,
    devices,
    async handle(route) {
      const req = route.request();
      const cors = { 'access-control-allow-origin': 'http://127.0.0.1:4173', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const { code, deviceId } = req.postDataJSON();
      seen.push({ code, deviceId });
      const reply = (status, body) => route.fulfill({ status, headers: cors, contentType: 'application/json', body: JSON.stringify(body) });
      if (code !== validCode) return reply(404, { error: 'wrong_code' });
      if (!devices.has(deviceId) && devices.size >= max) {
        return reply(409, { error: 'too_many_devices', message: 'This code is already on 3 devices. Contact support to reset it.' });
      }
      devices.add(deviceId);
      const token = await signToken(priv, { v: 1, cid: 'c_TESTCODE22', did: deviceId, iat: 1 });
      return reply(200, { token, devicesUsed: devices.size, maxDevices: max });
    },
  };
}

/** Serve js/config.js with the lock switched on. */
async function lockOn(page, { grandfather = true } = {}) {
  const src = fs.readFileSync(path.join(process.cwd(), 'js/config.js'), 'utf8')
    .replace('export const REQUIRE_UNLOCK = false;', 'export const REQUIRE_UNLOCK = true;')
    .replace("export const UNLOCK_API_URL = '';", `export const UNLOCK_API_URL = '${API}';`)
    .replace('export const UNLOCK_PUBLIC_KEY = null;', `export const UNLOCK_PUBLIC_KEY = ${JSON.stringify(keys.publicJwk)};`)
    .replace('export const UNLOCK_GRANDFATHER_EXISTING = true;', `export const UNLOCK_GRANDFATHER_EXISTING = ${grandfather};`);
  if (!src.includes('REQUIRE_UNLOCK = true') || !src.includes(API)) throw new Error('config.js changed shape');
  await page.route('**/js/config.js', (route) => route.fulfill({ contentType: 'text/javascript', body: src }));
}

/** Tests normally skip the gate (automation on localhost); this opts in. */
async function forceGate(page) {
  await page.addInitScript(() => localStorage.setItem('dayli.unlock.force', '1'));
}

const screen = (page) => page.locator('.unlock');
const bubble = (page) => page.locator('.unlock-say');
const msg = (page) => page.locator('#unlock-msg');
const input = (page) => page.getByLabel('Your unlock code');
const unlockBtn = (page) => page.getByRole('button', { name: 'Unlock' });

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  // Let the bunny settle for a nicer picture.
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS, name) });
}

test('lock off (the default): app opens as today, no unlock screen', async ({ page }) => {
  await forceGate(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  await expect(screen(page)).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-unlock', 'open');
});

test('test bypass: under automation on localhost the gate stays out of the way', async ({ page }) => {
  await lockOn(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-unlock', 'bypass');
});

test('new device: enter code, unlock, then stays unlocked offline', async ({ page }) => {
  const code = generateCode();
  const worker = mockWorker({ validCode: code });
  await lockOn(page);
  await forceGate(page);
  await page.route(`${API}/**`, (route) => worker.handle(route));
  await page.goto('/');

  await expect(screen(page)).toBeVisible();
  await expect(bubble(page)).toHaveText('Enter your code to get started!');
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
  await expect(input(page)).toBeFocused();
  await shot(page, '1-enter-code.png');

  // Typing without dashes gets tidied into groups.
  await input(page).pressSequentially(code.slice(5).replace(/-/g, '').toLowerCase());
  await expect(input(page)).toHaveValue(code);
  await unlockBtn(page).click();
  await expect(bubble(page)).toHaveText('You’re all set! Welcome to Calo!');
  await expect(page.locator('.unlock')).toHaveAttribute('data-state', 'success');
  await shot(page, '2-success.png');
  expect(worker.seen).toHaveLength(1);
  expect(worker.seen[0].code).toBe(code);

  await page.getByRole('button', { name: 'Open Calo' }).click();
  await expect(screen(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();

  // No server, no network: still unlocked.
  await page.unroute(`${API}/**`);
  await page.route(`${API}/**`, (route) => route.abort('internetdisconnected'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  await expect(screen(page)).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-unlock', 'unlocked');
  expect(worker.seen).toHaveLength(1);
});

test('wrong code: friendly message, can try again', async ({ page }) => {
  const worker = mockWorker({ validCode: generateCode() });
  await lockOn(page);
  await forceGate(page);
  await page.route(`${API}/**`, (route) => worker.handle(route));
  await page.goto('/');
  await input(page).fill(generateCode());
  await unlockBtn(page).click();
  await expect(bubble(page)).toHaveText('Hmm, that didn’t work.');
  await expect(msg(page)).toHaveText('That code didn’t work. Check it matches your Etsy download exactly.');
  await expect(input(page)).toHaveAttribute('aria-invalid', 'true');
  await shot(page, '4-wrong-code.png');
  // Typing again clears the error.
  await input(page).press('Backspace');
  await expect(msg(page)).toBeEmpty();
  await expect(bubble(page)).toHaveText('Enter your code to get started!');
});

test('typo: caught on the phone, nothing sent', async ({ page }) => {
  const code = generateCode();
  const worker = mockWorker({ validCode: code });
  await lockOn(page);
  await forceGate(page);
  await page.route(`${API}/**`, (route) => worker.handle(route));
  await page.goto('/');
  const last = code.at(-1);
  const typo = code.slice(0, -1) + (last === 'Z' ? 'Y' : 'Z');
  await input(page).fill(typo);
  await unlockBtn(page).click();
  await expect(msg(page)).toHaveText('That code has a typo somewhere. Check each letter and try again.');
  expect(worker.seen).toHaveLength(0);
});

test('4th device: polite "already on 3 devices" message', async ({ browser }) => {
  const code = generateCode();
  const worker = mockWorker({ validCode: code });
  for (let i = 0; i < 4; i += 1) {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    await lockOn(page);
    await forceGate(page);
    await page.route(`${API}/**`, (route) => worker.handle(route));
    await page.goto('/');
    await input(page).fill(code);
    await unlockBtn(page).click();
    if (i < 3) {
      await expect(page.locator('.unlock')).toHaveAttribute('data-state', 'success');
    } else {
      await expect(page.locator('.unlock')).toHaveAttribute('data-state', 'too-many');
      await expect(msg(page)).toHaveText('This code is already on 3 devices. Contact support to reset it.');
      await shot(page, '3-too-many-devices.png');
    }
    await context.close();
  }
  expect(worker.devices.size).toBe(3);
});

test('existing user with saved data is not locked out when the lock turns on', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue' }).click();
  const skip = page.getByRole('button', { name: 'Skip for now' });
  const notNow = page.getByRole('button', { name: 'Not now' });
  await expect(skip.or(notNow)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await notNow.click();
  await page.getByRole('button', { name: 'This is my pet' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();

  await lockOn(page);
  await page.evaluate(() => localStorage.setItem('dayli.unlock.force', '1'));
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();
  await expect(screen(page)).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-unlock', 'grandfathered');
});

test('with grandfathering off, an existing user must enter a code too', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('button', { name: 'Skip for now' }).or(page.getByRole('button', { name: 'Not now' }))).toBeVisible();
  await page.evaluate(async () => {
    const req = indexedDB.open('dayli');
    const db = await new Promise((r) => { req.onsuccess = () => r(req.result); });
    const tx = db.transaction('settings', 'readwrite');
    const store = tx.objectStore('settings');
    const row = await new Promise((r) => { const g = store.get('main'); g.onsuccess = () => r(g.result); });
    store.put({ ...row, setupComplete: true });
    await new Promise((r) => { tx.oncomplete = r; });
  });
  await lockOn(page, { grandfather: false });
  await page.evaluate(() => localStorage.setItem('dayli.unlock.force', '1'));
  await page.reload();
  await expect(screen(page)).toBeVisible();
});
