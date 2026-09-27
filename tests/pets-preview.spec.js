import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const ANIMALS = [
  ['dog', 'Dog'],
  ['cat', 'Cat'],
  ['bunny', 'Bunny'],
  ['penguin', 'Penguin'],
  ['horse', 'Horse'],
  ['monkey', 'Monkey'],
  ['tiger', 'Tiger'],
  ['shark', 'Shark'],
  ['pig', 'Pig'],
  ['axolotl', 'Axolotl'],
  ['capybara', 'Capybara'],
  ['dragon', 'Dragon'],
];

function watchPage(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  const external = [];
  page.on('request', (req) => {
    const host = new URL(req.url()).hostname;
    if (host !== '127.0.0.1' && host !== 'localhost') external.push(req.url());
  });
  return { errors, external };
}

async function openPets(page) {
  const watched = watchPage(page);
  await page.goto('/pets-preview/');
  await expect.poll(() => page.evaluate(() => window.__PETS && window.__PETS.pixelScore())).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.__PETS.shown)).toBe('penguin');
  return watched;
}

async function shown(page, name) {
  await expect.poll(() => page.evaluate(() => window.__PETS.shown)).toBe(name);
  expect(await page.evaluate(() => window.__PETS.pixelScore())).toBeGreaterThan(0);
}

