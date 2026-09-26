/**
 * Dayli UI. Plain DOM, no framework. All user data stays in IndexedDB.
 */

import { PRODUCT_NAME, APP_VERSION } from './config.js';
import * as model from './model.js';
import * as db from './db.js';
import * as push from './push.js';

const {
  POINTS, DAY_COMPLETE_BONUS, THEMES, ACCENTS, FONTS, WEEKDAY_LABELS,
  TEXT_COLOURS, BG_COLOURS, defaultSettings, defaultDifficulty, addDays, plannerDate, formatDayLabel,
  formatTime, dayOfWeek, instancesOn, computeStreak, sumPoints, pointsOnDate,
  isDayComplete, levelForPoints, levelProgress, levelTitle, displayLevel,
  upcomingReminders, reminderText, onAccent, autoScrim, burstCount, clone,
  zonedDateTime, weekStartOf, parseHM, migrateSettings, paintColors, fixTextColor,
  normalizeHex, relativeLuminance,
} = model;

const S = {
  tasks: [],
  overrides: [],
  completions: [],
  bonuses: [],
  settings: defaultSettings(),
  reminders: [],
  background: null,
};

let viewDate = null;
let deferredPrompt = null;
let photoUrl = null;
let undoTimer = null;
let undoFn = null;
let toastText = '';
let banner = null;
let dayCard = null;
let levelPop = null;
let sheetOpen = false;
let sessionStarted = currentMs();
let doneExpanded = false;
const highWater = { level: 1, celebrated: 1, shown: {} };

const appEl = () => document.getElementById('app');
const overlayEl = () => document.getElementById('overlay');

function h(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') {
        for (const [d, v] of Object.entries(value)) node.dataset[d] = String(v);
      } else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else {
        node.setAttribute(key, value === true ? '' : String(value));
      }
    }
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function icon(pathD) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  for (const d of (Array.isArray(pathD) ? pathD : [pathD])) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
  }
  return svg;
}

