import { test, expect } from '@playwright/test';

const ART = '/opt/cursor/artifacts';

const SAMPLE = {
  id: 'study-1',
  title: 'Review your notes',
  category: 'study',
  reason: "You've got classes but no study time yet",
  difficulty: 'easy',
  suggestedTime: '16:00',
  repeat: null,
};

function at(iso) {
  return new Date(iso).getTime();
}

async function useClock(page, iso) {
  await page.addInitScript((initial) => {
    const stored = localStorage.getItem('dayli-clock');
    window.__DAYLI_NOW = stored ? Number(stored) : initial;
  }, at(iso));
}

async function installMock(context, sample = SAMPLE) {
  await context.addInitScript((suggestion) => {
    const state = {
      suggestion,
      calls: [],
      accepted: null,
      completed: [],
    };
    window.__suggest = state;
    window.__suggestGo = true;
    window.DayliSuggest = {
      async loadLibrary() { state.calls.push('load'); },
      getSuggestion(input) {
        state.calls.push('get');
        state.lastSettings = input && input.settings ? input.settings : null;
        if (!window.__suggestGo) return null;
        return state.suggestion;
      },
      markShown(id) { state.calls.push(['shown', id]); },
      markAccepted(id, taskId) {
        state.calls.push(['accepted', id, taskId]);
        state.accepted = taskId;
        state.suggestion = null;
      },
      markDismissed(id, opts) {
        state.calls.push(['dismissed', id, !!opts?.forever]);
        state.suggestion = null;
      },
      isSuggestedTask(taskId) { return taskId === state.accepted; },
      markSuggestedCompleted(taskId) {
        if (taskId !== state.accepted) return false;
        if (state.completed.includes(taskId)) return false;
        state.completed.push(taskId);
        return true;
      },
    };
  }, sample);
}

async function skipToToday(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue' }).click();
  const skip = page.getByRole('button', { name: 'Skip for now' });
  const notNow = page.getByRole('button', { name: 'Not now', exact: true });
  await expect(skip.or(notNow)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await notNow.click();
  await page.getByRole('button', { name: 'This is my pet' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();
}

function bubble(page) {
  return page.locator('.suggest-bubble');
}

async function savedFrequency(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('dayli');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('settings', 'readonly');
      const get = tx.objectStore('settings').get('main');
      get.onerror = () => reject(get.error);
      get.onsuccess = () => resolve(get.result?.suggestFrequency || null);
    };
  }));
}

async function waitForPet(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('#pet-hero');
    return el && (el.dataset.state === 'ready' || el.dataset.state === 'fallback');
  });
}

test('the suggestion card adds, snoozes, and skips with the engine', async ({ context, page }) => {
  await installMock(context);
  await useClock(page, '2026-09-25T15:00:00-04:00');
  await skipToToday(page);
  const card = bubble(page);
  await expect(card).toBeVisible();
  await expect(card).toHaveCount(1);
  await expect(card.getByText('Review your notes')).toBeVisible();
  await expect(card.getByText("You've got classes but no study time yet")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__dayli.lastSuggestGesture())).toBe('wave');
  const shown = await page.evaluate(() => window.__suggest.calls.some((call) => Array.isArray(call) && call[0] === 'shown' && call[1] === 'study-1'));
  expect(shown).toBe(true);

  await card.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(card).toHaveCount(0);
  const dismissed = await page.evaluate(() => window.__suggest.calls.filter((call) => Array.isArray(call) && call[0] === 'dismissed'));
  expect(dismissed).toEqual([['dismissed', 'study-1', false]]);
});

test('don\'t suggest this dismisses the idea for good', async ({ context, page }) => {
  await installMock(context);
  await useClock(page, '2026-09-25T15:00:00-04:00');
  await skipToToday(page);
  await bubble(page).getByRole('button', { name: "Don't suggest this" }).click();
  await expect(bubble(page)).toHaveCount(0);
  const dismissed = await page.evaluate(() => window.__suggest.calls.filter((call) => Array.isArray(call) && call[0] === 'dismissed'));
  expect(dismissed).toEqual([['dismissed', 'study-1', true]]);
});

