import { test, expect } from '@playwright/test';

const REST = -0.42;

function at(isoWithOffset) {
  return new Date(isoWithOffset).getTime();
}

function wrap(delta) {
  let x = delta;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

async function useClock(page, iso) {
  await page.addInitScript((initial) => {
    window.__DAYLI_NOW = initial;
  }, at(iso));
}

async function skipToToday(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue' }).click();
  const skip = page.getByRole('button', { name: 'Skip for now' });
  const notNow = page.getByRole('button', { name: 'Not now' });
  await expect(skip.or(notNow)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await notNow.click();
  await page.getByRole('button', { name: 'This is my pet' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();
  await page.waitForFunction(() => {
    const el = document.querySelector('#pet-hero');
    return el && (el.dataset.state === 'ready' || el.dataset.state === 'fallback');
  });
}

async function yawOf(page) {
  return page.evaluate(() => window.__dayli.petYaw());
}

async function resetToday(page) {
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();
  await page.waitForFunction(() => document.querySelector('#pet-hero')?.dataset.state === 'ready');
}

async function mouseDrag(page, dx) {
  const box = await page.locator('#pet-hero').boundingBox();
  const y = box.y + box.height * 0.58;
  const startX = box.x + box.width * 0.5;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  const steps = 40;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(startX + (dx * i) / steps, y);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(140);
  await page.mouse.up();
  await page.waitForTimeout(40);
}

async function touchPath(page, deltas) {
  const box = await page.locator('#pet-hero').boundingBox();
  const startX = box.x + box.width * 0.5;
  const startY = box.y + box.height * 0.5;
  const cdp = await page.context().newCDPSession(page);
  const samples = [];
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ id: 1, x: Math.round(startX), y: Math.round(startY) }],
  });
  let x = startX;
  for (const leg of deltas) {
    const steps = leg.steps || 20;
    for (let i = 1; i <= steps; i += 1) {
      x += leg.dx / steps;
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ id: 1, x: Math.round(x), y: Math.round(startY) }],
      });
      await page.waitForTimeout(leg.wait ?? 20);
    }
    if (leg.sample) samples.push({ at: leg.sample, yaw: await yawOf(page) });
  }
  await page.waitForTimeout(140);
  const beforeUp = await yawOf(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
  await page.waitForTimeout(40);
  return { samples, beforeUp, afterUp: await yawOf(page) };
}

test('touch drag follows the finger the same way a mouse drag does', async ({ browser }) => {
  test.setTimeout(90_000);
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    timezoneId: 'America/Toronto',
    deviceScaleFactor: 1,
  });
  const page = await phone.newPage();
  await useClock(page, '2026-09-25T15:00:00-04:00');
  await skipToToday(page);
  await expect(page.locator('#pet-hero')).toHaveAttribute('data-state', 'ready');

  const rest = await yawOf(page);
  expect(rest).toBeCloseTo(REST, 2);
  await mouseDrag(page, -200);
  const mouseDelta = wrap((await yawOf(page)) - rest);

  await resetToday(page);
  const touchRest = await yawOf(page);
  const slow = await touchPath(page, [{ dx: -200, steps: 40, wait: 24 }]);
  const touchDelta = wrap(slow.afterUp - touchRest);
  // 200px is about 160 degrees. The old bug stopped near 104 and then coasted.
  expect(Math.abs(touchDelta - mouseDelta)).toBeLessThan(0.2);
  expect(Math.abs(touchDelta)).toBeGreaterThan(2.4);

  await resetToday(page);
  const revRest = await yawOf(page);
  const rev = await touchPath(page, [
    { dx: -100, steps: 20, wait: 20, sample: 'left' },
    { dx: 100, steps: 20, wait: 20, sample: 'back' },
  ]);
  const left = wrap(rev.samples.find((s) => s.at === 'left').yaw - revRest);
  const back = wrap(rev.samples.find((s) => s.at === 'back').yaw - revRest);
  expect(left).toBeGreaterThan(1.0);
  // Turning back toward the start must undo the first half, not keep spinning.
  expect(Math.abs(back)).toBeLessThan(0.35);
  expect(Math.abs(back)).toBeLessThan(Math.abs(left) * 0.4);
  await phone.close();
});

test('shop and closet taps stay put, and a worn item says Wearing', async ({ browser }) => {
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    timezoneId: 'America/Toronto',
    deviceScaleFactor: 1,
  });
  const page = await phone.newPage();
  await useClock(page, '2026-09-25T15:00:00-04:00');
  await skipToToday(page);
  await page.evaluate(() => {
    const wardrobe = window.__dayli.getState().settings.wardrobe;
    wardrobe.owned.party_hat = { at: null, source: 'buy' };
    wardrobe.owned.beanie = { at: null, source: 'buy' };
    wardrobe.outfit.hat = 'party_hat';
  });

  await page.getByRole('button', { name: 'Your pet' }).click();
  await expect(page.getByRole('heading', { name: 'Your pet' })).toBeVisible();
  await page.getByRole('button', { name: 'Shop', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pet Shop' })).toBeVisible();

  const party = page.getByRole('button', { name: 'Party Hat', exact: true });
  const beanie = page.getByRole('button', { name: 'Beanie', exact: true });
  await expect(party).toContainText('Wearing');
  await expect(beanie).toContainText('Wear');
  await expect(beanie).not.toContainText('Wearing');
  const pillFits = await party.evaluate((el) => {
    const pill = el.querySelector('.shop-pill');
    const tile = el.getBoundingClientRect();
    const box = pill.getBoundingClientRect();
    return pill.textContent === 'Wearing' && box.width <= tile.width - 8 && pill.scrollWidth <= pill.clientWidth + 1;
  });
  expect(pillFits).toBe(true);
  await page.screenshot({ path: '/opt/cursor/artifacts/shop-wearing.png' });

  await beanie.click();
  await expect(page.getByText('Trying on')).toBeVisible();
  await page.locator('.pet-open').click();
  await page.waitForTimeout(700);
  await expect(page.getByRole('heading', { name: 'Pet Shop' })).toBeVisible();
  await expect(page.getByText('Trying on')).toBeVisible();

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Closet', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My Closet' })).toBeVisible();
  await page.locator('.pet-open').click();
  await page.waitForTimeout(700);
  await expect(page.getByRole('heading', { name: 'My Closet' })).toBeVisible();

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();
  await page.getByRole('button', { name: 'Your pet' }).click();
  await expect(page.getByRole('heading', { name: 'Your pet' })).toBeVisible();
  await phone.close();
});
