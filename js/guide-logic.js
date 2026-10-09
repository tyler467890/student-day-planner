/**
 * Guide bunny rules with no DOM, so node --test can cover them.
 * Name lives in config.js (GUIDE_NAME), not here.
 */

export const GUIDE_STORE_KEY = 'dayli.guide.v1';

/** Opens between return-visit pop-ins: every 2nd or 3rd open. */
export const VISIT_GAPS = [2, 3];

export function defaultGuideState() {
  return {
    greeted: false, // said hi (first open, maybe during setup)
    tourDone: false, // finished or skipped the walkthrough
    handoff: 'none', // none | pet | goals | done: the after-tour nudges
    opens: 0, // app opens counted after the tour
    nextVisitAt: 0, // open number that gets the next pop-in
    lastVisitOpen: 0,
  };
}

export function normalizeGuideState(raw) {
  const base = defaultGuideState();
  if (!raw || typeof raw !== 'object') return base;
  const out = { ...base };
  out.greeted = raw.greeted === true;
  out.tourDone = raw.tourDone === true;
  out.handoff = ['none', 'pet', 'goals', 'done'].includes(raw.handoff) ? raw.handoff : base.handoff;
  for (const key of ['opens', 'nextVisitAt', 'lastVisitOpen']) {
    const n = Number(raw[key]);
    out[key] = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }
  return out;
}

export function loadGuideState(storage) {
  try {
    const text = storage?.getItem(GUIDE_STORE_KEY);
    return normalizeGuideState(text ? JSON.parse(text) : null);
  } catch {
    return defaultGuideState();
  }
}

export function saveGuideState(storage, state) {
  try {
    storage?.setItem(GUIDE_STORE_KEY, JSON.stringify(normalizeGuideState(state)));
  } catch { /* private mode: the tour may show again, which is fine */ }
}

/** Should the walkthrough run on this open? */
export function needsTour(state) {
  return !normalizeGuideState(state).tourDone;
}

function gap(rand) {
  const r = typeof rand === 'function' ? rand() : Math.random();
  return VISIT_GAPS[Math.min(VISIT_GAPS.length - 1, Math.floor(Math.max(0, r) * VISIT_GAPS.length))];
}

/** Tour finished or skipped. The next pop-in is 2 or 3 opens away. */
export function finishTour(state, rand) {
  const s = normalizeGuideState(state);
  s.greeted = true;
  s.tourDone = true;
  s.nextVisitAt = s.opens + gap(rand);
  return s;
}

/** Settings > Replay tour. Keeps the open counter. */
export function replayTour(state) {
  const s = normalizeGuideState(state);
  s.tourDone = false;
  s.handoff = 'none';
  return s;
}

/**
 * Count one app open and decide on a pop-in.
 * Never on an open that runs (or still owes) the tour, so never on the very first open.
 * Returns { state, show }.
 */
export function recordOpen(state, rand) {
  const s = normalizeGuideState(state);
  if (!s.tourDone) return { state: s, show: false };
  s.opens += 1;
  if (!s.nextVisitAt) s.nextVisitAt = s.opens + gap(rand);
  if (s.opens >= s.nextVisitAt) {
    s.lastVisitOpen = s.opens;
    s.nextVisitAt = s.opens + gap(rand);
    return { state: s, show: true };
  }
  return { state: s, show: false };
}

/**
 * Walkthrough steps. `has(selector)` says whether a target is on screen,
 * so steps for missing UI fall back or drop out.
 */
export const TOUR_STEPS = [
  {
    id: 'hello',
    greet: true,
    text: "Hi! I'm {guide}, your guide to {app}!",
  },
  {
    id: 'pet',
    targets: ['.pet-slot .pet-open', '.pet-slot'],
    text: 'This is your pet! Tap it to change animals and colours.',
  },
  {
    id: 'shop',
    targets: ['[data-guide="shop"]', '.coin-pill'],
    text: 'Earn ★ coins by finishing tasks, then shop for clothes!',
    // No shop button on this screen: point at the pet, since Shop lives on the pet page.
    fallbackTargets: ['.pet-slot .pet-open', '.pet-slot'],
    fallbackText: 'Earn ★ coins by finishing tasks. Tap your pet, then Shop for clothes!',
  },
  {
    id: 'add',
    targets: ['.fab'],
    text: 'Tap + to add a goal, class or task.',
  },
  {
    id: 'week',
    targets: ['[data-guide="week"]'],
    text: 'Busy week? Type it here and I\u2019ll fill it in for you.',
  },
  {
    id: 'stats',
    targets: ['.today .stats'],
    text: 'Done tasks give points, grow your 🔥 streak and level you up!',
  },
  {
    id: 'end',
    end: true,
    text: 'That\u2019s it! First, let\u2019s make your pet yours.',
  },
];

