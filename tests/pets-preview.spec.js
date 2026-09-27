const { test, expect } = require('@playwright/test');

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
  return watched;
}

test('pet preview on a phone', async ({ page }) => {
  const { errors, external } = await openPets(page);
  expect(external, 'no third-party requests').toEqual([]);
  expect(errors, 'no console errors').toEqual([]);

  await page.getByRole('button', { name: 'Cat', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PETS.animal)).toBe('cat');
  await page.getByRole('button', { name: 'Bunny', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PETS.animal)).toBe('bunny');
  await page.getByRole('button', { name: 'Penguin', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__PETS.animal)).toBe('penguin');
  expect(await page.evaluate(() => window.__PETS.pixelScore())).toBeGreaterThan(0);

  await page.locator('#pet-height').fill('1.35');
  await expect.poll(() => page.evaluate(() => window.__PETS.height)).toBeCloseTo(1.35, 2);
  await page.locator('#pet-body').fill('1.2');
  await expect.poll(() => page.evaluate(() => window.__PETS.body)).toBeCloseTo(1.2, 2);

  await page.getByRole('button', { name: 'Colour #FF4D1A' }).click();
  await expect.poll(() => page.evaluate(() => window.__PETS.color)).toBe('#FF4D1A');
  await page.locator('#pet-colour').fill('#00c2a8');
  await expect.poll(() => page.evaluate(() => window.__PETS.color.toLowerCase())).toBe('#00c2a8');

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
  const attached = await page.evaluate(() => window.__PETS.hatOffset());
  expect(attached).toBeGreaterThan(0.2);

  for (const emote of ['wave', 'jump', 'spin', 'sleepy', 'walk']) {
    const distance = await page.evaluate((name) => {
      window.__PETS.play(name);
      window.__PETS.pause(0.4);
      return window.__PETS.hatOffset();
    }, emote);
    expect(Math.abs(distance - attached), `${emote} keeps the hat on the head`).toBeLessThan(0.02);
    expect(await page.evaluate(() => window.__PETS.mode)).toBe(emote);
  }

  await page.evaluate(() => window.__PETS.resume());
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
  expect(zoom1).toBeLessThanOrEqual(7.2);
  expect(zoom1).toBeGreaterThanOrEqual(2.8);

  await page.evaluate(() => {
    window.__PETS.yaw = 0.15;
    window.__PETS.setAnimal('penguin');
    window.__PETS.setHeight(1);
    window.__PETS.setBody(1);
    window.__PETS.setColor('#3B5BDB');
    window.__PETS.setEyes('round');
    window.__PETS.setCheeks(true);
    window.__PETS.setHat(false);
    window.__PETS.play('wave');
    window.__PETS.pause(0.35);
  });
  await page.screenshot({ path: '/opt/cursor/artifacts/pets-penguin.png' });

  await page.evaluate(() => {
    window.__PETS.resume();
    window.__PETS.setAnimal('bunny');
    window.__PETS.setColor('#7C3AED');
    window.__PETS.setHat(true);
    window.__PETS.setEyes('round');
    window.__PETS.setCheeks(true);
    window.__PETS.yaw = -0.35;
    window.__PETS.play('idle');
    window.__PETS.pause(0.2);
  });
  await page.screenshot({ path: '/opt/cursor/artifacts/pets-bunny-hat.png' });
  expect(await page.evaluate(() => window.__PETS.pixelScore())).toBeGreaterThan(0);

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
