/**
 * Suggested goals engine. No UI. The page (or agent B) loads this module,
 * awaits loadLibrary(), then calls getSuggestion when it is ready to offer
 * one card. Mark the outcome so cooldown, snooze, and the one-off completion
 * bonus stay on this device.
 *
 *   loadLibrary(): Promise<void>
 *   getSuggestion({ tasks, now, settings, random }): Suggestion | null
 *   markShown(id, now?)
 *   markAccepted(id, taskId, now?)
 *   markDismissed(id, { forever, now })
 *   isSuggestedTask(taskId): boolean
 *   markSuggestedCompleted(taskId): boolean
 *
 * Suggestion = { id, title, category, reason, difficulty, suggestedTime?, repeat }
 * difficulty is 'easy' | 'medium' | 'hard'. repeat is 'daily' | 'weekly' | null.
 * settings.suggestFrequency is 'off' | 'rare' | 'normal' | 'often' (default 'normal').
 * tasks are the planner's stored tasks (title, note, categoryId, id).
 * now is a Date, epoch ms, or date string. random() in [0, 1) is optional;
 * without it the engine rolls a stable per-day number so polling does not
 * eventually force a card. Pass random from tests when the roll must be fixed.
 *
 * History is IndexedDB store "suggestions", record id "state", via js/db.js.
 * It is not part of replaceAll, so ordinary planner saves do not wipe it.
 * The only reads are the two local JSON files under data/.
 */

import { getAll, put } from './db.js';

const STATE_ID = 'state';
const STORE = 'suggestions';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const SNOOZE_MS = 7 * DAY_MS;
const RARE_GAP_MS = 3 * DAY_MS;
const OFTEN_GAP_MS = 4 * HOUR_MS;
const FIRE_CHANCE = { rare: 0.34, normal: 0.5, often: 0.72 };
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const GENERIC_CATEGORY_IDS = new Set(['goals', 'goal', 'none', 'other', 'main']);

function goal(id, title, category, reason, difficulty, suggestedTime = null, repeat = null) {
  const item = { id, title, category, reason, difficulty };
  if (suggestedTime) item.suggestedTime = suggestedTime;
  item.repeat = repeat;
  return item;
}