const I = {
  plus: ['M12 5v14', 'M5 12h14'],
  check: ['M5 12.5 9.5 17 19 7'],
  palette: ['M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 1.6-3.2 2 2 0 0 1 1.6-3.3H18a4 4 0 0 0 4-4 9 9 0 0 0-10-7.5z', 'M7.5 11.5h.01', 'M9.5 7.5h.01', 'M14.5 7.5h.01', 'M17.2 11h.01'],
  left: ['M15 6 9 12l6 6'],
  right: ['M9 6l6 6-6 6'],
  bell: ['M6 9a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9', 'M10 20a2 2 0 0 0 4 0'],
  trash: ['M4 7h16', 'M9 7V5h6v2', 'M8 7l1 13h6l1-13'],
  undo: ['M8 8H3v5', 'M3.5 8a8 8 0 1 1-1 4'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  share: ['M12 16V4', 'M8 8l4-4 4 4', 'M5 14v5h14v-5'],
};

function deviceKind() {
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (iOS) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Current instant. Tests set window.__DAYLI_NOW (ms) so IndexedDB timers keep running. */
function currentMs() {
  const hooked = window.__DAYLI_NOW;
  if (typeof hooked === 'number' && Number.isFinite(hooked)) return hooked;
  return Date.now();
}

function currentDate() {
  return new Date(currentMs());
}

function celebrationMode() {
  if (reducedMotion()) return 'reduced';
  return S.settings.celebrations || 'full';
}

function plannerToday() {
  return plannerDate(currentDate(), S.settings.dayStart || '04:00');
}

function viewedYMD() {
  return viewDate || plannerToday();
}

function categoryById(id) {
  return (S.settings.categories || []).find((c) => c.id === id) || S.settings.categories[0];
}

function isDone(inst) {
  return S.completions.some((c) => c.instanceId === inst.instanceId);
}

function mergeSettings(saved) {
  return migrateSettings(saved);
}

function photoArg() {
  if (!photoUrl) return null;
  return { on: true, luminance: S.background?.brightness, scrim: resolvedScrim() };
}

function noteHighWater() {
  highWater.level = Math.max(highWater.level, S.settings.highestLevel || 1);
  highWater.celebrated = Math.max(highWater.celebrated, S.settings.celebratedLevel || 1);
  Object.assign(highWater.shown, S.settings.dayCompleteShown || {});
}

function refreshPhotoUrl() {
  if (photoUrl) URL.revokeObjectURL(photoUrl);
  photoUrl = S.background?.blob ? URL.createObjectURL(S.background.blob) : null;
}

function resolvedScrim() {
  const choice = S.settings.photoScrim || 'auto';
  if (choice === 'dark' || choice === 'light') return choice;
  const lum = S.background?.brightness;
  if (lum == null) return 'dark';
  return autoScrim(lum);
}

function applyChrome() {
  const settings = S.settings;
  const painted = paintColors(settings, photoArg());
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.font = settings.font;
  root.dataset.text = painted.customText ? 'custom' : 'theme';
  root.dataset.tone = relativeLuminance(painted.bg) > 0.45 ? 'light' : 'dark';
  root.style.setProperty('--bg', painted.bg);
  root.style.setProperty('--surface', painted.surface);
  root.style.setProperty('--text', painted.text);
  root.style.setProperty('--muted', painted.muted);
  root.style.setProperty('--accent', painted.accent);
  root.style.setProperty('--on-accent', onAccent(painted.accent));
  root.style.setProperty('--success', painted.success);
  root.dataset.photo = photoUrl ? 'on' : 'off';
  root.dataset.scrim = photoUrl ? resolvedScrim() : 'none';
  const photo = document.getElementById('backdrop-photo');
  if (photo) {
    photo.style.backgroundImage = photoUrl ? `url("${photoUrl}")` : 'none';
    const blur = Number(settings.photoBlur) || 0;
    photo.style.filter = blur ? `blur(${blur}px)` : 'none';
    photo.style.transform = blur ? 'scale(1.08)' : 'none';
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = painted.bg;
  document.title = PRODUCT_NAME;
  const apple = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (apple) apple.setAttribute('content', PRODUCT_NAME);
}

async function persistAll() {
  noteHighWater();
  await db.replaceAll({
    tasks: S.tasks,
    overrides: S.overrides,
    completions: S.completions,
    bonuses: S.bonuses,
    settings: [S.settings],
    reminders: S.reminders,
    background: S.background ? [S.background] : [],
  });
}

function snapshot() {
  return {
    tasks: clone(S.tasks),
    overrides: clone(S.overrides),
    completions: clone(S.completions),
    bonuses: clone(S.bonuses),
    settings: clone(S.settings),
    reminders: clone(S.reminders),
  };
}

function restore(snap) {
  S.tasks = snap.tasks;
  S.overrides = snap.overrides;
  S.completions = snap.completions;
  S.bonuses = snap.bonuses;
  S.settings = snap.settings;
  S.reminders = snap.reminders;
  S.settings.highestLevel = Math.max(S.settings.highestLevel || 1, highWater.level);
  S.settings.celebratedLevel = Math.max(S.settings.celebratedLevel || 1, highWater.celebrated);
  S.settings.dayCompleteShown = { ...(S.settings.dayCompleteShown || {}), ...highWater.shown };
}

function showUndo(text, fn) {
  if (undoTimer) clearTimeout(undoTimer);
  undoFn = fn;
  toastText = text;
  renderToast();
  undoTimer = setTimeout(() => {
    undoFn = null;
    toastText = '';
    renderToast();
  }, 5000);
}

function announce(text) {
  const live = document.getElementById('live');
  if (!live) return;
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 30);
}

function streakInfo(today = plannerToday()) {
  const dates = [...new Set(S.completions.map((c) => c.completedOn || c.date).filter(Boolean))];
  return computeStreak(dates, today, { weekdaysOnly: S.settings.streakMode === 'weekdays' });
}

function recomputeStreakBonuses() {
  const info = streakInfo();
  S.bonuses = S.bonuses.filter((b) => b.kind !== 'streak');
  for (const ms of info.milestones) {
    S.bonuses.push({
      id: `streak:${ms.date}:${ms.days}`,
      kind: 'streak',
      date: ms.date,
      points: ms.points,
    });
  }
  return info;
}

function syncDayBonuses(ymd) {
  const instances = instancesOn(ymd, S.tasks, S.overrides);
  const comps = S.completions.filter((c) => c.date === ymd);
  const awarded = S.settings.dayCompleteAwarded?.[ymd];
  const complete = isDayComplete(instances, comps);
  let justFinished = false;
  if (complete && !awarded) {
    S.settings.dayCompleteAwarded[ymd] = instances.map((i) => i.instanceId);
    if (!S.bonuses.some((b) => b.id === `day:${ymd}`)) {
      S.bonuses.push({ id: `day:${ymd}`, kind: 'day', date: ymd, points: DAY_COMPLETE_BONUS });
    }
    justFinished = true;
  } else if (awarded) {
    const still = awarded.every((id) => S.completions.some((c) => c.instanceId === id));
    if (!still) {
      delete S.settings.dayCompleteAwarded[ymd];
      S.bonuses = S.bonuses.filter((b) => b.id !== `day:${ymd}`);
    }
  }
  const earned = comps.reduce((sum, c) => sum + (c.points || 0), 0);
  const met = model.goalMet(S.settings, instances, comps, earned);
  const goalId = `goal:${ymd}`;
  if (met && !S.bonuses.some((b) => b.id === goalId)) {
    S.bonuses.push({ id: goalId, kind: 'goal', date: ymd, points: model.GOAL_BONUS });
  } else if (!met) {
    S.bonuses = S.bonuses.filter((b) => b.id !== goalId);
  }
  return { justFinished, complete };
}

function syncLevel() {
  recomputeStreakBonuses();
  const total = sumPoints(S.completions, S.bonuses);
  const level = levelForPoints(total);
  if (level > (S.settings.highestLevel || 1)) S.settings.highestLevel = level;
  const leveled = (S.settings.highestLevel || 1) > (S.settings.celebratedLevel || 1);
  if (leveled) S.settings.celebratedLevel = S.settings.highestLevel;
  noteHighWater();
  return { leveled, level: S.settings.highestLevel, total };
}

function findInstance(taskId, date) {
  if (!taskId || !date) return null;
  return instancesOn(date, S.tasks, S.overrides).find((inst) => inst.taskId === taskId) || null;
}

async function completeInstance(inst, { fromUndo = false } = {}) {
  if (!inst || isDone(inst)) return;
  const snap = snapshot();
  const points = POINTS[inst.difficulty] || POINTS.easy;
  const completedOn = plannerToday();
  S.completions.push({
    id: inst.instanceId,
    instanceId: inst.instanceId,
    taskId: inst.taskId,
    date: inst.date,
    completedOn,
    points,
    difficulty: inst.difficulty,
    completedAt: currentDate().toISOString(),
  });
  const day = syncDayBonuses(inst.date);
  const level = syncLevel();
  const streak = streakInfo();
  const showDay = day.justFinished && inst.date === plannerToday() && !S.settings.dayCompleteShown[inst.date];
  if (showDay) S.settings.dayCompleteShown[inst.date] = true;
  markReminderDone(inst.taskId, inst.date);
  doneExpanded = true;
  await persistAll();
  render();
  if (!fromUndo) {
    playComplete(inst, points, { ...day, ...level, streak: streak.streak, showDay });
    showUndo(`Done! +${points}`, async () => {
      restore(snap);
      await persistAll();
      render();
      syncPush();
    });
  }
  syncPush();
}

function playComplete(inst, points, result) {
  const mode = celebrationMode();
  const onToday = inst.date === plannerToday();
  announce(`+${points}`);
  if (S.settings.sound) playTone(mode === 'reduced' ? 0 : 520, 0.12);
  if (mode === 'full' && navigator.vibrate) {
    try { navigator.vibrate(inst.difficulty === 'hard' ? [20, 40, 20] : 15); } catch { /* ignore */ }
  }
  if (onToday && mode !== 'off') spawnFloat(inst.instanceId, points, mode);
  if (onToday && mode === 'full') spawnBurst(inst);
  if (result.showDay) {
    openDayCard(result.streak);
    if (mode === 'full') spawnConfetti();
  }
  if (result.leveled) openLevelPop(result.level);
}

function spawnFloat(instanceId, points, mode) {
  const btn = document.querySelector(`[data-instance="${CSS.escape(instanceId)}"] .check`);
  const layer = document.getElementById('celebrate');
  const el = h('div', {
    class: mode === 'reduced' ? 'points-float is-fade' : 'points-float',
    text: `+${points}`,
  });
  const rect = btn?.getBoundingClientRect();
  el.style.left = `${rect ? rect.left + rect.width / 2 : window.innerWidth / 2}px`;
  el.style.top = `${rect ? rect.top : 180}px`;
  layer.append(el);
  setTimeout(() => el.remove(), 800);
}

function spawnBurst(inst) {
  const btn = document.querySelector(`[data-instance="${CSS.escape(inst.instanceId)}"] .check`);
  const rect = btn?.getBoundingClientRect();
  const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const cy = rect ? rect.top + rect.height / 2 : 200;
  const layer = document.getElementById('celebrate');
  const n = burstCount(inst.difficulty);
  const kind = inst.difficulty === 'hard' ? 'confetti' : 'spark';
  for (let i = 0; i < n; i += 1) {
    const p = document.createElement('span');
    p.className = `particle ${kind}`;
    p.style.left = `${cx}px`;
    p.style.top = `${cy}px`;
    const angle = (Math.PI * 2 * i) / n;
    const dist = inst.difficulty === 'hard' ? 40 + (i % 5) * 28 : 30 + (i % 4) * 18;
    p.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(angle) * dist - (inst.difficulty === 'hard' ? 20 : 0)}px`);
    p.style.background = ['#6D4AFF', '#FFD60A', '#00C2A8', '#FF2D87', '#1A8CFF'][i % 5];
    layer.append(p);
    setTimeout(() => p.remove(), 1300);
  }
}

function spawnConfetti() {
  const layer = document.getElementById('celebrate');
  for (let i = 0; i < 36; i += 1) {
    const p = document.createElement('span');
    p.className = 'particle confetti fall';
    p.style.left = `${(i * 37) % 100}%`;
    p.style.top = '-8px';
    p.style.animationDelay = `${(i % 8) * 0.05}s`;
    p.style.background = ['#6D4AFF', '#FFD60A', '#00C2A8', '#FF2D87', '#1A8CFF'][i % 5];
    layer.append(p);
    setTimeout(() => p.remove(), 1600);
  }
}

function playTone(freq, dur) {
  if (!S.settings.sound) return;
  try {
    const ctx = playTone.ctx || (playTone.ctx = new AudioContext());
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq || 520;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  } catch { /* autoplay or missing API */ }
}

function openDayCard(streak) {
  dayCard = { streak };
  renderOverlayBits();
  const nice = document.getElementById('day-nice');
  if (nice) nice.focus();
}

function openLevelPop(level) {
  levelPop = { level, title: levelTitle(level) };
  renderOverlayBits();
  clearTimeout(openLevelPop.timer);
  openLevelPop.timer = setTimeout(() => {
    levelPop = null;
    renderOverlayBits();
  }, 3000);
  announce(`Level ${level}, ${levelTitle(level)}`);
}

async function moveInstance(inst) {
  const task = S.tasks.find((t) => t.id === inst.taskId);
  if (!task) return;
  const snap = snapshot();
  const target = addDays(inst.date, 1);
  if (!task.repeat || task.repeat === 'none') {
    task.date = target;
    task.updatedAt = currentDate().toISOString();
    const comp = S.completions.find((c) => c.instanceId === inst.instanceId);
    if (comp) {
      comp.date = target;
      comp.instanceId = `${task.id}:${target}`;
      comp.id = comp.instanceId;
    }
  } else {
    const id = `${task.id}:${inst.originDate}`;
    let ov = S.overrides.find((o) => o.id === id);
    if (!ov) {
      ov = { id, taskId: task.id, date: inst.originDate, skipped: false, movedTo: target, edits: null };
      S.overrides.push(ov);
    } else {
      ov.movedTo = target;
      ov.skipped = false;
    }
  }
  S.reminders = S.reminders.filter((r) => r.taskId !== task.id || (r.state !== 'scheduled' && r.state !== 'missed'));
  await persistAll();
  refreshReminderRecords();
  await persistAll();
  render();
  showUndo('Moved to tomorrow.', async () => {
    restore(snap);
    await persistAll();
    render();
    syncPush();
  });
  syncPush();
}

async function deleteInstance(inst, scope) {
  const task = S.tasks.find((t) => t.id === inst.taskId);
  if (!task) return;
  const snap = snapshot();
  if (!task.repeat || task.repeat === 'none' || scope === 'all') {
    S.tasks = S.tasks.filter((t) => t.id !== task.id);
    S.overrides = S.overrides.filter((o) => o.taskId !== task.id);
  } else {
    const id = `${task.id}:${inst.originDate}`;
    let ov = S.overrides.find((o) => o.id === id);
    if (!ov) {
      ov = { id, taskId: task.id, date: inst.originDate, skipped: true, movedTo: null, edits: null };
      S.overrides.push(ov);
    } else {
      ov.skipped = true;
      ov.movedTo = null;
    }
  }
  S.reminders = S.reminders.filter((r) => r.taskId !== inst.taskId || (r.state !== 'scheduled' && r.state !== 'missed'));
  syncDayBonuses(inst.date);
  syncLevel();
  await persistAll();
  refreshReminderRecords();
  await persistAll();
  closeSheet();
  render();
  showUndo('Deleted.', async () => {
    restore(snap);
    await persistAll();
    render();
    syncPush();
  });
  syncPush();
}

function blankDraft(date) {
  return {
    title: '',
    categoryId: 'task',
    difficulty: 'easy',
    difficultyTouched: false,
    time: '',
    duration: '',
    durationTouched: false,
    repeat: 'none',
    days: [dayOfWeek(date)],
    remind: String(S.settings.defaultLead ?? 10),
    note: '',
    scope: 'day',
  };
}

function draftFromInstance(inst) {
  return {
    title: inst.title,
    categoryId: inst.categoryId,
    difficulty: inst.difficulty,
    difficultyTouched: true,
    time: inst.time || '',
    duration: inst.durationMin ?? '',
    durationTouched: true,
    repeat: inst.repeat || 'none',
    days: inst.days?.length ? [...inst.days] : [dayOfWeek(inst.date)],
    remind: inst.remindLeadMin == null ? 'off' : String(inst.remindLeadMin),
    note: inst.note || '',
    scope: 'day',
  };
}

function buildTask(draft, date) {
  const title = draft.title.trim();
  const time = draft.time || null;
  let duration = draft.duration === '' || draft.duration == null ? null : Number(draft.duration);
  if (draft.categoryId === 'class' && time && duration == null && !draft.durationTouched) duration = 50;
  const remindLeadMin = time && draft.remind !== 'off' ? Number(draft.remind) : null;
  return {
    title,
    categoryId: draft.categoryId,
    difficulty: draft.difficulty,
    time,
    durationMin: duration,
    remindLeadMin,
    note: draft.note.trim(),
    repeat: draft.repeat,
    days: draft.repeat === 'days' ? [...draft.days] : [],
    date,
  };
}

async function saveDraft(draft, existing) {
  const title = draft.title.trim();
  if (!title) {
    const input = document.getElementById('field-title');
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }
    const err = document.getElementById('title-error');
    if (err) err.hidden = false;
    return;
  }
  const snap = snapshot();
  if (!existing) {
    const fields = buildTask(draft, viewedYMD());
    S.tasks.push({
      id: crypto.randomUUID(),
      ...fields,
      createdAt: currentDate().toISOString(),
      updatedAt: currentDate().toISOString(),
    });
  } else {
    const task = S.tasks.find((t) => t.id === existing.taskId);
    if (!task) return;
    const fields = buildTask(draft, existing.date);
    const series = !existing.repeating || draft.scope === 'all';
    if (series) {
      Object.assign(task, {
        title: fields.title,
        categoryId: fields.categoryId,
        difficulty: fields.difficulty,
        time: fields.time,
        durationMin: fields.durationMin,
        remindLeadMin: fields.remindLeadMin,
        note: fields.note,
        repeat: fields.repeat,
        days: fields.days,
        updatedAt: currentDate().toISOString(),
      });
      const ov = S.overrides.find((o) => o.taskId === task.id && o.date === existing.originDate);
      if (ov?.edits) ov.edits = null;
    } else {
      const id = `${task.id}:${existing.originDate}`;
      let ov = S.overrides.find((o) => o.id === id);
      const edits = {
        title: fields.title,
        categoryId: fields.categoryId,
        difficulty: fields.difficulty,
        time: fields.time,
        durationMin: fields.durationMin,
        remindLeadMin: fields.remindLeadMin,
        note: fields.note,
      };
      if (!ov) {
        ov = { id, taskId: task.id, date: existing.originDate, skipped: false, movedTo: null, edits };
        S.overrides.push(ov);
      } else {
        ov.edits = { ...(ov.edits || {}), ...edits };
      }
    }
    const instId = existing.instanceId;
    const comp = S.completions.find((c) => c.instanceId === instId || (c.taskId === task.id && c.date === existing.date));
    if (comp) {
      const applyAll = series;
      const targets = applyAll
        ? S.completions.filter((c) => c.taskId === task.id)
        : [comp];
      for (const item of targets) {
        item.difficulty = fields.difficulty;
        item.points = POINTS[fields.difficulty] || POINTS.easy;
      }
      syncDayBonuses(existing.date);
      syncLevel();
    }
  }
  await persistAll();
  refreshReminderRecords();
  await persistAll();
  closeSheet();
  render();
  if (existing) {
    showUndo('Saved.', async () => {
      restore(snap);
      await persistAll();
      render();
      syncPush();
    });
  }
  syncPush();
}

function refreshReminderRecords() {
  const now = currentDate();
  const wanted = upcomingReminders({
    tasks: S.tasks,
    overrides: S.overrides,
    settings: S.settings,
    now,
    showNames: S.settings.showNames !== false,
  });
  const wantedIds = new Set(wanted.map((w) => w.id));
  S.reminders = S.reminders.filter((r) => {
    if (r.state === 'scheduled' && !r.snoozed) return wantedIds.has(r.id);
    return true;
  });
  for (const item of wanted) {
    if (!S.reminders.some((r) => r.id === item.id)) {
      S.reminders.push({ ...item, state: 'scheduled', snoozed: false });
    }
  }
  for (const r of S.reminders) {
    if (r.state === 'scheduled' && Date.parse(r.fireAtUTC) < sessionStarted) r.state = 'missed';
  }
}

function checkDue() {
  const now = currentMs();
  const notify = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  let delivered = false;
  for (const r of S.reminders) {
    if (r.state !== 'scheduled') continue;
    const t = Date.parse(r.fireAtUTC);
    if (t <= now && t >= sessionStarted - 1500) {
      r.state = 'delivered';
      delivered = true;
      showBanner(r);
      if (notify) systemNotify(r);
    }
  }
  const current = plannerToday();
  if (checkDue.lastDay && checkDue.lastDay !== current) render();
  checkDue.lastDay = current;
  if (delivered) persistAll();
}

async function systemNotify(record) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!reg?.showNotification) return;
    await reg.showNotification(record.title, {
      body: record.body || '',
      tag: record.id,
      data: {
        taskId: record.taskId,
        date: record.date,
        title: record.title,
        body: record.body,
        id: record.id,
      },
      actions: [
        { action: 'done', title: 'Done' },
        { action: 'snooze', title: 'Snooze' },
      ],
    });
  } catch { /* banner still shows */ }
  if (S.settings.sound) playTone(440, 0.18);
}

function showBanner(record) {
  banner = record;
  renderOverlayBits();
}

function hideBanner() {
  banner = null;
  renderOverlayBits();
}

function snoozeRecord(record, minutes) {
  const at = new Date(currentMs() + minutes * 60 * 1000);
  record.fireAtUTC = at.toISOString();
  record.id = `${record.taskId || 'note'}:${record.date}:snooze:${at.toISOString()}`;
  record.state = 'scheduled';
  record.snoozed = true;
  hideBanner();
  persistAll();
  syncPush();
}

function markReminderDone(taskId, date) {
  for (const r of S.reminders) {
    if (r.taskId === taskId && r.date === date && (r.state === 'delivered' || r.state === 'missed' || r.state === 'scheduled')) {
      r.state = 'done';
    }
  }
}

async function bannerDone(record) {
  record.state = 'done';
  hideBanner();
  const inst = findInstance(record.taskId, record.date);
  if (inst && !isDone(inst)) await completeInstance(inst);
  else await persistAll();
}

function missedReminders() {
  return S.reminders
    .filter((r) => r.state === 'missed')
    .sort((a, b) => Date.parse(b.fireAtUTC) - Date.parse(a.fireAtUTC));
}

async function dismissMissed(record) {
  record.state = 'dismissed';
  await persistAll();
  render();
}

async function dismissAllMissed() {
  for (const r of S.reminders) if (r.state === 'missed') r.state = 'dismissed';
  await persistAll();
  render();
}

async function syncPush() {
  if (!S.settings.remindersWanted || !S.settings.pushSubscription) return;
  if (!push.pushConfigured()) return;
  const now = currentDate();
  const list = upcomingReminders({
    tasks: S.tasks,
    overrides: S.overrides,
    settings: S.settings,
    now,
    showNames: S.settings.showNames !== false,
  });
  for (const r of S.reminders) {
    if (r.snoozed && r.state === 'scheduled' && Date.parse(r.fireAtUTC) > currentMs()) {
      list.push({
        id: r.id,
        fireAtUTC: r.fireAtUTC,
        title: S.settings.showNames === false ? 'Coming up' : (r.title || 'Coming up'),
        body: S.settings.showNames === false ? 'You have something coming up' : (r.body || ''),
        taskId: r.taskId || null,
        date: r.date || null,
      });
    }
  }
  try {
    await push.syncReminders(S.settings.pushSubscription, list);
  } catch (err) {
    console.warn('Push sync failed', err);
  }
}

async function turnOnReminders() {
  if (!('Notification' in window)) return { ok: false };
  let perm = Notification.permission;
  if (perm !== 'granted') perm = await Notification.requestPermission();
  S.settings.remindersWanted = perm === 'granted';
  if (perm === 'granted') {
    try {
      const result = await push.subscribe();
      if (result?.subscription) S.settings.pushSubscription = result.subscription;
    } catch (err) {
      console.warn('Push subscribe failed', err);
    }
    refreshReminderRecords();
    await persistAll();
    await syncPush();
  } else {
    await persistAll();
  }
  return { ok: perm === 'granted', permission: perm };
}

function reminderStatus() {
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  if (deviceKind() === 'ios' && !isStandalone()) {
    return {
      code: 'needs-install',
      text: 'On iPhone, add to Home Screen to get reminders',
    };
  }
  if (perm === 'denied') {
    return {
      code: 'blocked',
      text: "Reminders are blocked in your browser settings. Here's how to allow them.",
    };
  }
  if (perm !== 'granted' || !S.settings.remindersWanted) {
    return { code: 'off', text: 'Reminders are off.' };
  }
  const pushOn = push.pushConfigured() && S.settings.pushSubscription && 'PushManager' in window;
  if (!pushOn) return { code: 'open-only', text: 'Only while the app is open' };
  return { code: 'on', text: 'On. Reminders usually arrive on time.' };
}

function render() {
  applyChrome();
  const root = appEl();
  root.replaceChildren();
  if (!S.settings.setupComplete) root.append(renderSetup());
  else if (S.screen === 'customize') root.append(renderCustomize());
  else if (S.screen === 'help') root.append(renderHelp());
  else root.append(renderToday());
  renderOverlayBits();
}

function renderSetup() {
  const step = S.settings.setupStep || 1;
  if (step === 1) return renderSetup1();
  if (step === 2) return renderSetup2();
  return renderSetup3();
}

function renderSetup1() {
  const title = h('input', {
    id: 'setup-title',
    class: 'text-input title-input',
    maxlength: '30',
    'aria-label': 'Title',
    value: S.settings.title || 'My Day',
    placeholder: 'My Day',
  });
  title.addEventListener('input', () => {
    S.settings.title = title.value.slice(0, 30) || 'My Day';
    persistAll();
  });
  const swatches = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Theme' },
    Object.entries(THEMES).map(([id, theme]) => {
      const btn = h('button', {
        type: 'button',
        class: `swatch${S.settings.theme === id ? ' is-selected' : ''}`,
        'aria-label': `${id} theme`,
        'aria-checked': S.settings.theme === id ? 'true' : 'false',
        role: 'radio',
        style: `background:${theme.bg}; color:${theme.text}`,
      });
      btn.append(h('span', { class: 'swatch-dot', style: `background:${theme.accent}` }));
      btn.append(h('span', { class: 'swatch-name', text: id[0].toUpperCase() + id.slice(1) }));
      btn.addEventListener('click', async () => {
        S.settings.theme = id;
        S.settings.accent = theme.accent;
        S.settings.textColor = null;
        S.settings.bgColor = null;
        await persistAll();
        render();
      });
      return btn;
    }));
  const file = h('input', { type: 'file', accept: 'image/*', id: 'setup-photo', class: 'sr-only' });
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f) openCropper(f);
    file.value = '';
  });
  return h('section', { class: 'setup', 'aria-labelledby': 'setup-h' },
    h('p', { class: 'wordmark', text: PRODUCT_NAME }),
    h('h1', { id: 'setup-h', class: 'setup-title', text: 'Make it yours' }),
    h('p', { class: 'lede', text: 'A title, a colour, and an optional photo. Ten seconds.' }),
    h('label', { class: 'field-label', for: 'setup-title', text: 'Title' }),
    title,
    h('p', { class: 'field-label', text: 'Theme' }),
    swatches,
    h('label', { class: 'btn secondary', for: 'setup-photo' }, icon(I.plus), 'Add a photo'),
    file,
    h('button', {
      type: 'button',
      class: 'btn primary',
      onclick: async () => {
        if (!S.settings.title?.trim()) S.settings.title = 'My Day';
        S.settings.setupStep = isStandalone() ? 3 : 2;
        await persistAll();
        render();
      },
    }, 'Continue'));
}

function renderSetup2() {
  const kind = deviceKind();
  const promptReady = Boolean(deferredPrompt);
  const steps = kind === 'ios'
    ? [
      ['Tap Share', 'The square with an arrow, in Safari.'],
      ['Add to Home Screen', 'Choose it in the share menu.'],
      ['Open as Web App, then Add', 'Turn that on, then tap Add.'],
    ]
    : null;
  const body = [];
  body.push(h('p', { class: 'wordmark', text: PRODUCT_NAME }));
  body.push(h('h1', { class: 'setup-title', text: 'Put it on your Home Screen' }));
  if (kind === 'ios' && steps) {
    body.push(h('ol', { class: 'install-steps' }, steps.map(([t, d], i) => h('li', {},
      h('span', { class: 'step-num', text: String(i + 1) }),
      h('span', {}, h('strong', { text: t }), h('span', { class: 'step-detail', text: d }))))));
    body.push(h('div', { class: 'illustration', 'aria-hidden': 'true' },
      h('div', { class: 'illu-phone' }, icon(I.share), h('span', { text: 'Share' })),
      h('div', { class: 'illu-row', text: 'Add to Home Screen' }),
      h('div', { class: 'illu-row', text: 'Open as Web App' })));
  } else if (promptReady) {
    body.push(h('p', { class: 'lede', text: 'Install Dayli so it opens like an app.' }));
    body.push(h('button', {
      type: 'button',
      class: 'btn primary',
      onclick: async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        try { await deferredPrompt.userChoice; } catch { /* ignore */ }
        deferredPrompt = null;
        render();
      },
    }, 'Install app'));
  } else {
    const line = kind === 'android'
      ? 'Open the browser menu and choose Install app or Add to Home Screen.'
      : 'Open the browser menu and choose Install app, or bookmark this page.';
    body.push(h('p', { class: 'lede', text: line }));
  }
  body.push(h('div', { class: 'row-btns' },
    h('button', {
      type: 'button',
      class: 'btn primary',
      onclick: async () => {
        S.settings.setupStep = 3;
        await persistAll();
        render();
      },
    }, 'I did it'),
    h('button', {
      type: 'button',
      class: 'btn ghost',
      onclick: async () => {
        S.settings.installSkipped = true;
        S.settings.setupStep = 3;
        await persistAll();
        render();
      },
    }, 'Skip for now')));
  return h('section', { class: 'setup' }, body);
}

function renderSetup3() {
  const iosBlocked = deviceKind() === 'ios' && !isStandalone();
  const morning = h('input', { type: 'checkbox', id: 'morning-toggle' });
  morning.checked = Boolean(S.settings.morningCheckin?.on);
  morning.addEventListener('change', () => {
    S.settings.morningCheckin.on = morning.checked;
    persistAll();
  });
  const turnOn = h('button', {
    type: 'button',
    class: 'btn primary',
    disabled: iosBlocked ? 'true' : null,
    onclick: async () => {
      if (iosBlocked) return;
      await turnOnReminders();
      S.settings.setupComplete = true;
      await persistAll();
      render();
    },
  }, 'Turn on reminders');
  return h('section', { class: 'setup' },
    h('p', { class: 'wordmark', text: PRODUCT_NAME }),
    h('h1', { class: 'setup-title', text: 'Want a nudge before classes and tasks?' }),
    iosBlocked ? h('p', { class: 'lede', text: 'Add to Home Screen first to get reminders on iPhone.' }) : null,
    S.settings.installSkipped && deviceKind() === 'ios'
      ? h('p', { class: 'note', text: 'Reminders and saving work best from your Home Screen.' })
      : null,
    turnOn,
    h('button', {
      type: 'button',
      class: 'btn ghost',
      onclick: async () => {
        S.settings.setupComplete = true;
        await persistAll();
        render();
      },
    }, 'Not now'),
    h('label', { class: 'check-row' }, morning, h('span', { text: 'Morning check-in at 8:00' })));
}

function renderToday() {
  const today = plannerToday();
  const viewed = viewedYMD();
  const viewingToday = viewed === today;
  if (!viewingToday) doneExpanded = doneExpanded;
  const instances = instancesOn(viewed, S.tasks, S.overrides);
  const open = instances.filter((inst) => !isDone(inst));
  const done = instances.filter((inst) => isDone(inst));
  const timed = open.filter((inst) => inst.time);
  const anytime = open.filter((inst) => !inst.time);
  const total = sumPoints(S.completions, S.bonuses);
  const level = displayLevel(total, S.settings.highestLevel);
  const progress = levelProgress(total, level);
  const streak = streakInfo(today);
  const dayPoints = pointsOnDate(S.completions, S.bonuses, viewingToday ? today : viewed);
  const goal = S.settings.dailyGoal;
  const compsToday = S.completions.filter((c) => c.date === viewed);

  const shell = h('main', { class: 'shell' });
  const header = h('header', { class: 'top' });
  header.append(
    h('div', { class: 'top-row' },
      h('div', {},
        h('h1', { class: 'top-title', text: S.settings.title || 'My Day' }),
        h('div', { class: 'date-row' },
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => shiftDay(-1) }, icon(I.left)),
          h('button', { type: 'button', class: 'date-btn', 'aria-label': formatDayLabel(viewed), title: 'Pick a day', onclick: pickDate }, formatDayLabel(viewed)),
          h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Next day', onclick: () => shiftDay(1) }, icon(I.right)))),
      h('button', {
        type: 'button',
        class: 'icon-btn',
        'aria-label': 'Customize',
        onclick: () => { S.screen = 'customize'; render(); },
      }, icon(I.palette))),
  );
  if (!viewingToday) {
    header.append(h('button', {
      type: 'button',
      class: 'text-btn',
      onclick: () => { viewDate = null; render(); },
    }, 'Back to today'));
  }
  header.append(h('div', { class: 'stats' },
    levelButton(level, progress),
    h('button', {
      type: 'button',
      class: 'chip',
      'aria-label': `Streak, ${streak.streak} ${streak.streak === 1 ? 'day' : 'days'}`,
      onclick: openProgress,
    }, '🔥 ', h('span', { class: 'num', text: String(streak.streak) })),
    h('p', { class: 'chip points-chip', 'aria-label': `Today's points ${dayPoints}` },
      h('span', { class: 'num', text: `+${dayPoints}` }))));
  shell.append(header);

  if (goal && goal.mode !== 'off') {
    const n = Number(goal.n) || 0;
    let label = '';
    let ratio = 0;
    if (goal.mode === 'tasks') {
      const count = compsToday.length;
      label = `${Math.min(count, n)} of ${n} done`;
      ratio = n ? Math.min(1, count / n) : 0;
    } else {
      const earned = compsToday.reduce((sum, c) => sum + c.points, 0);
      label = `${Math.min(earned, n)} of ${n} points`;
      ratio = n ? Math.min(1, earned / n) : 0;
    }
    shell.append(h('div', { class: 'goal' },
      h('div', { class: 'goal-label', text: label }),
      h('div', { class: 'goal-track', 'aria-hidden': 'true' }, h('div', { class: 'goal-fill', style: `width:${ratio * 100}%` }))));
  }

  if (viewingToday && S.settings.installSkipped && deviceKind() === 'ios' && !isStandalone()) {
    shell.append(h('p', { class: 'note', text: 'Reminders and saving work best from your Home Screen.' }));
  }

  const missed = viewingToday ? missedReminders() : [];
  if (missed.length) shell.append(renderAway(missed));

  if (shouldNudgeBackup() && viewingToday) shell.append(renderBackupNudge());

  const list = h('div', { class: 'day-list', id: 'day-list' });
  if (!instances.length) {
    const evening = viewingToday && isEvening();
    list.append(h('div', { class: 'empty' },
      h('p', { text: evening ? 'Plan tomorrow?' : 'Nothing planned yet. Add your first class or task.' }),
      h('button', {
        type: 'button',
        class: 'btn primary',
        onclick: () => {
          if (evening) {
            viewDate = addDays(today, 1);
            render();
            openSheet(null);
          } else openSheet(null);
        },
      }, evening ? 'Plan tomorrow' : 'Add')));
  } else if (S.settings.format === 'timeline') {
    list.append(renderTimeline(instances, viewed, today));
  } else {
    if (timed.length) list.append(h('div', { class: 'cards' }, timed.map(renderCard)));
    if (anytime.length) {
      list.append(h('h2', { class: 'divider', text: 'Anytime' }));
      list.append(h('div', { class: 'cards' }, anytime.map(renderCard)));
    }
    if (!open.length && done.length && viewingToday) {
      list.append(h('div', { class: 'all-done' },
        h('p', { text: 'All done for today. Rest up.' }),
        h('button', { type: 'button', class: 'text-btn', onclick: () => { viewDate = addDays(today, 1); render(); } }, 'Plan tomorrow')));
    }
    if (done.length) list.append(renderDone(done));
  }
  shell.append(list);
  shell.append(h('button', {
    type: 'button',
    class: 'fab',
    'aria-label': 'Add a class or task',
    onclick: () => openSheet(null),
  }, icon(I.plus)));
  attachDaySwipe(list);
  return shell;
}

