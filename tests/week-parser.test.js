import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWeekDescription, parseWeekWithRules, findOverlaps } from '../js/week-parser.js';

const TYLER = 'i work 8am to 5pm monday to friday and i also have school online tuesdays and thrusdays from 5pm to 7pm, then on wednsdays and fridays id like a gym reminder at 8am too workout for 2 hours.';

function byTitle(result) {
  return Object.fromEntries(result.goals.map((goal) => [goal.title, goal]));
}

test("Tyler's week: work, school online, and gym/workout", async () => {
  const result = await parseWeekDescription(TYLER);
  assert.equal(result.unread.length, 0, JSON.stringify(result));
  assert.deepEqual(result.goals.map((goal) => goal.title), ['Work', 'School online', 'Gym/Workout']);

  const goals = byTitle(result);
  assert.deepEqual(goals.Work.days, [1, 2, 3, 4, 5]);
  assert.equal(goals.Work.startTime, '08:00');
  assert.equal(goals.Work.endTime, '17:00');
  assert.equal(goals.Work.durationMin, 540);

  assert.deepEqual(goals['School online'].days, [2, 4]);
  assert.equal(goals['School online'].startTime, '17:00');
  assert.equal(goals['School online'].endTime, '19:00');
  assert.equal(goals['School online'].durationMin, 120);

  assert.deepEqual(goals['Gym/Workout'].days, [3, 5]);
  assert.equal(goals['Gym/Workout'].startTime, '08:00');
  assert.equal(goals['Gym/Workout'].endTime, '10:00');
  assert.equal(goals['Gym/Workout'].durationMin, 120);

  const notes = findOverlaps(result.goals);
  assert.equal(notes.length, 1);
  assert.deepEqual(notes[0].days, [3, 5]);
  assert.equal(notes[0].titleA, 'Work');
  assert.equal(notes[0].titleB, 'Gym/Workout');
  assert.match(notes[0].message, /Wednesday and Friday/);
  assert.match(notes[0].message, /You can still add both/);
  assert.equal(findOverlaps([goals.Work, goals['School online']]).length, 0);
});

test('the same week with cleaner spelling, abbreviations, and a 24-hour clock', async () => {
  const text = 'I work 8:00am-5:00pm Mon-Fri. I also have school online on Tuesdays and Thursdays from 17:00 to 19:00. Then on Wednesdays and Fridays I would like a gym reminder at 8am to workout for 2 hrs.';
  const result = await parseWeekDescription(text);
  assert.equal(result.unread.length, 0, JSON.stringify(result));
  const goals = byTitle(result);
  assert.equal(goals.Work.startTime, '08:00');
  assert.equal(goals.Work.endTime, '17:00');
  assert.deepEqual(goals.Work.days, [1, 2, 3, 4, 5]);
  assert.deepEqual(goals['School online'].days, [2, 4]);
  assert.equal(goals['School online'].startTime, '17:00');
  assert.equal(goals['School online'].endTime, '19:00');
  assert.equal(goals['Gym/Workout'].startTime, '08:00');
  assert.equal(goals['Gym/Workout'].endTime, '10:00');
  assert.deepEqual(goals['Gym/Workout'].days, [3, 5]);
});

test('bare hours, through, and weekdays', async () => {
  const result = parseWeekWithRules('I work 8 to 5 Monday through Friday and school weekdays from 9:30 am to 3 pm');
  const goals = byTitle(result);
  assert.equal(goals.Work.startTime, '08:00');
  assert.equal(goals.Work.endTime, '17:00');
  assert.deepEqual(goals.Work.days, [1, 2, 3, 4, 5]);
  assert.equal(goals.School.startTime, '09:30');
  assert.equal(goals.School.endTime, '15:00');
  assert.deepEqual(goals.School.days, [1, 2, 3, 4, 5]);
});

