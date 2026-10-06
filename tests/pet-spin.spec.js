import { test, expect } from '@playwright/test';

const ART = '/opt/cursor/artifacts';
const REST = -0.42;

function at(isoWithOffset) {
  return new Date(isoWithOffset).getTime();
}

async function useClock(page, iso) {
  const start = at(iso);
  await page.addInitScript((initial) => {
    window.__DAYLI_NOW = initial;
  }, start);
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

async function dragPet(page, dx) {
  const box = await page.locator('#pet-hero').boundingBox();
  const y = box.y + box.height * 0.58;
  const startX = box.x + Math.min(box.width * 0.7, box.width - 24);
  await page.mouse.move(startX, y);
  await page.mouse.down();
  const steps = 28;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(startX + (dx * i) / steps, y);
  }
  await page.waitForTimeout(140);
  await page.mouse.up();
  await page.waitForTimeout(40);
}

async function turnTo(page, target) {
  for (let n = 0; n < 3; n += 1) {
    const yaw = await yawOf(page);
    let delta = target - yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    if (Math.abs(delta) < 0.12) return yaw;
    const dx = -delta / 0.014;
    await dragPet(page, dx);
  }
  return yawOf(page);
}

async function touchDrag(page, dx, dy = 0) {
  const box = await page.locator('#pet-hero').boundingBox();
  const startX = box.x + box.width * 0.62;
  const startY = box.y + box.height * 0.5;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: Math.round(startX), y: Math.round(startY) }],
  });
  const steps = 16;
  for (let i = 1; i <= steps; i += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{
        x: Math.round(startX + (dx * i) / steps),
        y: Math.round(startY + (dy * i) / steps),
      }],
    });
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(120);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function canvasEdges(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('#pet-hero canvas');
    if (!canvas) return null;
    const w = canvas.width;
    const h = canvas.height;
    const copy = document.createElement('canvas');
    copy.width = w;
    copy.height = h;
    const g = copy.getContext('2d', { willReadFrequently: true });
    g.drawImage(canvas, 0, 0);
    const img = g.getImageData(0, 0, w, h).data;
    const band = 3;
    const edges = { top: 0, bottom: 0, left: 0, right: 0, center: 0 };
    const alphaAt = (x, y) => img[(y * w + x) * 4 + 3];
    for (let x = 0; x < w; x += 1) {
      for (let y = 0; y < band; y += 1) {
        edges.top = Math.max(edges.top, alphaAt(x, y));
        edges.bottom = Math.max(edges.bottom, alphaAt(x, h - 1 - y));
      }
    }
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < band; x += 1) {
        edges.left = Math.max(edges.left, alphaAt(x, y));
        edges.right = Math.max(edges.right, alphaAt(w - 1 - x, y));
      }
    }
    edges.center = alphaAt(Math.floor(w / 2), Math.floor(h / 2));
    return { w, h, ...edges };
  });
}

