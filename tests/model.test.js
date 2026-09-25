import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, plannerDate, levelForPoints, levelBounds, levelTitle, computeStreak,
  instancesOn, upcomingReminders, reminderText, headerContrast, cardContrast,
  THEMES, contrastRatio, onAccent, POINTS, defaultSettings,
} from '../js/model.js';

test('planner date rolls at 4:00', () => {
  const before = new Date(2026, 8, 22, 3, 30, 0);
  const after = new Date(2026, 8, 22, 4, 0, 0);
  assert.equal(plannerDate(before, '04:00'), '2026-09-21');
  assert.equal(plannerDate(after, '04:00'), '2026-09-22');
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
  for (const hex of ['#4F46E5', '#0F766E', '#C2410C', '#1D63B8', '#BE185D', '#8B8CF6', '#7C3AED', '#0E7490']) {
    const ink = onAccent(hex);
    assert.ok(contrastRatio(hex, ink) >= 4.5, hex);
  }
});
