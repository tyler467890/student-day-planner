import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, plannerDate, levelForPoints, levelBounds, levelTitle, computeStreak,
  instancesOn, upcomingReminders, reminderText, headerContrast, cardContrast,
  THEMES, ACCENTS, TEXT_COLOURS, BG_COLOURS, contrastRatio, onAccent, POINTS, defaultSettings,
  paintColors, fixTextColor, migrateSettings, hexToRgb, relativeLuminance, normalizePet,
  occursOn, repeatFromDays, formatDaySelection, formatTimeRange, minutesBetween,
  hsvToHex, hexToHsv, wheelPointToHs, hsToWheelPoint, COLOUR_WHEEL_SIZE,
  weekStartOf, zonedDateTime, goalMet, earliestStoredDate, defaultCategories, defaultDifficulty,
} from '../js/model.js';
import { pickCelebration, signatureLabel } from '../js/celebrations.js';

test('planner date changes at local midnight', () => {
  const late = new Date(2026, 8, 21, 23, 30, 0);
  const early = new Date(2026, 8, 22, 0, 10, 0);
  const stillNight = new Date(2026, 8, 22, 3, 30, 0);
  assert.equal(plannerDate(late), '2026-09-21');
  assert.equal(plannerDate(early), '2026-09-22');
  assert.equal(plannerDate(stillNight, '04:00'), '2026-09-22');
  const at = zonedDateTime('2026-09-22', '02:00', '04:00');
  assert.equal(at.getDate(), 22);
  assert.equal(at.getHours(), 2);
});

test('level thresholds match the table', () => {
  const points = [0, 39, 40, 99, 100, 179, 180, 279, 280, 399, 400, 549, 550, 729, 730, 939, 940, 1179, 1180, 1479, 1480, 1779, 1780];
  const levels = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12];
  points.forEach((pts, i) => assert.equal(levelForPoints(pts), levels[i], `points ${pts}`));
  assert.equal(levelBounds(1).next, 40);
  assert.equal(levelBounds(10).start, 1180);
  assert.equal(levelBounds(10).next, 1480);
  assert.equal(levelBounds(11).start, 1480);
  assert.equal(levelTitle(1), 'Starter');
  assert.equal(levelTitle(5), 'Steady');
  assert.equal(levelTitle(10), 'Focused');
  assert.equal(levelTitle(15), 'Unstoppable');
  assert.equal(levelTitle(20), 'Legend');
});

test('points by difficulty', () => {
  assert.deepEqual(POINTS, { easy: 5, medium: 10, hard: 20 });
});

test('streak: one task counts, rest day, second miss resets, best kept', () => {
  const mondayTuesday = ['2026-09-21', '2026-09-22'];
  const quiet = computeStreak(mondayTuesday, '2026-09-25', {});
  assert.equal(quiet.streak, 0);
  assert.equal(quiet.best, 2);
  assert.ok(quiet.restDays.includes('2026-09-23'));

  const stillOpen = computeStreak(['2026-09-21', '2026-09-22', '2026-09-23'], '2026-09-24', {});
  assert.equal(stillOpen.streak, 3);

  const restarted = computeStreak(['2026-09-21', '2026-09-22', '2026-09-25'], '2026-09-25', {});
  assert.equal(restarted.streak, 1);
  assert.equal(restarted.best, 2);
});

test('streak uses one rest day then continues', () => {
  const info = computeStreak(['2026-09-21', '2026-09-22', '2026-09-24'], '2026-09-24', {});
  assert.equal(info.streak, 3);
  assert.deepEqual(info.restDays, ['2026-09-23']);
});

test('rest weeks follow the install weekday', () => {
  const dates = ['2026-09-19', '2026-09-22'];
  const monday = computeStreak(dates, '2026-09-23', { weekAnchor: 1 });
  assert.equal(monday.streak, 2);
  const wednesday = computeStreak(dates, '2026-09-23', { weekAnchor: 3 });
  assert.equal(wednesday.streak, 1);
});

test('week starts on the weekday of the first-run date', () => {
  assert.equal(weekStartOf('2026-09-25', '2026-09-23'), '2026-09-23');
  assert.equal(weekStartOf('2026-09-22', '2026-09-23'), '2026-09-16');
  assert.equal(weekStartOf('2026-09-25', null), '2026-09-21');
});