function levelButton(level, progress) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const btn = h('button', {
    type: 'button',
    class: 'level-btn',
    'aria-label': `Level ${level}, ${levelTitle(level)}. Open progress`,
    onclick: openProgress,
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', 'level-ring');
  svg.setAttribute('aria-hidden', 'true');
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  bg.setAttribute('cx', '32');
  bg.setAttribute('cy', '32');
  bg.setAttribute('r', String(r));
  bg.setAttribute('class', 'ring-bg');
  const fg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  fg.setAttribute('cx', '32');
  fg.setAttribute('cy', '32');
  fg.setAttribute('r', String(r));
  fg.setAttribute('class', 'ring-fg');
  fg.setAttribute('stroke-dasharray', String(c));
  fg.setAttribute('stroke-dashoffset', String(c * (1 - progress)));
  svg.append(bg, fg);
  btn.append(svg, h('span', { class: 'level-num num', text: String(level) }), h('span', { class: 'level-name', text: levelTitle(level) }));
  return btn;
}

function renderCard(inst) {
  const cat = categoryById(inst.categoryId);
  const earlier = isEarlier(inst);
  const points = POINTS[inst.difficulty] || 5;
  const check = h('button', {
    type: 'button',
    class: 'check',
    'aria-label': `Mark ${inst.title} done, ${inst.difficulty}, ${points} points`,
    onclick: (e) => { e.stopPropagation(); completeInstance(inst); },
  }, icon(I.check));
  const main = h('button', {
    type: 'button',
    class: 'card-main',
    onclick: () => openSheet(inst),
  },
  h('span', { class: 'card-title', text: inst.title }),
  h('span', { class: 'card-meta' },
    inst.time ? h('span', { text: formatTime(inst.time, S.settings.clock24) }) : null,
    h('span', { text: `${cat?.emoji || ''} ${cat?.name || ''}`.trim() }),
    inst.note ? h('span', { text: inst.note }) : null,
    earlier ? h('span', { class: 'earlier', text: 'earlier' }) : null));
  const tag = h('span', { class: `tag tag-${inst.difficulty}`, text: labelDifficulty(inst.difficulty) });
  const move = earlier
    ? h('button', { type: 'button', class: 'text-btn quiet move-link', onclick: (e) => { e.stopPropagation(); moveInstance(inst); } }, 'Move to tomorrow')
    : null;
  const actions = h('div', { class: 'card-actions' },
    h('button', { type: 'button', class: 'text-btn', onclick: () => moveInstance(inst) }, 'Move to tomorrow'),
    h('button', { type: 'button', class: 'text-btn danger', onclick: () => deleteInstance(inst, 'day') }, 'Delete'));
  const card = h('article', {
    class: `card${earlier ? ' is-earlier' : ''}`,
    dataset: { instance: inst.instanceId },
  }, check, h('span', { class: 'dot', style: `background:${cat?.color || '#6D4AFF'}` }), main, tag, move, actions);
  attachCardGestures(card);
  return card;
}

function labelDifficulty(d) {
  if (d === 'hard') return 'Hard';
  if (d === 'medium') return 'Medium';
  return 'Easy';
}

function isEarlier(inst) {
  if (!inst.time) return false;
  const when = zonedDateTime(inst.date, inst.time, S.settings.dayStart || '04:00');
  return when.getTime() < currentMs();
}

function isEvening() {
  const now = currentDate();
  const mins = now.getHours() * 60 + now.getMinutes();
  const start = parseHM(S.settings.dayStart || '04:00');
  return mins >= 17 * 60 || mins < start.h * 60 + start.m;
}

function renderDone(done) {
  const panel = h('div', { class: 'done-block' });
  const btn = h('button', {
    type: 'button',
    class: 'done-toggle',
    'aria-expanded': doneExpanded ? 'true' : 'false',
    onclick: () => { doneExpanded = !doneExpanded; render(); },
  }, `Done (${done.length})`);
  panel.append(btn);
  if (doneExpanded) {
    panel.append(h('div', { class: 'cards' }, done.map((inst) => {
      const cat = categoryById(inst.categoryId);
      return h('article', { class: 'card is-done', dataset: { instance: inst.instanceId } },
        h('span', { class: 'check is-checked', 'aria-hidden': 'true' }, icon(I.check)),
        h('span', { class: 'dot', style: `background:${cat?.color || '#6D4AFF'}` }),
        h('div', { class: 'card-main static' },
          h('span', { class: 'card-title', text: inst.title }),
          h('span', { class: 'card-meta', text: inst.time ? formatTime(inst.time, S.settings.clock24) : 'Anytime' })),
        h('span', { class: `tag tag-${inst.difficulty}`, text: labelDifficulty(inst.difficulty) }));
    })));
  }
  return panel;
}

function renderTimeline(instances, viewed, today) {
  const open = instances.filter((inst) => !isDone(inst));
  const done = instances.filter((inst) => isDone(inst));
  const untimed = open.filter((inst) => !inst.time);
  const timed = open.filter((inst) => inst.time);
  let start = 7;
  let end = 22;
  if (timed.length) {
    const starts = timed.map((inst) => parseHM(inst.time).h);
    const ends = timed.map((inst) => {
      const hm = parseHM(inst.time);
      return Math.ceil((hm.h * 60 + hm.m + (inst.durationMin || 50)) / 60);
    });
    start = Math.min(...starts);
    end = Math.max(...ends);
    if (end <= start) end = start + 1;
  }
  if (viewed === today) {
    const now = currentDate();
    const hour = now.getHours() + now.getMinutes() / 60;
    start = Math.min(start, Math.floor(hour));
    end = Math.max(end, Math.ceil(hour + 0.01));
  }
  const hourH = 64;
  const height = (end - start) * hourH;
  const wrap = h('div', { class: 'timeline-wrap' });
  if (untimed.length) {
    wrap.append(h('div', { class: 'untimed-strip' }, untimed.map(renderCard)));
  }
  const rail = h('div', { class: 'timeline', style: `height:${height}px` });
  for (let hour = start; hour < end; hour += 1) {
    const label = formatTime(`${String(hour).padStart(2, '0')}:00`, S.settings.clock24);
    rail.append(h('div', { class: 'hour', style: `top:${(hour - start) * hourH}px` },
      h('span', { class: 'hour-label', text: label })));
  }
  for (const inst of timed) {
    const hm = parseHM(inst.time);
    const top = ((hm.h * 60 + hm.m) - start * 60) / 60 * hourH;
    const dur = Math.max(44, ((inst.durationMin || 45) / 60) * hourH - 6);
    const card = renderCard(inst);
    card.classList.add('timeline-card');
    card.style.top = `${top}px`;
    card.style.minHeight = `${dur}px`;
    rail.append(card);
  }
  if (viewed === today) {
    const now = currentDate();
    const mins = now.getHours() * 60 + now.getMinutes();
    const top = ((mins - start * 60) / 60) * hourH;
    rail.append(h('div', { class: 'now-line', style: `top:${top}px` }, h('span', { text: 'Now' })));
  }
  wrap.append(rail);
  if (done.length && !open.length && viewed === today) {
    wrap.append(h('div', { class: 'all-done' },
      h('p', { text: 'All done for today. Rest up.' }),
      h('button', { type: 'button', class: 'text-btn', onclick: () => { viewDate = addDays(today, 1); render(); } }, 'Plan tomorrow')));
  }
  if (done.length) wrap.append(renderDone(done));
  return wrap;
}

function renderAway(missed) {
  const shown = missed.slice(0, 5);
  return h('section', { class: 'away', 'aria-label': 'While you were away' },
    h('h2', { text: 'While you were away' }),
    h('ul', {}, shown.map((r) => h('li', {},
      h('p', {}, h('strong', { text: r.title || 'Coming up' }), h('span', { class: 'card-meta', text: r.body || '' })),
      h('div', { class: 'row-btns' },
        h('button', { type: 'button', class: 'btn small', onclick: () => awayDone(r) }, 'Done'),
        h('button', { type: 'button', class: 'btn small secondary', onclick: () => awayMove(r) }, 'Move to later'),
        h('button', { type: 'button', class: 'btn small ghost', onclick: () => dismissMissed(r) }, 'Dismiss'))))),
    h('button', { type: 'button', class: 'text-btn', onclick: dismissAllMissed }, 'Dismiss all'));
}

async function awayDone(record) {
  record.state = 'done';
  const inst = findInstance(record.taskId, record.date);
  if (inst) await completeInstance(inst);
  else {
    await persistAll();
    render();
  }
}

async function awayMove(record) {
  record.state = 'dismissed';
  const inst = findInstance(record.taskId, record.date);
  if (inst) await moveInstance(inst);
  else {
    await persistAll();
    render();
  }
}

function shouldNudgeBackup() {
  if ((S.tasks || []).length < 10) return false;
  if (S.settings.backupNudgeDismissedOn === plannerToday()) return false;
  if (!S.settings.lastBackup) return true;
  const then = new Date(S.settings.lastBackup).getTime();
  return currentMs() - then > 14 * 24 * 60 * 60 * 1000;
}

function renderBackupNudge() {
  return h('section', { class: 'nudge' },
    h('p', { text: 'Save a backup? It takes 2 seconds.' }),
    h('div', { class: 'row-btns' },
      h('button', { type: 'button', class: 'btn small', onclick: () => downloadBackup(false) }, 'Back up now'),
      h('button', {
        type: 'button',
        class: 'btn small ghost',
        onclick: async () => {
          S.settings.backupNudgeDismissedOn = plannerToday();
          await persistAll();
          render();
        },
      }, 'Not now')));
}

function shiftDay(delta) {
  viewDate = addDays(viewedYMD(), delta);
  doneExpanded = false;
  render();
}

function pickDate() {
  const input = h('input', { type: 'date', class: 'sr-only', value: viewedYMD() });
  input.addEventListener('change', () => {
    if (input.value) {
      viewDate = input.value;
      render();
    }
  });
  document.body.append(input);
  input.showPicker?.();
  input.click();
  setTimeout(() => input.remove(), 60_000);
}

function attachDaySwipe(list) {
  let startX = 0;
  let startY = 0;
  list.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.card')) return;
    startX = e.clientX;
    startY = e.clientY;
  });
  list.addEventListener('pointerup', (e) => {
    if (e.target.closest('.card')) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) shiftDay(dx < 0 ? 1 : -1);
  });
}

