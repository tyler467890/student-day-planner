import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';

const ART = '/opt/cursor/artifacts';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

function at(isoWithOffset) {
  return new Date(isoWithOffset).getTime();
}

/** Date-only clock. Does not pause timers, so IndexedDB writes still finish. */
async function useClock(page, iso) {
  const start = at(iso);
  await page.addInitScript((initial) => {
    const stored = localStorage.getItem('dayli-clock');
    window.__DAYLI_NOW = stored ? Number(stored) : initial;
  }, start);
}

async function setClock(page, iso, { check = true } = {}) {
  const ms = at(iso);
  await page.evaluate(({ t, check }) => {
    window.__DAYLI_NOW = t;
    localStorage.setItem('dayli-clock', String(t));
    if (check) {
      document.dispatchEvent(new Event('visibilitychange'));
      window.__dayli?.checkReminders?.();
    }
  }, { t: ms, check });
}

async function skipToToday(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue' }).click();
  const skip = page.getByRole('button', { name: 'Skip for now' });
  const notNow = page.getByRole('button', { name: 'Not now' });
  await expect(skip.or(notNow)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await notNow.click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

async function addItem(page, { title, category, difficulty, time, days, remind, save = 'click' }) {
  await page.getByRole('button', { name: 'Add a class or task' }).click();
  const field = page.getByLabel('What?');
  await field.fill(title);
  if (category) await page.getByRole('radio', { name: new RegExp(category, 'i') }).click();
  if (difficulty) await page.getByRole('radio', { name: new RegExp(`^${difficulty}`, 'i') }).click();
  if (time) await page.getByLabel('Time').fill(time);
  if (days) {
    await page.getByRole('radio', { name: 'Pick days' }).click();
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      const btn = page.getByRole('button', { name: day, exact: true });
      const pressed = await btn.getAttribute('aria-pressed');
      const want = days.includes(day);
      if (want && pressed !== 'true') await btn.click();
      if (!want && pressed === 'true') await btn.click();
    }
  }
  if (remind != null) await page.getByLabel('Remind me').selectOption(String(remind));
  if (save === 'enter') await field.press('Enter');
  else await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.card-title', { hasText: title }).first()).toBeVisible();
}

async function openCard(page, title) {
  await page.locator('.card-main', { hasText: title }).first().click();
}

test('first launch shows 3 steps and step 1 cannot be skipped', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Make it yours' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip for now' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Not now' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Put it on your Home Screen' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('heading', { name: 'Want a nudge before classes and tasks?' })).toBeVisible();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByText('Nothing planned yet. Add your first class or task.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toBeVisible();
});

test('iPhone shows install steps; standalone skips step 2 and enables reminders', async ({ browser }) => {
  const iphone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: IPHONE,
    timezoneId: 'America/Toronto',
  });
  const page = await iphone.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('list').getByText('Add to Home Screen', { exact: true })).toBeVisible();
  await expect(page.getByText('Open as Web App, then Add')).toBeVisible();
  await expect(page.getByText('Tap Share')).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('button', { name: 'Turn on reminders' })).toBeDisabled();
  await expect(page.getByText('Add to Home Screen first to get reminders on iPhone.')).toBeVisible();
  await iphone.close();

  const standalone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: IPHONE,
    timezoneId: 'America/Toronto',
  });
  await standalone.addInitScript(() => {
    const orig = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      if (String(query).includes('display-mode: standalone')) {
        return {
          matches: true,
          media: String(query),
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
          dispatchEvent() { return false; },
          onchange: null,
        };
      }
      return orig(query);
    };
  });
  const installed = await standalone.newPage();
  await installed.goto('/');
  await installed.getByRole('button', { name: 'Continue' }).click();
  await expect(installed.getByRole('heading', { name: 'Want a nudge before classes and tasks?' })).toBeVisible();
  await expect(installed.getByRole('heading', { name: 'Put it on your Home Screen' })).toHaveCount(0);
  await expect(installed.getByRole('button', { name: 'Turn on reminders' })).toBeEnabled();
  await standalone.close();
});

