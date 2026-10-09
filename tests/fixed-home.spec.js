import { test, expect } from '@playwright/test';

// The home screen stays still: only the goals list scrolls, and other screens
// and sheets scroll inside themselves. The page (body) never scrolls.

const GOALS = [
  'Biology lecture', 'Math homework', 'Read chapter 5', 'Gym session', 'Group project call',
  'Essay outline', 'Lab report', 'Study for quiz', 'Laundry', 'Call grandma',
  'Practice guitar', 'Spanish flashcards', 'Clean desk', 'Plan weekend', 'Water plants',
];
const SIZES = [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 1280, height: 800 },
];

async function skipToToday(page) {
  await page.addInitScript(() => { window.__DAYLI_NOW = new Date('2026-10-09T09:00:00-03:00').getTime(); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue' }).click();
  const skip = page.getByRole('button', { name: 'Skip for now' });
  const notNow = page.getByRole('button', { name: 'Not now' });
  await expect(skip.or(notNow)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await notNow.click();
  await page.getByRole('button', { name: 'This is my pet' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();
  await page.waitForFunction(() => ['ready', 'fallback'].includes(document.querySelector('#pet-hero')?.dataset.state));
}

async function addGoals(page) {
  for (const title of GOALS) {
    await page.getByRole('button', { name: 'Add a class or task' }).click();
    await page.getByLabel('What?').fill(title);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('#edit-sheet')).toHaveCount(0);
  }
  await expect(page.locator('#day-list .card')).toHaveCount(GOALS.length);
}

const pageScroll = (page) => page.evaluate(() => ({
  win: window.scrollY,
  doc: document.scrollingElement.scrollTop,
  body: document.body.scrollTop,
  fits: document.documentElement.scrollHeight <= window.innerHeight + 1,
}));

function inside(box, size) {
  return box.y >= -1 && box.x >= -1 && box.y + box.height <= size.height + 1 && box.x + box.width <= size.width + 1;
}

test('goals list scrolls while the header and pet stay still', async ({ page }) => {
  await skipToToday(page);
  await addGoals(page);
  const list = page.locator('#day-list');

  for (const size of SIZES) {
    await page.setViewportSize(size);
    await list.evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(150);

    const header = page.locator('main.today > header');
    const pet = page.locator('#pet-hero');
    const headerBefore = await header.boundingBox();
    const petBefore = await pet.boundingBox();
    // The pet is fully on screen and a useful size.
    expect(inside(petBefore, size), `pet visible at ${size.width}x${size.height}`).toBe(true);
    expect(petBefore.height).toBeGreaterThanOrEqual(120);
    // The list has its own scroll area that holds more than fits.
    const metrics = await list.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, oy: getComputedStyle(el).overflowY }));
    expect(metrics.oy).toBe('auto');
    expect(metrics.sh).toBeGreaterThan(metrics.ch);
    expect(metrics.ch).toBeGreaterThanOrEqual(140);

    const listBox = await list.boundingBox();
    expect(listBox.y + listBox.height).toBeLessThanOrEqual(size.height + 1);
    await page.mouse.move(listBox.x + listBox.width / 2, listBox.y + Math.min(80, listBox.height / 2));
    await page.mouse.wheel(0, 600);
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);

    expect(await header.boundingBox()).toEqual(headerBefore);
    expect(await pet.boundingBox()).toEqual(petBefore);
    expect(await pageScroll(page)).toEqual({ win: 0, doc: 0, body: 0, fits: true });

    // Every goal can be reached: the last card scrolls fully into view above the bottom edge.
    await list.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const last = await page.locator('#day-list .card').last().boundingBox();
    expect(inside(last, size), `last goal reachable at ${size.width}x${size.height}`).toBe(true);
    expect(await pet.boundingBox()).toEqual(petBefore);
  }
});