function attachCardGestures(card) {
  let x0 = 0;
  let y0 = 0;
  let timer = null;
  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') && !e.target.closest('.card-main')) return;
    x0 = e.clientX;
    y0 = e.clientY;
    timer = setTimeout(() => card.classList.add('show-actions'), 500);
  });
  card.addEventListener('pointerup', (e) => {
    clearTimeout(timer);
    const dx = e.clientX - x0;
    if (dx < -48 && Math.abs(e.clientY - y0) < 40) card.classList.add('show-actions');
  });
  card.addEventListener('pointerleave', () => clearTimeout(timer));
  card.addEventListener('pointercancel', () => clearTimeout(timer));
}

function openProgress() {
  const today = plannerToday();
  const info = streakInfo(today);
  const total = sumPoints(S.completions, S.bonuses);
  const level = displayLevel(total, S.settings.highestLevel);
  const start = weekStartOf(today, S.settings.weekStart || 'mon');
  const dates = new Set(S.completions.map((c) => c.completedOn || c.date));
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const ymd = addDays(start, i);
    days.push({
      ymd,
      label: WEEKDAY_LABELS.find((d) => d.dow === dayOfWeek(ymd))?.short || '',
      done: dates.has(ymd),
      rest: info.restDays.includes(ymd),
    });
  }
  const sheet = h('div', { class: 'sheet-wrap', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Progress' },
    h('button', { type: 'button', class: 'sheet-backdrop', 'aria-label': 'Close progress', onclick: closeProgress }),
    h('div', { class: 'sheet' },
      h('h2', { text: 'Progress' }),
      h('p', { text: `${total} total points` }),
      h('p', { text: `Level ${level} · ${levelTitle(level)}` }),
      h('p', { text: `Best streak: ${info.best} ${info.best === 1 ? 'day' : 'days'}` }),
      h('h3', { text: 'This week' }),
      h('ul', { class: 'week' }, days.map((d) => h('li', {},
        h('span', { text: d.label }),
        h('span', { text: d.rest ? '🌙' : d.done ? '✓' : '·' }),
        d.rest ? h('span', { class: 'sr-only', text: 'Rest day' }) : null))),
      h('button', { type: 'button', class: 'btn primary', onclick: closeProgress }, 'Close')));
  overlayEl().append(sheet);
  sheet.querySelector('.btn').focus();
}