test('desktop shows install instructions and an Install button when a prompt exists', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(/Install app or Add to Home Screen|Install app, or bookmark/)).toBeVisible();
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    event.prompt = () => Promise.resolve();
    event.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(event);
  });
  await expect(page.getByRole('button', { name: 'Install app' })).toBeVisible();
});

test('notification permission is requested only from Turn on reminders', async ({ context, page }) => {
  await context.grantPermissions(['notifications']);
  await context.addInitScript(() => {
    window.__permCalls = 0;
    const orig = Notification.requestPermission.bind(Notification);
    Notification.requestPermission = (...args) => {
      window.__permCalls += 1;
      return orig(...args);
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('button', { name: 'Turn on reminders' })).toBeVisible();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__permCalls)).toBe(0);
  await page.getByRole('button', { name: 'Turn on reminders' }).click();
  await expect.poll(() => page.evaluate(() => window.__permCalls)).toBe(1);
});

test('enter saves a title with defaults; class defaults are medium, 50 min, 10 min remind', async ({ page }) => {
  await skipToToday(page);
  await page.getByRole('button', { name: 'Add a class or task' }).click();
  await page.getByLabel('What?').fill('Finish essay intro');
  await page.getByLabel('What?').press('Enter');
  await expect(page.locator('.card-title', { hasText: 'Finish essay intro' })).toBeVisible();
  await expect(page.locator('.tag-easy')).toBeVisible();
  const easy = await page.evaluate(() => window.__dayli.getState().tasks[0]);
  expect(easy.difficulty).toBe('easy');
  expect(easy.remindLeadMin).toBeNull();

  await addItem(page, {
    title: 'Biology 101',
    category: 'Class',
    time: '09:00',
    days: ['Monday', 'Wednesday', 'Friday'],
  });
  const bio = await page.evaluate(() => window.__dayli.getState().tasks.find((t) => t.title === 'Biology 101'));
  expect(bio.difficulty).toBe('medium');
  expect(bio.durationMin).toBe(50);
  expect(bio.remindLeadMin).toBe(10);
  expect(bio.repeat).toBe('days');
  expect(bio.days.sort()).toEqual([1, 3, 5]);
});

test('MWF classes show on those days only; just today and all repeats both work', async ({ page }) => {
  await useClock(page, '2026-09-21T10:00:00-04:00');
  await skipToToday(page);
  for (const title of ['Biology 101', 'Chemistry lab', 'English seminar']) {
    await addItem(page, {
      title,
      category: 'Class',
      time: title === 'Chemistry lab' ? '11:00' : title === 'English seminar' ? '13:00' : '09:00',
      days: ['Monday', 'Wednesday', 'Friday'],
    });
  }
  await expect(page.locator('.card-title')).toHaveCount(3);
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.locator('.card-title')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.locator('.card-title')).toHaveCount(3);

  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await openCard(page, 'Biology 101');
  await page.getByLabel('What?').fill('Biology lab');
  await page.getByRole('radio', { name: 'This day only' }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.card-title', { hasText: 'Biology lab' })).toBeVisible();
  await page.getByRole('button', { name: 'Next day' }).click();
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.locator('.card-title', { hasText: 'Biology 101' })).toBeVisible();
  await expect(page.locator('.card-title', { hasText: 'Biology lab' })).toHaveCount(0);

  await openCard(page, 'Biology 101');
  await page.getByLabel('What?').fill('Bio lecture');
  await page.getByRole('radio', { name: 'All repeats' }).check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.card-title', { hasText: 'Bio lecture' })).toBeVisible();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await page.getByRole('button', { name: 'Previous day' }).click();
  await expect(page.locator('.card-title', { hasText: 'Biology lab' })).toBeVisible();
});

test('move, delete and undo work, including the 5 second toast', async ({ page }) => {
  await useClock(page, '2026-09-25T15:00:00-04:00');
  await skipToToday(page);
  await addItem(page, { title: 'Gym', time: '17:00', save: 'enter' });
  await openCard(page, 'Gym');
  await page.getByRole('button', { name: 'Move to tomorrow' }).click();
  await expect(page.getByText('Nothing planned yet')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.card-title', { hasText: 'Gym' })).toBeVisible();

  await openCard(page, 'Gym');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Nothing planned yet')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.card-title', { hasText: 'Gym' })).toBeVisible();

  await openCard(page, 'Gym');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await page.waitForTimeout(5200);
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
});

