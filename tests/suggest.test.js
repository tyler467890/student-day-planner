import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  loadLibrary,
  getSuggestion,
  markShown,
  markAccepted,
  markDismissed,
  isSuggestedTask,
  markSuggestedCompleted,
  normalizeGoal,
  parseLibraryDocuments,
  seedDocuments,
  seedLibrary,
  librarySource,
  activeSettings,
  firedRuleIds,
  conceptsForGoal,
  canNotify,
  resetSuggestionsForTests,
  setLibraryReaderForTests,
} from '../js/suggest.js';

const NOW = new Date(2026, 9, 6, 10, 0, 0);
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const OPEN = { suggestFrequency: 'often' };

function at(ms) {
  return new Date(NOW.getTime() + ms);
}

function suggest(tasks, extra = {}) {
  return getSuggestion({
    tasks,
    now: extra.now || NOW,
    settings: extra.settings || OPEN,
    random: Object.prototype.hasOwnProperty.call(extra, 'random') ? extra.random : () => 0,
  });
}

test('normalise goal names before matching', () => {
  assert.equal(normalizeGoal('Go to School!!!'), 'go to school');
  assert.equal(normalizeGoal('Read-chapter, 4'), 'read-chapter 4');
  assert.equal(normalizeGoal("  Today's HOMEWORK? "), "today's homework");
  assert.equal(normalizeGoal('Salt & pepper'), 'salt and pepper');
});

test('school without study suggests study, and classic is not a class', () => {
  resetSuggestionsForTests();
  const school = suggest([
    { id: 'a', title: 'Go to school!!!' },
    { id: 'b', title: 'History class lecture' },
  ]);
  assert.equal(school.category, 'study');
  assert.equal(school.id, 'study-block');
  assert.equal(school.difficulty, 'easy');
  assert.equal(school.suggestedTime, '16:30');
  assert.equal(school.repeat, 'daily');
  assert.equal(school.quiet, false);
  assert.match(school.reason, /school/i);

  const notSchool = suggest([{ id: 'c', title: 'Listen to a classic album' }]);
  assert.equal(notSchool.category, 'sleep');
  assert.notEqual(notSchool.category, 'study');
});

test('homework already on the list is not another study suggestion', () => {
  resetSuggestionsForTests();
  const picked = suggest([
    { id: 'a', title: 'Go to school' },
    { id: 'b', title: 'HOMEWORK chapter 2' },
  ]);
  assert.ok(picked);
  assert.notEqual(picked.category, 'study');
  assert.notEqual(picked.category, 'school');
  const titles = ['go to school', 'homework chapter 2'];
  assert.equal(titles.includes(normalizeGoal(picked.title)), false);
});

test('work-heavy list suggests something relaxing', () => {
  resetSuggestionsForTests();
  const picked = suggest([
    { id: '1', title: 'Morning shift' },
    { id: '2', title: 'Work the closing shift' },
    { id: '3', title: 'Email the boss about the job' },
  ]);
  assert.equal(picked.category, 'relax');
  assert.equal(['easy', 'medium', 'hard'].includes(picked.difficulty), true);
});

test('an empty list falls back to a life-improvement goal', () => {
  resetSuggestionsForTests();
  const picked = suggest([]);
  assert.equal(picked.category, 'sleep');
});

test('nothing already on the list is suggested, and a full list yields nothing', () => {
  resetSuggestionsForTests();
  const school = [{ id: 'a', title: 'Go to school' }];
  const first = suggest(school);
  assert.equal(first.category, 'study');
  const second = suggest([...school, { id: 'dup', title: first.title }]);
  assert.notEqual(second.id, first.id);
  assert.notEqual(second.category, 'study');
  const listed = [...school, { id: 'dup', title: first.title }].map((task) => normalizeGoal(task.title));
  assert.equal(listed.includes(normalizeGoal(second.title)), false);

  const library = seedLibrary();
  const covered = Object.values(library.categories).map((category, index) => ({
    id: `c-${index}`,
    title: category.keywords[0],
  }));
  assert.equal(suggest(covered), null);
});

test('an accepted suggestion still on the list is not offered again', () => {
  resetSuggestionsForTests();
  const first = suggest([{ id: 'school', title: 'Go to school' }]);
  markAccepted(first.id, 'task-99', NOW);
  assert.equal(isSuggestedTask('task-99'), true);
  const stillThere = [
    { id: 'school', title: 'Go to school' },
    { id: 'task-99', title: 'zzzz unique wording' },
  ];
  const pause = seedLibrary().settings.cooldownAfterAcceptDays * DAY;
  assert.equal(suggest(stillThere, { now: at(pause - 1) }), null);
  const again = suggest(stillThere, { now: at(pause) });
  assert.notEqual(again.id, first.id);
});