/** Raw documents. data/*.json is generated from these and may replace them. */
const SEED_SUGGESTIONS_DOC = {
  version: 1,
  suggestions: [
    goal('study-block', 'Study for 25 minutes', 'study', 'School is on your list, and a short study block keeps the classwork from piling up.', 'easy', '16:30', 'daily'),
    goal('study-notes', "Review today's notes", 'study', 'A few minutes with the notes from today makes the next class easier.', 'medium', '17:00', 'daily'),
    goal('study-homework', 'Start the next homework problem', 'study', 'Starting the next problem is the hard part, so this one stays small.', 'easy', '16:00', 'daily'),
    goal('study-flashcards', 'Make 10 flashcards for the next exam', 'study', 'Ten cards is enough to feel ready without taking the whole evening.', 'medium', '19:00', 'weekly'),
    goal('study-chapter', 'Read one textbook chapter', 'study', 'One chapter is a clear finish line when a textbook feels endless.', 'medium', '18:00', null),
    goal('relax-hobby', 'Spend 20 minutes on a hobby', 'relax', 'Something you actually like belongs on the list too.', 'easy', null, 'weekly'),
    goal('relax-phone', 'Put your phone in another room for 15 minutes', 'relax', 'Fifteen quiet minutes gives your head a less crowded room.', 'easy', null, null),
    goal('relax-song', 'Listen to one song and do nothing else', 'relax', 'One song, with nothing else going on, is enough to come up for air.', 'easy', null, null),
    goal('relax-stretch', 'Stretch for five minutes', 'relax', 'Five minutes of stretching undoes a long sit.', 'easy', null, 'daily'),
    goal('relax-walk', 'Take a 10 minute walk outside', 'relax', 'When the list is heavy, a short walk is a real break.', 'easy', '15:30', null),
    goal('sleep-bedtime', 'Pick a bedtime and start winding down', 'sleep', 'A bedtime you actually start makes the next day less of a scramble.', 'easy', '22:00', 'daily'),
    goal('sleep-screens', 'Screens off 30 minutes before bed', 'sleep', 'Screens off before bed makes it easier to fall asleep.', 'medium', '21:30', 'daily'),
    goal('sleep-wake', 'Set an alarm for the same wake time tomorrow', 'sleep', 'The same wake time does more for your energy than a perfect night.', 'easy', '07:30', 'daily'),
    goal('prod-top-three', "Write tomorrow's top three priorities", 'productivity', 'Three priorities beat a long list you will not finish.', 'easy', '21:00', 'daily'),
    goal('prod-two-minute', 'Finish one two-minute task you have been avoiding', 'productivity', 'A tiny task you have been avoiding is a quick win.', 'easy', null, null),
    goal('prod-week', 'Sketch a rough plan for the week', 'productivity', 'A rough week plan keeps the days from blurring together.', 'medium', '18:00', 'weekly'),
    goal('money-save', 'Move a small amount into savings', 'money', 'A small transfer into savings counts, even if it is tiny.', 'easy', null, 'weekly'),
    goal('money-skip', 'Skip one unplanned purchase today', 'money', 'Skipping one unplanned purchase is a real saving.', 'medium', null, null),
    goal('money-spent', 'Write down what you spent today', 'money', 'Writing down what you spent makes the money picture honest.', 'easy', '21:00', 'daily'),
    goal('health-fruit', 'Eat one piece of fruit', 'health', 'One piece of fruit is a simple way to look after yourself.', 'easy', null, 'daily'),
    goal('health-move', 'Move your body for 15 minutes', 'health', 'Fifteen minutes of moving counts, even if it is not a workout.', 'easy', '17:30', 'daily'),
    goal('health-posture', 'Reset your posture and unclench your shoulders', 'health', 'Unclench your shoulders. Your body has been holding the day.', 'easy', null, null),
    goal('health-water', 'Drink a full glass of water', 'health', 'One full glass of water is an easy health win.', 'easy', '09:00', 'daily'),
    goal('meals-breakfast', 'Eat breakfast before you start the day', 'meals', 'Eating before the day starts keeps the morning from running you.', 'easy', '08:00', 'daily'),
    goal('meals-lunch', 'Sit down for a real lunch', 'meals', 'A real lunch beats grazing over your work.', 'easy', '12:15', 'daily'),
    goal('mind-breath', 'Take three slow breaths', 'mindfulness', 'Three slow breaths reset a loud hour.', 'easy', null, null),
    goal('mind-journal', 'Write one line about how today went', 'mindfulness', 'One line about today is enough to put it down.', 'easy', '21:15', 'daily'),
    goal('chores-laundry', 'Start one load of laundry', 'chores', 'Starting one load is the whole chore. Folding can wait.', 'medium', null, 'weekly'),
    goal('chores-tidy', 'Tidy one surface for 10 minutes', 'chores', 'Ten minutes on one surface is enough. Leave the rest.', 'easy', null, null),
    goal('social-meal', 'Plan one meal with someone this week', 'social', 'One shared meal gives the week a person, not just tasks.', 'easy', null, 'weekly'),
    goal('social-text', 'Send a message to a friend', 'social', 'A short message is enough to stay connected.', 'easy', null, null),
    goal('social-thanks', 'Thank someone who helped you recently', 'social', 'Thanking someone makes the help feel seen.', 'easy', null, null),
  ],
};