test('drag, spin, and framing at phone and desktop size', async ({ browser }) => {
  test.setTimeout(180_000);
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

  const before = await yawOf(page);
  expect(before).toBeCloseTo(REST, 2);
  await dragPet(page, 160);
  const dragged = await yawOf(page);
  expect(Math.abs(dragged - before)).toBeGreaterThan(0.8);
  await expect(page.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();

  await page.waitForTimeout(450);
  await page.getByRole('button', { name: 'Your pet' }).click();
  await expect(page.getByRole('heading', { name: 'Your pet' })).toBeVisible();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();

  for (const title of ['Morning lecture', 'Afternoon lab', 'Essay block', 'Gym']) {
    await page.getByRole('button', { name: 'Add a class or task' }).click();
    await page.getByLabel('What?').fill(title);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await touchDrag(page, 0, -220);
  const scrollAfter = await page.evaluate(() => window.scrollY);
  expect(scrollAfter).toBeGreaterThan(scrollBefore + 30);
  await expect(page.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();

  await page.evaluate(() => window.scrollTo(0, 0));
  const yawBeforeTouch = await yawOf(page);
  await touchDrag(page, -180, 8);
  const yawAfterTouch = await yawOf(page);
  expect(Math.abs(yawAfterTouch - yawBeforeTouch)).toBeGreaterThan(0.7);
  await expect(page.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();

  await page.getByRole('button', { name: 'Your pet' }).click();
  await page.getByRole('button', { name: 'Cat', exact: true }).click();
  await page.getByRole('button', { name: 'Shop', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pet Shop' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Spin', exact: true })).toBeVisible();

  const shopYaw = await yawOf(page);
  await page.getByRole('button', { name: 'Spin', exact: true }).click();
  await page.waitForTimeout(280);
  const midSpin = await yawOf(page);
  expect(Math.abs(midSpin - shopYaw)).toBeGreaterThan(0.4);
  await page.waitForTimeout(1200);
  await expect(page.getByRole('heading', { name: 'Pet Shop' })).toBeVisible();

  await page.locator('.pet-open').dblclick();
  await page.waitForTimeout(200);
  await expect(page.getByRole('heading', { name: 'Pet Shop' })).toBeVisible();
  await page.waitForTimeout(600);
  await expect(page.getByRole('heading', { name: 'Pet Shop' })).toBeVisible();

  await page.getByRole('tab', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Butterfly Wings', exact: true }).click();
  await expect(page.getByText('Trying on')).toBeVisible();
  await page.waitForTimeout(500);
  await turnTo(page, REST + Math.PI);
  const wingEdges = await canvasEdges(page);
  expect(wingEdges.center).toBeGreaterThan(20);
  expect(wingEdges.left).toBeLessThan(24);
  expect(wingEdges.right).toBeLessThan(24);
  expect(wingEdges.top).toBeLessThan(24);
  await page.screenshot({ path: `${ART}/spin-back-wings.png` });

  await page.getByRole('tab', { name: 'Effects', exact: true }).click();
  await page.getByRole('button', { name: 'Rainbow Aura', exact: true }).click();
  await page.waitForTimeout(400);
  await turnTo(page, REST + Math.PI / 2);
  const auraEdges = await canvasEdges(page);
  expect(auraEdges.left).toBeLessThan(24);
  expect(auraEdges.right).toBeLessThan(24);
  expect(auraEdges.top).toBeLessThan(24);
  expect(auraEdges.bottom).toBeLessThan(40);
  await page.screenshot({ path: `${ART}/spin-side-aura.png` });

  await page.evaluate(() => {
    const wardrobe = window.__dayli.getState().settings.wardrobe;
    wardrobe.owned.jetpack = { at: null, source: 'buy' };
    wardrobe.owned.backpack = { at: null, source: 'buy' };
    wardrobe.owned.cape = { at: null, source: 'buy' };
    wardrobe.outfit.back = 'jetpack';
    wardrobe.outfit.effect = null;
  });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Closet', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My Closet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Spin', exact: true })).toBeVisible();
  await page.waitForTimeout(400);
  await turnTo(page, REST + Math.PI);
  const jetEdges = await canvasEdges(page);
  expect(jetEdges.left).toBeLessThan(24);
  expect(jetEdges.right).toBeLessThan(24);
  await page.screenshot({ path: `${ART}/spin-back-jetpack.png` });

  await page.evaluate(() => {
    const wardrobe = window.__dayli.getState().settings.wardrobe;
    wardrobe.outfit.back = 'cape';
  });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Closet', exact: true }).click();
  await page.waitForTimeout(300);
  await turnTo(page, REST + Math.PI);
  const capeEdges = await canvasEdges(page);
  expect(capeEdges.left).toBeLessThan(24);
  expect(capeEdges.right).toBeLessThan(24);

  await page.evaluate(() => {
    const wardrobe = window.__dayli.getState().settings.wardrobe;
    wardrobe.outfit.back = null;
    wardrobe.outfit.effect = 'rainbow_aura';
  });
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();
  await page.waitForTimeout(500);
  await turnTo(page, REST + Math.PI / 2);
  const todayAura = await canvasEdges(page);
  expect(todayAura.left).toBeLessThan(24);
  expect(todayAura.right).toBeLessThan(24);
  expect(todayAura.top).toBeLessThan(24);

  await page.evaluate(() => {
    window.__dayli.getState().settings.wardrobe.outfit.effect = null;
  });
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.waitForTimeout(300);
  await turnTo(page, REST - 0.9);
  await page.screenshot({ path: `${ART}/spin-today.png` });
  await page.waitForTimeout(4200);
  const settled = await yawOf(page);
  expect(Math.abs(settled - REST)).toBeLessThan(0.2);
  await phone.close();

  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    timezoneId: 'America/Toronto',
  });
  const wide = await desktop.newPage();
  await useClock(wide, '2026-09-25T15:00:00-04:00');
  await skipToToday(wide);
  await expect(wide.locator('#pet-hero')).toHaveAttribute('data-state', 'ready');
  const deskBefore = await yawOf(wide);
  await dragPet(wide, -200);
  expect(Math.abs((await yawOf(wide)) - deskBefore)).toBeGreaterThan(0.8);
  await expect(wide.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();
  await wide.waitForTimeout(450);
  await wide.getByRole('button', { name: 'Your pet' }).click();
  await wide.getByRole('button', { name: 'Shop', exact: true }).click();
  await wide.getByRole('tab', { name: 'Back', exact: true }).click();
  await wide.getByRole('button', { name: 'Butterfly Wings', exact: true }).click();
  await wide.waitForTimeout(400);
  await turnTo(wide, REST + Math.PI);
  const deskWings = await canvasEdges(wide);
  expect(deskWings.left).toBeLessThan(24);
  expect(deskWings.right).toBeLessThan(24);
  expect(deskWings.top).toBeLessThan(24);
  await wide.getByRole('tab', { name: 'Effects', exact: true }).click();
  await wide.getByRole('button', { name: 'Rainbow Aura', exact: true }).click();
  await wide.waitForTimeout(300);
  await turnTo(wide, REST + Math.PI / 2);
  const deskAura = await canvasEdges(wide);
  expect(deskAura.left).toBeLessThan(24);
  expect(deskAura.right).toBeLessThan(24);
  await desktop.close();
});