test('add uses the suggested time, and the time field can change it', async ({ context, page }) => {
  await installMock(context);
  await useClock(page, '2026-09-25T15:00:00-04:00');
  await skipToToday(page);
  const card = bubble(page);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Add suggested goal' }).click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('.card-title', { hasText: 'Review your notes' })).toBeVisible();
  const added = await page.evaluate(() => {
    const state = window.__dayli.getState();
    const task = state.tasks.at(-1);
    const accepted = window.__suggest.calls.find((call) => Array.isArray(call) && call[0] === 'accepted');
    return { time: task.time, title: task.title, id: task.id, accepted };
  });
  expect(added.title).toBe('Review your notes');
  expect(added.time).toBe('16:00');
  expect(added.accepted[1]).toBe('study-1');
  expect(added.accepted[2]).toBe(added.id);

  await page.evaluate(() => { window.__suggest.suggestion = {
    id: 'walk-1',
    title: 'Take a short walk',
    category: 'life',
    reason: 'Today is pretty full.',
    difficulty: 'easy',
    suggestedTime: '16:00',
    repeat: null,
  }; });
  await page.evaluate(() => window.__dayli.checkReminders());
  const next = bubble(page);
  await expect(next.getByText('Take a short walk')).toBeVisible();
  await next.getByRole('button', { name: /Choose when/ }).click();
  const time = next.locator('input[type="time"]');
  await expect(time).toBeVisible();
  await time.fill('18:30');
  await next.getByRole('button', { name: 'Add suggested goal' }).click();
  await expect.poll(() => page.evaluate(() => window.__dayli.getState().tasks.at(-1).time)).toBe('18:30');
  await expect(page.locator('.card-title', { hasText: 'Take a short walk' })).toBeVisible();
});

test('suggested goals setting stores off, rarely, normal, and often', async ({ context, page }) => {
  await installMock(context);
  await useClock(page, '2026-09-25T15:00:00-04:00');
  await skipToToday(page);
  await page.getByRole('button', { name: 'Customize' }).click();
  await expect(page.getByRole('heading', { name: 'Suggested goals' })).toBeVisible();
  const toggle = page.getByRole('checkbox', { name: 'Suggest goals' });
  await expect(toggle).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Normal' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('radio', { name: 'Often' }).click();
  await expect.poll(() => savedFrequency(page)).toBe('often');
  await page.reload();
  await page.getByRole('button', { name: 'Customize' }).click();
  await expect(page.getByRole('radio', { name: 'Often' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('checkbox', { name: 'Suggest goals' }).click();
  await expect.poll(() => savedFrequency(page)).toBe('off');
  await page.reload();
  await page.getByRole('button', { name: 'Customize' }).click();
  await expect(page.getByRole('checkbox', { name: 'Suggest goals' })).not.toBeChecked();
  expect(await page.evaluate(() => window.__dayli.getState().settings.suggestFrequency)).toBe('off');
  await page.getByRole('checkbox', { name: 'Suggest goals' }).click();
  await expect.poll(() => page.evaluate(() => window.__dayli.getState().settings.suggestFrequency)).toBe('often');
  await page.getByRole('radio', { name: 'Rarely' }).click();
  await expect.poll(() => page.evaluate(() => window.__dayli.getState().settings.suggestFrequency)).toBe('rare');
  await expect(page.getByRole('radio', { name: 'Normal: a couple a week' })).toBeVisible();
  await expect(page.getByText('Normal is a couple a week, at most one a day. Your pet offers one at a time.')).toBeVisible();
});

test('older teen and adult goals stay off until the setting is turned on', async ({ context, page }) => {
  await installMock(context);
  await useClock(page, '2026-09-25T15:00:00-04:00');
  await skipToToday(page);
  await page.getByRole('button', { name: 'Customize' }).click();
  const older = page.getByRole('checkbox', { name: 'Include goals for older teens and adults' });
  await expect(older).not.toBeChecked();
  expect(await page.evaluate(() => window.__dayli.getState().settings.suggestIncludeOlder)).toBe(false);
  await older.click();
  await expect.poll(() => page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('dayli');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const get = db.transaction('settings', 'readonly').objectStore('settings').get('main');
      get.onerror = () => reject(get.error);
      get.onsuccess = () => resolve(get.result?.suggestIncludeOlder === true);
    };
  }))).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Customize' }).click();
  await expect(page.getByRole('checkbox', { name: 'Include goals for older teens and adults' })).toBeChecked();
  await page.getByRole('button', { name: 'Back' }).click();
  await bubble(page).getByRole('button', { name: 'Not now', exact: true }).click();
  await page.evaluate(() => window.__dayli.checkReminders());
  await expect.poll(() => page.evaluate(() => window.__suggest.lastSettings?.suggestIncludeOlder)).toBe(true);
});