const SEED_RULES_DOC = {
  version: 1,
  categories: {
    study: {
      label: 'Study',
      lifeImprovement: false,
      keywords: ['study', 'studying', 'homework', 'revise', 'revision', 'exam', 'exams', 'quiz', 'assignment', 'essay', 'read chapter', 'flashcards', 'coursework'],
    },
    school: {
      label: 'School',
      lifeImprovement: false,
      keywords: ['school', 'class', 'lecture', 'lesson', 'tutorial', 'seminar', 'campus', 'homeroom'],
    },
    work: {
      label: 'Work',
      lifeImprovement: false,
      keywords: ['work', 'shift', 'job', 'internship', 'paycheck', 'boss', 'workplace', 'at work'],
    },
    relax: {
      label: 'Relax',
      lifeImprovement: true,
      keywords: ['relax', 'unwind', 'break', 'hobby', 'phone away'],
    },
    sleep: {
      label: 'Sleep',
      lifeImprovement: true,
      keywords: ['sleep', 'bedtime', 'wind down', 'lights out', 'in bed', 'screens off'],
    },
    productivity: {
      label: 'Productivity',
      lifeImprovement: true,
      keywords: ['priorities', 'plan my day', 'plan the week', 'pomodoro', 'deep work', 'two minute', 'to do list', 'todo list'],
    },
    money: {
      label: 'Money',
      lifeImprovement: true,
      keywords: ['budget', 'savings', 'save money', 'spending', 'spent', 'allowance', 'expense', 'unplanned purchase'],
    },
    health: {
      label: 'Health',
      lifeImprovement: true,
      keywords: ['exercise', 'workout', 'walk', 'run', 'gym', 'water', 'hydrate', 'stretch', 'fruit', 'posture', 'vitamins'],
    },
    social: {
      label: 'Social',
      lifeImprovement: true,
      keywords: ['friend', 'friends', 'family', 'hang out', 'catch up', 'text a friend', 'thank someone'],
    },
    meals: {
      label: 'Meals',
      lifeImprovement: true,
      keywords: ['breakfast', 'lunch', 'dinner', 'meal', 'meals', 'cook'],
    },
    chores: {
      label: 'Chores',
      lifeImprovement: true,
      keywords: ['laundry', 'dishes', 'tidy', 'vacuum', 'chore', 'chores'],
    },
    mindfulness: {
      label: 'Mindfulness',
      lifeImprovement: true,
      keywords: ['meditate', 'meditation', 'journal', 'gratitude', 'slow breaths', 'mindful'],
    },
  },
  rules: [
    {
      id: 'school-without-study',
      description: 'School or class is on the list, and nothing looks like studying.',
      kind: 'missing',
      when: { has: ['school'], missing: ['study'] },
      suggest: ['study'],
      weight: 8,
    },
    {
      id: 'no-sleep',
      description: 'No sleep or bedtime goal yet.',
      kind: 'missing',
      when: { missing: ['sleep'] },
      suggest: ['sleep'],
      weight: 4,
    },
    {
      id: 'no-health',
      description: 'Nothing on the list looks after the body.',
      kind: 'missing',
      when: { missing: ['health'] },
      suggest: ['health'],
      weight: 3,
    },
    {
      id: 'no-social',
      description: 'No friend, family, or other people goal.',
      kind: 'missing',
      when: { missing: ['social'] },
      suggest: ['social'],
      weight: 3,
    },
    {
      id: 'no-money',
      description: 'No money, budget, or savings goal.',
      kind: 'missing',
      when: { missing: ['money'] },
      suggest: ['money'],
      weight: 2,
    },
    {
      id: 'no-productivity',
      description: 'No planning or focus goal.',
      kind: 'missing',
      when: { missing: ['productivity'] },
      suggest: ['productivity'],
      weight: 3,
    },
    {
      id: 'busy-without-break',
      description: 'School, work, or study is on the list, and nothing is a break.',
      kind: 'missing',
      when: { hasAny: ['work', 'school', 'study'], missing: ['relax'] },
      suggest: ['relax'],
      weight: 5,
    },
    {
      id: 'work-heavy',
      description: 'Work is more than 40% of the list, or at least 3 work items.',
      kind: 'too-much',
      when: { category: 'work', percent: 40, count: 3, minTasks: 4 },
      suggest: ['relax'],
      weight: 9,
    },
    {
      id: 'study-heavy',
      description: 'Study is more than half the list, or at least 4 study items.',
      kind: 'too-much',
      when: { category: 'study', percent: 50, count: 4, minTasks: 4 },
      suggest: ['relax', 'social'],
      weight: 7,
    },
    {
      id: 'meals-during-busy',
      description: 'School or work is on the list, and no meal goal.',
      kind: 'missing',
      when: { hasAny: ['school', 'work'], missing: ['meals'] },
      suggest: ['meals'],
      weight: 4,
    },
  ],
};

