/**
 * Pure planner logic: dates, tasks, points, levels, streaks, reminders.
 * No DOM and no storage, so it can run in the browser and in Node tests.
 */

export const POINTS = { easy: 5, medium: 10, hard: 20 };
export const DAY_COMPLETE_BONUS = 10;
export const GOAL_BONUS = 5;
export const MILESTONES = [
  { days: 3, points: 15 },
  { days: 7, points: 25 },
  { days: 14, points: 40 },
  { days: 30, points: 75 },
  { days: 60, points: 120 },
  { days: 100, points: 200 },
];

const LEVEL_STARTS = [0, 40, 100, 180, 280, 400, 550, 730, 940, 1180];

export const THEMES = {
  calm: { bg: '#E4DEFF', surface: '#FFFFFF', text: '#2A1860', muted: '#533C86', accent: '#6D4AFF', onAccent: '#FFFFFF', success: '#15803D' },
  mint: { bg: '#C8FFE6', surface: '#FFFFFF', text: '#064536', muted: '#1B6B56', accent: '#00B894', onAccent: '#12131A', success: '#15803D' },
  sunset: { bg: '#FFE0C2', surface: '#FFFFFF', text: '#5C2208', muted: '#8A4030', accent: '#FF4D1A', onAccent: '#12131A', success: '#15803D' },
  ocean: { bg: '#D2EFFF', surface: '#FFFFFF', text: '#062E52', muted: '#1E5680', accent: '#0084FF', onAccent: '#12131A', success: '#15803D' },
  blossom: { bg: '#FFD4E8', surface: '#FFFFFF', text: '#6A1040', muted: '#8E3A62', accent: '#FF2D87', onAccent: '#12131A', success: '#15803D' },
  night: { bg: '#16142B', surface: '#2A2744', text: '#F6F4FF', muted: '#C8C2EE', accent: '#38BDF8', onAccent: '#12131A', success: '#5DFFB0' },
};

export const ACCENTS = ['#6D4AFF', '#00C2A8', '#FF4D1A', '#1A8CFF', '#FF2D87', '#38BDF8', '#7C3AED', '#00B4D8'];

/** Solid background choices. The last control in the row is a native colour picker. */
export const BG_COLOURS = [
  '#FFFFFF', '#FFF6D8', '#FFE0C2', '#FFD4E8', '#FFD6D6', '#E4DEFF',
  '#D2EFFF', '#C8FFE6', '#E8FFC2', '#FFE38A', '#FFC8A3', '#F5C8FF',
  '#C6F3FF', '#FFE4F1', '#E7EEFF', '#FFF1D6', '#D8FFD6', '#FFD0F0',
  '#16142B', '#2A1858',
];

/** Text choices, dark inks and bright lights. The last control is a native colour picker. */
export const TEXT_COLOURS = [
  '#2A1860', '#4C1D95', '#064536', '#14532D', '#5C2208', '#6A1040',
  '#062E52', '#3B0764', '#1C1917', '#FFFFFF', '#FFF3B0', '#C8FFE6',
  '#D2EFFF', '#FFD4E8', '#E4DEFF', '#FFE0C2', '#F6F4FF', '#B8FFF2',
  '#FFD0D0', '#E7FFB0',
];

export const FONTS = [
  { id: 'nunito', label: 'Nunito' },
  { id: 'inter', label: 'Inter' },
  { id: 'lexend', label: 'Lexend' },
  { id: 'caveat', label: 'Caveat' },
];

export const WEEKDAY_LABELS = [
  { dow: 1, short: 'M', name: 'Monday' },
  { dow: 2, short: 'T', name: 'Tuesday' },
  { dow: 3, short: 'W', name: 'Wednesday' },
  { dow: 4, short: 'T', name: 'Thursday' },
  { dow: 5, short: 'F', name: 'Friday' },
  { dow: 6, short: 'S', name: 'Saturday' },
  { dow: 0, short: 'S', name: 'Sunday' },
];

export function defaultCategories() {
  return [
    { id: 'class', name: 'Class', emoji: '📚', color: '#1A8CFF' },
    { id: 'study', name: 'Study', emoji: '✏️', color: '#7C3AED' },
    { id: 'task', name: 'Task', emoji: '✅', color: '#15803D' },
    { id: 'personal', name: 'Personal', emoji: '🌱', color: '#00C2A8' },
    { id: 'goal', name: 'Goal', emoji: '🎯', color: '#FF4D1A' },
  ];
}