function closeProgress() {
  overlayEl().querySelector('.sheet-wrap')?.remove();
}

function openSheet(inst) {
  sheetOpen = true;
  document.body.classList.add('sheet-open');
  const date = inst?.date || viewedYMD();
  const draft = inst ? draftFromInstance(inst) : blankDraft(date);
  const wrap = h('div', { class: 'sheet-wrap', id: 'edit-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': inst ? 'Edit' : 'Add' });
  const backdrop = h('button', { type: 'button', class: 'sheet-backdrop', 'aria-label': 'Cancel', onclick: closeSheet });
  const sheet = h('div', { class: 'sheet' });
  const title = h('input', {
    id: 'field-title',
    class: 'text-input',
    maxlength: '120',
    placeholder: 'Biology 101',
    'aria-label': 'What?',
    value: draft.title,
  });
  const error = h('p', { id: 'title-error', class: 'error', hidden: 'true', text: 'Add a name first.' });
  title.addEventListener('input', () => { draft.title = title.value; error.hidden = true; title.removeAttribute('aria-invalid'); });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveDraft(draft, inst);
    }
  });
  let ph = 0;
  const placeholders = ['Biology 101', 'Finish essay intro', 'Gym'];
  const phTimer = setInterval(() => {
    if (!title.isConnected) { clearInterval(phTimer); return; }
    ph = (ph + 1) % placeholders.length;
    title.placeholder = placeholders[ph];
  }, 2200);

  const catRow = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Type' });
  const diffRow = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'How hard?' });
  const repeatRow = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Repeat' });
  const dayRow = h('div', { class: 'chips days', role: 'group', 'aria-label': 'Days' });
  const time = h('input', { type: 'time', id: 'field-time', class: 'text-input', 'aria-label': 'Time', value: draft.time });
  const duration = h('input', {
    type: 'number', id: 'field-duration', class: 'text-input', min: '0', max: '600',
    'aria-label': 'Duration in minutes', placeholder: draft.categoryId === 'class' ? '50' : 'Optional',
    value: draft.duration === '' || draft.duration == null ? '' : String(draft.duration),
  });
  const remindWrap = h('div', { class: 'remind-field' });
  const remind = h('select', { id: 'field-remind', 'aria-label': 'Remind me' });
  for (const [val, label] of [['0', 'At start'], ['5', '5 min before'], ['10', '10 min before'], ['15', '15 min before'], ['30', '30 min before'], ['60', '60 min before'], ['off', 'Off']]) {
    const opt = h('option', { value: val, text: label });
    if (String(draft.remind) === val) opt.selected = true;
    remind.append(opt);
  }
  remind.addEventListener('change', () => { draft.remind = remind.value; });
  const note = h('input', { id: 'field-note', class: 'text-input', maxlength: '80', 'aria-label': 'Note', placeholder: 'Room 204', value: draft.note });
  note.addEventListener('input', () => { draft.note = note.value; });

  function paintCats() {
    catRow.replaceChildren(...S.settings.categories.map((cat) => {
      const btn = h('button', {
        type: 'button',
        class: `chip${draft.categoryId === cat.id ? ' is-selected' : ''}`,
        role: 'radio',
        'aria-checked': draft.categoryId === cat.id ? 'true' : 'false',
        onclick: () => {
          draft.categoryId = cat.id;
          if (!draft.difficultyTouched) draft.difficulty = defaultDifficulty(cat.id);
          if (cat.id === 'class' && draft.repeat === 'none') draft.repeat = 'days';
          if (cat.id === 'class' && draft.time && !draft.durationTouched && draft.duration === '') draft.duration = 50;
          paintCats();
          paintDiff();
          paintRepeat();
          syncRemindVisibility();
          if (draft.duration !== '' && draft.duration != null) duration.value = String(draft.duration);
        },
      }, `${cat.emoji} ${cat.name}`);
      return btn;
    }));
  }
  function paintDiff() {
    diffRow.replaceChildren(...['easy', 'medium', 'hard'].map((d) => h('button', {
      type: 'button',
      class: `chip big${draft.difficulty === d ? ' is-selected' : ''}`,
      role: 'radio',
      'aria-checked': draft.difficulty === d ? 'true' : 'false',
      onclick: () => { draft.difficulty = d; draft.difficultyTouched = true; paintDiff(); },
    }, h('span', { text: labelDifficulty(d) }), h('span', { class: 'chip-sub', text: `+${POINTS[d]}` }))));
  }
  function paintRepeat() {
    const options = [['none', 'Never'], ['daily', 'Every day'], ['weekdays', 'Weekdays'], ['days', 'Pick days']];
    repeatRow.replaceChildren(...options.map(([id, label]) => h('button', {
      type: 'button',
      class: `chip${draft.repeat === id ? ' is-selected' : ''}`,
      role: 'radio',
      'aria-checked': draft.repeat === id ? 'true' : 'false',
      onclick: () => { draft.repeat = id; paintRepeat(); },
    }, label)));
    dayRow.hidden = draft.repeat !== 'days';
    dayRow.replaceChildren(...WEEKDAY_LABELS.map((day) => h('button', {
      type: 'button',
      class: `chip${draft.days.includes(day.dow) ? ' is-selected' : ''}`,
      'aria-pressed': draft.days.includes(day.dow) ? 'true' : 'false',
      'aria-label': day.name,
      onclick: () => {
        if (draft.days.includes(day.dow)) draft.days = draft.days.filter((d) => d !== day.dow);
        else draft.days = [...draft.days, day.dow];
        if (!draft.days.length) draft.days = [day.dow];
        paintRepeat();
      },
    }, day.short)));
  }
  function syncRemindVisibility() {
    const has = Boolean(time.value);
    remindWrap.hidden = !has;
    draft.time = time.value;
  }
  time.addEventListener('input', () => {
    draft.time = time.value;
    if (draft.categoryId === 'class' && time.value && !draft.durationTouched && !duration.value) {
      draft.duration = 50;
      duration.value = '50';
    }
    syncRemindVisibility();
  });
  duration.addEventListener('input', () => {
    draft.durationTouched = true;
    draft.duration = duration.value === '' ? '' : Number(duration.value);
  });

  paintCats();
  paintDiff();
  paintRepeat();
  remindWrap.append(h('label', { class: 'field-label', for: 'field-remind', text: 'Remind me' }), remind);
  syncRemindVisibility();

  const scopeRow = inst?.repeating
    ? h('fieldset', { class: 'scope' },
      h('legend', { text: 'Apply changes' }),
      h('label', {}, h('input', { type: 'radio', name: 'scope', value: 'day', checked: 'true', onchange: () => { draft.scope = 'day'; } }), ' This day only'),
      h('label', {}, h('input', { type: 'radio', name: 'scope', value: 'all', onchange: () => { draft.scope = 'all'; } }), ' All repeats'))
    : null;

  sheet.append(
    h('h2', { text: inst ? 'Edit' : 'Add' }),
    h('label', { class: 'field-label', for: 'field-title', text: 'What?' }),
    title,
    error,
    h('p', { class: 'field-label', text: 'Type' }),
    catRow,
    h('p', { class: 'field-label', text: 'How hard?' }),
    diffRow,
    h('div', { class: 'split' },
      h('div', {}, h('label', { class: 'field-label', for: 'field-time', text: 'When?' }), time),
      h('div', {}, h('label', { class: 'field-label', for: 'field-duration', text: 'Duration' }), duration)),
    h('p', { class: 'field-label', text: 'Repeat' }),
    repeatRow,
    dayRow,
    remindWrap,
    h('label', { class: 'field-label', for: 'field-note', text: 'Note' }),
    note,
    scopeRow,
    h('div', { class: 'row-btns' },
      h('button', { type: 'button', class: 'btn primary', onclick: () => saveDraft(draft, inst) }, 'Save'),
      h('button', { type: 'button', class: 'btn ghost', onclick: closeSheet }, 'Cancel')),
  );
  if (inst) {
    const extras = h('div', { class: 'row-btns' });
    extras.append(h('button', { type: 'button', class: 'text-btn', onclick: () => moveInstance(inst).then(closeSheet) }, 'Move to tomorrow'));
    if (inst.repeating) {
      extras.append(h('button', { type: 'button', class: 'text-btn danger', onclick: () => deleteInstance(inst, 'day') }, 'Delete this day'));
      extras.append(h('button', { type: 'button', class: 'text-btn danger', onclick: () => deleteInstance(inst, 'all') }, 'Delete all'));
    } else {
      extras.append(h('button', { type: 'button', class: 'text-btn danger', onclick: () => deleteInstance(inst, 'all') }, 'Delete'));
    }
    sheet.append(extras);
  }
  wrap.append(backdrop, sheet);
  overlayEl().append(wrap);
  title.focus();
  sheetOpen = true;
}