test('daily goal is finishing every task scheduled that day', () => {
  const a = { instanceId: 'a' };
  const b = { instanceId: 'b' };
  assert.equal(goalMet({}, [], []), false);
  assert.equal(goalMet({}, [a], []), false);
  assert.equal(goalMet({}, [a], [{ instanceId: 'a' }]), true);
  assert.equal(goalMet({ dailyGoal: { mode: 'off', n: 5 } }, [a, b], [{ instanceId: 'a' }, { instanceId: 'b' }]), true);
  assert.equal(goalMet({ dailyGoal: { mode: 'tasks', n: 1 } }, [a, b], [{ instanceId: 'a' }]), false);
});

test('new planners start with one category and an empty first-run date', () => {
  const cats = defaultCategories();
  assert.equal(cats.length, 1);
  assert.equal(cats[0].name, 'My goals');
  assert.equal(defaultSettings().installedOn, null);
  assert.equal(defaultSettings().categories.length, 1);
  assert.equal(defaultDifficulty('class'), 'medium');
  assert.equal(defaultDifficulty('goals'), 'easy');
  const fresh = migrateSettings({ categories: [], schemaVersion: 2 });
  assert.equal(fresh.categories[0].name, 'My goals');
  const kept = migrateSettings({
    schemaVersion: 2,
    categories: [{ id: 'class', name: 'Class', emoji: '📚', color: '#1A8CFF' }],
  });
  assert.equal(kept.categories.length, 1);
  assert.equal(kept.categories[0].name, 'Class');
});

test('first stored planner date is the earliest task, completion, or bonus', () => {
  const ymd = earliestStoredDate(
    [{ date: '2026-09-10', createdAt: '2026-01-01T00:00:00.000Z' }],
    [{ completedOn: '2026-09-08', date: '2026-09-02' }],
    [{ date: '2026-09-04' }],
  );
  assert.equal(ymd, '2026-09-02');
  assert.equal(earliestStoredDate([], [], []), null);
});

test('weekdays-only ignores Saturday and Sunday', () => {
  const friday = '2026-09-25';
  const monday = '2026-09-28';
  const overWeekend = computeStreak([friday], monday, { weekdaysOnly: true });
  assert.equal(overWeekend.streak, 1);
  assert.deepEqual(overWeekend.restDays, []);

  const missedMonday = computeStreak([friday], '2026-09-29', { weekdaysOnly: true });
  assert.equal(missedMonday.streak, 1);
  assert.deepEqual(missedMonday.restDays, ['2026-09-28']);

  const everydayWeekend = computeStreak([friday], monday, { weekdaysOnly: false });
  assert.equal(everydayWeekend.streak, 0);
});

test('streak milestones', () => {
  let d = '2026-01-05';
  const dates = [];
  for (let i = 0; i < 7; i += 1) {
    dates.push(d);
    d = addDays(d, 1);
  }
  const info = computeStreak(dates, dates[6], {});
  assert.equal(info.streak, 7);
  assert.ok(info.milestones.some((m) => m.days === 3 && m.points === 15));
  assert.ok(info.milestones.some((m) => m.days === 7 && m.points === 25));
});

test('repeating classes appear on chosen days only', () => {
  const task = {
    id: 'bio',
    title: 'Biology 101',
    categoryId: 'class',
    difficulty: 'medium',
    date: '2026-09-21',
    repeat: 'days',
    days: [1, 3, 5],
    time: '09:00',
    remindLeadMin: 10,
  };
  assert.equal(instancesOn('2026-09-21', [task], []).length, 1);
  assert.equal(instancesOn('2026-09-23', [task], []).length, 1);
  assert.equal(instancesOn('2026-09-25', [task], []).length, 1);
  assert.equal(instancesOn('2026-09-22', [task], []).length, 0);
  assert.equal(instancesOn('2026-09-24', [task], []).length, 0);
});

test('just this day edit does not change other days', () => {
  const task = {
    id: 'bio', title: 'Biology 101', categoryId: 'class', difficulty: 'medium',
    date: '2026-09-21', repeat: 'days', days: [1, 3, 5], time: '09:00', remindLeadMin: 10,
  };
  const overrides = [{
    id: 'bio:2026-09-21', taskId: 'bio', date: '2026-09-21', skipped: false, movedTo: null,
    edits: { title: 'Biology lab' },
  }];
  assert.equal(instancesOn('2026-09-21', [task], overrides)[0].title, 'Biology lab');
  assert.equal(instancesOn('2026-09-23', [task], overrides)[0].title, 'Biology 101');
});

