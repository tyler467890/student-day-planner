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
 *   canNotify(now): boolean
 *
 * Suggestion = { id, title, category, reason, difficulty, suggestedTime?, repeat, quiet }
 * difficulty is 'easy' | 'medium' | 'hard'. repeat is 'daily' | 'weekly' | null.
 * quiet is true during quiet hours: show the card in the app, do not notify.
 * settings.suggestFrequency is 'off' | 'rare' | 'normal' | 'often' (default 'normal').
 * settings.installedOn is YYYY-MM-DD. settings.suggestIncludeOlder === true
 * includes the teen/adult cards. tasks are the planner's stored tasks.
 * now is a Date, epoch ms, or date string. random() in [0, 1) is optional;
 * without it the engine rolls a stable per-day number so polling does not
 * eventually force a card. Pass random from tests when the roll must be fixed.
 *
 * The shipped data files are the designer library (array of suggestions,
 * concepts, categoryCoverage, rules). The seed below is the fallback and
 * still uses the older categories/keywords shape. Frequency numbers come
 * from the loaded settings object.
 *
 * History is the settings-store row id "suggestions", via js/db.js.
 * replaceAll keeps that row, so ordinary planner saves do not wipe it.
 * The only reads are the two local JSON files under data/.
 */

import { getAll, put } from './db.js';

const STATE_ID = 'suggestions';
const STORE = 'settings';
const DAY_MS = 24 * 60 * 60 * 1000;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const GENERIC_CATEGORY_IDS = new Set(['goals', 'goal', 'none', 'other', 'main']);

/* Used only when a library has no settings block. The shipped gap-rules.json
   is what normal mode actually reads. Keep these equal to that file. */
const DEFAULT_SETTINGS = {
  maxPerDay: 1,
  maxPerWeek: 2,
  showChanceWhenEligible: 0.3,
  minDaysBetweenSuggestions: 3,
  cooldownAfterDismissDays: 7,
  cooldownAfterAcceptDays: 3,
  neverRepeatDismissedIds: true,
  categorySnoozeAfterDismissals: { count: 3, withinDays: 30, snoozeDays: 30 },
  doNotResuggestAcceptedWhileGoalExists: true,
  resuggestAcceptedAfterDays: 90,
  minDaysSinceFirstUse: 2,
  minGoalsBeforeGapRules: 3,
  quietHours: { start: '21:00', end: '07:00' },
  showOnlyAtAppOpen: true,
  avoidWhenAllTodayGoalsDone: false,
  skipIfOpenGoalsAtLeast: 12,
  ageSafeOnlyByDefault: true,
  fallbackWhenNoRuleFires: 'random-category-easy',
  rulePickStrategy: 'weighted-random-by-priority',
};

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
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9'\- :]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stemWord(word) {
  for (const suffix of ['ing', 'es', 'ed', 's']) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) return word.slice(0, -suffix.length);
  }
  return word;
}