test('frequency caps and the random skip', () => {
  resetSuggestionsForTests();
  const tasks = [{ id: 'a', title: 'Go to school' }];
  const settings = seedLibrary().settings;
  const normal = { suggestFrequency: 'normal' };
  assert.equal(suggest(tasks, { settings: { suggestFrequency: 'off' } }), null);
  assert.equal(suggest(tasks, { settings: normal, random: () => 0.99 }), null);
  assert.equal(suggest(tasks, { settings: normal, random: () => 0 }).category, 'study');

  const shown = suggest(tasks, { settings: normal });
  markShown(shown.id, NOW);
  assert.equal(suggest(tasks, { now: at(20 * HOUR), settings: normal }), null);
  assert.equal(suggest(tasks, { now: at(settings.minDaysBetweenSuggestions * DAY - 1), settings: normal }), null);
  const second = suggest(tasks, { now: at(settings.minDaysBetweenSuggestions * DAY), settings: normal });
  assert.ok(second);
  markShown(second.id, at(settings.minDaysBetweenSuggestions * DAY));
  assert.equal(suggest(tasks, { now: at(6 * DAY), settings: normal }), null);
  assert.ok(suggest(tasks, { now: at(7 * DAY), settings: normal }));

  resetSuggestionsForTests();
  markShown('study-block', NOW);
  assert.equal(suggest(tasks, { now: at(6 * DAY), settings: { suggestFrequency: 'rare' } }), null);
  assert.ok(suggest(tasks, { now: at(7 * DAY), settings: { suggestFrequency: 'rare' } }));

  resetSuggestionsForTests();
  markShown('study-block', NOW);
  assert.equal(suggest(tasks, { now: at(4 * HOUR) }), null);
  assert.equal(suggest(tasks, { now: at(1.5 * DAY - 1) }), null);
  assert.ok(suggest(tasks, { now: at(1.5 * DAY) }));
});

test('the same day does not flip between showing and hiding', () => {
  resetSuggestionsForTests();
  const tasks = [{ id: 'a', title: 'Go to school' }];
  const settings = { suggestFrequency: 'normal' };
  let shown = 0;
  let hidden = 0;
  for (let i = 0; i < 40; i += 1) {
    const now = new Date(2026, 0, 1 + i, 10, 0, 0);
    const first = getSuggestion({ tasks, now, settings });
    const second = getSuggestion({ tasks, now, settings });
    assert.deepEqual(first, second);
    if (first) shown += 1;
    else hidden += 1;
  }
  assert.ok(shown > 0);
  assert.ok(hidden > 0);
});

test('dismiss forever never returns, and not-now snoozes for 7 days', () => {
  resetSuggestionsForTests();
  const tasks = [{ id: 'a', title: 'Go to school' }];
  const first = suggest(tasks);
  assert.equal(first.id, 'study-block');
  markDismissed(first.id, { forever: true, now: NOW });
  assert.notEqual(suggest(tasks, { now: at(30 * DAY) }).id, first.id);
  for (let i = 0; i < 10; i += 1) {
    const picked = suggest(tasks, { now: at(i * DAY), random: () => i / 1000 });
    if (picked) assert.notEqual(picked.id, first.id);
  }

  resetSuggestionsForTests();
  markDismissed('study-block', { forever: false, now: NOW });
  assert.notEqual(suggest(tasks, { now: at(7 * DAY - 1) }).id, 'study-block');
  assert.equal(suggest(tasks, { now: at(7 * DAY) }).id, 'study-block');
});

test('the completion bonus is true only the first time for an accepted suggestion', () => {
  resetSuggestionsForTests();
  assert.equal(isSuggestedTask('task-1'), false);
  assert.equal(markSuggestedCompleted('task-1'), false);
  markShown('study-block', NOW);
  assert.equal(markSuggestedCompleted('task-1'), false);
  markAccepted('study-block', 'task-1', NOW);
  assert.equal(isSuggestedTask('task-1'), true);
  assert.equal(isSuggestedTask('other'), false);
  assert.equal(markSuggestedCompleted('task-1'), true);
  assert.equal(markSuggestedCompleted('task-1'), false);
});