function closeSheet() {
  clearInterval(closeSheet._t);
  document.getElementById('edit-sheet')?.remove();
  sheetOpen = false;
  document.body.classList.remove('sheet-open');
}

function colourRow(kind) {
  const s = S.settings;
  const theme = THEMES[s.theme] || THEMES.calm;
  const colours = kind === 'text' ? TEXT_COLOURS : BG_COLOURS;
  const current = normalizeHex(kind === 'text' ? s.textColor : s.bgColor);
  const themeHex = normalizeHex(kind === 'text' ? theme.text : theme.bg);
  const label = kind === 'text' ? 'Text' : 'Background';
  const row = h('div', { class: 'swatch-row' });
  row.append(h('button', {
    type: 'button',
    class: `swatch dot${current ? '' : ' is-selected'}`,
    'aria-label': `${label} colour from theme`,
    style: `background:${themeHex}`,
    onclick: async () => {
      if (kind === 'text') s.textColor = null;
      else s.bgColor = null;
      await persistAll();
      render();
    },
  }));
  for (const hex of colours) {
    row.append(h('button', {
      type: 'button',
      class: `swatch dot${current === hex ? ' is-selected' : ''}`,
      'aria-label': `${label} ${hex}`,
      style: `background:${hex}`,
      onclick: async () => {
        if (kind === 'text') s.textColor = hex;
        else s.bgColor = hex;
        await persistAll();
        render();
      },
    }));
  }
  const picker = h('input', {
    type: 'color',
    'aria-label': `Custom ${label.toLowerCase()} colour`,
    value: (current || themeHex).toLowerCase(),
  });
  picker.addEventListener('change', async () => {
    const hex = normalizeHex(picker.value);
    if (!hex) return;
    if (kind === 'text') s.textColor = hex;
    else s.bgColor = hex;
    await persistAll();
    render();
  });
  const customSelected = Boolean(current && !colours.includes(current));
  row.append(h('label', { class: `color-chip${customSelected ? ' is-selected' : ''}` }, picker));
  return row;
}

function contrastNote() {
  const painted = paintColors(S.settings, photoArg());
  if (painted.ok) return null;
  return h('div', { class: 'contrast-note', id: 'contrast-note', 'aria-live': 'polite' },
    h('span', { text: 'These colours are hard to read.' }),
    h('button', {
      type: 'button',
      class: 'text-btn',
      onclick: async () => {
        S.settings.textColor = fixTextColor(S.settings, photoArg());
        await persistAll();
        render();
      },
    }, 'Fix it'));
}

function renderCustomize() {
  const s = S.settings;
  const page = h('main', { class: 'shell settings' });
  page.append(h('header', { class: 'top-row' },
    h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Back', onclick: () => { S.screen = 'today'; render(); } }, icon(I.left)),
    h('h1', { class: 'setup-title', text: 'Customize' })));

  const title = h('input', { class: 'text-input', maxlength: '30', 'aria-label': 'Title', value: s.title || '' });
  title.addEventListener('input', () => { s.title = title.value.slice(0, 30); persistAll(); });

  page.append(h('section', {},
    h('h2', { text: 'Look' }),
    h('label', { class: 'field-label', text: 'Title' }),
    title,
    h('p', { class: 'field-label', text: 'Theme' }),
    h('div', { class: 'swatch-row' }, Object.entries(THEMES).map(([id, theme]) => h('button', {
      type: 'button',
      class: `swatch${s.theme === id ? ' is-selected' : ''}`,
      'aria-label': `${id} theme`,
      style: `background:${theme.bg}; color:${theme.text}`,
      onclick: async () => {
        s.theme = id;
        s.accent = theme.accent;
        s.textColor = null;
        s.bgColor = null;
        await persistAll();
        render();
      },
    }, h('span', { class: 'swatch-dot', style: `background:${theme.accent}` })))),
    h('p', { class: 'field-label', text: 'Text colour' }),
    colourRow('text'),
    h('p', { class: 'field-label', text: 'Background colour' }),
    colourRow('bg'),
    contrastNote(),
    h('p', { class: 'field-label', text: 'Accent colour' }),
    h('div', { class: 'swatch-row' }, ACCENTS.map((hex) => h('button', {
      type: 'button',
      class: `swatch accent${s.accent.toLowerCase() === hex.toLowerCase() ? ' is-selected' : ''}`,
      'aria-label': `Accent ${hex}`,
      style: `background:${hex}`,
      onclick: async () => { s.accent = hex; await persistAll(); render(); },
    }))),
    h('p', { class: 'field-label', text: 'Font' }),
    h('div', { class: 'chips' }, FONTS.map((font) => h('button', {
      type: 'button',
      class: `chip${s.font === font.id ? ' is-selected' : ''}`,
      onclick: async () => { s.font = font.id; await persistAll(); render(); },
    }, font.label))),
    h('p', { class: 'field-label', text: 'Format' }),
    h('div', { class: 'chips' }, ['list', 'timeline'].map((fmt) => h('button', {
      type: 'button',
      class: `chip${s.format === fmt ? ' is-selected' : ''}`,
      onclick: async () => { s.format = fmt; await persistAll(); render(); },
    }, fmt === 'list' ? 'List' : 'Timeline'))),
    h('p', { class: 'field-label', text: 'Celebrations' }),
    h('div', { class: 'chips' }, ['full', 'subtle', 'off'].map((c) => h('button', {
      type: 'button',
      class: `chip${s.celebrations === c ? ' is-selected' : ''}`,
      onclick: async () => { s.celebrations = c; await persistAll(); render(); },
    }, c[0].toUpperCase() + c.slice(1)))),
    h('label', { class: 'check-row' }, (() => {
      const box = h('input', { type: 'checkbox', 'aria-label': 'Sound' });
      box.checked = Boolean(s.sound);
      box.addEventListener('change', () => { s.sound = box.checked; persistAll(); });
      return box;
    })(), 'Sound')));

  const file = h('input', { type: 'file', accept: 'image/*', id: 'bg-file', class: 'sr-only' });
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f) openCropper(f);
    file.value = '';
  });
  const scrim = h('select', { id: 'photo-dim', 'aria-label': 'Photo dimming' });
  for (const [val, label] of [['auto', 'Auto'], ['dark', 'Dark'], ['light', 'Light']]) {
    const opt = h('option', { value: val, text: label });
    if ((s.photoScrim || 'auto') === val) opt.selected = true;
    scrim.append(opt);
  }
  scrim.addEventListener('change', async () => {
    s.photoScrim = scrim.value;
    await persistAll();
    render();
  });
  const blur = h('input', { type: 'range', id: 'photo-blur', min: '0', max: '12', step: '1', 'aria-label': 'Background blur', value: String(s.photoBlur || 0) });
  const blurVal = h('span', { class: 'num', text: String(s.photoBlur || 0) });
  blur.addEventListener('input', () => {
    s.photoBlur = Number(blur.value);
    blurVal.textContent = blur.value;
    applyChrome();
    persistAll();
  });
  page.append(h('section', { class: 'photo-settings' },
    h('h2', { text: 'Background photo' }),
    h('div', { class: 'stack' },
      h('label', { class: 'btn secondary', for: 'bg-file' }, photoUrl ? 'Change photo' : 'Add a photo'),
      file,
      photoUrl ? h('button', { type: 'button', class: 'text-btn danger', onclick: removePhoto }, 'Remove photo') : null),
    h('label', { class: 'field-label', for: 'photo-dim', text: 'Photo dimming' }),
    scrim,
    h('label', { class: 'field-label', for: 'photo-blur', text: 'Background blur' }),
    h('div', { class: 'split' }, blur, blurVal)));

  page.append(renderCategories());
  page.append(renderPlanSettings());
  page.append(renderReminderSettings());
  page.append(renderDataSettings());
  page.append(h('section', {},
    h('h2', { text: 'About' }),
    h('p', { text: `${PRODUCT_NAME} ${APP_VERSION}` }),
    h('p', { class: 'privacy', text: "Your planner lives on this device. We don't see your tasks. If you turn on reminders while the app is closed, only the reminder time and text are sent to our reminder service, and deleted after sending." }),
    h('p', { class: 'fine', text: 'Nunito, Inter, Lexend and Caveat are used under the SIL Open Font License. Icons in the app are original.' }),
    !isStandalone() ? h('button', { type: 'button', class: 'btn secondary', onclick: () => promptInstall() }, 'Install app') : null,
    h('button', { type: 'button', class: 'btn ghost', onclick: () => { S.screen = 'help'; render(); } }, 'Help')));
  return page;
}

function renderCategories() {
  const section = h('section', {});
  section.append(h('h2', { text: 'Categories' }));
  for (const cat of S.settings.categories) {
    const name = h('input', { class: 'text-input', 'aria-label': `Category name ${cat.name}`, value: cat.name, maxlength: '24' });
    name.addEventListener('change', () => { cat.name = name.value.trim() || cat.name; persistAll(); render(); });
    const emoji = h('input', { class: 'text-input emoji-input', 'aria-label': `Emoji for ${cat.name}`, value: cat.emoji, maxlength: '4' });
    emoji.addEventListener('change', () => { cat.emoji = emoji.value.trim() || cat.emoji; persistAll(); render(); });
    const colors = h('div', { class: 'swatches tiny' }, ACCENTS.map((hex) => h('button', {
      type: 'button',
      class: `swatch accent${cat.color.toLowerCase() === hex.toLowerCase() ? ' is-selected' : ''}`,
      'aria-label': `${cat.name} colour ${hex}`,
      style: `background:${hex}`,
      onclick: () => { cat.color = hex; persistAll(); render(); },
    })));
    const row = h('div', { class: 'cat-row' }, emoji, name);
    if (S.settings.categories.length > 1) {
      row.append(h('button', {
        type: 'button',
        class: 'text-btn danger',
        'aria-label': `Remove ${cat.name}`,
        onclick: () => removeCategory(cat.id),
      }, 'Remove'));
    }
    section.append(row, colors);
  }
  if (S.settings.categories.length < 8) {
    section.append(h('button', { type: 'button', class: 'btn secondary', onclick: addCategory }, 'Add category'));
  }
  return section;
}

function addCategory() {
  if (S.settings.categories.length >= 8) return;
  const n = S.settings.categories.length + 1;
  S.settings.categories.push({
    id: crypto.randomUUID(),
    name: `Category ${n}`,
    emoji: '⭐',
    color: ACCENTS[n % ACCENTS.length],
  });
  persistAll();
  render();
}

