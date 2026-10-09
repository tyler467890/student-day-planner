import { test, expect } from '@playwright/test';

const KEY = 'dayli.guide.v1';

/** Guide is off under automation unless a test opts in. */
async function optIn(page, guideState) {
  await page.addInitScript(({ key, state }) => {
    localStorage.setItem('dayli.guide.force', '1');
    if (state && !sessionStorage.getItem('guide-seeded')) {
      localStorage.setItem(key, JSON.stringify(state));
      sessionStorage.setItem('guide-seeded', '1');
    }
  }, { key: KEY, state: guideState || null });
}

const card = (page) => page.locator('#guide .guide-card');
const next = (page) => card(page).getByRole('button', { name: 'Next' });

/** Wait for the typewriter to finish the line. */
async function typed(page) {
  const text = card(page).locator('.guide-text');
  await expect.poll(async () => {
    const [shown, full] = await Promise.all([text.textContent(), text.getAttribute('aria-label')]);
    return Boolean(full) && shown === full;
  }).toBe(true);
}

async function advance(page) {
  const step = await card(page).getAttribute('data-step');
  await typed(page);
  await next(page).click();
  await expect(card(page)).not.toHaveAttribute('data-step', step);
}

async function finishSetup(page) {
  await page.getByRole('button', { name: 'Continue' }).click();
  const skip = page.getByRole('button', { name: 'Skip for now' });
  const notNow = page.getByRole('button', { name: 'Not now' });
  await expect(skip.or(notNow)).toBeVisible();
  if (await skip.isVisible()) await skip.click();
  await notNow.click();
  await page.getByRole('button', { name: 'This is my pet' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();
}

async function guideState(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), KEY);
}

