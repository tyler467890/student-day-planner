import { test, expect } from '@playwright/test';

function at(iso) {
  return new Date(iso).getTime();
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
  const notNow = page.getByRole('button', { name: 'Not now', exact: true });
  await expect(skip.or(notNow)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await notNow.click();
  await page.getByRole('button', { name: 'This is my pet' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();
}

test('the real suggestion engine offers a goal, and finishing it pays 2 coins once', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await useClock(page, '2026-09-11T15:00:00-04:00');
  await skipToToday(page);
  const card = page.locator('.suggest-bubble');
  await expect(card).toHaveCount(1);
  await expect(card.getByText('Pick a bedtime and start winding down')).toBeVisible();
  await expect(card.getByText('A bedtime you actually start makes the next day less of a scramble.')).toBeVisible();
  await card.getByRole('button', { name: 'Add suggested goal' }).click();
  await expect(card).toHaveCount(0);
  const added = page.locator('.card-title', { hasText: 'Pick a bedtime and start winding down' });
  await expect(added).toBeVisible();
  const task = await page.evaluate(() => window.__dayli.getState().tasks.at(-1));
  expect(task.time).toBe('22:00');
  expect(task.repeat).toBe('daily');
  await page.getByRole('button', { name: /Mark Pick a bedtime and start winding down done/ }).click();
  await expect(page.locator('.suggest-bonus-note')).toHaveText('+2 bonus for trying a suggestion');
  const after = await page.evaluate(() => {
    const state = window.__dayli.getState();
    const points = window.__dayli.model.sumPoints(state.completions, state.bonuses);
    const bonus = state.bonuses.find((row) => row.kind === 'suggestion');
    return {
      points,
      level: window.__dayli.model.levelForPoints(points),
      coins: bonus?.coins,
      bonusPoints: bonus?.points,
    };
  });
  expect(after.points).toBe(10);
  expect(after.level).toBe(1);
  expect(after.coins).toBe(2);
  expect(after.bonusPoints).toBe(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => page.evaluate(() => window.__dayli.getState().bonuses.some((row) => row.kind === 'suggestion'))).toBe(false);
  await page.getByRole('button', { name: /Mark Pick a bedtime and start winding down done/ }).click();
  await expect(page.locator('.suggest-bonus-note')).toHaveCount(0);
  expect(await page.evaluate(() => window.__dayli.getState().bonuses.some((row) => row.kind === 'suggestion'))).toBe(false);
  expect(errors).toEqual([]);
});