export function defaultSettings() {
  return {
    id: 'main',
    title: 'My Day',
    theme: 'calm',
    accent: '#6D4AFF',
    textColor: null,
    bgColor: null,
    font: 'nunito',
    format: 'list',
    celebrations: 'full',
    sound: false,
    dayStart: '04:00',
    weekStart: 'mon',
    clock24: false,
    streakMode: 'everyday',
    dailyGoal: { mode: 'tasks', n: 5 },
    defaultLead: 10,
    showNames: true,
    morningCheckin: { on: false, time: '08:00' },
    setupComplete: false,
    setupStep: 1,
    lastBackup: null,
    backupNudgeDismissedOn: null,
    persistResult: null,
    dayCompleteShown: {},
    dayCompleteAwarded: {},
    highestLevel: 1,
    celebratedLevel: 1,
    remindersWanted: false,
    pushSubscription: null,
    installSkipped: false,
    photoScrim: 'auto',
    photoBlur: 0,
    categories: defaultCategories(),
    schemaVersion: 2,
  };
}

export function defaultDifficulty(categoryId) {
  return categoryId === 'class' ? 'medium' : 'easy';
}

export function pad(n) {
  return String(n).padStart(2, '0');
}

export function ymdFromParts(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseYMD(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return { y, m, d };
}

export function addDays(ymd, n) {
  const { y, m, d } = parseYMD(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function dayOfWeek(ymd) {
  const { y, m, d } = parseYMD(ymd);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function parseHM(hm) {
  const [h, m] = String(hm || '00:00').split(':').map(Number);
  return { h: h || 0, m: m || 0 };
}

export function hmToMinutes(hm) {
  const { h, m } = parseHM(hm);
  return h * 60 + m;
}

/** Planner date for a Date, using the local day-start boundary (default 4:00). */
export function plannerDate(date, dayStart = '04:00') {
  const local = date instanceof Date ? date : new Date(date);
  const mins = local.getHours() * 60 + local.getMinutes();
  const start = hmToMinutes(dayStart);
  const y = local.getFullYear();
  const m = local.getMonth() + 1;
  const d = local.getDate();
  const ymd = ymdFromParts(y, m, d);
  return mins < start ? addDays(ymd, -1) : ymd;
}

export function formatDayLabel(ymd) {
  const { y, m, d } = parseYMD(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(dt);
}

export function formatTime(hm, clock24) {
  if (!hm) return '';
  const { h, m } = parseHM(hm);
  if (clock24) return `${pad(h)}:${pad(m)}`;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${pad(m)} ${suffix}`;
}

/** Calendar Date for a clock time that belongs to a planner day. */
export function zonedDateTime(plannerYmd, hm, dayStart = '04:00') {
  const mins = hmToMinutes(hm);
  const start = hmToMinutes(dayStart);
  const ymd = mins < start ? addDays(plannerYmd, 1) : plannerYmd;
  const { y, m, d } = parseYMD(ymd);
  const { h, m: min } = parseHM(hm);
  return new Date(y, m - 1, d, h, min, 0, 0);
}

export function mondayOf(ymd) {
  const dow = dayOfWeek(ymd);
  const delta = dow === 0 ? -6 : 1 - dow;
  return addDays(ymd, delta);
}

export function weekStartOf(ymd, weekStart) {
  const dow = dayOfWeek(ymd);
  if (weekStart === 'sun') return addDays(ymd, -dow);
  return mondayOf(ymd);
}

function isCountable(ymd, weekdaysOnly) {
  if (!weekdaysOnly) return true;
  const dow = dayOfWeek(ymd);
  return dow !== 0 && dow !== 6;
}

/**
 * Streak as of a planner day. Today is still open: a miss counts only after
 * the day has ended. One rest day per Mon–Sun week. A second miss that week
 * resets the current streak. Best streak is the highest run in the history.
 */
export function computeStreak(completionDates, today, { weekdaysOnly = false } = {}) {
  const set = new Set((completionDates || []).filter((d) => d && d <= today));
  const milestones = [];
  if (set.size === 0) {
    return { streak: 0, best: 0, restDays: [], lastCounted: null, milestones };
  }
  const start = [...set].sort()[0];
  let streak = 0;
  let best = 0;
  let lastCounted = null;
  let restWeek = null;
  const restDays = [];

  function applyMiss(day) {
    const week = mondayOf(day);
    if (restWeek !== week) {
      restWeek = week;
      restDays.push(day);
      return 'rest';
    }
    streak = 0;
    return 'reset';
  }

  let d = start;
  while (d <= today) {
    if (isCountable(d, weekdaysOnly) && set.has(d)) {
      if (lastCounted) {
        let m = addDays(lastCounted, 1);
        while (m < d) {
          if (isCountable(m, weekdaysOnly) && applyMiss(m) === 'reset') break;
          m = addDays(m, 1);
        }
      }
      streak += 1;
      lastCounted = d;
      if (streak > best) best = streak;
      for (const ms of MILESTONES) {
        if (streak === ms.days) milestones.push({ date: d, days: ms.days, points: ms.points });
      }
    }
    d = addDays(d, 1);
  }

  if (lastCounted && !set.has(today)) {
    const yesterday = addDays(today, -1);
    let m = addDays(lastCounted, 1);
    while (m <= yesterday) {
      if (isCountable(m, weekdaysOnly) && applyMiss(m) === 'reset') break;
      m = addDays(m, 1);
    }
  }

  return { streak, best, restDays, lastCounted, milestones };
}

export function levelForPoints(points) {
  const pts = Math.max(0, points || 0);
  if (pts < 1180) {
    let level = 1;
    for (let i = 0; i < LEVEL_STARTS.length; i += 1) {
      if (pts >= LEVEL_STARTS[i]) level = i + 1;
    }
    return level;
  }
  return 10 + Math.floor((pts - 1180) / 300);
}

export function levelBounds(level) {
  const lv = Math.max(1, level);
  if (lv <= 10) {
    return {
      start: LEVEL_STARTS[lv - 1],
      next: lv < 10 ? LEVEL_STARTS[lv] : 1480,
    };
  }
  const start = 1180 + (lv - 10) * 300;
  return { start, next: start + 300 };
}

export function levelTitle(level) {
  if (level >= 20) return 'Legend';
  if (level >= 15) return 'Unstoppable';
  if (level >= 10) return 'Focused';
  if (level >= 5) return 'Steady';
  return 'Starter';
}

export function levelProgress(points, displayedLevel) {
  const { start, next } = levelBounds(displayedLevel);
  if (points < start) return 0;
  if (points >= next) return 1;
  return (points - start) / (next - start);
}

export function displayLevel(points, highestLevel) {
  return Math.max(levelForPoints(points), highestLevel || 1);
}

export function occursOn(task, ymd) {
  if (!task) return false;
  if (!task.repeat || task.repeat === 'none') return task.date === ymd;
  if (task.date && ymd < task.date) return false;
  const dow = dayOfWeek(ymd);
  if (task.repeat === 'daily') return true;
  if (task.repeat === 'weekdays') return dow !== 0 && dow !== 6;
  if (task.repeat === 'days') return Array.isArray(task.days) && task.days.includes(dow);
  return false;
}

function toInstance(task, ymd, edits, movedFrom) {
  const merged = { ...task, ...(edits || {}) };
  const origin = movedFrom || ymd;
  return {
    instanceId: `${task.id}:${origin}`,
    taskId: task.id,
    originDate: origin,
    date: ymd,
    title: merged.title || '',
    categoryId: merged.categoryId,
    difficulty: merged.difficulty || 'easy',
    time: merged.time || null,
    durationMin: merged.durationMin ?? null,
    remindLeadMin: merged.remindLeadMin ?? null,
    note: merged.note || '',
    repeat: task.repeat || 'none',
    days: task.days ? [...task.days] : [],
    repeating: Boolean(task.repeat && task.repeat !== 'none'),
    moved: Boolean(movedFrom),
  };
}

export function instancesOn(ymd, tasks, overrides) {
  const list = [];
  const ovs = overrides || [];
  for (const task of tasks || []) {
    const own = ovs.find((o) => o.taskId === task.id && o.date === ymd);
    if (occursOn(task, ymd) && !own?.skipped && !own?.movedTo) {
      list.push(toInstance(task, ymd, own?.edits, null));
    }
  }
  for (const ov of ovs) {
    if (ov.movedTo !== ymd) continue;
    const task = (tasks || []).find((t) => t.id === ov.taskId);
    if (!task) continue;
    list.push(toInstance(task, ymd, ov.edits, ov.date));
  }
  list.sort((a, b) => {
    if (a.time && b.time && a.time !== b.time) return a.time < b.time ? -1 : 1;
    if (a.time && !b.time) return -1;
    if (!a.time && b.time) return 1;
    return a.title.localeCompare(b.title);
  });
  return list;
}

export function sumPoints(completions, bonuses) {
  let total = 0;
  for (const item of completions || []) total += item.points || 0;
  for (const item of bonuses || []) total += item.points || 0;
  return total;
}

export function pointsOnDate(completions, bonuses, ymd) {
  let total = 0;
  for (const item of completions || []) {
    if ((item.completedOn || item.date) === ymd) total += item.points || 0;
  }
  for (const item of bonuses || []) {
    if (item.date === ymd) total += item.points || 0;
  }
  return total;
}

export function isDayComplete(instances, completions) {
  if (!instances || instances.length < 2) return false;
  return instances.every((inst) => (completions || []).some((c) => c.instanceId === inst.instanceId));
}

export function goalMet(settings, instances, completions, earnedPoints) {
  const goal = settings?.dailyGoal;
  if (!goal || goal.mode === 'off') return false;
  const n = Number(goal.n) || 0;
  if (n <= 0) return false;
  if (goal.mode === 'tasks') return (completions || []).length >= n;
  if (goal.mode === 'points') return (earnedPoints || 0) >= n;
  return false;
}

export function reminderText({ title, time, note, showNames, clock24 }) {
  if (!showNames) {
    return { title: 'Coming up', body: 'You have something coming up' };
  }
  const parts = [];
  if (time) parts.push(`Starts ${formatTime(time, clock24)}`);
  if (note) parts.push(note);
  return { title: title || 'Coming up', body: parts.join(' · ') || 'Starts soon' };
}

/**
 * Reminders for the next 7 days. Task titles are omitted entirely when
 * showNames is false, so a push payload built from this list cannot leak them.
 */
export function upcomingReminders({ tasks, overrides, settings, now, showNames }) {
  const dayStart = settings?.dayStart || '04:00';
  const today = plannerDate(now, dayStart);
  const horizon = now.getTime() + 7 * 24 * 60 * 60 * 1000;
  const names = showNames !== false && settings?.showNames !== false;
  const clock24 = Boolean(settings?.clock24);
  const list = [];

  for (let i = 0; i < 8; i += 1) {
    const ymd = addDays(today, i);
    const instances = instancesOn(ymd, tasks, overrides);
    if (settings?.morningCheckin?.on) {
      const at = zonedDateTime(ymd, settings.morningCheckin.time || '08:00', dayStart);
      const ts = at.getTime();
      if (ts > now.getTime() && ts <= horizon) {
        const n = instances.length;
        list.push({
          id: `morning:${ymd}`,
          fireAtUTC: at.toISOString(),
          title: names ? "Here's your day" : 'Coming up',
          body: names
            ? `Here's your day: ${n} ${n === 1 ? 'thing' : 'things'} planned.`
            : 'You have something coming up',
          taskId: null,
          date: ymd,
          kind: 'morning',
        });
      }
    }
    for (const inst of instances) {
      if (!inst.time || inst.remindLeadMin == null) continue;
      const at = zonedDateTime(ymd, inst.time, dayStart);
      at.setMinutes(at.getMinutes() - Number(inst.remindLeadMin));
      const ts = at.getTime();
      if (ts <= now.getTime() || ts > horizon) continue;
      const text = reminderText({
        title: inst.title,
        time: inst.time,
        note: inst.note,
        showNames: names,
        clock24,
      });
      list.push({
        id: `${inst.taskId}:${ymd}:${at.toISOString()}`,
        fireAtUTC: at.toISOString(),
        title: text.title,
        body: text.body,
        taskId: inst.taskId,
        date: ymd,
        kind: 'task',
      });
    }
  }
  return list;
}