test('malformed JSON falls back to the seed, and a valid pair is used', async () => {
  resetSuggestionsForTests();
  const docs = seedDocuments();
  assert.equal(parseLibraryDocuments({ suggestions: 'nope' }, docs.rules), null);
  assert.equal(parseLibraryDocuments(docs.suggestions, { rules: [] }), null);
  const broken = structuredClone(docs.suggestions);
  broken.suggestions[0] = { ...broken.suggestions[0], difficulty: 'impossible' };
  assert.equal(parseLibraryDocuments(broken, docs.rules), null);
  const dupes = structuredClone(docs.suggestions);
  dupes.suggestions.push({ ...dupes.suggestions[0] });
  assert.equal(parseLibraryDocuments(dupes, docs.rules), null);
  const badPercent = structuredClone(docs.rules);
  badPercent.rules = [{ ...badPercent.rules[0], when: { category: 'work', percent: '40' } }];
  assert.equal(parseLibraryDocuments(docs.suggestions, badPercent), null);

  setLibraryReaderForTests(async () => ({ suggestionsText: '{', rulesText: '{}' }));
  await loadLibrary();
  assert.equal(librarySource(), 'seed');
  assert.equal(suggest([{ id: 'a', title: 'Go to school' }]).id, 'study-block');

  resetSuggestionsForTests();
  const customSuggestions = {
    version: 1,
    suggestions: [
      {
        id: 'custom-study',
        title: 'Custom study block',
        category: 'study',
        reason: 'Custom reason about school.',
        difficulty: 'medium',
        suggestedTime: '16:30',
        repeat: 'daily',
      },
      {
        id: 'custom-relax',
        title: 'Custom quiet break',
        category: 'relax',
        reason: 'Custom relax reason.',
        difficulty: 'easy',
        repeat: null,
      },
      {
        id: 'custom-sleep',
        title: 'Custom bedtime',
        category: 'sleep',
        reason: 'Custom sleep reason.',
        difficulty: 'easy',
        repeat: 'daily',
      },
    ],
  };
  const customRules = {
    version: 1,
    categories: {
      study: { label: 'Study', lifeImprovement: false, keywords: ['study', 'homework'] },
      school: { label: 'School', lifeImprovement: false, keywords: ['school', 'class'] },
      work: { label: 'Work', lifeImprovement: false, keywords: ['work', 'shift', 'job'] },
      relax: { label: 'Relax', lifeImprovement: true, keywords: ['relax', 'quiet'] },
      sleep: { label: 'Sleep', lifeImprovement: true, keywords: ['sleep', 'bedtime'] },
    },
    rules: [
      {
        id: 'school-without-study',
        kind: 'missing',
        when: { has: ['school'], missing: ['study'] },
        suggest: ['study'],
        weight: 10,
      },
      {
        id: 'work-heavy',
        kind: 'too-much',
        when: { category: 'work', percent: 40, count: 99, minTasks: 4 },
        suggest: ['relax'],
        weight: 9,
      },
      {
        id: 'no-sleep',
        kind: 'missing',
        when: { missing: ['sleep'] },
        suggest: ['sleep'],
        weight: 4,
      },
    ],
  };
  setLibraryReaderForTests(async () => ({
    suggestionsText: JSON.stringify(customSuggestions),
    rulesText: JSON.stringify(customRules),
  }));
  await loadLibrary();
  assert.equal(librarySource(), 'file');
  assert.equal(suggest([{ title: 'Go to school' }]).id, 'custom-study');
  assert.equal(suggest([{ title: 'Morning shift' }, { title: 'Another shift' }]).category, 'sleep');
  const heavy = [
    { title: 'Morning shift' },
    { title: 'Closing shift' },
    { title: 'Job email' },
    { title: 'zzzz one' },
    { title: 'zzzz two' },
  ];
  assert.equal(suggest(heavy).id, 'custom-relax');

  await loadLibrary();
  assert.equal(suggest([{ title: 'Go to school' }]).id, 'custom-study');
});

const READY = { suggestFrequency: 'often', installedOn: '2020-01-01' };

function real(tasks, extra = {}) {
  return suggest(tasks, {
    ...extra,
    settings: extra.settings || READY,
  });
}