export function normalizeGoal(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function validVersion(doc) {
  return doc.version == null || (Number.isInteger(doc.version) && doc.version >= 1);
}

function parseSuggestion(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  if (typeof item.id !== 'string' || !item.id.trim()) return null;
  if (typeof item.title !== 'string' || !item.title.trim()) return null;
  if (typeof item.category !== 'string' || !item.category.trim()) return null;
  if (typeof item.reason !== 'string' || !item.reason.trim()) return null;
  if (item.difficulty !== 'easy' && item.difficulty !== 'medium' && item.difficulty !== 'hard') return null;
  let suggestedTime;
  if (item.suggestedTime != null && item.suggestedTime !== '') {
    if (typeof item.suggestedTime !== 'string' || !TIME_RE.test(item.suggestedTime)) return null;
    suggestedTime = item.suggestedTime;
  }
  let repeat = null;
  if (item.repeat != null && item.repeat !== '') {
    if (item.repeat !== 'daily' && item.repeat !== 'weekly') return null;
    repeat = item.repeat;
  }
  const parsed = {
    id: item.id.trim(),
    title: item.title.trim(),
    category: item.category.trim(),
    reason: item.reason.trim(),
    difficulty: item.difficulty,
    repeat,
  };
  if (suggestedTime) parsed.suggestedTime = suggestedTime;
  return parsed;
}

function parseSuggestions(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !validVersion(doc)) return null;
  if (!Array.isArray(doc.suggestions) || doc.suggestions.length === 0) return null;
  const suggestions = [];
  const ids = new Set();
  for (const item of doc.suggestions) {
    const parsed = parseSuggestion(item);
    if (!parsed || ids.has(parsed.id)) return null;
    ids.add(parsed.id);
    suggestions.push(parsed);
  }
  return suggestions;
}

function parseCategories(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const ids = Object.keys(raw);
  if (!ids.length) return null;
  const categories = {};
  for (const id of ids) {
    if (!/^\S+$/.test(id)) return null;
    const cat = raw[id];
    if (!cat || typeof cat !== 'object' || Array.isArray(cat)) return null;
    if (!Array.isArray(cat.keywords) || cat.keywords.length === 0) return null;
    const keywords = [];
    for (const keyword of cat.keywords) {
      if (typeof keyword !== 'string' || !normalizeGoal(keyword)) return null;
      keywords.push(keyword.trim());
    }
    if (cat.label != null && (typeof cat.label !== 'string' || !cat.label.trim())) return null;
    if (cat.lifeImprovement != null && typeof cat.lifeImprovement !== 'boolean') return null;
    categories[id] = {
      label: cat.label ? cat.label.trim() : id,
      lifeImprovement: cat.lifeImprovement === true,
      keywords,
    };
  }
  return categories;
}

function parseIdList(value, categories, optional) {
  if (value == null && optional) return [];
  if (!Array.isArray(value)) return null;
  const ids = [];
  for (const id of value) {
    if (typeof id !== 'string' || !categories[id]) return null;
    ids.push(id);
  }
  return ids;
}