function removeCategory(id) {
  if (S.settings.categories.length <= 1) return;
  const fallback = S.settings.categories.find((c) => c.id !== id);
  S.settings.categories = S.settings.categories.filter((c) => c.id !== id);
  for (const task of S.tasks) if (task.categoryId === id) task.categoryId = fallback.id;
  persistAll();
  render();
}

function renderPlanSettings() {
  const s = S.settings;
  const goalMode = h('select', { 'aria-label': 'Daily goal' });
  for (const [val, label] of [['off', 'Off'], ['tasks', 'Finish N tasks'], ['points', 'Earn N points']]) {
    const opt = h('option', { value: val, text: label });
    if (s.dailyGoal.mode === val) opt.selected = true;
    goalMode.append(opt);
  }
  const goalN = h('input', { type: 'number', min: '1', max: '100', 'aria-label': 'Goal amount', value: String(s.dailyGoal.n || 5), class: 'text-input' });
  goalMode.addEventListener('change', () => { s.dailyGoal.mode = goalMode.value; persistAll(); render(); });
  goalN.addEventListener('change', () => { s.dailyGoal.n = Math.max(1, Number(goalN.value) || 1); persistAll(); });
  const dayStart = h('input', { type: 'time', 'aria-label': 'Day starts at', value: s.dayStart || '04:00', class: 'text-input' });
  dayStart.addEventListener('change', () => { s.dayStart = dayStart.value || '04:00'; persistAll(); render(); });
  return h('section', {},
    h('h2', { text: 'Plan' }),
    h('label', { class: 'field-label', text: 'Daily goal' }),
    goalMode,
    s.dailyGoal.mode === 'off' ? null : goalN,
    h('p', { class: 'field-label', text: 'Streak counts on' }),
    h('div', { class: 'chips' }, [
      ['everyday', 'Every day'],
      ['weekdays', 'Weekdays only'],
    ].map(([id, label]) => h('button', {
      type: 'button',
      class: `chip${s.streakMode === id ? ' is-selected' : ''}`,
      onclick: () => { s.streakMode = id; persistAll(); render(); },
    }, label))),
    h('label', { class: 'field-label', text: 'Day starts at' }),
    dayStart,
    h('p', { class: 'field-label', text: 'Week starts on' }),
    h('div', { class: 'chips' }, [['mon', 'Monday'], ['sun', 'Sunday']].map(([id, label]) => h('button', {
      type: 'button',
      class: `chip${s.weekStart === id ? ' is-selected' : ''}`,
      onclick: () => { s.weekStart = id; persistAll(); },
    }, label))),
    h('p', { class: 'field-label', text: 'Clock' }),
    h('div', { class: 'chips' }, [[false, '12 hour'], [true, '24 hour']].map(([val, label]) => h('button', {
      type: 'button',
      class: `chip${Boolean(s.clock24) === val ? ' is-selected' : ''}`,
      onclick: () => { s.clock24 = val; persistAll(); render(); },
    }, label))));
}

function renderReminderSettings() {
  const s = S.settings;
  const status = reminderStatus();
  const lead = h('select', { 'aria-label': 'Default lead time' });
  for (const [val, label] of [['0', 'At start'], ['5', '5 min'], ['10', '10 min'], ['15', '15 min'], ['30', '30 min'], ['60', '60 min']]) {
    const opt = h('option', { value: val, text: label });
    if (String(s.defaultLead) === val) opt.selected = true;
    lead.append(opt);
  }
  lead.addEventListener('change', () => { s.defaultLead = Number(lead.value); persistAll(); });
  const names = h('input', { type: 'checkbox', id: 'show-names' });
  names.checked = s.showNames !== false;
  names.addEventListener('change', () => {
    s.showNames = names.checked;
    S.reminders = S.reminders.filter((r) => r.snoozed || r.state !== 'scheduled');
    refreshReminderRecords();
    persistAll();
    syncPush();
  });
  const morning = h('input', { type: 'checkbox', 'aria-label': 'Morning check-in' });
  morning.checked = Boolean(s.morningCheckin?.on);
  const morningTime = h('input', { type: 'time', 'aria-label': 'Morning check-in time', value: s.morningCheckin?.time || '08:00', class: 'text-input' });
  morning.addEventListener('change', () => { s.morningCheckin.on = morning.checked; persistAll(); syncPush(); });
  morningTime.addEventListener('change', () => { s.morningCheckin.time = morningTime.value || '08:00'; persistAll(); syncPush(); });
  const turnOn = status.code === 'off' && Notification.permission !== 'denied'
    ? h('button', { type: 'button', class: 'btn secondary', onclick: async () => { await turnOnReminders(); render(); } }, 'Turn on')
    : null;
  return h('section', {},
    h('h2', { text: 'Reminders' }),
    h('p', { id: 'reminder-status', dataset: { status: status.code }, text: status.text }),
    status.code === 'blocked' ? h('p', { class: 'fine', text: 'In your browser settings, allow notifications for this site.' }) : null,
    turnOn,
    h('label', { class: 'field-label', text: 'Default lead time' }),
    lead,
    h('label', { class: 'check-row' }, names, 'Show task names in notifications'),
    h('label', { class: 'check-row' }, morning, 'Morning check-in'),
    morningTime,
    h('button', { type: 'button', class: 'btn ghost', onclick: testReminder }, 'Test reminder'));
}

function testReminder() {
  const record = {
    id: `test:${currentMs()}`,
    title: 'Test reminder',
    body: 'Reminders usually arrive on time.',
    taskId: null,
    date: plannerToday(),
    fireAtUTC: currentDate().toISOString(),
    state: 'delivered',
  };
  showBanner(record);
  if (Notification.permission === 'granted') systemNotify(record);
  else announce('Test reminder');
}

function renderDataSettings() {
  const include = h('input', { type: 'checkbox', id: 'include-photo' });
  include.checked = true;
  const file = h('input', { type: 'file', accept: 'application/json,.json', id: 'restore-file', class: 'sr-only' });
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (f) confirmRestore(f);
    file.value = '';
  });
  const last = S.settings.lastBackup ? formatDayLabel(plannerDate(new Date(S.settings.lastBackup), S.settings.dayStart)) : 'Not yet';
  return h('section', {},
    h('h2', { text: 'Your data' }),
    h('p', { text: `Last backup: ${last}` }),
    h('label', { class: 'check-row' }, include, 'Include background photo'),
    h('button', { type: 'button', class: 'btn secondary', onclick: () => downloadBackup(include.checked) }, 'Back up now'),
    h('label', { class: 'btn ghost', for: 'restore-file', text: 'Restore from backup' }),
    file,
    h('button', { type: 'button', class: 'text-btn danger', onclick: confirmErase }, 'Erase everything'));
}

async function downloadBackup(includePhoto) {
  const data = {
    version: 1,
    app: PRODUCT_NAME,
    exportedAt: currentDate().toISOString(),
    tasks: S.tasks,
    overrides: S.overrides,
    completions: S.completions,
    bonuses: S.bonuses,
    settings: S.settings,
    reminders: S.reminders.filter((r) => r.state !== 'delivered'),
  };
  if (includePhoto && S.background?.blob) {
    data.photo = {
      brightness: S.background.brightness ?? null,
      scrim: S.settings.photoScrim,
      blur: S.settings.photoBlur,
      dataUrl: await blobToDataURL(S.background.blob),
    };
  }
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  const name = `student-planner-backup-${plannerToday()}.json`;
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  S.settings.lastBackup = currentDate().toISOString();
  await persistAll();
  if (S.screen === 'customize') render();
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function confirmRestore(file) {
  const wrap = h('div', { class: 'sheet-wrap', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Restore backup' },
    h('button', { type: 'button', class: 'sheet-backdrop', 'aria-label': 'Cancel', onclick: () => wrap.remove() }),
    h('div', { class: 'sheet' },
      h('h2', { text: 'Restore this backup?' }),
      h('p', { text: 'This replaces the planner on this device.' }),
      h('div', { class: 'row-btns' },
        h('button', { type: 'button', class: 'btn primary', onclick: () => { wrap.remove(); restoreFile(file); } }, 'Restore'),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => wrap.remove() }, 'Cancel'))));
  overlayEl().append(wrap);
}

async function restoreFile(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || data.version !== 1 || !Array.isArray(data.tasks)) throw new Error('bad file');
    S.tasks = data.tasks;
    S.overrides = data.overrides || [];
    S.completions = data.completions || [];
    S.bonuses = data.bonuses || [];
    S.settings = mergeSettings(data.settings || {});
    S.settings.setupComplete = true;
    S.reminders = data.reminders || [];
    if (data.photo?.dataUrl) {
      const res = await fetch(data.photo.dataUrl);
      const blob = await res.blob();
      S.background = { id: 'current', blob, brightness: data.photo.brightness };
      if (data.photo.scrim) S.settings.photoScrim = data.photo.scrim;
      if (data.photo.blur != null) S.settings.photoBlur = data.photo.blur;
    }
    refreshPhotoUrl();
    noteHighWater();
    await persistAll();
    S.screen = 'today';
    render();
    announce('Backup restored');
  } catch {
    overlayEl().append(h('div', { class: 'sheet-wrap', role: 'dialog', 'aria-label': 'Backup problem' },
      h('div', { class: 'sheet' },
        h('h2', { text: "That file doesn't look like a Dayli backup." }),
        h('button', { type: 'button', class: 'btn primary', onclick: (e) => e.target.closest('.sheet-wrap').remove() }, 'OK'))));
  }
}

function confirmErase() {
  const wrap = h('div', { class: 'sheet-wrap', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Erase everything' },
    h('button', { type: 'button', class: 'sheet-backdrop', 'aria-label': 'Cancel', onclick: () => wrap.remove() }),
    h('div', { class: 'sheet' },
      h('h2', { text: 'Erase everything?' }),
      h('p', { text: 'Your tasks, points and photo would be cleared from this device.' }),
      h('div', { class: 'row-btns' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => wrap.remove() }, 'Keep my planner'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => { wrap.remove(); confirmErase2(); } }, 'Continue'))));
  overlayEl().append(wrap);
}

function confirmErase2() {
  const wrap = h('div', { class: 'sheet-wrap', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Confirm erase' },
    h('button', { type: 'button', class: 'sheet-backdrop', 'aria-label': 'Cancel', onclick: () => wrap.remove() }),
    h('div', { class: 'sheet' },
      h('h2', { text: 'This can’t be undone.' }),
      h('div', { class: 'row-btns' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => wrap.remove() }, 'Cancel'),
        h('button', { type: 'button', class: 'text-btn danger', onclick: () => { wrap.remove(); eraseAll(); } }, 'Erase now'))));
  overlayEl().append(wrap);
}

async function eraseAll() {
  await db.eraseDatabase();
  S.tasks = [];
  S.overrides = [];
  S.completions = [];
  S.bonuses = [];
  S.reminders = [];
  S.background = null;
  S.settings = defaultSettings();
  S.screen = 'today';
  viewDate = null;
  refreshPhotoUrl();
  if (photoUrl) { URL.revokeObjectURL(photoUrl); photoUrl = null; }
  render();
}

async function removePhoto() {
  S.background = null;
  refreshPhotoUrl();
  await persistAll();
  render();
}

function promptInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt = null;
    return;
  }
  const kind = deviceKind();
  const text = kind === 'ios'
    ? 'In Safari, tap Share, then Add to Home Screen, turn on Open as Web App, and tap Add.'
    : 'Open the browser menu and choose Install app or Add to Home Screen.';
  overlayEl().append(h('div', { class: 'sheet-wrap', role: 'dialog', 'aria-label': 'Install' },
    h('div', { class: 'sheet' },
      h('h2', { text: 'Install app' }),
      h('p', { text }),
      h('button', { type: 'button', class: 'btn primary', onclick: (e) => e.target.closest('.sheet-wrap').remove() }, 'OK'))));
}