test('first open: greeting, tour with next, then pet and first goal', async ({ page }) => {
  await optIn(page);
  await page.goto('/');
  await expect(card(page)).toContainText("Hi, I'm Calo! Welcome to your new planner.");
  await expect(page.locator('#guide .guide-actor')).toHaveCSS('opacity', '1');
  await typed(page);
  await next(page).click();
  await expect(card(page)).toContainText('set up your planner');
  await typed(page);
  await card(page).getByRole('button', { name: 'Let’s go!' }).click();
  await expect(page.locator('#guide')).toHaveCount(0);
  expect((await guideState(page)).greeted).toBe(true);

  await finishSetup(page);
  // Tour starts on Today without repeating hello.
  await expect(card(page)).toHaveAttribute('data-step', 'pet');
  await expect(card(page)).toContainText('This is your pet!');
  await expect(page.locator('#guide .guide-dots')).toHaveAttribute('aria-label', /Step 1 of \d/);
  await expect(page.locator('#guide .guide-spot')).toBeVisible();
  // The tour blocks the page underneath.
  await expect(page.locator('#guide .guide-block')).toBeVisible();

  const seen = [];
  for (let i = 0; i < 8; i += 1) {
    const step = await card(page).getAttribute('data-step');
    seen.push(step);
    if (step === 'end') break;
    await advance(page);
  }
  expect(seen).toEqual(['pet', 'shop', 'add', 'week', 'stats', 'end']);
  await expect(card(page)).toContainText('make your pet yours');
  await card(page).getByRole('button', { name: 'Dress up my pet' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Your pet' })).toBeVisible();
  const st = await guideState(page);
  expect(st.tourDone).toBe(true);
  expect(st.handoff).toBe('pet');

  // Pet tip pops in on the pet page, then back to Today for the goal nudge.
  await expect(card(page)).toContainText('Pick an animal');
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(card(page)).toContainText('first goal');
  await card(page).getByRole('button', { name: 'Add a goal' }).click();
  await expect(page.getByLabel('What?')).toBeVisible();
  expect((await guideState(page)).handoff).toBe('done');
});

test('skip tour frees the screen and does not come back on reload', async ({ page }) => {
  await optIn(page, { greeted: true });
  await page.goto('/');
  await expect(page.locator('#guide')).toHaveCount(0);
  await finishSetup(page);
  await expect(card(page)).toHaveAttribute('data-step', 'pet');
  await card(page).getByRole('button', { name: 'Skip tour' }).click();
  await expect(page.locator('#guide .guide-block')).toBeHidden();
  // Taps reach the app straight away.
  await page.getByRole('button', { name: 'Add a class or task' }).click();
  await expect(page.getByLabel('What?')).toBeVisible();
  const st = await guideState(page);
  expect(st.tourDone).toBe(true);
  expect(st.handoff).toBe('done');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.locator('#guide .guide-card[data-step]')).toHaveCount(0);
});

test('finish via Maybe later, and Replay tour in Customize runs it again', async ({ page }) => {
  await optIn(page, { greeted: true });
  await page.goto('/');
  await finishSetup(page);
  await expect(card(page)).toHaveAttribute('data-step', 'pet');
  for (let i = 0; i < 8; i += 1) {
    if ((await card(page).getAttribute('data-step')) === 'end') break;
    await advance(page);
  }
  await card(page).getByRole('button', { name: 'Maybe later' }).click();
  await expect(page.locator('#guide .guide-block')).toBeHidden();
  expect((await guideState(page)).tourDone).toBe(true);

  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Customize' }).click();
  await page.getByRole('button', { name: 'Replay tour' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();
  await expect(card(page)).toHaveAttribute('data-step', 'pet');
});

test('return visit: pops in on a later open, hops away when tapped, never blocks', async ({ page }) => {
  await optIn(page, { greeted: true, tourDone: true, handoff: 'done', opens: 1, nextVisitAt: 3 });
  await page.goto('/');
  await finishSetup(page);
  // Open 2: no visit (next is at 3).
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'My Day' })).toBeVisible();
  await page.waitForTimeout(1800);
  await expect(page.locator('#guide')).toHaveCount(0);
  expect((await guideState(page)).opens).toBe(2);

  // Open 3: Calo pops in with a pep talk.
  await page.reload();
  const visit = page.locator('#guide .guide-card.is-visit');
  await expect(visit).toBeVisible({ timeout: 6000 });
  await expect(visit.locator('.guide-text')).not.toHaveText('');
  await expect(page.locator('#guide .guide-block')).toBeHidden();
  // The rest of the page still takes taps.
  await page.getByRole('button', { name: 'Add a class or task' }).click();
  await expect(page.getByLabel('What?')).toBeVisible();
  await page.keyboard.press('Escape');
  const st = await guideState(page);
  expect(st.opens).toBe(3);
  expect(st.nextVisitAt === 5 || st.nextVisitAt === 6).toBe(true);
  // Tap to send him away.
  await page.locator('#guide .guide-actor').click({ force: true }).catch(() => {});
  await expect(page.locator('#guide')).toHaveCount(0, { timeout: 4000 });
});

test('return visit leaves by itself after a few seconds', async ({ page }) => {
  await optIn(page, { greeted: true, tourDone: true, handoff: 'done', opens: 4, nextVisitAt: 5 });
  await page.goto('/');
  await finishSetup(page);
  await page.reload();
  await expect(page.locator('#guide .guide-card.is-visit')).toBeVisible({ timeout: 6000 });
  await expect(page.locator('#guide')).toHaveCount(0, { timeout: 12000 });
});

test('reduced motion fades instead of hopping and still works', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await optIn(page);
  await page.goto('/');
  await expect(card(page)).toContainText("Hi, I'm Calo");
  await expect(card(page).locator('.guide-text')).toHaveText("Hi, I'm Calo! Welcome to your new planner.");
  await context.close();
});

test('guide stays out of the way under automation unless opted in', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  await page.waitForTimeout(1200);
  await expect(page.locator('#guide')).toHaveCount(0);
});

test('tour still starts when setup is finished while the greeting hops out', async ({ page }) => {
  await optIn(page);
  await page.goto('/');
  await typed(page);
  await next(page).click();
  await typed(page);
  await card(page).getByRole('button', { name: 'Let’s go!' }).click();
  // Do not wait for him to leave: finish setup right away.
  await finishSetup(page);
  await expect(card(page)).toHaveAttribute('data-step', 'pet', { timeout: 8000 });
});