test('list and timeline show the same tasks and the timeline has a now line', async ({ page }) => {
  await useClock(page, '2026-09-25T15:00:00-04:00');
  await skipToToday(page);
  await addItem(page, { title: 'Biology 101', category: 'Class', time: '09:00' });
  await addItem(page, { title: 'Gym', time: '17:00' });
  await expect(page.locator('.card-title')).toHaveCount(2);
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.card-title')).toHaveCount(2);
  await expect(page.locator('.now-line')).toBeVisible();
  await expect(page.getByText('Now')).toBeVisible();
});

test('layout at 360px and at 1440px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await skipToToday(page);
  await addItem(page, { title: 'Biology 101', time: '09:00' });
  const narrow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  expect(narrow).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  const box = await page.locator('main.shell').boundingBox();
  expect(box.width).toBeLessThanOrEqual(561);
  expect(box.x).toBeGreaterThan(200);
  expect(box.x + box.width).toBeLessThan(1240);
});

test('easy medium and hard points, undo, day complete once, level up once', async ({ page }) => {
  await skipToToday(page);
  await addItem(page, { title: 'Easy task', difficulty: 'Easy' });
  await page.getByRole('button', { name: /Mark Easy task done, easy, 5 points/ }).click();
  await expect(page.getByLabel(/Today's points 5/)).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel(/Today's points 0/)).toBeVisible();

  await page.getByRole('button', { name: /Mark Easy task done, easy, 5 points/ }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await addItem(page, { title: 'Medium task', difficulty: 'Medium' });
  await page.getByRole('button', { name: /Mark Medium task done, medium, 10 points/ }).click();
  await expect(page.getByLabel(/Today's points 10/)).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();

  await addItem(page, { title: 'Hard task', difficulty: 'Hard' });
  await page.getByRole('button', { name: /Mark Hard task done, hard, 20 points/ }).click();
  await expect(page.getByLabel(/Today's points 20/)).toBeVisible();
  await expect(page.locator('.particle').first()).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByLabel(/Today's points 0/)).toBeVisible();
  await openCard(page, 'Hard task');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();

  await page.getByRole('button', { name: /Mark Easy task done, easy, 5 points/ }).click();
  await expect(page.getByRole('dialog', { name: 'Day complete' })).toHaveCount(0);
  await page.getByRole('button', { name: /Mark Medium task done, medium, 10 points/ }).click();
  await expect(page.getByRole('dialog', { name: 'Day complete' })).toBeVisible();
  await expect(page.getByText('+10 bonus')).toBeVisible();
  await expect(page.getByLabel(/Today's points 25/)).toBeVisible();
  await page.getByRole('button', { name: 'Nice' }).click();

  await addItem(page, { title: 'Later task', difficulty: 'Easy' });
  await page.getByRole('button', { name: /Mark Later task done, easy, 5 points/ }).click();
  await expect(page.getByRole('dialog', { name: 'Day complete' })).toHaveCount(0);
  const totalAfter = await page.evaluate(() => window.__dayli.getState());
  const bonus = totalAfter.bonuses.find((b) => b.kind === 'day');
  expect(bonus.points).toBe(10);

  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Add a class or task' }).click();
  await page.getByLabel('What?').fill('Level pusher');
  await page.getByRole('radio', { name: /^Hard/i }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: /Mark Level pusher done, hard, 20 points/ }).click();
  await expect(page.getByRole('button', { name: /Level 2 · Starter/ })).toBeVisible();
  await page.getByRole('button', { name: /Level 2 · Starter/ }).click();
  await page.getByRole('button', { name: 'Add a class or task' }).click();
  await page.getByLabel('What?').fill('Still level 2');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: /Mark Still level 2 done, easy, 5 points/ }).click();
  await expect(page.getByRole('button', { name: /Level \d+ ·/ })).toHaveCount(0);
  const level = await page.evaluate(() => {
    const s = window.__dayli.getState();
    const pts = s.completions.reduce((n, c) => n + c.points, 0) + s.bonuses.reduce((n, b) => n + b.points, 0);
    return { pts, shown: s.settings.highestLevel, fromTable: window.__dayli.model.levelForPoints(pts) };
  });
  expect(level.fromTable).toBe(2);
  expect(level.shown).toBe(2);
  expect(level.pts).toBeGreaterThanOrEqual(40);
  expect(level.pts).toBeLessThan(100);
});

test('streak rest day, second miss, best streak, weekdays only, 4am boundary', async ({ page }) => {
  await useClock(page, '2026-09-21T10:00:00-04:00');
  await skipToToday(page);
  await addItem(page, { title: 'Monday work' });
  await page.getByRole('button', { name: /Mark Monday work done/ }).click();
  await expect(page.getByLabel('Streak, 1 day')).toBeVisible();

  await setClock(page, '2026-09-23T10:00:00-04:00');
  await addItem(page, { title: 'Wednesday work' });
  await page.getByRole('button', { name: /Mark Wednesday work done/ }).click();
  await expect(page.getByLabel('Streak, 2 days')).toBeVisible();
  await page.getByRole('button', { name: /Open progress/ }).click();
  await expect(page.locator('li', { hasText: 'Rest day' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await setClock(page, '2026-09-25T10:00:00-04:00');
  await expect(page.getByLabel('Streak, 0 days')).toBeVisible();
  const guilt = await page.locator('body').innerText();
  expect(guilt).not.toMatch(/You failed|You broke your streak|You missed|OVERDUE/i);
  await page.getByRole('button', { name: /Open progress/ }).click();
  await expect(page.getByText('Best streak: 2 days')).toBeVisible();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('button', { name: 'Weekdays only' }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await setClock(page, '2026-09-25T11:00:00-04:00');
  await addItem(page, { title: 'Friday work' });
  await page.getByRole('button', { name: /Mark Friday work done/ }).click();
  await setClock(page, '2026-09-28T10:00:00-04:00');
  const weekend = await page.evaluate(() => window.__dayli.model.computeStreak(
    window.__dayli.getState().completions.map((c) => c.completedOn),
    window.__dayli.getState().plannerToday,
    { weekdaysOnly: true },
  ));
  expect(weekend.restDays.filter((d) => d === '2026-09-26' || d === '2026-09-27')).toEqual([]);
  expect(weekend.streak).toBeGreaterThanOrEqual(1);
});

test('4:00 AM still counts as the previous planner day', async ({ page }) => {
  await useClock(page, '2026-09-22T03:30:00-04:00');
  await skipToToday(page);
  await expect(page.getByRole('button', { name: 'Mon, Sep 21' })).toBeVisible();
  await addItem(page, { title: 'Late study' });
  await page.getByRole('button', { name: /Mark Late study done/ }).click();
  const completedOn = await page.evaluate(() => window.__dayli.getState().completions[0].completedOn);
  expect(completedOn).toBe('2026-09-21');
  await setClock(page, '2026-09-22T04:00:00-04:00');
  await expect(page.getByRole('button', { name: 'Tue, Sep 22' })).toBeVisible();
});

test('no overdue shame, and celebrations follow subtle, off, and reduced motion', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: 'America/Toronto',
  });
  const page = await context.newPage();
  await useClock(page, '2026-09-25T15:00:00-04:00');
  await skipToToday(page);
  await addItem(page, { title: 'Morning lab', time: '09:00' });
  await expect(page.locator('.earlier')).toHaveText('earlier');
  await expect(page.getByRole('button', { name: 'Move to tomorrow' })).toBeVisible();
  const color = await page.locator('.earlier').evaluate((el) => getComputedStyle(el).color);
  expect(color).not.toBe('rgb(185, 28, 28)');
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/OVERDUE|You failed|You broke your streak|Get productive/i);

  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('button', { name: 'Subtle', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: /Mark Morning lab done/ }).click();
  await expect(page.locator('.points-float')).toBeVisible();
  await expect(page.locator('.particle')).toHaveCount(0);
  await context.close();

  const off = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Toronto' });
  const offPage = await off.newPage();
  await skipToToday(offPage);
  await offPage.getByRole('button', { name: 'Customize' }).click();
  await offPage.getByRole('button', { name: 'Off', exact: true }).click();
  await offPage.getByRole('button', { name: 'Back', exact: true }).click();
  await addItem(offPage, { title: 'Quiet task', difficulty: 'Hard' });
  await offPage.getByRole('button', { name: /Mark Quiet task done/ }).click();
  await expect(offPage.locator('.particle')).toHaveCount(0);
  await expect(offPage.locator('.points-float')).toHaveCount(0);
  await expect(offPage.getByLabel(/Today's points 20/)).toBeVisible();
  await off.close();

  const reduced = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: 'America/Toronto',
    reducedMotion: 'reduce',
  });
  const calm = await reduced.newPage();
  await skipToToday(calm);
  await addItem(calm, { title: 'Calm task', difficulty: 'Hard' });
  await calm.getByRole('button', { name: /Mark Calm task done/ }).click();
  await expect(calm.locator('.particle')).toHaveCount(0);
  await expect(calm.locator('.points-float.is-fade')).toBeVisible();
  const transform = await calm.locator('.points-float').evaluate((el) => getComputedStyle(el).animationName);
  expect(transform === 'none' || transform === 'fade-in').toBe(true);
  await reduced.close();
});

test('open-app reminder banner, system notification, snooze and done', async ({ context, page }) => {
  // Headless Chromium reports Notification.permission as denied, and
  // context.grantPermissions does not change it. Emulate a granted permission.
  await context.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' });
    window.__notes = [];
    const orig = ServiceWorkerRegistration.prototype.showNotification;
    ServiceWorkerRegistration.prototype.showNotification = function show(title, opts) {
      window.__notes.push({ title, body: opts?.body });
      try { return orig.apply(this, arguments); } catch { return Promise.resolve(); }
    };
  });
  await useClock(page, '2026-09-25T10:00:00-04:00');
  await skipToToday(page);
  await page.evaluate(() => navigator.serviceWorker?.ready);
  await addItem(page, { title: 'Biology 101', category: 'Class', time: '10:11', remind: '10' });
  await setClock(page, '2026-09-25T10:01:30-04:00');
  await expect(page.locator('#banner')).toContainText('Biology 101');
  await expect.poll(() => page.evaluate(() => window.__notes.length)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Snooze 10 min' }).click();
  await expect(page.locator('#banner')).toHaveCount(0);
  await setClock(page, '2026-09-25T10:12:00-04:00');
  await expect(page.locator('#banner')).toBeVisible();
  const before = await page.evaluate(() => window.__dayli.getState().completions.length);
  await page.locator('#banner').getByRole('button', { name: 'Done' }).click();
  await expect.poll(() => page.evaluate(() => window.__dayli.getState().completions.length)).toBe(before + 1);
  const points = await page.evaluate(() => window.__dayli.getState().completions.at(-1).points);
  expect(points).toBe(10);
});

test('show task names off sends Coming up and never the title', async ({ context, page }) => {
  const posts = [];
  const publicKey = Buffer.alloc(65, 4).toString('base64url');
  await context.addInitScript((key) => {
    let perm = 'default';
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => perm });
    Notification.requestPermission = async () => { perm = 'granted'; return 'granted'; };
    window.__DAYLI_PUSH_CONFIG = { serverUrl: 'https://push.test.local', vapidPublicKey: key };
    PushManager.prototype.getSubscription = async () => null;
    PushManager.prototype.subscribe = async () => ({
      endpoint: 'https://push.example/sub',
      toJSON() { return { endpoint: this.endpoint, keys: { p256dh: 'AA', auth: 'BB' } }; },
      unsubscribe: async () => true,
    });
  }, publicKey);
  await page.route('https://push.test.local/**', async (route) => {
    posts.push({ url: route.request().url(), body: route.request().postDataJSON() });
    await route.fulfill({ json: { ok: true } });
  });
  await skipToToday(page);
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByLabel('Show task names in notifications').uncheck();
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect.poll(() => posts.length).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await addItem(page, { title: 'Biology 101', time: '16:00' });
  await expect.poll(() => posts.length).toBeGreaterThan(1);
  const blob = JSON.stringify(posts);
  expect(blob.includes('Biology 101')).toBe(false);
  expect(blob.includes('Coming up')).toBe(true);

  await openCard(page, 'Biology 101');
  await page.getByLabel('Time').fill('17:30');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => posts.length).toBeGreaterThan(2);
  const last = posts.at(-1).body;
  expect(JSON.stringify(last).includes('Biology')).toBe(false);
  expect(last.reminders.some((r) => r.fireAtUTC && r.title === 'Coming up')).toBe(true);

  await openCard(page, 'Biology 101');
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => posts.at(-1).body.reminders.every((r) => !String(r.id).includes('Biology'))).toBe(true);
  const afterDelete = JSON.stringify(posts.at(-1));
  expect(afterDelete.includes('Biology')).toBe(false);
});