test('hidden task names never include the title', () => {
  const secret = 'Biology 101';
  const settings = defaultSettings();
  settings.showNames = false;
  settings.morningCheckin = { on: true, time: '08:00' };
  const task = {
    id: 't1', title: secret, categoryId: 'class', difficulty: 'medium',
    date: '2026-09-25', repeat: 'none', time: '10:30', remindLeadMin: 10, note: 'Room 204',
  };
  const now = new Date(2026, 8, 25, 9, 0, 0);
  const list = upcomingReminders({
    tasks: [task], overrides: [], settings, now, showNames: false,
  });
  const blob = JSON.stringify(list);
  assert.equal(blob.includes(secret), false);
  assert.equal(blob.includes('Room 204'), false);
  assert.ok(list.some((item) => item.title === 'Coming up'));
  const text = reminderText({ title: secret, time: '10:30', note: 'Room 204', showNames: false, clock24: false });
  assert.equal(text.title, 'Coming up');
  assert.equal(JSON.stringify(text).includes(secret), false);
});

test('shown task names include the title and start time', () => {
  const text = reminderText({ title: 'Biology 101', time: '10:30', note: 'Room 204', showNames: true, clock24: false });
  assert.equal(text.title, 'Biology 101');
  assert.match(text.body, /10:30/);
  assert.match(text.body, /Room 204/);
});

test('scrim keeps header and card text at 4.5:1 on white and black photos', () => {
  for (const photo of ['#FFFFFF', '#000000']) {
    for (const mode of ['dark', 'light']) {
      const header = headerContrast(photo, mode);
      assert.ok(header.ratio >= 4.5, `${mode} scrim on ${photo} header ${header.ratio}`);
    }
    for (const theme of Object.values(THEMES)) {
      const card = cardContrast(theme, photo);
      assert.ok(card.textRatio >= 4.5, `card text ${card.textRatio}`);
      assert.ok(card.mutedRatio >= 4.5, `card muted ${card.mutedRatio}`);
    }
  }
});

test('accent swatches have a readable on-accent colour', () => {
  for (const hex of ACCENTS) {
    const ink = onAccent(hex);
    assert.ok(contrastRatio(hex, ink) >= 4.5, hex);
  }
});