function parseWeight(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

function parseSuggest(suggest, ruleWeight, categories) {
  if (!Array.isArray(suggest) || suggest.length === 0) return null;
  const out = [];
  for (const item of suggest) {
    if (typeof item === 'string') {
      if (!categories[item]) return null;
      out.push({ category: item, weight: ruleWeight });
    } else if (item && typeof item === 'object' && typeof item.category === 'string' && categories[item.category]) {
      const weight = parseWeight(item.weight, ruleWeight);
      if (weight == null) return null;
      out.push({ category: item.category, weight });
    } else {
      return null;
    }
  }
  return out;
}

function parseRule(rule, categories) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return null;
  if (typeof rule.id !== 'string' || !rule.id.trim()) return null;
  if (rule.kind !== 'missing' && rule.kind !== 'too-much') return null;
  const weight = parseWeight(rule.weight, 1);
  if (weight == null) return null;
  const suggest = parseSuggest(rule.suggest, weight, categories);
  if (!suggest) return null;
  const when = rule.when;
  if (!when || typeof when !== 'object' || Array.isArray(when)) return null;
  let parsedWhen;
  if (rule.kind === 'missing') {
    const has = parseIdList(when.has, categories, true);
    const hasAny = parseIdList(when.hasAny, categories, true);
    const missing = parseIdList(when.missing, categories, false);
    if (!has || !hasAny || !missing || missing.length === 0) return null;
    parsedWhen = { has, hasAny, missing };
  } else {
    if (typeof when.category !== 'string' || !categories[when.category]) return null;
    const percent = when.percent == null ? null : when.percent;
    const count = when.count == null ? null : when.count;
    if (percent == null && count == null) return null;
    if (percent != null && (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100)) return null;
    if (count != null && (!Number.isInteger(count) || count < 1)) return null;
    const minTasks = when.minTasks == null ? 4 : when.minTasks;
    if (!Number.isInteger(minTasks) || minTasks < 0) return null;
    parsedWhen = { category: when.category, percent, count, minTasks };
  }
  const parsed = {
    id: rule.id.trim(),
    kind: rule.kind,
    when: parsedWhen,
    suggest,
    weight,
  };
  if (rule.description != null) {
    if (typeof rule.description !== 'string') return null;
    parsed.description = rule.description;
  }
  return parsed;
}

function parseRulesDocument(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !validVersion(doc)) return null;
  const categories = parseCategories(doc.categories);
  if (!categories || !Array.isArray(doc.rules)) return null;
  const rules = [];
  const ids = new Set();
  for (const rule of doc.rules) {
    const parsed = parseRule(rule, categories);
    if (!parsed || ids.has(parsed.id)) return null;
    ids.add(parsed.id);
    rules.push(parsed);
  }
  return { categories, rules };
}

/**
 * Validate the two JSON documents. Returns the library, or null if either
 * document is malformed. Unknown extra fields are ignored.
 */
export function parseLibraryDocuments(suggestionsDoc, rulesDoc) {
  const suggestions = parseSuggestions(suggestionsDoc);
  const rulesDocParsed = parseRulesDocument(rulesDoc);
  if (!suggestions || !rulesDocParsed) return null;
  for (const suggestion of suggestions) {
    if (!rulesDocParsed.categories[suggestion.category]) return null;
  }
  return {
    suggestions,
    categories: rulesDocParsed.categories,
    rules: rulesDocParsed.rules,
  };
}

export function seedDocuments() {
  return {
    suggestions: SEED_SUGGESTIONS_DOC,
    rules: SEED_RULES_DOC,
  };
}

export function seedLibrary() {
  return parseLibraryDocuments(SEED_SUGGESTIONS_DOC, SEED_RULES_DOC);
}

let library = seedLibrary();
let source = 'seed';
let loaded = false;
let loading = null;
let state = emptyState();
let persistChain = Promise.resolve();

if (!library) throw new Error('Built-in suggestion seed is malformed');

function emptyState() {
  return {
    id: STATE_ID,
    shown: [],
    accepted: [],
    dismissed: [],
    completions: [],
  };
}

function isPristine(value) {
  return !value.shown.length && !value.accepted.length && !value.dismissed.length && !value.completions.length;
}