test('missed reminders show While you were away', async ({ page }) => {
  await useClock(page, '2026-09-25T10:00:00-04:00');
  await skipToToday(page);
  await addItem(page, { title: 'Chemistry lab', category: 'Class', time: '10:30', remind: '0' });
  await setClock(page, '2026-09-25T11:00:00-04:00', { check: false });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'While you were away' })).toBeVisible();
  await expect(page.getByText('Chemistry lab').first()).toBeVisible();
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'While you were away' })).toHaveCount(0);
});

test('reminder status lines', async ({ browser }) => {
  const denied = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Toronto' });
  await denied.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { get: () => 'denied' });
  });
  const deniedPage = await denied.newPage();
  await skipToToday(deniedPage);
  await deniedPage.getByRole('button', { name: 'Customize' }).click();
  await expect(deniedPage.locator('#reminder-status')).toContainText('blocked in your browser settings');
  await denied.close();

  const off = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Toronto' });
  await off.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'default' });
  });
  const offPage = await off.newPage();
  await skipToToday(offPage);
  await offPage.getByRole('button', { name: 'Customize' }).click();
  await expect(offPage.locator('#reminder-status')).toHaveText('Reminders are off.');
  await off.close();

  const iphone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: IPHONE,
    timezoneId: 'America/Toronto',
  });
  const iphonePage = await iphone.newPage();
  await skipToToday(iphonePage);
  await iphonePage.getByRole('button', { name: 'Customize' }).click();
  await expect(iphonePage.locator('#reminder-status')).toContainText('add to Home Screen');
  await iphone.close();

  const openOnly = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'America/Toronto' });
  await openOnly.addInitScript(() => {
    let perm = 'default';
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => perm });
    Notification.requestPermission = async () => { perm = 'granted'; return 'granted'; };
  });
  const openPage = await openOnly.newPage();
  await skipToToday(openPage);
  await openPage.getByRole('button', { name: 'Customize' }).click();
  await openPage.getByRole('button', { name: 'Turn on' }).click();
  await expect(openPage.locator('#reminder-status')).toHaveText('Only while the app is open');
  await openOnly.close();
});