test('quiet hours hold the suggestion notification until daytime', async ({ context, page }) => {
  await context.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' });
    window.__notes = [];
    const orig = ServiceWorkerRegistration.prototype.showNotification;
    ServiceWorkerRegistration.prototype.showNotification = function show(title, opts) {
      window.__notes.push({ title, body: opts?.body, data: opts?.data || null, actions: opts?.actions || null });
      try { return orig.apply(this, arguments); } catch { return Promise.resolve(); }
    };
  });
  await installMock(context);
  await page.addInitScript(() => { window.__suggestGo = false; });
  await useClock(page, '2026-09-25T21:10:00-04:00');
  await skipToToday(page);
  await expect(bubble(page)).toHaveCount(0);
  await page.evaluate(() => {
    window.__dayli.getState().settings.remindersWanted = true;
    window.__suggestGo = true;
  });
  await page.evaluate(() => window.__dayli.checkReminders());
  await expect(bubble(page)).toBeVisible();
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__notes.length)).toBe(0);
  await page.evaluate(() => {
    window.__DAYLI_NOW = new Date('2026-09-25T15:00:00-04:00').getTime();
    window.__dayli.checkReminders();
  });
  await expect.poll(() => page.evaluate(() => window.__notes.length)).toBe(1);
  const note = await page.evaluate(() => window.__notes[0]);
  expect(note.title).toBe('Review your notes');
  expect(note.body).toBe("You've got classes but no study time yet");
  expect(note.data.kind).toBe('suggest');
  expect(note.data.suggestId).toBe('study-1');
  expect(note.actions).toBe(null);

  await page.goto('/?suggest=study-1');
  await expect(page.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();
  await expect(bubble(page)).toBeVisible();
  expect(page.url()).not.toContain('suggest=');
});

test('a quiet suggestion and canNotify false stay on the card', async ({ context, page }) => {
  await context.addInitScript(() => {
    Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' });
    window.__notes = [];
    const orig = ServiceWorkerRegistration.prototype.showNotification;
    ServiceWorkerRegistration.prototype.showNotification = function show(title, opts) {
      window.__notes.push({ title, body: opts?.body, data: opts?.data || null, actions: opts?.actions || null });
      try { return orig.apply(this, arguments); } catch { return Promise.resolve(); }
    };
  });
  await installMock(context, { ...SAMPLE, quiet: true });
  await page.addInitScript(() => { window.__suggestGo = false; });
  await useClock(page, '2026-09-25T15:00:00-04:00');
  await skipToToday(page);
  await page.evaluate(() => {
    window.__dayli.getState().settings.remindersWanted = true;
    window.__suggestGo = true;
  });
  await page.evaluate(() => window.__dayli.checkReminders());
  await expect(bubble(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__dayli.getState().settings.suggestCard?.notice)).toBe('skipped');
  expect(await page.evaluate(() => window.__notes.length)).toBe(0);
  await page.evaluate(() => {
    window.__DAYLI_NOW = new Date('2026-09-25T16:00:00-04:00').getTime();
    window.__dayli.checkReminders();
  });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__notes.length)).toBe(0);

  await page.evaluate(() => {
    window.__suggest.suggestion = {
      id: 'walk-1',
      title: 'Take a short walk',
      category: 'health',
      reason: 'A short walk breaks up a long list.',
      difficulty: 'easy',
      suggestedTime: '16:00',
      repeat: null,
    };
    window.DayliSuggest.canNotify = () => false;
    window.__dayli.getState().settings.suggestCard = null;
    window.__DAYLI_NOW = new Date('2026-09-25T15:00:00-04:00').getTime();
  });
  await page.evaluate(() => window.__dayli.checkReminders());
  await expect(bubble(page).getByText('Take a short walk')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__dayli.getState().settings.suggestCard?.notice)).toBe('later');
  expect(await page.evaluate(() => window.__notes.length)).toBe(0);
  await page.evaluate(() => {
    window.DayliSuggest.canNotify = () => true;
    window.__dayli.checkReminders();
  });
  await expect.poll(() => page.evaluate(() => window.__notes.length)).toBe(1);
});

test('finishing a suggested goal adds 2 coins once, and undo takes them back', async ({ context, page }) => {
  await installMock(context);
  await useClock(page, '2026-09-25T15:00:00-04:00');
  await skipToToday(page);
  await bubble(page).getByRole('button', { name: 'Add suggested goal' }).click();
  await page.getByRole('button', { name: /Mark Review your notes done/ }).click();
  await expect(page.locator('.suggest-bonus-note')).toHaveText('+2 bonus for trying a suggestion');
  const after = await page.evaluate(() => {
    const state = window.__dayli.getState();
    const points = window.__dayli.model.sumPoints(state.completions, state.bonuses);
    const bonus = state.bonuses.find((row) => row.kind === 'suggestion');
    return { points, level: window.__dayli.model.levelForPoints(points), bonus };
  });
  expect(after.points).toBe(10);
  expect(after.level).toBe(1);
  expect(after.bonus.coins).toBe(2);
  expect(after.bonus.points).toBe(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => page.evaluate(() => window.__dayli.getState().bonuses.some((row) => row.kind === 'suggestion'))).toBe(false);
  await expect.poll(() => page.evaluate(() => window.__dayli.getState().completions.length)).toBe(0);
  await page.getByRole('button', { name: /Mark Review your notes done/ }).click();
  await expect(page.locator('.suggest-bonus-note')).toHaveCount(0);
  expect(await page.evaluate(() => window.__dayli.getState().bonuses.some((row) => row.kind === 'suggestion'))).toBe(false);
  const wallet = await page.evaluate(() => {
    const state = window.__dayli.getState();
    return window.__dayli.model.sumPoints(state.completions, state.bonuses);
  });
  expect(wallet).toBe(10);
});

