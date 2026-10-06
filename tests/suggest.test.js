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
  assert.equal(normalizeGoal('Read-chapter, 4'), 'read chapter 4');
  assert.equal(normalizeGoal("  Today's HOMEWORK? "), 'today s homework');
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
  assert.match(school.reason, /school/i);

  const notSchool = suggest([{ id: 'c', title: 'Listen to a classic album' }]);
  assert.equal(notSchool.category, 'sleep');
  assert.notEqual(notSchool.category, 'study');
});

test('homework already on the list is not another study suggestion', () => {
  resetSuggestionsForTests();
  const picked = suggest([
    { id: 'a', title: 'Go to school' },
    { id: 'b', title: 'HOMEWORK: chapter 2' },
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
  const again = suggest([
    { id: 'school', title: 'Go to school' },
    { id: 'task-99', title: 'zzzz unique wording' },
  ]);
  assert.notEqual(again.id, first.id);
});

test('frequency caps and the random skip', () => {
  resetSuggestionsForTests();
  const tasks = [{ id: 'a', title: 'Go to school' }];
  assert.equal(suggest(tasks, { settings: { suggestFrequency: 'off' } }), null);
  assert.equal(suggest(tasks, { settings: {}, random: () => 0.99 }), null);
  assert.equal(suggest(tasks, { settings: {}, random: () => 0 }).category, 'study');

  const shown = suggest(tasks, { settings: { suggestFrequency: 'normal' } });
  markShown(shown.id, NOW);
  assert.equal(suggest(tasks, { now: at(3 * HOUR), settings: { suggestFrequency: 'normal' } }), null);
  assert.ok(suggest(tasks, { now: at(20 * HOUR), settings: { suggestFrequency: 'normal' } }));

  resetSuggestionsForTests();
  markShown('study-block', NOW);
  assert.equal(suggest(tasks, { now: at(2 * DAY), settings: { suggestFrequency: 'rare' } }), null);
  assert.equal(suggest(tasks, { now: at(3 * DAY - 1), settings: { suggestFrequency: 'rare' } }), null);
  assert.ok(suggest(tasks, { now: at(3 * DAY), settings: { suggestFrequency: 'rare' } }));

  resetSuggestionsForTests();
  markShown('study-block', NOW);
  assert.equal(suggest(tasks, { now: at(4 * HOUR - 1) }), null);
  const second = suggest(tasks, { now: at(4 * HOUR) });
  assert.ok(second);
  markShown(second.id, at(4 * HOUR));
  assert.equal(suggest(tasks, { now: at(10 * HOUR) }), null);
  assert.ok(suggest(tasks, { now: at(DAY + 5 * HOUR) }));
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

test('shipped JSON matches the seed and loadLibrary reads it', async () => {
  resetSuggestionsForTests();
  const suggestionsText = await readFile(new URL('../data/suggestions.json', import.meta.url), 'utf8');
  const rulesText = await readFile(new URL('../data/gap-rules.json', import.meta.url), 'utf8');
  const docs = seedDocuments();
  assert.deepEqual(JSON.parse(suggestionsText), docs.suggestions);
  assert.deepEqual(JSON.parse(rulesText), docs.rules);
  const library = seedLibrary();
  assert.ok(library.suggestions.length >= 30);
  assert.ok(library.rules.length >= 10);

  await loadLibrary();
  assert.equal(librarySource(), 'file');
  assert.equal(suggest([{ title: 'Go to school' }]).id, 'study-block');
  markDismissed('study-block', { forever: true, now: NOW });
  await loadLibrary();
  assert.notEqual(suggest([{ title: 'Go to school' }]).id, 'study-block');
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