test('pet preview on a phone', async ({ page }) => {
  const { errors, external } = await openPets(page);
  expect(external, 'no third-party requests').toEqual([]);
  expect(errors, 'no console errors').toEqual([]);

  for (const [id, label] of ANIMALS) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await shown(page, id);
  }

  const clipped = await page.locator('button, input').evaluateAll((els) => els.map((el) => {
    const box = el.getBoundingClientRect();
    return {
      name: (el.getAttribute('aria-label') || el.textContent || '').trim(),
      left: box.left,
      right: box.right,
      width: box.width,
      view: window.innerWidth,
    };
  }));
  for (const box of clipped) {
    expect(box.width, box.name).toBeGreaterThan(0);
    expect(box.left, box.name).toBeGreaterThanOrEqual(-1);
    expect(box.right, box.name).toBeLessThanOrEqual(box.view + 1);
  }

  await page.locator('#pet-height').fill('1.35');
  await expect.poll(() => page.evaluate(() => window.__PETS.height)).toBeCloseTo(1.35, 2);
  await page.locator('#pet-body').fill('1.2');
  await expect.poll(() => page.evaluate(() => window.__PETS.body)).toBeCloseTo(1.2, 2);

  await page.getByRole('button', { name: 'Colour Sunny yellow' }).click();
  await expect.poll(() => page.evaluate(() => window.__PETS.color.toLowerCase())).toBe('#ffd23f');
  await page.getByRole('button', { name: 'Colour Natural' }).click();
  await expect.poll(() => page.evaluate(() => window.__PETS.color.toLowerCase())).toBe('#6fd6a6');
  await page.locator('#pet-colour').fill('#00c2a8');
  await expect.poll(() => page.evaluate(() => window.__PETS.color.toLowerCase())).toBe('#00c2a8');
  await page.locator('#pet-colour').fill('#f4f4f4');
  const clamped = await page.evaluate(() => window.__PETS.color);
  const value = parseInt(clamped.slice(1), 16);
  const luminance = (0.2126 * ((value >> 16) & 255) + 0.7152 * ((value >> 8) & 255) + 0.0722 * (value & 255)) / 255;
  expect(luminance).toBeLessThan(0.78);
  expect(luminance).toBeGreaterThan(0.25);

  await page.getByRole('button', { name: 'Happy eyes' }).click();
  await expect.poll(() => page.evaluate(() => window.__PETS.eyes)).toBe('happy');
  await page.getByRole('button', { name: 'Sparkly eyes' }).click();
  await expect.poll(() => page.evaluate(() => window.__PETS.eyes)).toBe('sparkly');
  await page.getByRole('button', { name: 'Round eyes' }).click();
  await expect.poll(() => page.evaluate(() => window.__PETS.eyes)).toBe('round');

  await page.getByRole('button', { name: 'Cheeks', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PETS.cheeks)).toBe(false);
  await page.getByRole('button', { name: 'Cheeks', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PETS.cheeks)).toBe(true);

  await page.getByRole('button', { name: 'Hat', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PETS.hatVisible)).toBe(true);
  const idle = await page.evaluate(() => {
    window.__PETS.play('idle');
    window.__PETS.pause(0);
    return window.__PETS.hatFollow();
  });
  expect(idle.gap).toBeGreaterThan(0.2);

  let jumpHead = idle;
  for (const emote of ['wave', 'jump', 'spin', 'sleepy', 'walk']) {
    const follow = await page.evaluate((name) => {
      window.__PETS.play(name);
      window.__PETS.pause(0.45);
      return window.__PETS.hatFollow();
    }, emote);
    if (emote === 'jump') jumpHead = follow;
    expect(Math.abs(follow.gap - idle.gap), `${emote} keeps the hat on the head`).toBeLessThan(0.02);
    expect(await page.evaluate(() => window.__PETS.mode)).toBe(emote);
  }
  expect(jumpHead.headY - idle.headY).toBeGreaterThan(0.05);
  expect(jumpHead.hatY - idle.hatY).toBeGreaterThan(0.05);

  await page.evaluate(() => {
    window.__PETS.resume();
    window.__PETS.setHeight(1);
    window.__PETS.setBody(1);
  });
  for (const [label, mode] of [['Wave', 'wave'], ['Jump', 'jump'], ['Spin', 'spin'], ['Sleepy', 'sleepy'], ['Walk', 'walk']]) {
    await page.evaluate(() => { window.__PETS.timeScale = 1; });
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__PETS.mode)).toBe(mode);
    await page.evaluate(() => { window.__PETS.timeScale = 30; });
    await expect.poll(() => page.evaluate(() => window.__PETS.mode)).toBe('idle');
  }
  await page.evaluate(() => { window.__PETS.timeScale = 1; });

  const canvas = page.locator('#stage');
  const box = await canvas.boundingBox();
  const yaw0 = await page.evaluate(() => window.__PETS.yaw);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const yaw1 = await page.evaluate(() => window.__PETS.yaw);
  expect(Math.abs(yaw1 - yaw0)).toBeGreaterThan(0.3);

  const zoom0 = await page.evaluate(() => window.__PETS.zoom);
  await page.mouse.wheel(0, 280);
  const zoom1 = await page.evaluate(() => window.__PETS.zoom);
  expect(zoom1).toBeGreaterThan(zoom0);
  expect(zoom1).toBeLessThanOrEqual(8.4);
  expect(zoom1).toBeGreaterThanOrEqual(2.8);

  await page.evaluate(async () => {
    await window.__PETS.setAnimal('tiger');
    window.__PETS.setNatural();
    window.__PETS.setHeight(1);
    window.__PETS.setBody(1);
    window.__PETS.setEyes('round');
    window.__PETS.setCheeks(true);
    window.__PETS.setHat(false);
    window.__PETS.yaw = -0.42;
    window.__PETS.zoom = 6.85;
    window.__PETS.lookY = 1.45;
    window.__PETS.camY = 1.5;
    window.__PETS.play('wave');
    window.__PETS.pause(0.2);
  });
  await shown(page, 'tiger');
  await page.screenshot({ path: '/opt/cursor/artifacts/pets-lineup-or-picker.png' });

  await page.evaluate(async () => {
    await window.__PETS.setAnimal('bunny');
    window.__PETS.setColor('#7C3AED');
    window.__PETS.setHat(true);
    window.__PETS.setEyes('round');
    window.__PETS.setCheeks(true);
    window.__PETS.yaw = -0.4;
    window.__PETS.zoom = 6.85;
    window.__PETS.lookY = 1.45;
    window.__PETS.camY = 1.5;
    window.__PETS.play('idle');
    window.__PETS.pause(0.2);
  });
  await shown(page, 'bunny');
  expect(await page.evaluate(() => window.__PETS.color.toLowerCase())).toBe('#7c3aed');
  await page.screenshot({ path: '/opt/cursor/artifacts/pets-custom-hat.png' });

  const faceSheet = await page.evaluate(async () => {
    window.__PETS.setHat(false);
    window.__PETS.setNatural();
    return window.__PETS.captureFaceSheet(['cat', 'dog', 'penguin', 'bunny']);
  });
  fs.mkdirSync('/opt/cursor/artifacts', { recursive: true });
  fs.writeFileSync('/opt/cursor/artifacts/pets-faces.png', Buffer.from(faceSheet.split(',')[1], 'base64'));
  await page.evaluate(() => window.__PETS.clearFaceGrid());

  await page.evaluate(() => window.__PETS.resume());
  await page.waitForTimeout(2200);
  const fps = await page.evaluate(() => window.__PETS.fps());
  console.log(`Approximate headless FPS: ${fps.toFixed(1)}`);
  expect(Number.isFinite(fps)).toBe(true);
  expect(fps).toBeGreaterThan(0);
  expect(errors, 'no console errors after interaction').toEqual([]);
});

test('pet preview on a desktop', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const { errors, external } = await openPets(page);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.__PETS.pixelScore())).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Hat', exact: true }).click();
  await page.getByRole('button', { name: 'Wave', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PETS.mode)).toBe('wave');
  await context.close();
});

test('service worker does not cache the pet preview', async ({ request }) => {
  const response = await request.get('/sw.js');
  const text = await response.text();
  expect(text).toContain("url.pathname.includes('/pets-preview')");
  const assets = text.slice(text.indexOf('const ASSETS'), text.indexOf('];'));
  expect(assets).not.toContain('pets-preview');
});