test('themes and fonts apply and persist', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Mint theme' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.getByRole('button', { name: 'Customize' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'mint');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'mint');
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('button', { name: 'Lexend', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-font', 'lexend');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-font', 'lexend');
  for (const theme of ['Calm', 'Sunset', 'Ocean', 'Blossom', 'Night']) {
    await page.getByRole('button', { name: 'Customize' }).click();
    await page.getByRole('button', { name: `${theme} theme` }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.toLowerCase());
    await page.getByRole('button', { name: 'Back', exact: true }).click();
  }
});

test('photo crop stores an image at most 1600px and categories cap at 8', async ({ page }) => {
  await skipToToday(page);
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.locator('#bg-file').setInputFiles('tests/fixtures/photo-12mp.jpg');
  await expect(page.getByRole('heading', { name: 'Crop photo' })).toBeVisible();
  await page.getByRole('button', { name: 'Save photo' }).click();
  await expect(page.getByRole('button', { name: 'Remove photo' })).toBeVisible();
  const size = await page.evaluate(() => window.__dayli.getState().background);
  expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(1600);
  expect(size.width).toBeGreaterThan(0);

  await page.getByLabel('Photo dimming').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-scrim', 'dark');
  await page.getByLabel('Photo dimming').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-scrim', 'light');

  const name = page.getByLabel('Category name Class');
  await name.fill('Lecture');
  await name.press('Tab');
  await expect(page.getByLabel(/Category name Lecture/)).toBeVisible();
  const start = await page.locator('.cat-row').count();
  expect(start).toBe(5);
  for (let i = start; i < 8; i += 1) {
    await page.getByRole('button', { name: 'Add category' }).click();
  }
  await expect(page.locator('.cat-row')).toHaveCount(8);
  await expect(page.getByRole('button', { name: 'Add category' })).toHaveCount(0);
});

