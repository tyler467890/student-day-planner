import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POINTS_PER_COIN, SUGGESTION_COIN_BONUS, coinsFromPoints, earnedCoins, walletBalance,
} from '../js/shop.js';
import { dayOfWeek, levelForPoints, sumPoints } from '../js/model.js';
import {
  applySuggestionBonus, buildSuggestionTask, defaultSuggestionTime, isQuietAtMinutes,
  noticePlan, normalizeSuggestFrequency, resolveSuggestEngine, shouldAskSuggestion,
  suggestionBonusId, suggestionFromEngine, suggestionGesture, suggestionHold, suggestPace,
} from '../js/suggestions.js';

const QUIET = { quietHours: { on: true, start: '22:00', end: '07:00' } };

test('suggested goals default to on and normal', () => {
  assert.equal(normalizeSuggestFrequency(undefined), 'normal');
  assert.equal(normalizeSuggestFrequency('often'), 'often');
  assert.equal(normalizeSuggestFrequency('nope'), 'normal');
  assert.equal(suggestPace({ suggestFrequency: 'off', suggestPace: 'rare' }), 'rare');
  assert.equal(suggestPace({ suggestFrequency: 'often' }), 'often');
  assert.equal(suggestPace({}), 'normal');
});

test('quiet hours block a suggestion notification and a daytime one can send', () => {
  const settings = { ...QUIET, suggestFrequency: 'normal', remindersWanted: true };
  assert.equal(isQuietAtMinutes(22 * 60, settings), true);
  assert.equal(isQuietAtMinutes(23 * 60 + 10, settings), true);
  assert.equal(isQuietAtMinutes(6 * 60 + 59, settings), true);
  assert.equal(isQuietAtMinutes(7 * 60, settings), false);
  assert.equal(isQuietAtMinutes(21 * 60 + 59, settings), false);
  assert.equal(noticePlan({
    now: new Date(2026, 8, 25, 23, 10),
    settings,
    permission: 'granted',
  }), 'later');
  assert.equal(noticePlan({
    now: new Date(2026, 8, 25, 15, 0),
    settings,
    permission: 'granted',
  }), 'send');
  assert.equal(noticePlan({
    now: new Date(2026, 8, 25, 23, 10),
    settings: { ...settings, quietHours: { on: false } },
    permission: 'granted',
  }), 'send');
  assert.equal(noticePlan({
    now: new Date(2026, 8, 25, 15, 0),
    settings: { ...settings, remindersWanted: false },
    permission: 'granted',
  }), 'skip');
  assert.equal(noticePlan({
    now: new Date(2026, 8, 25, 15, 0),
    settings,
    permission: 'granted',
    alreadyNotified: true,
  }), 'skip');
});

test('suggestion quiet hours start at 21:00 unless the engine says otherwise', () => {
  const settings = { suggestFrequency: 'normal', remindersWanted: true };
  const night = new Date(2026, 8, 25, 21, 0);
  const evening = new Date(2026, 8, 25, 20, 59);
  assert.equal(isQuietAtMinutes(21 * 60, settings), true);
  assert.equal(isQuietAtMinutes(20 * 60 + 59, settings), false);
  assert.equal(noticePlan({ now: night, settings, permission: 'granted' }), 'later');
  assert.equal(noticePlan({ now: evening, settings, permission: 'granted' }), 'send');

  const idea = { id: 'budget', title: 'Sketch a budget', quiet: true };
  assert.equal(suggestionFromEngine(idea).quiet, true);
  assert.equal(suggestionHold({ now: evening, settings, suggestion: idea }), 'never');
  assert.equal(noticePlan({
    now: evening, settings, permission: 'granted', suggestion: idea,
  }), 'skip');
  assert.equal(suggestionHold({
    now: night, settings, suggestion: { quiet: false },
  }), 'send');
  assert.equal(suggestionHold({
    now: evening, settings, canNotify: () => false,
  }), 'later');
  assert.equal(suggestionHold({
    now: night, settings, canNotify: () => true,
  }), 'send');
  assert.equal(suggestionHold({
    now: night, settings, suggestion: { quiet: true }, canNotify: () => true,
  }), 'never');
  assert.equal(suggestionHold({
    now: night, settings, canNotify() { throw new Error('missing'); },
  }), 'later');
  assert.equal(suggestionFromEngine({ id: 'walk', title: 'Walk' }).quiet, null);
  assert.equal(suggestionHold({
    now: night, settings, suggestion: { quiet: null },
  }), 'later');
});

test('the same suggestion is not asked again within the hour while the app stays open', () => {
  const now = 1_000_000;
  assert.equal(shouldAskSuggestion({ reason: 'tick', lastAskedAt: now, now: now + 30_000, hasCard: false }), false);
  assert.equal(shouldAskSuggestion({ reason: 'tick', lastAskedAt: now, now: now + 60 * 60 * 1000, hasCard: false }), true);
  assert.equal(shouldAskSuggestion({ reason: 'resume', lastAskedAt: now, now: now + 1000, hasCard: false }), true);
  assert.equal(shouldAskSuggestion({ reason: 'open', lastAskedAt: now, now, hasCard: true }), false);
});