test('the real library loads and matches the rule simulator', async () => {
  resetSuggestionsForTests();
  const suggestionsText = await readFile(new URL('../data/suggestions.json', import.meta.url), 'utf8');
  const rulesText = await readFile(new URL('../data/gap-rules.json', import.meta.url), 'utf8');
  const suggestions = JSON.parse(suggestionsText);
  const rules = JSON.parse(rulesText);
  assert.equal(Array.isArray(suggestions), true);
  assert.equal(suggestions.length, 132);
  assert.equal(suggestions.filter((item) => item.meta && item.meta.ageSafe === false).length, 9);
  assert.equal(rules.rules.length, 23);
  assert.equal(Object.keys(rules.concepts).length, 26);
  assert.equal(rules.settings.maxPerDay, 1);
  assert.equal(rules.settings.maxPerWeek, 2);
  assert.equal(rules.settings.showChanceWhenEligible, 0.3);
  assert.equal(rules.settings.minDaysBetweenSuggestions, 3);
  assert.equal(rules.settings.minDaysSinceFirstUse, 2);
  assert.equal(rules.settings.skipIfOpenGoalsAtLeast, 12);
  assert.deepEqual(rules.settings.quietHours, { start: '21:00', end: '07:00' });

  await loadLibrary();
  assert.equal(librarySource(), 'file');
  assert.equal(activeSettings().maxPerWeek, rules.settings.maxPerWeek);
  assert.equal(activeSettings().showChanceWhenEligible, rules.settings.showChanceWhenEligible);
  assert.equal(conceptsForGoal('Finish homework').includes('work'), false);
  assert.equal(conceptsForGoal('Listen to a classic album').includes('school'), false);
  assert.equal(conceptsForGoal('Go to school').includes('school'), true);

  const cases = {
    student: [
      [{ title: 'Go to school' }, { title: 'Soccer practice' }, { title: 'Walk dog' }],
      ['school-no-study', 'sports-no-recovery', 'no-sleep-goal', 'routine-anchor'],
    ],
    worker: [
      [
        { title: 'Work shift 9-5' },
        { title: 'Answer emails' },
        { title: 'Team meeting' },
        { title: 'Do laundry' },
        { title: 'Gym' },
      ],
      ['work-heavy-no-rest', 'income-no-money', 'no-social', 'no-sleep-goal', 'no-learning'],
    ],
    'night-owl': [
      [
        { title: 'Finish essay', time: '23:30' },
        { title: 'Play Fortnite' },
        { title: 'Watch YouTube' },
        { title: 'Math homework' },
      ],
      ['late-night', 'big-task-no-plan', 'screens-heavy', 'sedentary-heavy', 'no-movement', 'no-sleep-goal'],
    ],
    spender: [
      [{ title: 'Buy new shoes' }, { title: 'Babysitting' }, { title: 'Call grandma' }],
      ['income-no-money', 'spending-no-budget', 'no-movement', 'no-sleep-goal'],
    ],
    exam: [
      [{ title: 'Bio exam Friday' }, { title: 'Iced coffee' }, { title: 'Stressed - finish lab report' }],
      ['exam-coming', 'stress-words', 'exam-no-sleep', 'big-task-no-plan', 'caffeine', 'no-movement', 'no-sleep-goal'],
    ],
    new: [[{ title: 'Read' }], ['learning-practice', 'new-user']],
  };
  for (const [name, [tasks, expected]] of Object.entries(cases)) {
    assert.deepEqual(firedRuleIds(tasks, NOW), expected, name);
  }

  const school = real([{ title: 'Go to school' }]);
  assert.equal(school.id, 'stu-05');
  assert.equal(school.category, 'study');
  assert.equal(school.difficulty, 'easy');
  assert.equal(school.quiet, false);
  const worker = real([
    { title: 'Work shift 9-5' },
    { title: 'Answer emails' },
    { title: 'Team meeting' },
    { title: 'Do laundry' },
    { title: 'Gym' },
  ]);
  assert.equal(worker.id, 'rlx-01');
  assert.equal(worker.category, 'relax');
});

test('teen and adult cards stay hidden until suggestIncludeOlder is on', async () => {
  resetSuggestionsForTests();
  await loadLibrary();
  const coffee = [{ title: 'Iced coffee' }];
  const safe = real(coffee);
  assert.notEqual(safe.id, 'slp-08');
  assert.equal(safe.id, 'hea-05');
  const older = real(coffee, { settings: { ...READY, suggestIncludeOlder: true } });
  assert.equal(older.id, 'slp-08');
  assert.equal(older.category, 'sleep');
});

test('no suggestions in the first two days, or with 12 open goals', async () => {
  resetSuggestionsForTests();
  await loadLibrary();
  const tasks = [{ id: 'a', title: 'Go to school' }];
  assert.equal(real(tasks, { settings: { ...READY, installedOn: '2026-10-06' } }), null);
  assert.equal(real(tasks, { settings: { ...READY, installedOn: '2026-10-05' } }), null);
  assert.equal(real(tasks, { settings: { ...READY, installedOn: '2026-10-04' } }).id, 'stu-05');
  assert.equal(real(tasks, { settings: { suggestFrequency: 'often' } }).id, 'stu-05');

  const open = Array.from({ length: 12 }, (_, index) => ({ id: `g${index}`, title: 'Go to school' }));
  assert.equal(real(open), null);
  assert.equal(real(open.slice(0, 11)).id, 'stu-05');
  const sameId = Array.from({ length: 12 }, () => ({ id: 'same', title: 'Go to school' }));
  assert.equal(real(sameId).id, 'stu-05');
  const mixed = open.slice(0, 11).concat([{ id: 'done', title: 'Go to school', completedOn: '2026-10-05' }]);
  assert.equal(real(mixed).id, 'stu-05');
});