test('swiping over the pet scrolls the goals, sideways still turns the pet', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await skipToToday(page);
  await addGoals(page);
  const list = page.locator('#day-list');
  await list.evaluate((el) => { el.scrollTop = 0; });
  const pet = page.locator('#pet-hero');
  const before = await pet.boundingBox();
  const cdp = await context.newCDPSession(page);
  const swipe = async (dx, dy) => {
    const x = Math.round(before.x + before.width * 0.5);
    const y = Math.round(before.y + before.height * 0.7);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 12; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.round(x + (dx * i) / 12), y: Math.round(y + (dy * i) / 12) }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(500);
  };
  await swipe(0, -160);
  expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(60);
  expect(await pet.boundingBox()).toEqual(before);
  expect((await pageScroll(page)).win).toBe(0);

  const scrolled = await list.evaluate((el) => el.scrollTop);
  const yaw = await page.evaluate(() => window.__dayli.petYaw());
  await swipe(-160, 4);
  expect(await list.evaluate((el) => el.scrollTop)).toBe(scrolled);
  if (yaw != null) expect(Math.abs(await page.evaluate(() => window.__dayli.petYaw()) - yaw)).toBeGreaterThan(0.5);
  await context.close();
});

test('ticking a goal keeps the list where it was', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await skipToToday(page);
  await addGoals(page);
  const list = page.locator('#day-list');
  await list.evaluate((el) => { el.scrollTop = 260; });
  const card = page.locator('#day-list .card').nth(6);
  await card.getByRole('button', { name: /^Mark .* done/ }).click();
  await page.waitForTimeout(300);
  expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(150);
});

test('settings scroll inside themselves and the page stays put', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await skipToToday(page);
  await page.getByRole('button', { name: 'Customize' }).click();
  await expect(page.getByRole('heading', { name: 'Customize' })).toBeVisible();
  const app = page.locator('#app');
  const target = page.getByRole('heading', { name: 'Your data' });
  const off = await target.boundingBox();
  expect(off.y).toBeGreaterThan(667);

  await page.mouse.move(187, 400);
  for (let i = 0; i < 40; i += 1) {
    const box = await target.boundingBox();
    if (box.y + box.height <= 667 && box.y >= 0) break;
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(60);
  }
  const box = await target.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(667);
  expect(await app.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  expect(await pageScroll(page)).toEqual({ win: 0, doc: 0, body: 0, fits: true });

  // Coming back home starts at the top of the home screen with the pet in view.
  await page.getByRole('button', { name: 'Back', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();
  expect(await app.evaluate((el) => el.scrollTop)).toBe(0);
  expect(inside(await page.locator('#pet-hero').boundingBox(), { width: 375, height: 667 })).toBe(true);
});

test('add-goal and describe-my-week fields stay visible on a keyboard-sized screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await skipToToday(page);
  // Roughly what is left above an on-screen keyboard on a short phone.
  const small = { width: 375, height: 360 };

  await page.getByRole('button', { name: 'Add a class or task' }).click();
  await page.setViewportSize(small);
  const what = page.getByLabel('What?');
  await what.focus();
  await page.waitForTimeout(400);
  expect(inside(await what.boundingBox(), small)).toBe(true);
  const sheet = page.locator('#edit-sheet .sheet');
  const sb = await sheet.boundingBox();
  expect(sb.y).toBeGreaterThanOrEqual(0);
  expect(sb.y + sb.height).toBeLessThanOrEqual(small.height + 1);
  await what.fill('Short screen goal');
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await save.scrollIntoViewIfNeeded();
  expect(inside(await save.boundingBox(), small)).toBe(true);
  await save.click();
  await expect(page.locator('#edit-sheet')).toHaveCount(0);
  expect((await pageScroll(page)).win).toBe(0);

  await page.getByRole('button', { name: 'Describe my week' }).click();
  const box = page.getByRole('textbox').first();
  await expect(box).toBeFocused();
  await page.waitForTimeout(400);
  expect(inside(await box.boundingBox(), small)).toBe(true);
  expect((await pageScroll(page)).win).toBe(0);
  await page.setViewportSize({ width: 375, height: 667 });
});