export function fillCopy(text, names) {
  return String(text)
    .replaceAll('{guide}', names?.guide || 'Muffin')
    .replaceAll('{app}', names?.app || 'Dayli');
}

/** Resolve steps against the live page. */
export function buildTour({ has = () => true, greeted = false, names } = {}) {
  const steps = [];
  for (const step of TOUR_STEPS) {
    if (step.greet && greeted) continue;
    let target = null;
    let text = step.text;
    if (step.targets) {
      target = step.targets.find((sel) => has(sel)) || null;
      if (!target && step.fallbackTargets) {
        target = step.fallbackTargets.find((sel) => has(sel)) || null;
        if (target) text = step.fallbackText || text;
      }
      if (!target) continue;
    }
    steps.push({ id: step.id, target, text: fillCopy(text, names), end: Boolean(step.end) });
  }
  return steps;
}

/** About 30 short pop-in lines. Some only fit a time of day or a streak. */
export const VISIT_LINES = [
  { text: 'You\u2019ve got this today!' },
  { text: 'One small step still counts.' },
  { text: 'Proud of you for showing up!' },
  { text: 'Tiny tasks add up to big wins.' },
  { text: 'Drink some water. Your brain will thank you!' },
  { text: 'Pick one thing and start. I\u2019ll cheer!' },
  { text: 'You\u2019re doing better than you think.' },
  { text: 'Deep breath. You can do hard things.' },
  { text: 'Done is better than perfect!' },
  { text: 'Five focused minutes. Ready, go!' },
  { text: 'Every tick earns you coins. Ka-ching!' },
  { text: 'Be kind to yourself today.' },
  { text: 'Hop to it! I believe in you.' },
  { text: 'A little progress is still progress.' },
  { text: 'Stretch break? Your pet approves.' },
  { text: 'You make planning look easy!' },
  { text: 'Hi friend! Just popping by to say hi.' },
  { text: 'Your future self says thanks!' },
  { text: 'Good morning! Let\u2019s make today a good one.', when: 'morning' },
  { text: 'Morning! What\u2019s the first win today?', when: 'morning' },
  { text: 'Afternoon check-in: you\u2019re doing great!', when: 'afternoon' },
  { text: 'Snack break, then one more task?', when: 'afternoon' },
  { text: 'Evening already? Nice work today.', when: 'evening' },
  { text: 'Plan tomorrow tonight and sleep easy.', when: 'evening' },
  { text: 'It\u2019s late. Rest is part of the plan too!', when: 'night' },
  { text: '{streak}-day streak! Keep it hopping!', minStreak: 2 },
  { text: '🔥 {streak} days in a row. Wow!', minStreak: 3 },
  { text: 'All done today? You\u2019re a star!', needsAllDone: true },
  { text: '{left} left today. You can do it!', minLeft: 1 },
  { text: 'Fresh day, fresh start. Let\u2019s go!', noStreak: true },
];

export function timeOfDay(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

/** Lines that fit right now, with {streak} and {left} filled. */
export function visitLinesFor({ hour = 12, streak = 0, left = 0, allDone = false } = {}) {
  const tod = timeOfDay(hour);
  return VISIT_LINES.filter((line) => {
    if (line.when && line.when !== tod) return false;
    if (line.minStreak && streak < line.minStreak) return false;
    if (line.noStreak && streak > 0) return false;
    if (line.needsAllDone && !allDone) return false;
    if (line.minLeft && left < line.minLeft) return false;
    return true;
  }).map((line) => line.text
    .replaceAll('{streak}', String(streak))
    .replaceAll('{left}', left === 1 ? '1 task' : `${left} tasks`));
}

export function pickVisitLine(ctx, rand) {
  const lines = visitLinesFor(ctx);
  const r = typeof rand === 'function' ? rand() : Math.random();
  return lines[Math.min(lines.length - 1, Math.floor(Math.max(0, r) * lines.length))] || 'You\u2019ve got this!';
}
