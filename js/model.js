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
  calm: { bg: '#F6F6FB', surface: '#FFFFFF', text: '#1E2030', muted: '#565B6E', accent: '#4F46E5', onAccent: '#FFFFFF', success: '#15803D' },
  mint: { bg: '#EFF8F4', surface: '#FFFFFF', text: '#14302A', muted: '#44605A', accent: '#0F766E', onAccent: '#FFFFFF', success: '#15803D' },
  sunset: { bg: '#FFF4EC', surface: '#FFFFFF', text: '#3A1F14', muted: '#6B4A3D', accent: '#C2410C', onAccent: '#FFFFFF', success: '#15803D' },
  ocean: { bg: '#EEF5FB', surface: '#FFFFFF', text: '#0F2438', muted: '#48607A', accent: '#1D63B8', onAccent: '#FFFFFF', success: '#15803D' },
  blossom: { bg: '#FCF1F5', surface: '#FFFFFF', text: '#3B1427', muted: '#6E4A5B', accent: '#BE185D', onAccent: '#FFFFFF', success: '#15803D' },
  night: { bg: '#12131A', surface: '#1D1F2A', text: '#F2F3F8', muted: '#A9ADBF', accent: '#8B8CF6', onAccent: '#12131A', success: '#4ADE80' },
};

export const ACCENTS = ['#4F46E5', '#0F766E', '#C2410C', '#1D63B8', '#BE185D', '#8B8CF6', '#7C3AED', '#0E7490'];

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
    { id: 'class', name: 'Class', emoji: '📚', color: '#1D63B8' },
    { id: 'study', name: 'Study', emoji: '✏️', color: '#7C3AED' },
    { id: 'task', name: 'Task', emoji: '✅', color: '#15803D' },
    { id: 'personal', name: 'Personal', emoji: '🌱', color: '#0F766E' },
    { id: 'goal', name: 'Goal', emoji: '🎯', color: '#C2410C' },
  ];
}

export function defaultSettings() {
  return {
    id: 'main',
    title: 'My Day',
    theme: 'calm',
    accent: '#4F46E5',
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
    schemaVersion: 1,
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

export function burstCount(difficulty) {
  if (difficulty === 'hard') return 40;
  if (difficulty === 'medium') return 16;
  return 8;
}

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