function renderHelp() {
  return h('main', { class: 'shell settings' },
    h('header', { class: 'top-row' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Back', onclick: () => { S.screen = 'customize'; render(); } }, icon(I.left)),
      h('h1', { class: 'setup-title', text: 'Quick guide' })),
    h('section', { class: 'help' },
      h('h2', { text: 'Points' }),
      h('p', { text: 'Easy is +5, medium is +10, hard is +20. Finishing every task in a day with at least two of them adds +10.' }),
      h('h2', { text: 'Levels' }),
      h('p', { text: 'Points add up. Level 2 is 40 points, level 5 is 280, level 10 is 1,180. Levels never go down.' }),
      h('h2', { text: 'Streaks' }),
      h('p', { text: 'Finish at least one task and the day counts. The day rolls over at 4:00 AM, unless you change it. You get one rest day each week. A second missed day that week starts the streak over, quietly. Your best streak stays.' }),
      h('h2', { text: 'Backup' }),
      h('p', { text: 'Customize, then Back up now, saves a file on your device. Restore brings it back. A Home Screen install is the safest place to keep your planner on iPhone.' })));
}

function renderToast() {
  let toast = document.getElementById('toast');
  if (!toastText) {
    toast?.remove();
    return;
  }
  if (!toast) {
    toast = h('div', { id: 'toast', class: 'toast', role: 'status' });
    overlayEl().append(toast);
  }
  toast.replaceChildren(
    h('span', { text: toastText }),
    h('button', {
      type: 'button',
      onclick: async () => {
        const fn = undoFn;
        undoFn = null;
        toastText = '';
        clearTimeout(undoTimer);
        renderToast();
        if (fn) await fn();
      },
    }, 'Undo'),
  );
}

function renderOverlayBits() {
  renderToast();
  let bar = document.getElementById('banner');
  if (!banner) bar?.remove();
  else {
    if (!bar) {
      bar = h('div', { id: 'banner', class: 'banner', role: 'status' });
      overlayEl().append(bar);
    }
    const record = banner;
    const snoozeMenu = h('div', { class: 'snooze-menu', hidden: 'true' },
      h('button', { type: 'button', onclick: () => snoozeRecord(record, 5) }, 'Snooze 5 min'),
      h('button', { type: 'button', onclick: () => snoozeRecord(record, 30) }, 'Snooze 30 min'));
    const snoozeBtn = h('button', { type: 'button', class: 'btn small secondary' }, 'Snooze 10 min');
    let hold = null;
    snoozeBtn.addEventListener('pointerdown', () => {
      hold = setTimeout(() => { snoozeMenu.hidden = false; }, 500);
    });
    const clearHold = () => clearTimeout(hold);
    snoozeBtn.addEventListener('pointerup', clearHold);
    snoozeBtn.addEventListener('pointerleave', clearHold);
    snoozeBtn.addEventListener('click', () => {
      if (!snoozeMenu.hidden) return;
      snoozeRecord(record, 10);
    });
    snoozeBtn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); snoozeMenu.hidden = false; }
    });
    bar.replaceChildren(
      h('div', {}, h('strong', { text: record.title || 'Coming up' }), h('p', { text: record.body || '' })),
      h('div', { class: 'row-btns' },
        h('button', { type: 'button', class: 'btn small', onclick: () => bannerDone(record) }, 'Done'),
        snoozeBtn,
        snoozeMenu),
    );
  }
  let day = document.getElementById('day-card');
  if (!dayCard) day?.remove();
  else if (!day) {
    day = h('div', { id: 'day-card', class: 'day-card', role: 'dialog', 'aria-label': 'Day complete' });
    day.append(
      h('h2', { text: 'Day complete! 🎉' }),
      h('p', { text: '+10 bonus' }),
      h('p', { text: `🔥 ${dayCard.streak}-day streak` }),
      h('button', { type: 'button', class: 'btn primary', id: 'day-nice', onclick: () => { dayCard = null; renderOverlayBits(); } }, 'Nice'),
    );
    overlayEl().append(day);
  }
  let pop = document.getElementById('level-pop');
  if (!levelPop) pop?.remove();
  else if (!pop) {
    pop = h('button', {
      type: 'button',
      id: 'level-pop',
      class: 'level-pop',
      onclick: () => { levelPop = null; clearTimeout(openLevelPop.timer); renderOverlayBits(); },
    }, `Level ${levelPop.level} · ${levelPop.title}`);
    overlayEl().append(pop);
  }
}

function openCropper(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const vw = 280;
    const vh = 320;
    const cover = Math.max(vw / img.width, vh / img.height);
    let scale = cover;
    let x = (vw - img.width * scale) / 2;
    let y = (vh - img.height * scale) / 2;
    const base = { scale, x, y };
    const viewport = h('div', { class: 'crop-view' });
    const pic = h('img', { alt: '', src: url, draggable: 'false' });
    viewport.append(pic);
    function draw() {
      pic.style.width = `${img.width * scale}px`;
      pic.style.height = `${img.height * scale}px`;
      pic.style.transform = `translate(${x}px, ${y}px)`;
    }
    draw();
    let last = null;
    viewport.addEventListener('pointerdown', (e) => {
      last = { cx: e.clientX, cy: e.clientY, x, y };
      viewport.setPointerCapture(e.pointerId);
    });
    viewport.addEventListener('pointermove', (e) => {
      if (!last) return;
      x = last.x + (e.clientX - last.cx);
      y = last.y + (e.clientY - last.cy);
      draw();
    });
    viewport.addEventListener('pointerup', () => { last = null; });
    const zoom = h('input', {
      type: 'range', min: '1', max: '4', step: '0.01', value: '1', 'aria-label': 'Zoom',
    });
    zoom.addEventListener('input', () => {
      const next = cover * Number(zoom.value);
      const cx = vw / 2;
      const cy = vh / 2;
      const ix = (cx - x) / scale;
      const iy = (cy - y) / scale;
      scale = next;
      x = cx - ix * scale;
      y = cy - iy * scale;
      draw();
    });
    const wrap = h('div', { class: 'sheet-wrap', id: 'cropper', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Crop photo' },
      h('div', { class: 'sheet' },
        h('h2', { text: 'Crop photo' }),
        viewport,
        zoom,
        h('div', { class: 'row-btns' },
          h('button', {
            type: 'button',
            class: 'btn ghost',
            onclick: () => { scale = base.scale; x = base.x; y = base.y; zoom.value = '1'; draw(); },
          }, 'Reset'),
          h('button', { type: 'button', class: 'btn ghost', onclick: () => { URL.revokeObjectURL(url); wrap.remove(); } }, 'Cancel'),
          h('button', { type: 'button', class: 'btn primary', onclick: () => saveCrop() }, 'Save photo'))));
    function saveCrop() {
      let sx = -x / scale;
      let sy = -y / scale;
      let sw = vw / scale;
      let sh = vh / scale;
      if (sx < 0) { sw += sx; sx = 0; }
      if (sy < 0) { sh += sy; sy = 0; }
      sw = Math.min(sw, img.width - sx);
      sh = Math.min(sh, img.height - sy);
      const long = Math.max(sw, sh);
      const factor = Math.min(1, 1600 / long);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(sw * factor));
      canvas.height = Math.max(1, Math.round(sh * factor));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      const sample = document.createElement('canvas');
      sample.width = 16;
      sample.height = 16;
      const sctx = sample.getContext('2d', { willReadFrequently: true });
      sctx.drawImage(canvas, 0, 0, 16, 16);
      const data = sctx.getImageData(0, 0, 16, 16).data;
      let lum = 0;
      const count = data.length / 4;
      for (let i = 0; i < data.length; i += 4) {
        lum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      }
      const brightness = lum / count;
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        S.background = { id: 'current', blob, brightness, width: canvas.width, height: canvas.height };
        refreshPhotoUrl();
        await persistAll();
        URL.revokeObjectURL(url);
        wrap.remove();
        render();
      }, 'image/jpeg', 0.8);
    }
    overlayEl().append(wrap);
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}

function closeTop() {
  if (document.getElementById('cropper')) { document.getElementById('cropper').remove(); return; }
  if (document.getElementById('edit-sheet')) { closeSheet(); return; }
  const sheet = overlayEl().querySelector('.sheet-wrap');
  if (sheet) { sheet.remove(); return; }
  if (dayCard) { dayCard = null; renderOverlayBits(); return; }
  if (levelPop) { levelPop = null; renderOverlayBits(); }
}

async function handleLaunchParams() {
  const params = new URLSearchParams(location.search);
  const action = params.get('action');
  const taskId = params.get('task');
  const date = params.get('date');
  if (!action) return;
  history.replaceState({}, '', location.pathname);
  if (action === 'done' && taskId && date) {
    const inst = findInstance(taskId, date);
    if (inst) await completeInstance(inst);
  } else if (action === 'snooze' && taskId && date) {
    const record = S.reminders.find((r) => r.taskId === taskId && r.date === date) || {
      id: `${taskId}:${date}:open`,
      taskId,
      date,
      title: 'Coming up',
      body: '',
      state: 'scheduled',
    };
    snoozeRecord(record, 10);
    if (!S.reminders.includes(record)) S.reminders.push(record);
  } else if (taskId && date) {
    const inst = findInstance(taskId, date);
    viewDate = date === plannerToday() ? null : date;
    render();
    if (inst) {
      showBanner({
        id: `open:${taskId}:${date}`,
        taskId,
        date,
        title: S.settings.showNames === false ? 'Coming up' : inst.title,
        body: reminderText({
          title: inst.title,
          time: inst.time,
          note: inst.note,
          showNames: S.settings.showNames !== false,
          clock24: S.settings.clock24,
        }).body,
        state: 'delivered',
      });
    }
  }
}

async function boot() {
  const loaded = await db.loadAll();
  S.tasks = loaded.tasks;
  S.overrides = loaded.overrides;
  S.completions = loaded.completions;
  S.bonuses = loaded.bonuses;
  S.settings = mergeSettings(loaded.settings);
  S.reminders = loaded.reminders;
  S.background = loaded.background;
  S.screen = 'today';
  if (S.settings.persistResult == null && navigator.storage?.persist) {
    try { S.settings.persistResult = await navigator.storage.persist(); } catch { S.settings.persistResult = false; }
    await db.put('settings', S.settings);
  } else if (S.settings.persistResult == null) {
    S.settings.persistResult = false;
    await db.put('settings', S.settings);
  }
  refreshPhotoUrl();
  noteHighWater();
  sessionStarted = currentMs();
  for (const r of S.reminders) {
    if (r.state === 'scheduled' && Date.parse(r.fireAtUTC) < sessionStarted) r.state = 'missed';
  }
  refreshReminderRecords();
  await persistAll();
  render();
  await handleLaunchParams();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkDue();
    render();
  });
  setInterval(checkDue, 30_000);
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    if (!S.settings.setupComplete && S.settings.setupStep === 2) render();
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type !== 'notification') return;
      const url = new URL(location.href);
      url.searchParams.set('action', event.data.action || 'open');
      if (event.data.data?.taskId) url.searchParams.set('task', event.data.data.taskId);
      if (event.data.data?.date) url.searchParams.set('date', event.data.data.date);
      location.assign(url.href);
    });
  }
  window.__dayli = {
    model,
    push,
    getState: () => ({
      tasks: S.tasks,
      overrides: S.overrides,
      completions: S.completions,
      bonuses: S.bonuses,
      settings: S.settings,
      reminders: S.reminders,
      viewed: viewedYMD(),
      plannerToday: plannerToday(),
      background: S.background ? { width: S.background.width, height: S.background.height, brightness: S.background.brightness } : null,
    }),
    checkReminders: () => { checkDue(); },
    buildUpcoming: () => upcomingReminders({
      tasks: S.tasks,
      overrides: S.overrides,
      settings: S.settings,
      now: currentDate(),
      showNames: S.settings.showNames !== false,
    }),
  };
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeTop();
});

boot().catch((err) => {
  console.error(err);
  const root = appEl();
  if (root) root.textContent = 'Dayli couldn’t open storage in this browser.';
});
