import { test, expect } from '@playwright/test';

const TYLER = 'i work 8am to 5pm monday to friday and i also have school online tuesdays and thrusdays from 5pm to 7pm, then on wednsdays and fridays id like a gym reminder at 8am too workout for 2 hours.';

function at(isoWithOffset) {
  return new Date(isoWithOffset).getTime();
}

async function useClock(page, iso) {
  const start = at(iso);
  await page.addInitScript((initial) => {
    const stored = localStorage.getItem('dayli-clock');
    window.__DAYLI_NOW = stored ? Number(stored) : initial;
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
}

test('describe your week previews goals, then adds each day on its own', async ({ page }) => {
  await useClock(page, '2026-09-21T07:00:00-04:00');
  await skipToToday(page);
  await page.getByRole('button', { name: 'Describe my week' }).click();
  await expect(page.getByRole('heading', { name: 'Describe your week' })).toBeVisible();
  await page.locator('#week-text').fill(TYLER);
  await page.getByRole('button', { name: 'Show my goals' }).click();
  const sheet = page.locator('#week-sheet');
  await expect(sheet.getByRole('heading', { name: 'Work' })).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'School online' })).toBeVisible();
  await expect(sheet.getByRole('heading', { name: 'Gym/Workout' })).toBeVisible();
  await expect(sheet.getByText('Mon–Fri')).toBeVisible();
  await expect(sheet.getByText('Tue & Thu')).toBeVisible();
  await expect(sheet.getByText('Wed & Fri')).toBeVisible();
  await expect(sheet.locator('#overlap-note')).toContainText('Wednesday and Friday');
  await expect(sheet.locator('#overlap-note')).toContainText('You can still add both');
  expect(await page.evaluate(() => window.__dayli.getState().tasks.length)).toBe(0);

  await sheet.getByRole('button', { name: 'Add these' }).click();
  await expect(page.locator('.card-title', { hasText: 'Work' })).toBeVisible();
  await expect(page.locator('.card-title', { hasText: 'School online' })).toHaveCount(0);
  await expect(page.locator('.card-title', { hasText: 'Gym/Workout' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.locator('.card-title', { hasText: 'Work' })).toBeVisible();
  await expect(page.locator('.card-title', { hasText: 'School online' })).toBeVisible();
  await expect(page.locator('.card-title', { hasText: 'Gym/Workout' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.locator('.card-title', { hasText: 'Work' })).toBeVisible();
  await expect(page.locator('.card-title', { hasText: 'Gym/Workout' })).toBeVisible();
  await expect(page.locator('.card-title', { hasText: 'School online' })).toHaveCount(0);

  await page.getByRole('button', { name: /Mark Work done/ }).click();
  const separated = await page.evaluate(() => {
    const { instancesOn } = window.__dayli.model;
    const state = window.__dayli.getState();
    const monday = instancesOn('2026-09-28', state.tasks, state.overrides).find((item) => item.title === 'Work');
    return {
      done: state.completions.map((item) => item.instanceId),
      later: monday.instanceId,
      points: state.completions.reduce((sum, item) => sum + item.points, 0),
    };
  });
  expect(separated.done).toHaveLength(1);
  expect(separated.done).not.toContain(separated.later);
  expect(separated.points).toBeGreaterThan(0);

  await page.getByRole('button', { name: /Repeating/ }).click();
  await expect(page.getByRole('heading', { name: 'Repeating' })).toBeVisible();
  await expect(page.locator('#repeat-sheet h3')).toHaveCount(3);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
});

test('weekends, an end date, and an unreadable line', async ({ page }) => {
  await useClock(page, '2026-09-21T07:00:00-04:00');
  await skipToToday(page);

  await page.getByRole('button', { name: 'Add a class or task' }).click();
  await expect(page.getByRole('radio', { name: 'Weekends' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Every day' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Pick days' })).toBeVisible();
  await page.getByLabel('What?').fill('Soccer');
  await page.getByLabel('Time').fill('10:00');
  await page.getByRole('radio', { name: 'Weekends' }).click();
  await expect(page.getByRole('button', { name: 'Saturday' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Monday' })).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.card-title', { hasText: 'Soccer' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Add a class or task' }).click();
  await page.getByLabel('What?').fill('Camp');
  await page.getByLabel('Time').fill('09:00');
  await page.getByLabel('End time').fill('12:00');
  await page.getByRole('radio', { name: 'Weekdays' }).click();
  await page.getByLabel('Repeat until').fill('2026-09-23');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.card-title', { hasText: 'Camp' })).toBeVisible();
  await expect(page.locator('.card-meta', { hasText: '9:00 AM – 12:00 PM' })).toBeVisible();

  await page.getByRole('button', { name: 'Next day' }).click();
  await page.getByRole('button', { name: 'Next day' }).click();
  await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.locator('.card-title', { hasText: 'Camp' })).toHaveCount(0);

  for (let i = 0; i < 2; i += 1) await page.getByRole('button', { name: 'Next day' }).click();
  await expect(page.locator('.card-title', { hasText: 'Soccer' })).toBeVisible();

  await page.getByRole('button', { name: 'Describe my week' }).click();
  await page.locator('#week-text').fill('remember to call grandma sometimes');
  await page.getByRole('button', { name: 'Show my goals' }).click();
  await expect(page.getByText("Couldn't read this part")).toBeVisible();
  await expect(page.getByText(/grandma/i)).toBeVisible();
  await expect(page.locator('#add-these')).toHaveCount(0);
  expect(await page.evaluate(() => window.__dayli.getState().tasks.map((task) => task.title))).toEqual(['Soccer', 'Camp']);
});