test('a missing suggestion engine leaves Today alone', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await useClock(page, '2026-09-25T15:00:00-04:00');
  await skipToToday(page);
  await page.evaluate(() => window.__dayli.checkReminders());
  await expect(page.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();
  await expect(bubble(page)).toHaveCount(0);
  await expect(page.getByText('Nothing planned yet. Add your first class or task.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('reduced motion does not play the suggestion gesture', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: 'America/Toronto',
    reducedMotion: 'reduce',
  });
  await installMock(context);
  const page = await context.newPage();
  await useClock(page, '2026-09-25T15:00:00-04:00');
  await skipToToday(page);
  await expect(bubble(page)).toBeVisible();
  expect(await page.evaluate(() => window.__dayli.lastSuggestGesture())).toBe(null);
  await context.close();
});

test('suggestion card screenshots on a phone and a desktop', async ({ browser }) => {
  test.setTimeout(120_000);
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    timezoneId: 'America/Toronto',
    deviceScaleFactor: 2,
  });
  await installMock(phone);
  const page = await phone.newPage();
  await useClock(page, '2026-09-25T15:00:00-04:00');
  await skipToToday(page);
  await page.getByRole('button', { name: 'Add a class or task' }).click();
  await page.getByLabel('What?').fill('Biology 101');
  await page.locator('#field-time').fill('09:00');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(bubble(page)).toBeVisible();
  await expect(page.locator('.card-title', { hasText: 'Biology 101' })).toBeVisible();
  await waitForPet(page);
  await page.evaluate(() => window.__dayli.posePet?.('wave', 0.45));
  await page.waitForTimeout(200);
  const phoneLayout = await page.evaluate(() => {
    const pet = document.querySelector('#pet-hero').getBoundingClientRect();
    const card = document.querySelector('.suggest-bubble').getBoundingClientRect();
    const task = document.querySelector('.card').getBoundingClientRect();
    return {
      petTop: pet.top,
      petHeight: pet.height,
      cardTop: card.top,
      cardBottom: card.bottom,
      taskTop: task.top,
      innerHeight: window.innerHeight,
    };
  });
  expect(phoneLayout.cardTop).toBeGreaterThan(phoneLayout.petTop + phoneLayout.petHeight * 0.35);
  expect(phoneLayout.taskTop).toBeGreaterThan(phoneLayout.cardTop);
  expect(phoneLayout.cardBottom).toBeLessThan(phoneLayout.innerHeight);
  expect(phoneLayout.taskTop).toBeLessThan(phoneLayout.innerHeight);
  await page.screenshot({ path: `${ART}/suggest-card-today.png` });

  await bubble(page).getByRole('button', { name: /Choose when/ }).click();
  await expect(bubble(page).locator('input[type="time"]')).toBeVisible();
  await bubble(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${ART}/suggest-add-time.png` });

  await page.getByRole('button', { name: 'Customize' }).click();
  await page.locator('.suggest-settings').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.screenshot({ path: `${ART}/suggest-settings.png` });
  await phone.close();

  const desk = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    timezoneId: 'America/Toronto',
  });
  await installMock(desk);
  const wide = await desk.newPage();
  await useClock(wide, '2026-09-25T15:00:00-04:00');
  await skipToToday(wide);
  await wide.getByRole('button', { name: 'Add a class or task' }).click();
  await wide.getByLabel('What?').fill('Biology 101');
  await wide.locator('#field-time').fill('09:00');
  await wide.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(bubble(wide)).toBeVisible();
  await waitForPet(wide);
  const deskLayout = await wide.evaluate(() => {
    const pet = document.querySelector('#pet-hero').getBoundingClientRect();
    const card = document.querySelector('.suggest-bubble').getBoundingClientRect();
    const task = document.querySelector('.card').getBoundingClientRect();
    return {
      petTop: pet.top,
      petHeight: pet.height,
      cardTop: card.top,
      cardBottom: card.bottom,
      taskTop: task.top,
      innerHeight: window.innerHeight,
    };
  });
  expect(deskLayout.cardTop).toBeGreaterThan(deskLayout.petTop + 40);
  expect(deskLayout.taskTop).toBeGreaterThan(deskLayout.cardTop);
  expect(deskLayout.cardBottom).toBeLessThan(deskLayout.innerHeight);
  await wide.evaluate(() => window.__dayli.posePet?.('wave', 0.45));
  await wide.screenshot({ path: `${ART}/suggest-card-desktop.png` });
  await desk.close();
});