test('backup, restore, erase, persist, reload and offline', async ({ page, context }) => {
  await skipToToday(page);
  const persisted = await page.evaluate(() => window.__dayli.getState().settings.persistResult);
  expect(persisted === true || persisted === false).toBe(true);

  await addItem(page, { title: 'Keep me', difficulty: 'Hard' });
  await page.getByRole('button', { name: /Mark Keep me done/ }).click();
  await page.getByRole('button', { name: 'Customize' }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Back up now' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^student-planner-backup-/);
  const file = await download.path();

  await page.getByRole('button', { name: 'Erase everything' }).click();
  await page.getByRole('button', { name: 'Keep my planner' }).click();
  await expect(page.getByRole('heading', { name: 'Customize' })).toBeVisible();
  await page.getByRole('button', { name: 'Erase everything' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('button', { name: 'Erase now' })).toBeVisible();
  await page.locator('.sheet').getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Customize' })).toBeVisible();
  await page.getByRole('button', { name: 'Erase everything' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Erase now' }).click();
  await expect(page.getByRole('heading', { name: 'Make it yours' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await page.getByRole('button', { name: 'Not now' }).click();
  await page.getByRole('button', { name: 'Customize' }).click();

  await page.locator('#restore-file').setInputFiles(file);
  await page.getByRole('button', { name: 'Restore', exact: true }).click();
  await expect(page.locator('.card-title', { hasText: 'Keep me' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Done \(1\)/ }).click();
  await expect(page.locator('.card-title', { hasText: 'Keep me' })).toBeVisible();

  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true });
      });
    }
    return reg.scope;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: /Done \(1\)/ }).click();
  await expect(page.locator('.card-title', { hasText: 'Keep me' })).toBeVisible();
  await context.setOffline(false);
});

test('no third-party requests and the manifest is installable', async ({ page }) => {
  const urls = [];
  page.on('request', (req) => urls.push(req.url()));
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue' }).click();
  const manifest = await page.evaluate(async () => {
    const href = document.querySelector('link[rel="manifest"]').href;
    const data = await (await fetch(href)).json();
    return { href, data };
  });
  expect(manifest.data.name).toBe('Dayli');
  expect(manifest.data.short_name).toBe('Dayli');
  expect(manifest.data.display).toBe('standalone');
  expect(manifest.data.start_url).toBe('./');
  expect(manifest.data.scope).toBe('./');
  expect(manifest.data.icons.map((icon) => icon.sizes).sort()).toEqual(['192x192', '512x512', '512x512']);
  const origin = new URL(page.url()).origin;
  const third = urls.filter((url) => !url.startsWith(origin) && !url.startsWith('data:'));
  expect(third).toEqual([]);
});

test('keyboard reach, focus, escape, and check button names', async ({ page }) => {
  await skipToToday(page);
  await addItem(page, { title: 'Biology 101', difficulty: 'Medium' });
  const check = page.getByRole('button', { name: 'Mark Biology 101 done, medium, 10 points' });
  await expect(check).toBeVisible();
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    const style = getComputedStyle(el);
    return { tag: el.tagName, outline: style.outlineStyle, width: style.outlineWidth };
  });
  expect(focused.outline).not.toBe('none');
  await check.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel(/Today's points 10/)).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Add a class or task' }).click();
  await expect(page.getByRole('dialog', { name: 'Add' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Add' })).toHaveCount(0);
});

test('screenshots', async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: IPHONE,
    timezoneId: 'America/Toronto',
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await useClock(page, '2026-09-25T15:00:00-04:00');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Make it yours' })).toBeVisible();
  await page.screenshot({ path: `${ART}/first-run-1.png` });
  await page.getByLabel('Title').fill("Tyler's Day");
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('list').getByText('Add to Home Screen', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${ART}/first-run-2.png` });
  await page.getByRole('button', { name: 'Skip for now' }).click();
  await expect(page.getByRole('button', { name: 'Turn on reminders' })).toBeDisabled();
  await page.screenshot({ path: `${ART}/first-run-3.png` });
  await page.getByRole('button', { name: 'Not now' }).click();

  await addItem(page, { title: 'Biology 101', category: 'Class', time: '09:00', days: ['Monday', 'Wednesday', 'Friday'] });
  await addItem(page, { title: 'Chemistry lab', category: 'Class', time: '11:00', difficulty: 'Medium' });
  await addItem(page, { title: 'Finish essay intro', difficulty: 'Hard' });
  await addItem(page, { title: 'Gym', time: '17:00', category: 'Personal' });
  await expect(page.getByRole('heading', { name: "Tyler's Day" })).toBeVisible();
  await page.screenshot({ path: `${ART}/today-list.png` });

  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.now-line')).toBeVisible();
  await page.screenshot({ path: `${ART}/today-timeline.png` });

  await openCard(page, 'Biology 101');
  await expect(page.getByRole('heading', { name: 'Edit' })).toBeVisible();
  await page.screenshot({ path: `${ART}/add-edit-sheet.png` });
  await page.locator('.sheet').getByRole('button', { name: 'Cancel', exact: true }).click();

  await page.getByRole('button', { name: 'Customize' }).click();
  await page.locator('#bg-file').setInputFiles('tests/fixtures/photo.jpg');
  await page.getByRole('button', { name: 'Save photo' }).click();
  await expect(page.getByRole('button', { name: 'Remove photo' })).toBeVisible();
  await page.screenshot({ path: `${ART}/customize-photo.png` });
  await page.getByRole('button', { name: 'List', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();

  await page.getByRole('button', { name: /Mark Finish essay intro done, hard, 20 points/ }).click();
  await expect(page.locator('.points-float, .particle').first()).toBeVisible();
  await page.screenshot({ path: `${ART}/completion-moment.png` });

  await page.getByRole('button', { name: /Mark Biology 101 done, medium, 10 points/ }).click();
  await page.getByRole('button', { name: 'Nice' }).click({ timeout: 1500 }).catch(() => {});
  await page.getByRole('button', { name: /Mark Chemistry lab done, medium, 10 points/ }).click();
  const pop = page.locator('#level-pop');
  if (!(await pop.count())) {
    await page.getByRole('button', { name: /Mark Gym done/ }).click();
  }
  await expect(page.locator('#level-pop')).toBeVisible();
  await page.screenshot({ path: `${ART}/level-up.png` });
  await context.close();

  const desktop = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    timezoneId: 'America/Toronto',
  });
  const wide = await desktop.newPage();
  await useClock(wide, '2026-09-25T15:00:00-04:00');
  await skipToToday(wide);
  await wide.getByLabel('Title').count();
  await addItem(wide, { title: 'Biology 101', category: 'Class', time: '09:00' });
  await addItem(wide, { title: 'Chemistry lab', category: 'Class', time: '11:00' });
  await addItem(wide, { title: 'Finish essay intro', difficulty: 'Hard' });
  await addItem(wide, { title: 'Gym', time: '17:00' });
  await wide.screenshot({ path: `${ART}/today-desktop.png` });
  await desktop.close();
});