function saturation(hex) {
  const { r, g, b } = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

test('themes stay named and are more vivid, with night still dark', () => {
  assert.deepEqual(Object.keys(THEMES), ['calm', 'mint', 'sunset', 'ocean', 'blossom', 'night']);
  for (const [id, theme] of Object.entries(THEMES)) {
    assert.ok(contrastRatio(theme.text, theme.bg) >= 4.5, `${id} text`);
    assert.ok(contrastRatio(theme.muted, theme.surface) >= 4.5, `${id} muted`);
    assert.ok(contrastRatio(theme.accent, theme.onAccent) >= 4.5, `${id} accent`);
    const painted = paintColors({ theme: id });
    assert.equal(painted.ok, true, `${id} paint ${painted.ratio}`);
    if (id === 'night') {
      assert.ok(relativeLuminance(theme.bg) < 0.05, 'night stays dark');
      assert.ok(relativeLuminance(theme.accent) > relativeLuminance('#8B8CF6'), 'night accent is brighter');
    } else {
      assert.ok(saturation(theme.bg) >= 0.12, `${id} background is vivid`);
      assert.ok(saturation(theme.accent) >= 0.65, `${id} accent is saturated`);
    }
  }
});

test('text and background palettes are compact bright sets', () => {
  assert.ok(TEXT_COLOURS.length >= 16 && TEXT_COLOURS.length <= 24);
  assert.ok(BG_COLOURS.length >= 16 && BG_COLOURS.length <= 24);
  assert.equal(new Set(TEXT_COLOURS).size, TEXT_COLOURS.length);
  assert.equal(new Set(BG_COLOURS).size, BG_COLOURS.length);
});

test('new pets celebrate with the signature move selected', () => {
  const pet = normalizePet({});
  assert.equal(defaultSettings().sound, true);
  assert.ok(pet.celebrations.includes('signature'));
  assert.ok(pet.celebrations.includes('dance'));
  assert.equal(signatureLabel('dog'), 'Tail wag');
  assert.equal(signatureLabel('lion'), 'Roar');
  assert.equal(signatureLabel('chick'), 'Wing flap');
  const kept = normalizePet({ animal: 'fox', celebrations: ['cheer', 'nope', 'cheer'] });
  assert.deepEqual(kept.celebrations, ['cheer']);
  assert.deepEqual(normalizePet({ celebrations: [] }).celebrations, ['signature']);
  assert.equal(pickCelebration(['dance', 'stars'], () => 0), 'dance');
  assert.equal(pickCelebration(['dance', 'stars'], () => 0.99), 'stars');
});

test('low contrast text is reported and fixed to a readable shade', () => {
  const settings = { theme: 'calm', bgColor: '#FFF6D8', textColor: '#FFF3B0' };
  const before = paintColors(settings);
  assert.equal(before.ok, false);
  assert.ok(before.ratio < 4.5);
  const fixed = fixTextColor(settings);
  const after = paintColors({ ...settings, textColor: fixed });
  assert.equal(after.bg, '#FFF6D8');
  assert.equal(after.ok, true, `fixed ${fixed} ratio ${after.ratio}`);
  const { r, g, b } = hexToRgb(fixed);
  assert.ok(r > b && g > b, `shade stays warm ${fixed}`);
  const already = paintColors({ theme: 'blossom' });
  assert.equal(fixTextColor({ theme: 'blossom', textColor: already.text }), already.text);
});

test('a v1 save keeps its theme, accent, and categories', () => {
  const v1 = {
    id: 'main',
    title: "Sam's Day",
    theme: 'ocean',
    accent: '#1D63B8',
    font: 'lexend',
    format: 'timeline',
    celebrations: 'full',
    sound: false,
    dayStart: '04:00',
    weekStart: 'mon',
    clock24: true,
    streakMode: 'everyday',
    dailyGoal: { mode: 'points', n: 30 },
    defaultLead: 15,
    showNames: false,
    morningCheckin: { on: true, time: '07:30' },
    setupComplete: true,
    setupStep: 3,
    photoScrim: 'dark',
    photoBlur: 4,
    schemaVersion: 1,
    categories: [
      { id: 'class', name: 'Lecture', emoji: '📚', color: '#1D63B8' },
    ],
  };
  const next = migrateSettings(v1);
  assert.equal(next.schemaVersion, 2);
  assert.equal(next.textColor, null);
  assert.equal(next.bgColor, null);
  assert.equal(next.theme, 'ocean');
  assert.equal(next.accent, '#1D63B8');
  assert.equal(next.title, "Sam's Day");
  assert.equal(next.font, 'nunito');
  assert.equal(next.format, 'list');
  assert.equal(next.clock24, false);
  assert.equal(next.showNames, false);
  assert.equal(next.dailyGoal, undefined);
  assert.equal(next.dayStart, undefined);
  assert.equal(next.weekStart, undefined);
  assert.equal(next.streakMode, undefined);
  assert.equal(next.installedOn, null);
  assert.equal(next.morningCheckin.time, '07:30');
  assert.equal(next.photoScrim, 'dark');
  assert.equal(next.photoBlur, 4);
  assert.equal(next.categories[0].name, 'Lecture');
  assert.equal(next.categories[0].color, '#1D63B8');
  assert.equal(next.setupComplete, true);
  assert.equal(next.pet.animal, 'penguin');
  assert.equal(next.pet.color, null);
  assert.equal(next.pet.hat, false);
  const kept = migrateSettings({
    ...v1,
    schemaVersion: 2,
    pet: { animal: 'tiger', color: '#ffd23f', eyes: 'sparkly', cheeks: false, hat: true, height: 1.2, body: 0.9 },
  });
  assert.equal(kept.schemaVersion, 2);
  assert.equal(kept.pet.animal, 'tiger');
  assert.equal(kept.pet.color, '#FFD23F');
  assert.equal(kept.pet.eyes, 'sparkly');
  assert.equal(kept.pet.cheeks, false);
  assert.equal(kept.pet.hat, true);
  assert.equal(kept.pet.height, 1.2);
  assert.equal(kept.title, "Sam's Day");
  assert.equal(kept.font, defaultSettings().font);
  assert.equal(kept.format, 'list');
  assert.equal(kept.clock24, false);
  const painted = paintColors(next);
  assert.equal(painted.bg, THEMES.ocean.bg);
  assert.equal(painted.text, THEMES.ocean.text);
  assert.equal(painted.accent, '#1D63B8');
  assert.equal(painted.ok, true);

  const custom = migrateSettings({ ...v1, schemaVersion: 2, textColor: '#6a1040', bgColor: '#ffd4e8' });
  assert.equal(custom.textColor, '#6A1040');
  assert.equal(custom.bgColor, '#FFD4E8');
  assert.equal(custom.title, "Sam's Day");
});

test('retired pets migrate onto the cube lineup', () => {
  assert.equal(normalizePet({ animal: 'horse', hat: true, eyes: 'sparkly' }).animal, 'fox');
  assert.equal(normalizePet({ animal: 'horse', hat: true }).hat, true);
  assert.equal(normalizePet({ animal: 'shark', color: '#ffd23f' }).animal, 'penguin');
  assert.equal(normalizePet({ animal: 'shark', color: '#ffd23f' }).color, '#FFD23F');
  assert.equal(normalizePet({ animal: 'axolotl' }).animal, 'bunny');
  assert.equal(normalizePet({ animal: 'capybara' }).animal, 'koala');
  assert.equal(normalizePet({ animal: 'dragon' }).animal, 'lion');
  assert.equal(normalizePet({ animal: 'tiger' }).animal, 'tiger');
  assert.equal(normalizePet({ animal: 'chick' }).animal, 'chick');
  assert.equal(normalizePet({ animal: 'nope' }).animal, 'penguin');
});

test('one-off goals stay on their own day', () => {
  const task = {
    id: 'once', title: 'Essay', categoryId: 'task', difficulty: 'easy',
    date: '2026-09-22', repeat: 'none', time: '16:00',
  };
  assert.equal(instancesOn('2026-09-22', [task], []).length, 1);
  assert.equal(instancesOn('2026-09-23', [task], []).length, 0);
  assert.equal(occursOn({ ...task, repeat: undefined }, '2026-09-22'), true);
  assert.equal(occursOn({ ...task, repeat: undefined }, '2026-09-23'), false);
});

test('weekends, weekdays, and an end date', () => {
  const weekends = {
    id: 'sat', title: 'Soccer', repeat: 'weekends', date: '2026-09-21', time: '10:00',
  };
  assert.equal(instancesOn('2026-09-26', [weekends], []).length, 1);
  assert.equal(instancesOn('2026-09-27', [weekends], []).length, 1);
  assert.equal(instancesOn('2026-09-25', [weekends], []).length, 0);

  const work = {
    id: 'work', title: 'Work', repeat: 'weekdays', date: '2026-09-21', time: '08:00',
    durationMin: 540, until: '2026-09-23', remindLeadMin: 10,
  };
  assert.equal(instancesOn('2026-09-21', [work], []).length, 1);
  assert.equal(instancesOn('2026-09-23', [work], []).length, 1);
  assert.equal(instancesOn('2026-09-24', [work], []).length, 0);
  assert.equal(instancesOn('2026-09-26', [work], []).length, 0);
});

test('finishing one occurrence leaves the next one open', () => {
  const task = {
    id: 'gym', title: 'Gym', repeat: 'weekdays', date: '2026-09-21', time: '08:00',
    durationMin: 120, difficulty: 'easy',
  };
  const monday = instancesOn('2026-09-21', [task], [])[0];
  const tuesday = instancesOn('2026-09-22', [task], [])[0];
  assert.notEqual(monday.instanceId, tuesday.instanceId);
  const completions = [{ instanceId: monday.instanceId, date: monday.date, points: 5 }];
  assert.equal(completions.some((item) => item.instanceId === tuesday.instanceId), false);
  assert.equal(formatTimeRange('08:00', 120, false), '8:00 AM – 10:00 AM');
  assert.equal(formatDaySelection([1, 2, 3, 4, 5]), 'Mon–Fri');
  assert.equal(formatDaySelection([2, 4]), 'Tue & Thu');
  assert.equal(formatDaySelection([3, 5]), 'Wed & Fri');
  assert.equal(repeatFromDays([1, 2, 3, 4, 5]), 'weekdays');
  assert.equal(repeatFromDays([6, 0]), 'weekends');
  assert.equal(repeatFromDays([1, 3, 5]), 'days');
  assert.equal(minutesBetween('08:00', '17:00'), 540);
});

test('a repeating goal reminds on each matching day', () => {
  const settings = defaultSettings();
  const task = {
    id: 'work', title: 'Work', repeat: 'weekdays', date: '2026-09-21',
    time: '08:00', durationMin: 540, remindLeadMin: 10, categoryId: 'task', difficulty: 'easy',
  };
  const now = new Date(2026, 8, 21, 6, 0, 0);
  const list = upcomingReminders({
    tasks: [task], overrides: [], settings, now, showNames: true,
  });
  const days = list.filter((item) => item.kind === 'task').map((item) => item.date);
  assert.ok(days.includes('2026-09-21'));
  assert.ok(days.includes('2026-09-22'));
  assert.ok(days.includes('2026-09-25'));
  assert.equal(days.includes('2026-09-26'), false);
  assert.ok(list.every((item) => item.title === 'Work' || item.kind !== 'task'));
});

test('colour wheel hue, saturation, and brightness round-trip', () => {
  assert.equal(hsvToHex({ h: 0, s: 100, v: 100 }), '#FF0000');
  assert.equal(hsvToHex({ h: 120, s: 100, v: 100 }), '#00FF00');
  assert.equal(hsvToHex({ h: 240, s: 100, v: 100 }), '#0000FF');
  assert.equal(hsvToHex({ h: 180, s: 100, v: 100 }), '#00FFFF');
  assert.equal(hsvToHex({ h: 0, s: 0, v: 100 }), '#FFFFFF');
  assert.equal(hsvToHex({ h: 40, s: 80, v: 0 }), '#000000');
  const sample = '#6D4AFF';
  const back = hsvToHex(hexToHsv(sample));
  const a = hexToRgb(sample);
  const b = hexToRgb(back);
  assert.ok(Math.abs(a.r - b.r) <= 1 && Math.abs(a.g - b.g) <= 1 && Math.abs(a.b - b.b) <= 1, back);
  const size = COLOUR_WHEEL_SIZE;
  const edge = wheelPointToHs(size, size / 2, size);
  assert.ok(edge.h < 1 || edge.h > 359);
  assert.equal(Math.round(edge.s), 100);
  const center = wheelPointToHs(size / 2, size / 2, size);
  assert.equal(Math.round(center.s), 0);
  const outside = wheelPointToHs(size + 40, size / 2, size);
  assert.equal(Math.round(outside.s), 100);
  const spot = hsToWheelPoint(120, 100, size);
  const backHs = wheelPointToHs(spot.x, spot.y, size);
  assert.ok(Math.abs(backHs.h - 120) < 0.02, backHs.h);
  assert.ok(Math.abs(backHs.s - 100) < 0.02, backHs.s);
  assert.equal(hsvToHex({ ...backHs, v: 100 }), '#00FF00');
});

test('saved font, layout, and clock choices reset to the defaults', () => {
  const next = migrateSettings({
    schemaVersion: 2,
    title: 'Lab Day',
    theme: 'mint',
    font: 'caveat',
    format: 'timeline',
    clock24: true,
    textColor: '#064536',
    weekStart: 'sun',
    dayStart: '05:00',
    streakMode: 'weekdays',
    dailyGoal: { mode: 'points', n: 9 },
    installedOn: '2026-09-02',
  });
  const base = defaultSettings();
  assert.equal(next.font, base.font);
  assert.equal(next.format, base.format);
  assert.equal(next.clock24, base.clock24);
  assert.equal(next.title, 'Lab Day');
  assert.equal(next.theme, 'mint');
  assert.equal(next.textColor, '#064536');
  assert.equal(next.weekStart, undefined);
  assert.equal(next.dayStart, undefined);
  assert.equal(next.streakMode, undefined);
  assert.equal(next.dailyGoal, undefined);
  assert.equal(next.installedOn, '2026-09-02');
  assert.equal(migrateSettings({ installedOn: 'nope' }).installedOn, null);
});

test('photo dimming still counts toward text contrast', () => {
  const settings = { theme: 'calm', textColor: '#FFFFFF', bgColor: '#FFFFFF' };
  const onWhite = paintColors(settings, { on: true, luminance: 1, scrim: 'light' });
  assert.equal(onWhite.ok, false);
  const fixed = fixTextColor(settings, { on: true, luminance: 1, scrim: 'light' });
  const after = paintColors({ ...settings, textColor: fixed }, { on: true, luminance: 1, scrim: 'light' });
  assert.equal(after.ok, true, `${fixed} ${after.ratio}`);
  for (const theme of Object.keys(THEMES)) {
    for (const luminance of [0, 1]) {
      for (const scrim of ['dark', 'light']) {
        const painted = paintColors({ theme }, { on: true, luminance, scrim });
        assert.equal(painted.ok, true, `${theme} ${scrim} lum ${luminance} ${painted.ratio}`);
      }
    }
  }
});