function stamp(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeState(row) {
  const next = emptyState();
  if (!row || typeof row !== 'object') return next;
  if (Array.isArray(row.shown)) {
    for (const item of row.shown) {
      if (!item || item.id == null) continue;
      next.shown.push({ id: String(item.id), at: stamp(item.at) });
    }
  }
  if (Array.isArray(row.accepted)) {
    for (const item of row.accepted) {
      if (!item || item.id == null || item.taskId == null) continue;
      next.accepted.push({ id: String(item.id), taskId: String(item.taskId), at: stamp(item.at) });
    }
  }
  if (Array.isArray(row.dismissed)) {
    for (const item of row.dismissed) {
      if (!item || item.id == null) continue;
      next.dismissed.push({ id: String(item.id), at: stamp(item.at), forever: item.forever === true });
    }
  }
  if (Array.isArray(row.completions)) {
    for (const item of row.completions) {
      if (!item || item.taskId == null) continue;
      next.completions.push({ taskId: String(item.taskId), at: stamp(item.at) });
    }
  }
  return next;
}

function persist() {
  const snapshot = normalizeState(state);
  if (typeof indexedDB === 'undefined') return;
  persistChain = persistChain
    .then(() => put(STORE, snapshot))
    .catch(() => {});
}

async function hydrate() {
  if (typeof indexedDB === 'undefined') return;
  try {
    const rows = await getAll(STORE);
    const row = (rows || []).find((item) => item && item.id === STATE_ID);
    if (!row || !isPristine(state)) return;
    state = normalizeState(row);
  } catch {
    /* Keep the in-memory record. The planner still runs. */
  }
}

function isNodeFile(url) {
  return typeof process !== 'undefined'
    && Boolean(process.versions?.node)
    && url
    && url.protocol === 'file:';
}

async function readText(url) {
  if (isNodeFile(url)) {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    return readFile(fileURLToPath(url), 'utf8');
  }
  const response = await fetch(url);
  if (!response || !response.ok) throw new Error(`HTTP ${response ? response.status : 'error'}`);
  return response.text();
}

async function defaultReadLibraryText() {
  const suggestionsUrl = new URL('../data/suggestions.json', import.meta.url);
  const rulesUrl = new URL('../data/gap-rules.json', import.meta.url);
  const [suggestionsText, rulesText] = await Promise.all([
    readText(suggestionsUrl),
    readText(rulesUrl),
  ]);
  return { suggestionsText, rulesText };
}

let readLibraryText = defaultReadLibraryText;

export function applyLoadedText(suggestionsText, rulesText) {
  let parsed = null;
  try {
    parsed = parseLibraryDocuments(JSON.parse(suggestionsText), JSON.parse(rulesText));
  } catch {
    parsed = null;
  }
  if (!parsed) {
    library = seedLibrary();
    source = 'seed';
    return 'seed';
  }
  library = parsed;
  source = 'file';
  return 'file';
}

export function librarySource() {
  return source;
}

function warnFallback(detail) {
  if (typeof console === 'undefined' || !console.warn) return;
  console.warn(`Dayli suggestions: ${detail} Using the built-in set.`);
}

async function doLoad() {
  try {
    await hydrate();
    try {
      const { suggestionsText, rulesText } = await readLibraryText();
      const kind = applyLoadedText(suggestionsText, rulesText);
      if (kind !== 'file') warnFallback('data files were malformed.');
    } catch {
      library = seedLibrary();
      source = 'seed';
      warnFallback('data files could not be loaded.');
    }
    loaded = true;
  } finally {
    loading = null;
  }
}

export function loadLibrary() {
  if (loaded) return Promise.resolve();
  if (!loading) loading = doLoad();
  return loading;
}

export function setLibraryReaderForTests(reader) {
  readLibraryText = typeof reader === 'function' ? reader : defaultReadLibraryText;
}

export function resetSuggestionsForTests() {
  loaded = false;
  loading = null;
  library = seedLibrary();
  source = 'seed';
  state = emptyState();
  persistChain = Promise.resolve();
  readLibraryText = defaultReadLibraryText;
}

function toDate(now) {
  if (now instanceof Date && !Number.isNaN(now.getTime())) return now;
  if (typeof now === 'number' && Number.isFinite(now)) return new Date(now);
  if (typeof now === 'string' && now) {
    const parsed = new Date(now);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function toTime(now) {
  return toDate(now).getTime();
}

function localDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function frequencyOf(settings) {
  const raw = String(settings?.suggestFrequency ?? 'normal').trim().toLowerCase();
  if (raw === 'off' || raw === 'rare' || raw === 'normal' || raw === 'often') return raw;
  return 'normal';
}

function shownOn(day) {
  return state.shown.filter((row) => localDay(row.at) === day).length;
}

function latestShownAt() {
  let latest = null;
  for (const row of state.shown) {
    if (latest == null || row.at > latest) latest = row.at;
  }
  return latest;
}

function cooldownBlocks(frequency, at) {
  const t = at.getTime();
  if (frequency === 'rare') {
    const last = latestShownAt();
    return last != null && t - last < RARE_GAP_MS;
  }
  if (frequency === 'normal') return shownOn(localDay(at)) >= 1;
  if (frequency === 'often') {
    if (shownOn(localDay(at)) >= 2) return true;
    const last = latestShownAt();
    return last != null && t - last < OFTEN_GAP_MS;
  }
  return true;
}

function stableUnit(seed) {
  let hash = 2166136261;
  const text = String(seed);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function taskText(task) {
  if (task == null) return '';
  if (typeof task === 'string') return task;
  const parts = [task.title, task.name, task.note, task.text, task.label];
  if (task.categoryId != null) {
    const id = String(task.categoryId).trim().toLowerCase();
    if (id && !GENERIC_CATEGORY_IDS.has(id)) parts.push(id.replace(/[-_]/g, ' '));
  }
  return parts.filter((part) => part != null && String(part).trim()).join(' ');
}

function asTasks(tasks) {
  return Array.isArray(tasks) ? tasks.filter((task) => task != null) : [];
}

function categoriesInText(text, categories) {
  const hits = new Set();
  const normalized = normalizeGoal(text);
  if (!normalized) return hits;
  const padded = ` ${normalized} `;
  for (const [id, category] of Object.entries(categories)) {
    for (const keyword of category.keywords) {
      const cleaned = normalizeGoal(keyword);
      if (cleaned && padded.includes(` ${cleaned} `)) {
        hits.add(id);
        break;
      }
    }
  }
  return hits;
}

function keywordHits(text, categories) {
  const normalized = normalizeGoal(text);
  if (!normalized) return [];
  const padded = ` ${normalized} `;
  const hits = [];
  for (const category of Object.values(categories)) {
    for (const keyword of category.keywords) {
      const cleaned = normalizeGoal(keyword);
      if (cleaned && padded.includes(` ${cleaned} `)) hits.push(cleaned);
    }
  }
  return hits;
}

function presentCategories(tasks, categories) {
  const present = new Set();
  for (const task of tasks) {
    for (const id of categoriesInText(taskText(task), categories)) present.add(id);
  }
  return present;
}

function ruleMatches(rule, tasks, categories) {
  const rows = tasks.map((task) => categoriesInText(taskText(task), categories));
  if (rule.kind === 'missing') {
    const present = new Set();
    for (const hits of rows) for (const id of hits) present.add(id);
    if (rule.when.has.length && !rule.when.has.every((id) => present.has(id))) return false;
    if (rule.when.hasAny.length && !rule.when.hasAny.some((id) => present.has(id))) return false;
    return rule.when.missing.every((id) => !present.has(id));
  }
  const n = rows.filter((hits) => hits.has(rule.when.category)).length;
  const total = rows.length;
  const byCount = rule.when.count != null && n >= rule.when.count;
  const byPercent = rule.when.percent != null
    && total >= rule.when.minTasks
    && total > 0
    && (n / total) * 100 > rule.when.percent;
  return byCount || byPercent;
}

function titlesClash(suggestion, tasks, categories) {
  const title = normalizeGoal(suggestion.title);
  if (!title) return false;
  const titleKeys = keywordHits(suggestion.title, categories);
  for (const task of tasks) {
    const text = normalizeGoal(taskText(task));
    if (!text) continue;
    if (text === title) return true;
    const shorter = text.length < title.length ? text : title;
    const longer = shorter === text ? title : text;
    if (shorter.length >= 12 && longer.includes(shorter)) return true;
    const padded = ` ${text} `;
    if (titleKeys.some((keyword) => padded.includes(` ${keyword} `))) return true;
  }
  return false;
}

function acceptedStillListed(suggestionId, tasks) {
  const ids = new Set();
  for (const task of tasks) {
    if (task && typeof task === 'object' && task.id != null) ids.add(String(task.id));
  }
  return state.accepted.some((row) => row.id === suggestionId && ids.has(row.taskId));
}

function dismissalBlocks(id, at) {
  const rows = state.dismissed.filter((row) => row.id === id);
  if (rows.some((row) => row.forever)) return true;
  const last = rows[rows.length - 1];
  if (!last) return false;
  return at.getTime() - last.at < SNOOZE_MS;
}

function weightMap(matched) {
  const weights = new Map();
  for (const rule of matched) {
    for (const target of rule.suggest) {
      weights.set(target.category, (weights.get(target.category) || 0) + target.weight);
    }
  }
  return weights;
}

function suggestionWeight(suggestion, weights, categories) {
  let weight = weights.get(suggestion.category) || 0;
  if (categories[suggestion.category]?.lifeImprovement) weight += 1;
  return weight;
}

function eligibleSuggestions(tasks, at) {
  const categories = library.categories;
  const present = presentCategories(tasks, categories);
  const matched = library.rules.filter((rule) => ruleMatches(rule, tasks, categories));
  const weights = weightMap(matched);
  const ranked = [];
  for (const suggestion of library.suggestions) {
    const weight = suggestionWeight(suggestion, weights, categories);
    if (weight <= 0) continue;
    if (present.has(suggestion.category)) continue;
    if (dismissalBlocks(suggestion.id, at)) continue;
    if (titlesClash(suggestion, tasks, categories)) continue;
    if (acceptedStillListed(suggestion.id, tasks)) continue;
    ranked.push({ suggestion, weight });
  }
  ranked.sort((a, b) => b.weight - a.weight || (a.suggestion.id < b.suggestion.id ? -1 : a.suggestion.id > b.suggestion.id ? 1 : 0));
  return ranked;
}

function pickWeighted(items, roll) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0) return null;
  let ticket = roll * total;
  for (const item of items) {
    ticket -= item.weight;
    if (ticket < 0) return item;
  }
  return items[items.length - 1];
}

function toPublicSuggestion(suggestion) {
  const out = {
    id: suggestion.id,
    title: suggestion.title,
    category: suggestion.category,
    reason: suggestion.reason,
    difficulty: suggestion.difficulty,
    repeat: suggestion.repeat ?? null,
  };
  if (suggestion.suggestedTime) out.suggestedTime = suggestion.suggestedTime;
  return out;
}

export function getSuggestion({ tasks, now, settings, random } = {}) {
  const frequency = frequencyOf(settings);
  if (frequency === 'off') return null;
  const at = toDate(now);
  if (cooldownBlocks(frequency, at)) return null;
  const day = localDay(at);
  const slot = shownOn(day);
  const gateRoll = typeof random === 'function'
    ? random()
    : stableUnit(`gate|${frequency}|${day}|${slot}`);
  if (gateRoll >= FIRE_CHANCE[frequency]) return null;
  const ranked = eligibleSuggestions(asTasks(tasks), at);
  if (!ranked.length) return null;
  const pickRoll = typeof random === 'function'
    ? random()
    : stableUnit(`pick|${frequency}|${day}|${slot}`);
  const chosen = pickWeighted(ranked, pickRoll);
  return chosen ? toPublicSuggestion(chosen.suggestion) : null;
}

export function markShown(id, now) {
  if (id == null || id === '') return;
  state.shown.push({ id: String(id), at: toTime(now) });
  if (state.shown.length > 80) state.shown.splice(0, state.shown.length - 80);
  persist();
}

export function markAccepted(id, taskId, now) {
  if (id == null || id === '' || taskId == null || taskId === '') return;
  state.accepted.push({ id: String(id), taskId: String(taskId), at: toTime(now) });
  persist();
}

export function markDismissed(id, options = {}) {
  if (id == null || id === '') return;
  state.dismissed.push({
    id: String(id),
    at: toTime(options && options.now),
    forever: Boolean(options && options.forever),
  });
  persist();
}

export function isSuggestedTask(taskId) {
  if (taskId == null || taskId === '') return false;
  const key = String(taskId);
  return state.accepted.some((row) => row.taskId === key);
}

export function markSuggestedCompleted(taskId) {
  if (taskId == null || taskId === '') return false;
  const key = String(taskId);
  if (!state.accepted.some((row) => row.taskId === key)) return false;
  if (state.completions.some((row) => row.taskId === key)) return false;
  state.completions.push({ taskId: key, at: Date.now() });
  persist();
  return true;
}

const api = {
  loadLibrary,
  getSuggestion,
  markShown,
  markAccepted,
  markDismissed,
  isSuggestedTask,
  markSuggestedCompleted,
};

if (typeof window !== 'undefined') window.DayliSuggest = api;