function phraseHit(normalized, synonym) {
  const escaped = synonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^| )${escaped}( |$)`).test(normalized);
}

function conceptsFor(name, concepts) {
  const normalized = normalizeGoal(name);
  const tokens = normalized ? normalized.split(' ') : [];
  const stems = new Set(tokens);
  for (const token of tokens) stems.add(stemWord(token));
  const hits = new Set();
  for (const [concept, synonyms] of Object.entries(concepts)) {
    for (const synonym of synonyms) {
      if (synonym.includes(' ') || synonym.includes('-')) {
        if (phraseHit(normalized, synonym)) {
          hits.add(concept);
          break;
        }
      } else if (tokens.includes(synonym) || (synonym.length > 3 && stems.has(stemWord(synonym)))) {
        hits.add(concept);
        break;
      }
    }
  }
  return hits;
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
    ageSafe: !(item.meta && typeof item.meta === 'object' && item.meta.ageSafe === false),
  };
  if (suggestedTime) parsed.suggestedTime = suggestedTime;
  return parsed;
}

function parseSuggestionList(list) {
  if (!Array.isArray(list) || list.length === 0) return null;
  const suggestions = [];
  const ids = new Set();
  for (const item of list) {
    const parsed = parseSuggestion(item);
    if (!parsed || ids.has(parsed.id)) return null;
    ids.add(parsed.id);
    suggestions.push(parsed);
  }
  return suggestions;
}

function parseSettings(raw) {
  const settings = {
    ...DEFAULT_SETTINGS,
    categorySnoozeAfterDismissals: { ...DEFAULT_SETTINGS.categorySnoozeAfterDismissals },
    quietHours: { ...DEFAULT_SETTINGS.quietHours },
  };
  if (raw == null) return settings;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const numbers = [
    'maxPerDay', 'maxPerWeek', 'showChanceWhenEligible', 'minDaysBetweenSuggestions',
    'cooldownAfterDismissDays', 'cooldownAfterAcceptDays', 'resuggestAcceptedAfterDays',
    'minDaysSinceFirstUse', 'minGoalsBeforeGapRules', 'skipIfOpenGoalsAtLeast',
  ];
  for (const key of numbers) {
    if (raw[key] == null) continue;
    if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key]) || raw[key] < 0) return null;
    settings[key] = raw[key];
  }
  const flags = [
    'neverRepeatDismissedIds', 'doNotResuggestAcceptedWhileGoalExists',
    'showOnlyAtAppOpen', 'avoidWhenAllTodayGoalsDone', 'ageSafeOnlyByDefault',
  ];
  for (const key of flags) {
    if (raw[key] == null) continue;
    if (typeof raw[key] !== 'boolean') return null;
    settings[key] = raw[key];
  }
  if (raw.categorySnoozeAfterDismissals != null) {
    const cfg = raw.categorySnoozeAfterDismissals;
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return null;
    const next = { ...settings.categorySnoozeAfterDismissals };
    for (const key of ['count', 'withinDays', 'snoozeDays']) {
      if (cfg[key] == null) continue;
      if (!Number.isInteger(cfg[key]) || cfg[key] < 0) return null;
      next[key] = cfg[key];
    }
    settings.categorySnoozeAfterDismissals = next;
  }
  if (raw.quietHours != null) {
    const quiet = raw.quietHours;
    if (!quiet || typeof quiet !== 'object' || Array.isArray(quiet)) return null;
    if (typeof quiet.start !== 'string' || !TIME_RE.test(quiet.start)) return null;
    if (typeof quiet.end !== 'string' || !TIME_RE.test(quiet.end)) return null;
    settings.quietHours = { start: quiet.start, end: quiet.end };
  }
  if (raw.fallbackWhenNoRuleFires != null) {
    if (typeof raw.fallbackWhenNoRuleFires !== 'string' || !raw.fallbackWhenNoRuleFires) return null;
    settings.fallbackWhenNoRuleFires = raw.fallbackWhenNoRuleFires;
  }
  if (raw.rulePickStrategy != null) {
    if (typeof raw.rulePickStrategy !== 'string' || !raw.rulePickStrategy) return null;
    settings.rulePickStrategy = raw.rulePickStrategy;
  }
  return settings;
}

function parseConceptMap(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const ids = Object.keys(raw);
  if (!ids.length) return null;
  const concepts = {};
  for (const id of ids) {
    if (!id.trim() || /\s/.test(id)) return null;
    if (!Array.isArray(raw[id]) || raw[id].length === 0) return null;
    const synonyms = [];
    for (const synonym of raw[id]) {
      if (typeof synonym !== 'string' || !synonym.trim()) return null;
      synonyms.push(synonym.trim().toLowerCase());
    }
    concepts[id] = synonyms;
  }
  return concepts;
}

function parseCoverage(raw, concepts) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const ids = Object.keys(raw);
  if (!ids.length) return null;
  const coverage = {};
  for (const id of ids) {
    if (!Array.isArray(raw[id]) || raw[id].length === 0) return null;
    const list = [];
    for (const concept of raw[id]) {
      if (typeof concept !== 'string' || !concepts[concept]) return null;
      list.push(concept);
    }
    coverage[id] = list;
  }
  return coverage;
}

function parseDesignerWhen(when, concepts) {
  if (!when || typeof when !== 'object' || Array.isArray(when)) return null;
  const parsed = {};
  for (const key of ['anyOf', 'noneOf']) {
    if (when[key] == null) continue;
    if (!Array.isArray(when[key]) || when[key].length === 0) return null;
    const ids = [];
    for (const id of when[key]) {
      if (typeof id !== 'string' || !concepts[id]) return null;
      ids.push(id);
    }
    parsed[key] = ids;
  }
  for (const key of ['minMatches', 'minGoals', 'maxGoals', 'orMinGoals', 'orMinHard']) {
    if (when[key] == null) continue;
    if (!Number.isInteger(when[key]) || when[key] < 0) return null;
    parsed[key] = when[key];
  }
  if (when.minShare != null) {
    if (typeof when.minShare !== 'number' || !Number.isFinite(when.minShare) || when.minShare < 0 || when.minShare > 1) return null;
    parsed.minShare = when.minShare;
  }
  if (when.orGoalTimeAfter != null) {
    if (typeof when.orGoalTimeAfter !== 'string' || !TIME_RE.test(when.orGoalTimeAfter)) return null;
    parsed.orGoalTimeAfter = when.orGoalTimeAfter;
  }
  if (!Object.keys(parsed).length) return null;
  return parsed;
}

function parseDesignerRule(rule, concepts, coverage, suggestions) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return null;
  if (typeof rule.id !== 'string' || !rule.id.trim()) return null;
  if (rule.trigger !== 'missing' && rule.trigger !== 'tooMuch' && rule.trigger !== 'present') return null;
  if (typeof rule.priority !== 'number' || !Number.isFinite(rule.priority) || rule.priority <= 0) return null;
  if (!Array.isArray(rule.suggest) || rule.suggest.length === 0) return null;
  const suggest = [];
  for (const category of rule.suggest) {
    if (typeof category !== 'string' || !coverage[category]) return null;
    suggest.push(category);
  }
  const when = parseDesignerWhen(rule.when, concepts);
  if (!when) return null;
  const preferIds = [];
  if (rule.preferIds != null) {
    if (!Array.isArray(rule.preferIds)) return null;
    for (const id of rule.preferIds) {
      const item = suggestions.find((suggestion) => suggestion.id === id);
      if (!item || !suggest.includes(item.category)) return null;
      preferIds.push(id);
    }
  }
  let preferDifficulty = null;
  if (rule.preferDifficulty != null) {
    if (rule.preferDifficulty !== 'easy' && rule.preferDifficulty !== 'medium' && rule.preferDifficulty !== 'hard') return null;
    preferDifficulty = rule.preferDifficulty;
  }
  const parsed = {
    id: rule.id.trim(),
    trigger: rule.trigger,
    when,
    suggest,
    priority: rule.priority,
    preferIds,
    preferDifficulty,
  };
  if (rule.description != null) {
    if (typeof rule.description !== 'string') return null;
    parsed.description = rule.description;
  }
  return parsed;
}

function parseDesigner(suggestionsDoc, rulesDoc) {
  if (!rulesDoc || typeof rulesDoc !== 'object' || Array.isArray(rulesDoc) || !validVersion(rulesDoc)) return null;
  const suggestions = parseSuggestionList(suggestionsDoc);
  const concepts = parseConceptMap(rulesDoc.concepts);
  if (!suggestions || !concepts) return null;
  const categoryCoverage = parseCoverage(rulesDoc.categoryCoverage, concepts);
  if (!categoryCoverage) return null;
  for (const item of suggestions) {
    if (!categoryCoverage[item.category]) return null;
  }
  const settings = parseSettings(rulesDoc.settings);
  if (!settings || !Array.isArray(rulesDoc.rules) || rulesDoc.rules.length === 0) return null;
  const rules = [];
  const ids = new Set();
  for (const rule of rulesDoc.rules) {
    const parsed = parseDesignerRule(rule, concepts, categoryCoverage, suggestions);
    if (!parsed || ids.has(parsed.id)) return null;
    ids.add(parsed.id);
    rules.push(parsed);
  }
  return {
    suggestions,
    concepts,
    categoryCoverage,
    rules,
    settings,
    categories: null,
  };
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

function parseLegacyRule(rule, categories) {
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

function compileLegacy(suggestions, categories, rules, settings) {
  const concepts = {};
  const categoryCoverage = {};
  for (const [id, category] of Object.entries(categories)) {
    concepts[id] = category.keywords.map((keyword) => keyword.trim().toLowerCase());
    categoryCoverage[id] = [id];
  }
  const compiled = rules.map((rule) => {
    let when;
    if (rule.kind === 'missing') {
      when = { noneOf: rule.when.missing.slice() };
      if (rule.when.has.length) when.allOf = rule.when.has.slice();
      if (rule.when.hasAny.length) when.anyOf = rule.when.hasAny.slice();
    } else {
      when = {
        legacyTooMuch: {
          category: rule.when.category,
          percent: rule.when.percent,
          count: rule.when.count,
          minTasks: rule.when.minTasks,
        },
      };
    }
    return {
      id: rule.id,
      trigger: rule.kind === 'too-much' ? 'tooMuch' : 'missing',
      description: rule.description,
      when,
      suggest: rule.suggest.map((target) => target.category),
      priority: rule.weight,
      preferIds: [],
      preferDifficulty: null,
    };
  });
  return {
    suggestions,
    concepts,
    categoryCoverage,
    rules: compiled,
    settings,
    categories,
  };
}

function parseLegacy(suggestionsDoc, rulesDoc) {
  if (!suggestionsDoc || typeof suggestionsDoc !== 'object' || Array.isArray(suggestionsDoc) || !validVersion(suggestionsDoc)) return null;
  if (!rulesDoc || typeof rulesDoc !== 'object' || Array.isArray(rulesDoc) || !validVersion(rulesDoc)) return null;
  const suggestions = parseSuggestionList(suggestionsDoc.suggestions);
  const categories = parseCategories(rulesDoc.categories);
  if (!suggestions || !categories || !Array.isArray(rulesDoc.rules)) return null;
  for (const suggestion of suggestions) {
    if (!categories[suggestion.category]) return null;
  }
  const rules = [];
  const ids = new Set();
  for (const rule of rulesDoc.rules) {
    const parsed = parseLegacyRule(rule, categories);
    if (!parsed || ids.has(parsed.id)) return null;
    ids.add(parsed.id);
    rules.push(parsed);
  }
  const settings = parseSettings(rulesDoc.settings);
  if (!settings) return null;
  return compileLegacy(suggestions, categories, rules, settings);
}

function designerShaped(suggestionsDoc, rulesDoc) {
  if (Array.isArray(suggestionsDoc)) return true;
  return Boolean(
    rulesDoc
    && typeof rulesDoc === 'object'
    && !Array.isArray(rulesDoc)
    && rulesDoc.concepts
    && typeof rulesDoc.concepts === 'object'
    && !Array.isArray(rulesDoc.concepts),
  );
}

/**
 * Validate the two JSON documents. Returns the library, or null if either
 * document is malformed. The designer shape (a suggestions array plus
 * concepts) is read natively. The older wrapped shape is compiled into the
 * same picker. A designer-shaped pair that does not validate does not fall
 * through to the older parser.
 */
export function parseLibraryDocuments(suggestionsDoc, rulesDoc) {
  if (designerShaped(suggestionsDoc, rulesDoc)) return parseDesigner(suggestionsDoc, rulesDoc);
  return parseLegacy(suggestionsDoc, rulesDoc);
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
      const dismissed = { id: String(item.id), at: stamp(item.at), forever: item.forever === true };
      if (typeof item.category === 'string' && item.category) dismissed.category = item.category;
      next.dismissed.push(dismissed);
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

export function activeSettings() {
  return library.settings;
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

function limitsFor(frequency, settings) {
  const maxPerDay = settings.maxPerDay;
  const maxPerWeek = settings.maxPerWeek;
  const showChance = settings.showChanceWhenEligible;
  const minDays = settings.minDaysBetweenSuggestions;
  if (frequency === 'often') {
    return {
      maxPerDay: Math.min(1, maxPerDay),
      maxPerWeek: Math.max(1, Math.round(maxPerWeek * 2)),
      showChance: Math.min(1, showChance * 2),
      minDays: minDays / 2,
    };
  }
  if (frequency === 'rare') {
    return {
      maxPerDay: Math.min(1, maxPerDay),
      maxPerWeek: Math.max(1, Math.round(maxPerWeek / 2)),
      showChance: showChance / 2,
      minDays: minDays * 2,
    };
  }
  return { maxPerDay, maxPerWeek, showChance, minDays };
}

function shownOn(day) {
  return state.shown.filter((row) => localDay(row.at) === day).length;
}

function shownWithin(at, days) {
  const t = at.getTime();
  return state.shown.filter((row) => t >= row.at && t - row.at < days * DAY_MS).length;
}

function latestAt(rows) {
  let latest = null;
  for (const row of rows) {
    if (latest == null || row.at > latest) latest = row.at;
  }
  return latest;
}

function scheduleBlocks(limits, at, libSettings) {
  if (shownOn(localDay(at)) >= limits.maxPerDay) return true;
  if (shownWithin(at, 7) >= limits.maxPerWeek) return true;
  const lastShown = latestAt(state.shown);
  if (lastShown != null && at.getTime() - lastShown < limits.minDays * DAY_MS) return true;
  const lastAccepted = latestAt(state.accepted);
  if (lastAccepted != null && at.getTime() - lastAccepted < libSettings.cooldownAfterAcceptDays * DAY_MS) return true;
  return false;
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

function takeRoll(random, seed) {
  if (typeof random === 'function') {
    const value = Number(random());
    if (Number.isFinite(value)) return Math.min(0.999999, Math.max(0, value));
  }
  return stableUnit(seed);
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

function taskClosed(task) {
  if (!task || typeof task !== 'object') return false;
  if (task.done === true || task.completed === true || task.skipped === true) return true;
  if (task.completedOn || task.completedAt) return true;
  const status = String(task.status || '').toLowerCase();
  return status === 'done' || status === 'completed' || status === 'skipped';
}

function completedTime(task) {
  if (!task || typeof task !== 'object') return null;
  if (typeof task.completedAt === 'number' && Number.isFinite(task.completedAt)) return task.completedAt;
  const raw = task.completedOn || task.completedAt;
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0).getTime();
  }
  if (raw) {
    const parsed = new Date(raw).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function completedRecently(task, at) {
  const when = completedTime(task);
  if (when == null) return false;
  const age = at.getTime() - when;
  return age >= 0 && age < 7 * DAY_MS;
}

function openCount(tasks) {
  const seen = new Set();
  let count = 0;
  for (const task of tasks) {
    if (taskClosed(task)) continue;
    const id = task && typeof task === 'object' && task.id != null ? String(task.id) : '';
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    count += 1;
  }
  return count;
}

function taskTime(task) {
  const raw = task && typeof task === 'object' ? (task.time || task.suggestedTime || '') : '';
  return typeof raw === 'string' && TIME_RE.test(raw) ? raw : '00:00';
}

function taskDiff(task) {
  const raw = task && typeof task === 'object' ? (task.difficulty || task.diff || '') : '';
  return raw === 'easy' || raw === 'medium' || raw === 'hard' ? raw : '';
}

function goalTitle(task) {
  if (typeof task === 'string') return task;
  return String((task && (task.title || task.name)) || '');
}

function goalRecords(tasks, at) {
  const rows = [];
  const seen = new Set();
  for (const task of tasks) {
    const closed = taskClosed(task);
    if (closed && !completedRecently(task, at)) continue;
    const id = task && typeof task === 'object' && task.id != null ? String(task.id) : '';
    if (id) {
      if (seen.has(id)) continue;
      seen.add(id);
    }
    rows.push({
      name: taskText(task),
      title: goalTitle(task),
      time: taskTime(task),
      diff: taskDiff(task),
    });
  }
  return rows;
}

function daysSinceInstall(installed, at) {
  if (typeof installed !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(installed)) return null;
  const [year, month, day] = installed.split('-').map(Number);
  const stampDate = new Date(Date.UTC(year, month - 1, day));
  if (stampDate.getUTCFullYear() !== year || stampDate.getUTCMonth() !== month - 1 || stampDate.getUTCDate() !== day) return null;
  const today = Date.UTC(at.getFullYear(), at.getMonth(), at.getDate());
  return Math.round((today - stampDate.getTime()) / DAY_MS);
}

function tooNew(libSettings, appSettings, at) {
  const min = libSettings.minDaysSinceFirstUse;
  if (typeof min !== 'number' || min <= 0) return false;
  const days = daysSinceInstall(appSettings && appSettings.installedOn, at);
  if (days == null || days < 0) return false;
  return days < min;
}

function rulePasses(rule, goals, per, all) {
  const when = rule.when;
  const count = goals.length;
  if (when.maxGoals != null && count > when.maxGoals) return false;
  if (when.minGoals != null && count < when.minGoals) return false;
  if (when.noneOf && when.noneOf.some((id) => all.has(id))) return false;
  if (when.allOf && when.allOf.length && !when.allOf.every((id) => all.has(id))) return false;
  if (when.anyOf) {
    const wanted = new Set(when.anyOf);
    let matches = 0;
    for (const hits of per) {
      for (const id of hits) {
        if (wanted.has(id)) {
          matches += 1;
          break;
        }
      }
    }
    const timed = when.orGoalTimeAfter && goals.some((goal) => goal.time > when.orGoalTimeAfter);
    if (matches === 0 && !timed) return false;
    if (when.minMatches != null && matches < when.minMatches) return false;
    if (when.minShare != null && count && matches / count < when.minShare) return false;
  }
  if (when.orMinGoals != null) {
    const hard = goals.filter((goal) => goal.diff === 'hard').length;
    const enoughGoals = count >= when.orMinGoals;
    const enoughHard = when.orMinHard != null && hard >= when.orMinHard;
    if (!enoughGoals && !enoughHard) return false;
  }
  if (when.legacyTooMuch) {
    const spec = when.legacyTooMuch;
    const matches = per.filter((hits) => hits.has(spec.category)).length;
    const byCount = spec.count != null && matches >= spec.count;
    const byPercent = spec.percent != null
      && count >= spec.minTasks
      && count > 0
      && (matches / count) * 100 > spec.percent;
    if (!byCount && !byPercent) return false;
  }
  return true;
}

function analyze(goals) {
  const per = goals.map((goal) => conceptsFor(goal.name, library.concepts));
  const all = new Set();
  for (const hits of per) for (const id of hits) all.add(id);
  const covered = new Set();
  for (const [category, concepts] of Object.entries(library.categoryCoverage)) {
    if (concepts.some((id) => all.has(id))) covered.add(category);
  }
  const fired = library.rules.filter((rule) => rulePasses(rule, goals, per, all));
  return { fired, covered };
}

export function firedRuleIds(tasks, now) {
  const goals = goalRecords(asTasks(tasks), toDate(now));
  return analyze(goals).fired.map((rule) => rule.id);
}

export function conceptsForGoal(text) {
  return [...conceptsFor(text, library.concepts)];
}

function listedIds(tasks) {
  const ids = new Set();
  for (const task of tasks) {
    if (task && typeof task === 'object' && task.id != null) ids.add(String(task.id));
  }
  return ids;
}

function idBlocked(id, at, libSettings) {
  const rows = state.dismissed.filter((row) => row.id === id);
  if (rows.some((row) => row.forever)) return true;
  let last = null;
  for (const row of rows) {
    if (!row.forever && (last == null || row.at > last)) last = row.at;
  }
  if (last == null) return false;
  return at.getTime() - last < libSettings.cooldownAfterDismissDays * DAY_MS;
}

function acceptedBlocks(id, tasks, at, libSettings) {
  const rows = state.accepted.filter((row) => row.id === id);
  if (!rows.length) return false;
  const ids = listedIds(tasks);
  if (libSettings.doNotResuggestAcceptedWhileGoalExists !== false && rows.some((row) => ids.has(row.taskId))) return true;
  const last = Math.max(...rows.map((row) => row.at));
  return at.getTime() - last < libSettings.resuggestAcceptedAfterDays * DAY_MS;
}

function categorySnoozedSet(at, libSettings) {
  const cfg = libSettings.categorySnoozeAfterDismissals;
  const snoozed = new Set();
  if (!cfg || !cfg.count) return snoozed;
  const byCategory = new Map();
  for (const row of state.dismissed) {
    if (!row.category) continue;
    if (!byCategory.has(row.category)) byCategory.set(row.category, []);
    byCategory.get(row.category).push(row);
  }
  for (const [category, rows] of byCategory) {
    rows.sort((a, b) => a.at - b.at);
    for (let i = 0; i + cfg.count - 1 < rows.length; i += 1) {
      const start = rows[i].at;
      const end = rows[i + cfg.count - 1].at;
      if (end - start <= cfg.withinDays * DAY_MS && at.getTime() < end + cfg.snoozeDays * DAY_MS) {
        snoozed.add(category);
        break;
      }
    }
  }
  return snoozed;
}

function ageOk(item, appSettings, libSettings) {
  if (item.ageSafe !== false) return true;
  if (libSettings.ageSafeOnlyByDefault === false) return true;
  return appSettings?.suggestIncludeOlder === true;
}

function titleTaken(item, goals) {
  const title = normalizeGoal(item.title);
  if (!title) return false;
  return goals.some((goal) => normalizeGoal(goal.title) === title);
}

function itemEligible(item, goals, tasks, at, appSettings, covered, snoozed) {
  if (!item) return false;
  if (covered.has(item.category) || snoozed.has(item.category)) return false;
  if (!ageOk(item, appSettings, library.settings)) return false;
  if (idBlocked(item.id, at, library.settings)) return false;
  if (acceptedBlocks(item.id, tasks, at, library.settings)) return false;
  if (titleTaken(item, goals)) return false;
  return true;
}

function itemsIn(categories, goals, tasks, at, appSettings, covered, snoozed) {
  const wanted = new Set(categories);
  return library.suggestions.filter((item) => wanted.has(item.category) && itemEligible(item, goals, tasks, at, appSettings, covered, snoozed));
}

function pickWeighted(items, roll) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  if (total <= 0 || !items.length) return null;
  let ticket = roll * total;
  for (const item of items) {
    ticket -= item.weight;
    if (ticket < 0) return item;
  }
  return items[items.length - 1];
}

function pickFromCategories(categories, preferDifficulty, goals, tasks, at, appSettings, covered, snoozed, roll) {
  let pool = itemsIn(categories, goals, tasks, at, appSettings, covered, snoozed);
  const difficulty = preferDifficulty || 'easy';
  const favoured = pool.filter((item) => item.difficulty === difficulty);
  if (favoured.length) pool = favoured;
  pool.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!pool.length) return null;
  const chosen = pickWeighted(pool.map((item) => ({ item, weight: 1 })), roll);
  return chosen ? chosen.item : null;
}

function ruleHasCard(rule, goals, tasks, at, appSettings, covered, snoozed) {
  return itemsIn(rule.suggest, goals, tasks, at, appSettings, covered, snoozed).length > 0;
}

function firstPreferId(rule, goals, tasks, at, appSettings, covered, snoozed) {
  for (const id of rule.preferIds || []) {
    const item = library.suggestions.find((suggestion) => suggestion.id === id);
    if (!item || !rule.suggest.includes(item.category)) continue;
    if (itemEligible(item, goals, tasks, at, appSettings, covered, snoozed)) return item;
  }
  return null;
}

function pickSuggestion(goals, tasks, at, appSettings, random, frequency, day) {
  const { fired, covered } = analyze(goals);
  const snoozed = categorySnoozedSet(at, library.settings);
  const available = fired
    .filter((rule) => ruleHasCard(rule, goals, tasks, at, appSettings, covered, snoozed))
    .sort((a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (available.length) {
    const ruleRoll = takeRoll(random, `rule|${frequency}|${day}`);
    const ranked = available.map((rule) => ({ item: rule, weight: rule.priority }));
    const chosen = pickWeighted(ranked, ruleRoll);
    const rule = chosen ? chosen.item : available[0];
    const preferred = firstPreferId(rule, goals, tasks, at, appSettings, covered, snoozed);
    if (preferred) return preferred;
    const itemRoll = takeRoll(random, `item|${frequency}|${day}|${rule.id}`);
    return pickFromCategories(rule.suggest, rule.preferDifficulty, goals, tasks, at, appSettings, covered, snoozed, itemRoll);
  }
  if (library.settings.fallbackWhenNoRuleFires !== 'random-category-easy') return null;
  const categories = Object.keys(library.categoryCoverage).sort();
  const roll = takeRoll(random, `fallback|${frequency}|${day}`);
  return pickFromCategories(categories, 'easy', goals, tasks, at, appSettings, covered, snoozed, roll);
}

function minutesOf(hhmm) {
  const [hour, minute] = hhmm.split(':').map(Number);
  return hour * 60 + minute;
}

function isQuiet(at, quiet) {
  if (!quiet || !TIME_RE.test(quiet.start || '') || !TIME_RE.test(quiet.end || '')) return false;
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  if (start === end) return false;
  const now = at.getHours() * 60 + at.getMinutes();
  if (start > end) return now >= start || now < end;
  return now >= start && now < end;
}

export function canNotify(now) {
  return !isQuiet(toDate(now), library.settings.quietHours);
}

function toPublicSuggestion(suggestion, at) {
  const out = {
    id: suggestion.id,
    title: suggestion.title,
    category: suggestion.category,
    reason: suggestion.reason,
    difficulty: suggestion.difficulty,
    repeat: suggestion.repeat ?? null,
    quiet: isQuiet(at, library.settings.quietHours),
  };
  if (suggestion.suggestedTime) out.suggestedTime = suggestion.suggestedTime;
  return out;
}

export function getSuggestion({ tasks, now, settings, random } = {}) {
  const frequency = frequencyOf(settings);
  if (frequency === 'off') return null;
  const at = toDate(now);
  const libSettings = library.settings;
  const taskList = asTasks(tasks);
  if (tooNew(libSettings, settings, at)) return null;
  if (openCount(taskList) >= libSettings.skipIfOpenGoalsAtLeast) return null;
  if (libSettings.avoidWhenAllTodayGoalsDone && taskList.length > 0 && openCount(taskList) === 0) return null;
  const limits = limitsFor(frequency, libSettings);
  if (scheduleBlocks(limits, at, libSettings)) return null;
  const day = localDay(at);
  const gate = takeRoll(random, `gate|${frequency}|${day}|${shownOn(day)}`);
  if (gate >= limits.showChance) return null;
  const chosen = pickSuggestion(goalRecords(taskList, at), taskList, at, settings, random, frequency, day);
  return chosen ? toPublicSuggestion(chosen, at) : null;
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
  const key = String(id);
  const found = library.suggestions.find((item) => item.id === key);
  const row = {
    id: key,
    at: toTime(options && options.now),
    forever: Boolean(options && options.forever),
  };
  if (found) row.category = found.category;
  else if (options && typeof options.category === 'string' && options.category) row.category = options.category;
  state.dismissed.push(row);
  if (state.dismissed.length > 200) {
    const forever = state.dismissed.filter((item) => item.forever);
    const rest = state.dismissed.filter((item) => !item.forever).slice(-200);
    state.dismissed = forever.concat(rest).sort((a, b) => a.at - b.at);
  }
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
  canNotify,
};

if (typeof window !== 'undefined') window.DayliSuggest = api;