test('a suggestion becomes a task at the suggested time, or a sensible default', () => {
  const categories = [
    { id: 'goals', name: 'My goals' },
    { id: 'study', name: 'Study' },
  ];
  const afternoon = new Date(2026, 8, 25, 15, 20);
  assert.equal(defaultSuggestionTime(afternoon), '16:00');
  assert.equal(defaultSuggestionTime(new Date(2026, 8, 25, 6, 30)), '08:00');
  assert.equal(defaultSuggestionTime(new Date(2026, 8, 25, 22, 10)), null);
  const study = buildSuggestionTask({
    id: 's1',
    title: 'Review your notes',
    category: 'Study',
    difficulty: 'medium',
    suggestedTime: '16:30',
    repeat: null,
  }, { now: afternoon, date: '2026-09-25', categories, defaultLead: 10 });
  assert.equal(study.time, '16:30');
  assert.equal(study.categoryId, 'study');
  assert.equal(study.difficulty, 'medium');
  assert.equal(study.repeat, 'none');
  assert.equal(study.remindLeadMin, 10);
  const weekly = buildSuggestionTask({
    title: 'Stretch',
    category: 'life',
    repeat: 'weekly',
    suggestedTime: '19:00',
  }, { now: afternoon, date: '2026-09-25', categories, defaultLead: 10 });
  assert.equal(weekly.repeat, 'days');
  assert.deepEqual(weekly.days, [dayOfWeek('2026-09-25')]);
  assert.equal(weekly.categoryId, 'goals');
  const daily = buildSuggestionTask({
    title: 'Walk',
    repeat: 'daily',
  }, { now: afternoon, date: '2026-09-25', categories });
  assert.equal(daily.time, '16:00');
  assert.equal(daily.repeat, 'daily');
});

test('the suggestion coin bonus applies once and does not change levels', () => {
  assert.equal(POINTS_PER_COIN, 5);
  assert.equal(SUGGESTION_COIN_BONUS, 2);
  const first = applySuggestionBonus({
    bonuses: [],
    taskId: 'task-1',
    firstTime: true,
    date: '2026-09-25',
  });
  assert.equal(first.applied, true);
  assert.equal(first.bonuses[0].id, suggestionBonusId('task-1'));
  assert.equal(first.bonuses[0].points, 0);
  assert.equal(first.bonuses[0].coins, 2);
  const again = applySuggestionBonus({
    bonuses: first.bonuses,
    taskId: 'task-1',
    firstTime: true,
    date: '2026-09-25',
  });
  assert.equal(again.applied, false);
  assert.equal(again.bonuses.length, 1);
  const declined = applySuggestionBonus({ bonuses: [], taskId: 'task-1', firstTime: false });
  assert.equal(declined.applied, false);
  const completions = [{ points: 5 }];
  assert.equal(sumPoints(completions, first.bonuses), 5);
  assert.equal(levelForPoints(sumPoints(completions, first.bonuses)), levelForPoints(5));
  assert.equal(earnedCoins(completions, first.bonuses), coinsFromPoints(5) + 2);
  assert.equal(walletBalance(completions, first.bonuses, 0), 3);
  assert.equal(walletBalance(completions, first.bonuses, 50), 0);
  assert.equal(walletBalance([], [{ points: 10 }], 0), 2);
});

test('a missing suggestion engine resolves to null and does not throw', async () => {
  assert.equal(await resolveSuggestEngine(async () => { throw new Error('404'); }), null);
  assert.equal(await resolveSuggestEngine(async () => ({})), null);
  assert.equal(await resolveSuggestEngine(async () => null), null);
  let loaded = 0;
  const engine = await resolveSuggestEngine(async () => ({
    async loadLibrary() { loaded += 1; },
    getSuggestion() { return null; },
  }));
  assert.equal(typeof engine.getSuggestion, 'function');
  assert.equal(loaded, 1);
  const still = await resolveSuggestEngine(async () => ({
    async loadLibrary() { throw new Error('library'); },
    getSuggestion() { return { id: 'x', title: 'Y' }; },
  }));
  assert.equal(still.getSuggestion().title, 'Y');
});

test('the pet gesture is skipped when motion is reduced', () => {
  assert.equal(suggestionGesture({ reducedMotion: true, celebrations: 'full' }), null);
  assert.equal(suggestionGesture({ reducedMotion: false, celebrations: 'off' }), null);
  assert.equal(suggestionGesture({ reducedMotion: false, celebrations: 'subtle' }), 'wave');
  assert.equal(suggestionGesture({ reducedMotion: false, celebrations: 'full' }), 'wave');
});
