import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GUIDE_STORE_KEY, defaultGuideState, normalizeGuideState, loadGuideState, saveGuideState,
  needsTour, finishTour, replayTour, recordOpen, buildTour, TOUR_STEPS, VISIT_LINES,
  visitLinesFor, pickVisitLine, timeOfDay, fillCopy,
} from '../js/guide-logic.js';
import { GUIDE_NAME, PRODUCT_NAME } from '../js/config.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

const low = () => 0; // picks gap 2
const high = () => 0.99; // picks gap 3

test('guide name and app name live in config', () => {
  assert.equal(typeof GUIDE_NAME, 'string');
  assert.ok(GUIDE_NAME.length > 0);
  assert.equal(fillCopy("Hi! I'm {guide}, your guide to {app}!", { guide: GUIDE_NAME, app: PRODUCT_NAME }),
    `Hi! I'm ${GUIDE_NAME}, your guide to ${PRODUCT_NAME}!`);
});

test('fresh install needs the tour and is not greeted', () => {
  const s = loadGuideState(memoryStorage());
  assert.deepEqual(s, defaultGuideState());
  assert.equal(needsTour(s), true);
});

test('onboarding flag round-trips through storage', () => {
  const store = memoryStorage();
  saveGuideState(store, finishTour(defaultGuideState(), low));
  assert.ok(store.map.has(GUIDE_STORE_KEY));
  const back = loadGuideState(store);
  assert.equal(back.tourDone, true);
  assert.equal(back.greeted, true);
  assert.equal(needsTour(back), false);
});

test('broken or hostile storage falls back to defaults', () => {
  const store = memoryStorage();
  store.setItem(GUIDE_STORE_KEY, '{not json');
  assert.deepEqual(loadGuideState(store), defaultGuideState());
  assert.deepEqual(loadGuideState({ getItem() { throw new Error('denied'); } }), defaultGuideState());
  const s = normalizeGuideState({ tourDone: 'yes', opens: -4, nextVisitAt: 'x', handoff: 'boom' });
  assert.equal(s.tourDone, false);
  assert.equal(s.opens, 0);
  assert.equal(s.nextVisitAt, 0);
  assert.equal(s.handoff, 'none');
});

test('no pop-in while the tour is still owed (so never on the first open)', () => {
  let s = defaultGuideState();
  for (let i = 0; i < 5; i += 1) {
    const r = recordOpen(s, low);
    assert.equal(r.show, false);
    assert.equal(r.state.opens, 0);
    s = r.state;
  }
});

test('pop-ins land on every 2nd open with a low roll', () => {
  let s = finishTour(defaultGuideState(), low);
  const shows = [];
  for (let i = 0; i < 8; i += 1) {
    const r = recordOpen(s, low);
    shows.push(r.show);
    s = r.state;
  }
  assert.deepEqual(shows, [false, true, false, true, false, true, false, true]);
});

test('pop-ins land on every 3rd open with a high roll', () => {
  let s = finishTour(defaultGuideState(), high);
  const shows = [];
  for (let i = 0; i < 9; i += 1) {
    const r = recordOpen(s, high);
    shows.push(r.show);
    s = r.state;
  }
  assert.deepEqual(shows, [false, false, true, false, false, true, false, false, true]);
});

test('random gaps are always 2 or 3 opens, never back to back', () => {
  let s = finishTour(defaultGuideState());
  let last = 0;
  let count = 0;
  for (let i = 0; i < 300; i += 1) {
    const r = recordOpen(s);
    s = r.state;
    if (r.show) {
      const gap = s.opens - last;
      assert.ok(gap === 2 || gap === 3, `gap ${gap}`);
      last = s.opens;
      count += 1;
    }
  }
  assert.ok(count >= 100 && count <= 150, `count ${count}`);
});

test('replay tour sets the flag back without losing the open count', () => {
  let s = finishTour(defaultGuideState(), low);
  s = recordOpen(s, low).state;
  s = recordOpen(s, low).state;
  const replayed = replayTour(s);
  assert.equal(needsTour(replayed), true);
  assert.equal(replayed.opens, 2);
  assert.equal(recordOpen(replayed, low).show, false);
});

test('tour drops greeting when already greeted and skips missing targets', () => {
  const all = buildTour({ has: () => true, names: { guide: 'Calo', app: 'Calo' } });
  assert.equal(all[0].id, 'hello');
  assert.equal(all[0].text, "Hi, I'm Calo! Welcome to your new planner.");
  assert.equal(all.at(-1).end, true);
  const greeted = buildTour({ has: () => true, greeted: true });
  assert.notEqual(greeted[0].id, 'hello');
  const none = buildTour({ has: () => false });
  assert.deepEqual(none.map((s) => s.id), ['hello', 'end']);
});

test('shop step points at a shop button when there is one, else at the pet', () => {
  const withShop = buildTour({ has: (sel) => sel === '[data-guide="shop"]' || sel === '.pet-slot' });
  assert.equal(withShop.find((s) => s.id === 'shop').target, '[data-guide="shop"]');
  const noShop = buildTour({ has: (sel) => sel === '.pet-slot' });
  const step = noShop.find((s) => s.id === 'shop');
  assert.equal(step.target, '.pet-slot');
  assert.match(step.text, /Tap your pet, then Shop/);
});

test('tour copy stays short', () => {
  for (const step of TOUR_STEPS) {
    assert.ok(fillCopy(step.text).length <= 70, step.id);
    if (step.fallbackText) assert.ok(step.fallbackText.length <= 75, step.id);
  }
});

test('about 30 short pep talks, picked by time of day and progress', () => {
  assert.ok(VISIT_LINES.length >= 28 && VISIT_LINES.length <= 34);
  for (const line of VISIT_LINES) assert.ok(line.text.length <= 50, line.text);
  assert.equal(timeOfDay(8), 'morning');
  assert.equal(timeOfDay(14), 'afternoon');
  assert.equal(timeOfDay(19), 'evening');
  assert.equal(timeOfDay(23), 'night');
  const morning = visitLinesFor({ hour: 8 });
  assert.ok(morning.some((t) => /morning/i.test(t)));
  assert.ok(!morning.some((t) => /late/i.test(t)));
  const streaky = visitLinesFor({ hour: 14, streak: 5, left: 2 });
  assert.ok(streaky.includes('5-day streak! Keep it hopping!'));
  assert.ok(streaky.includes('2 tasks left today. You can do it!'));
  assert.ok(!streaky.some((t) => /\{/.test(t)));
  assert.equal(typeof pickVisitLine({ hour: 10 }, () => 0.5), 'string');
  assert.equal(pickVisitLine({ hour: 10 }, () => 0), visitLinesFor({ hour: 10 })[0]);
});