test('misspelled single days, noon, weekends, and durations', async () => {
  const piano = parseWeekWithRules('piano on wensday and thrusday at 4pm for 45 minutes');
  assert.equal(piano.goals[0].title, 'Piano');
  assert.deepEqual(piano.goals[0].days, [3, 4]);
  assert.equal(piano.goals[0].startTime, '16:00');
  assert.equal(piano.goals[0].endTime, '16:45');

  const lunch = parseWeekWithRules('I pack lunch every day at noon for 30 minutes');
  assert.equal(lunch.goals[0].title, 'Pack lunch');
  assert.deepEqual(lunch.goals[0].days, [1, 2, 3, 4, 5, 6, 0]);
  assert.equal(lunch.goals[0].startTime, '12:00');
  assert.equal(lunch.goals[0].endTime, '12:30');

  const soccer = parseWeekWithRules('weekends at 10am soccer for an hour');
  assert.equal(soccer.goals[0].title, 'Soccer');
  assert.deepEqual(soccer.goals[0].days, [6, 0]);
  assert.equal(soccer.goals[0].startTime, '10:00');
  assert.equal(soccer.goals[0].endTime, '11:00');

  const band = parseWeekWithRules('band practice from 8:30 pm to 10 pm on Fridays');
  assert.equal(band.goals[0].title, 'Band practice');
  assert.deepEqual(band.goals[0].days, [5]);
  assert.equal(band.goals[0].startTime, '20:30');
  assert.equal(band.goals[0].endTime, '22:00');

  const long = parseWeekWithRules('study hall Mondays for 1 hour and 30 minutes at 4pm');
  assert.equal(long.goals[0].title, 'Study hall');
  assert.equal(long.goals[0].startTime, '16:00');
  assert.equal(long.goals[0].durationMin, 90);
  assert.equal(long.goals[0].endTime, '17:30');

  const half = parseWeekWithRules('stretch every Saturday at 7:15am for 1.5 hours');
  assert.equal(half.goals[0].title, 'Stretch');
  assert.deepEqual(half.goals[0].days, [6]);
  assert.equal(half.goals[0].durationMin, 90);
  assert.equal(half.goals[0].endTime, '08:45');
});

test('lists, daily, midnight, and mon wed fri', () => {
  const bio = parseWeekWithRules('mon, wed, and fri biology at 9am to 9:50am');
  assert.equal(bio.goals[0].title, 'Biology');
  assert.deepEqual(bio.goals[0].days, [1, 3, 5]);
  assert.equal(bio.goals[0].startTime, '09:00');
  assert.equal(bio.goals[0].endTime, '09:50');

  const stand = parseWeekWithRules('daily standup at 9am for 15 mins');
  assert.equal(stand.goals[0].title, 'Standup');
  assert.equal(stand.goals[0].days.length, 7);
  assert.equal(stand.goals[0].durationMin, 15);

  const late = parseWeekWithRules('close the lab Sundays at midnight for 20 minutes');
  assert.equal(late.goals[0].startTime, '00:00');
  assert.equal(late.goals[0].endTime, '00:20');
  assert.deepEqual(late.goals[0].days, [0]);
});

test('unreadable parts stay visible and are not saved as goals', () => {
  const mixed = parseWeekWithRules('I have soccer Saturdays at 9am for 1 hour, and remember to call grandma sometimes.');
  assert.equal(mixed.goals.length, 1);
  assert.equal(mixed.goals[0].title, 'Soccer');
  assert.deepEqual(mixed.goals[0].days, [6]);
  assert.equal(mixed.unread.length, 1);
  assert.match(mixed.unread[0].text, /grandma/i);

  const none = parseWeekWithRules('remember to call grandma sometimes');
  assert.equal(none.goals.length, 0);
  assert.equal(none.unread.length, 1);

  const daysOnly = parseWeekWithRules('monday to friday');
  assert.equal(daysOnly.goals.length, 0);
  assert.equal(daysOnly.unread.length, 1);

  const empty = parseWeekWithRules('   ');
  assert.deepEqual(empty, { goals: [], unread: [] });
});

test('a replacement parser can stand in for the rules', async () => {
  const result = await parseWeekDescription('this text is ignored', {
    parse: async () => ({
      goals: [{ title: 'Custom', days: [1, 1, 8], startTime: '9:00', endTime: '10:00' }],
      unread: ['nope'],
    }),
  });
  assert.equal(result.goals.length, 1);
  assert.equal(result.goals[0].title, 'Custom');
  assert.deepEqual(result.goals[0].days, [1]);
  assert.equal(result.goals[0].startTime, '09:00');
  assert.equal(result.goals[0].endTime, '10:00');
  assert.equal(result.goals[0].durationMin, 60);
  assert.deepEqual(result.unread, [{ text: 'nope' }]);
});

test('invalid custom goals are not silently kept', async () => {
  const result = await parseWeekDescription('x', {
    parse: () => ({
      goals: [{ title: '', days: [1], source: 'mystery bit' }, { title: 'No days', days: [] }],
      unread: [],
    }),
  });
  assert.equal(result.goals.length, 0);
  assert.deepEqual(result.unread, [{ text: 'mystery bit' }]);
});