test('the weekly cap, category snooze, and quiet hours follow the library settings', async () => {
  resetSuggestionsForTests();
  await loadLibrary();
  const tasks = [{ id: 'a', title: 'Go to school' }];
  const normal = { ...READY, suggestFrequency: 'normal' };
  const first = real(tasks, { settings: normal });
  markShown(first.id, NOW);
  markShown('stu-01', at(3 * DAY));
  assert.equal(real(tasks, { settings: normal, now: at(6 * DAY) }), null);
  assert.ok(real(tasks, { settings: normal, now: at(7 * DAY) }));

  resetSuggestionsForTests();
  await loadLibrary();
  assert.equal(real(tasks).id, 'stu-05');
  markDismissed('stu-05', { now: NOW });
  markDismissed('stu-01', { now: at(DAY) });
  assert.equal(real(tasks, { now: at(DAY) }).id, 'stu-09');
  markDismissed('stu-09', { now: at(2 * DAY) });
  const snoozed = real(tasks, { now: at(2 * DAY) });
  assert.notEqual(snoozed.category, 'study');
  assert.equal(real(tasks, { now: at(32 * DAY) }).id, 'stu-05');

  const morning = new Date(2026, 9, 6, 10, 0, 0);
  const night = new Date(2026, 9, 6, 21, 0, 0);
  const beforeSeven = new Date(2026, 9, 6, 6, 59, 0);
  const seven = new Date(2026, 9, 6, 7, 0, 0);
  const byDay = real(tasks, { now: morning });
  const byNight = real(tasks, { now: night });
  assert.equal(byDay.quiet, false);
  assert.equal(canNotify(morning), true);
  assert.ok(byNight);
  assert.equal(byNight.id, byDay.id);
  assert.equal(byNight.quiet, true);
  assert.equal(canNotify(night), false);
  assert.equal(real(tasks, { now: beforeSeven }).quiet, true);
  assert.equal(canNotify(beforeSeven), false);
  assert.equal(real(tasks, { now: seven }).quiet, false);
  assert.equal(canNotify(seven), true);
});

test('caps and quiet hours are read from the rules file', async () => {
  resetSuggestionsForTests();
  const suggestionsText = await readFile(new URL('../data/suggestions.json', import.meta.url), 'utf8');
  const rules = JSON.parse(await readFile(new URL('../data/gap-rules.json', import.meta.url), 'utf8'));
  rules.settings.skipIfOpenGoalsAtLeast = 2;
  rules.settings.maxPerWeek = 1;
  rules.settings.quietHours = { start: '21:00', end: '12:00' };
  setLibraryReaderForTests(async () => ({
    suggestionsText,
    rulesText: JSON.stringify(rules),
  }));
  await loadLibrary();
  assert.equal(activeSettings().skipIfOpenGoalsAtLeast, 2);
  assert.equal(activeSettings().quietHours.end, '12:00');
  const one = [{ id: 'a', title: 'Go to school' }];
  const two = [{ id: 'a', title: 'Go to school' }, { id: 'b', title: 'Math class' }];
  const lateMorning = new Date(2026, 9, 6, 11, 0, 0);
  const noon = new Date(2026, 9, 6, 12, 0, 0);
  assert.equal(real(one, { now: lateMorning }).quiet, true);
  assert.equal(canNotify(lateMorning), false);
  assert.equal(real(one, { now: noon }).quiet, false);
  assert.equal(real(two), null);
  assert.equal(real(one).id, 'stu-05');
  markShown('stu-05', NOW);
  assert.equal(real(one, { settings: { ...READY, suggestFrequency: 'normal' }, now: at(3 * DAY) }), null);
});

test('service worker caches the engine and Pages copies the data files', async () => {
  const sw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');
  const version = Number(sw.match(/const CACHE = 'dayli-v(\d+)'/)[1]);
  assert.ok(version >= 13);
  assert.match(sw, /\.\/js\/suggest\.js/);
  assert.match(sw, /\.\/data\/suggestions\.json/);
  assert.match(sw, /\.\/data\/gap-rules\.json/);
  const pages = await readFile(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  assert.match(pages, /cp -r[^\n]*\bdata\b/);
});