export function hexToRgb(hex) {
  const n = hex.replace('#', '');
  return {
    r: parseInt(n.slice(0, 2), 16),
    g: parseInt(n.slice(2, 4), 16),
    b: parseInt(n.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

export function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const chan = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

export function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export function onAccent(hex) {
  return contrastRatio(hex, '#FFFFFF') >= 4.5 ? '#FFFFFF' : '#12131A';
}

export function composite(topHex, topAlpha, bottomHex) {
  const t = hexToRgb(topHex);
  const b = hexToRgb(bottomHex);
  const a = topAlpha;
  return rgbToHex({
    r: t.r * a + b.r * (1 - a),
    g: t.g * a + b.g * (1 - a),
    b: t.b * a + b.b * (1 - a),
  });
}

export function autoScrim(averageLuminance) {
  return averageLuminance > 0.5 ? 'light' : 'dark';
}

/** Header text colour and the composited scrim colour over a photo. */
export function headerContrast(photoHex, scrimMode) {
  const dark = scrimMode !== 'light';
  const scrim = dark
    ? composite('#000000', 0.6, photoHex)
    : composite('#FFFFFF', 0.7, photoHex);
  const text = dark ? '#FFFFFF' : '#1E2030';
  return { scrim, text, ratio: contrastRatio(text, scrim) };
}

/** Card surface is 92% opaque. Returns contrast of text and muted on it. */
export function cardContrast(theme, photoHex) {
  const surface = composite(theme.surface, 0.92, photoHex);
  return {
    surface,
    textRatio: contrastRatio(theme.text, surface),
    mutedRatio: contrastRatio(theme.muted, surface),
  };
}

export function normalizeHex(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return `#${raw.toUpperCase()}`;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function hexToHsl(hex) {
  const { r, g, b } = hexToRgb(hex);
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return { h: h * 60, s: s * 100, l: l * 100 };
}

function hue2rgb(p, q, t) {
  let x = t;
  if (x < 0) x += 1;
  if (x > 1) x -= 1;
  if (x < 1 / 6) return p + (q - p) * 6 * x;
  if (x < 1 / 2) return q;
  if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
  return p;
}

export function hslToHex({ h, s, l }) {
  const H = (((h % 360) + 360) % 360) / 360;
  const S = clamp(s, 0, 100) / 100;
  const L = clamp(l, 0, 100) / 100;
  if (S === 0) {
    const v = Math.round(L * 255);
    return rgbToHex({ r: v, g: v, b: v });
  }
  const q = L < 0.5 ? L * (1 + S) : L + S - L * S;
  const p = 2 * L - q;
  return rgbToHex({
    r: hue2rgb(p, q, H + 1 / 3) * 255,
    g: hue2rgb(p, q, H) * 255,
    b: hue2rgb(p, q, H - 1 / 3) * 255,
  });
}

/** Gray whose WCAG relative luminance is as close as possible to `L`. */
export function grayFromLuminance(L) {
  const x = clamp(Number(L) || 0, 0, 1);
  const s = x <= 0.0031308 ? 12.92 * x : 1.055 * (x ** (1 / 2.4)) - 0.055;
  const c = Math.round(clamp(s, 0, 1) * 255);
  return rgbToHex({ r: c, g: c, b: c });
}

function cardFill(surface, bg, photoHex) {
  return photoHex ? composite(surface, 0.92, photoHex) : composite(surface, 0.92, bg);
}

function surfaceFor(text, ground, bg, photoHex) {
  const lightText = relativeLuminance(text) >= 0.5;
  const candidates = lightText
    ? [composite('#FFFFFF', 0.08, ground), '#1A1730', '#000000']
    : ['#FFFFFF', composite('#FFFFFF', 0.9, ground)];
  for (const surface of candidates) {
    if (contrastRatio(text, cardFill(surface, bg, photoHex)) >= 4.5) return surface;
  }
  return lightText ? '#000000' : '#FFFFFF';
}

function softerInk(text, grounds) {
  const list = grounds.filter(Boolean);
  if (!list.length) return text;
  const passes = (hex) => list.every((g) => contrastRatio(hex, g) >= 4.5);
  const base = list[0];
  for (let a = 0.72; a <= 1.001; a += 0.04) {
    const hex = composite(text, Math.min(a, 1), base);
    if (passes(hex)) return hex;
  }
  return text;
}

/**
 * Colours actually painted for a settings object.
 * `photo` is `{ on, luminance, scrim }` when a background photo is showing.
 * `scrim` should already be resolved to "dark" or "light".
 */
export function paintColors(settings, photo = null) {
  const theme = THEMES[settings?.theme] || THEMES.calm;
  const customBg = normalizeHex(settings?.bgColor);
  const customText = normalizeHex(settings?.textColor);
  const bg = customBg || theme.bg;
  const text = customText || theme.text;
  const accent = normalizeHex(settings?.accent) || theme.accent;
  const photoOn = Boolean(photo?.on);
  const scrim = photo?.scrim === 'light' ? 'light' : 'dark';
  const photoHex = photoOn ? grayFromLuminance(photo?.luminance == null ? 0.5 : photo.luminance) : null;
  const backdrop = photoOn ? headerContrast(photoHex, scrim).scrim : bg;
  const custom = Boolean(customBg || customText);
  const surface = custom ? surfaceFor(text, photoOn ? backdrop : bg, bg, photoHex) : theme.surface;
  const card = cardFill(surface, bg, photoHex);
  const mutedGrounds = [card];
  if (!(photoOn && !customText)) mutedGrounds.push(photoOn ? backdrop : bg);
  const muted = custom ? softerInk(text, mutedGrounds) : theme.muted;
  const headerInk = photoOn && !customText ? headerContrast(photoHex, scrim).text : text;
  const headerRatio = contrastRatio(headerInk, photoOn ? backdrop : bg);
  const cardRatio = contrastRatio(text, card);
  const mutedRatio = Math.min(...mutedGrounds.map((g) => contrastRatio(muted, g)));
  const ratio = Math.min(headerRatio, cardRatio, mutedRatio);
  return {
    bg,
    text,
    surface,
    muted,
    accent,
    success: theme.success,
    backdrop,
    card,
    ratio,
    ok: ratio >= 4.5,
    customText: Boolean(customText),
    customBg: Boolean(customBg),
    headerInk,
  };
}

/** Nearest lighter or darker shade of `textHex` that clears 4.5:1 on the painted grounds. */
export function nearestReadable(textHex, settings, photo = null) {
  const start = normalizeHex(textHex) || THEMES.calm.text;
  const trial = (hex) => paintColors({ ...settings, textColor: hex }, photo);
  if (trial(start).ok) return start;
  const hsl = hexToHsl(start);
  for (let step = 1; step <= 100; step += 1) {
    for (const dir of [1, -1]) {
      const hex = hslToHex({ h: hsl.h, s: hsl.s, l: clamp(hsl.l + dir * step, 0, 100) });
      if (trial(hex).ok) return hex;
    }
  }
  let best = '#12131A';
  let bestScore = -1;
  for (const hex of ['#FFFFFF', '#12131A', '#000000', '#F6F4FF']) {
    const score = trial(hex).ratio;
    if (score > bestScore) {
      bestScore = score;
      best = hex;
    }
  }
  return best;
}

export function fixTextColor(settings, photo = null) {
  const theme = THEMES[settings?.theme] || THEMES.calm;
  const start = normalizeHex(settings?.textColor) || theme.text;
  return nearestReadable(start, settings, photo);
}

/** Fill new colour fields without dropping a v1 save's theme, accent, or categories. */
export function migrateSettings(saved) {
  const base = defaultSettings();
  if (!saved || typeof saved !== 'object') return base;
  const version = Number(saved.schemaVersion) || 1;
  const merged = {
    ...base,
    ...saved,
    dailyGoal: { ...base.dailyGoal, ...(saved.dailyGoal || {}) },
    morningCheckin: { ...base.morningCheckin, ...(saved.morningCheckin || {}) },
    dayCompleteShown: { ...(saved.dayCompleteShown || {}) },
    dayCompleteAwarded: { ...(saved.dayCompleteAwarded || {}) },
    categories: Array.isArray(saved.categories) && saved.categories.length ? saved.categories : base.categories,
    id: 'main',
  };
  if (version < 2) merged.schemaVersion = 2;
  merged.textColor = normalizeHex(saved.textColor);
  merged.bgColor = normalizeHex(saved.bgColor);
  if (!THEMES[merged.theme]) merged.theme = base.theme;
  return merged;
}

export function burstCount(difficulty) {
  if (difficulty === 'hard') return 40;
  if (difficulty === 'medium') return 16;
  return 8;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
