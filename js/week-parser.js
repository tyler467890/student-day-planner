/**
 * On-device week description parser.
 *
 * The app should call only `parseWeekDescription`. A future model backend can
 * replace the rules by passing `options.parse` with the same result shape:
 *   { goals: [{ title, days, startTime, endTime, durationMin, source }],
 *     unread: [{ text }] }
 * Days are JS weekday numbers: 0 Sunday … 6 Saturday.
 * Nothing in this module saves data or talks to a network.
 */

const ORDER = [1, 2, 3, 4, 5, 6, 0];
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKENDS = [6, 0];

const DAY_NAMES = [
  { dow: 1, name: 'monday' },
  { dow: 2, name: 'tuesday' },
  { dow: 3, name: 'wednesday' },
  { dow: 4, name: 'thursday' },
  { dow: 5, name: 'friday' },
  { dow: 6, name: 'saturday' },
  { dow: 0, name: 'sunday' },
];

const ALIAS = new Map();
for (const day of DAY_NAMES) {
  const forms = [day.name, day.name.slice(0, 3)];
  if (day.name === 'tuesday') forms.push('tues');
  if (day.name === 'wednesday') forms.push('weds');
  if (day.name === 'thursday') forms.push('thur', 'thurs');
  for (const form of forms) {
    ALIAS.set(form, day.dow);
    ALIAS.set(`${form}s`, day.dow);
  }
}

const DAY_STOP = new Set([
  'work', 'works', 'working', 'school', 'online', 'gym', 'workout', 'workouts',
  'class', 'classes', 'study', 'homework', 'home', 'hours', 'hour', 'from',
  'with', 'that', 'this', 'your', 'have', 'reminder', 'please', 'soccer',
  'piano', 'lunch', 'band', 'practice', 'online', 'lesson', 'lessons',
]);

const FILLER = new Set(`
  i im id ill ive a an the also too to and or then on at from for of in my me
  have has had having like just please would want wanted wanna reminder reminders
  remind do does did some it its every each this that with is am are be got get
  going go need needs so but if when during around about into out up our your we
  you can could should will really maybe hey hi ok okay um uh plus still always
  usually normally typically gotta lets kinda kind thing things something weeks
  week today tomorrow tonight again another as well both all per by before after
  starts starting ends ending until till through thru between oclock sharp
  roughly except not gonna morning afternoon evening night hour hours hr hrs
  minute minutes min mins am pm noon midnight
  january february march april may june july august september october november december
`.split(/\s+/).filter(Boolean));

const RANGE_WORDS = new Set(['to', 'through', 'thru', 'until', 'till', '-']);
const LIST_WORDS = new Set(['and', 'or', '&', 'plus', ',']);

/**
 * @param {string} text
 * @param {{ parse?: (text: string) => object | Promise<object> }} [options]
 * @returns {Promise<{ goals: object[], unread: { text: string }[] }>}
 */
export async function parseWeekDescription(text, options = {}) {
  const parse = typeof options.parse === 'function' ? options.parse : parseWeekWithRules;
  const raw = await parse(text == null ? '' : String(text));
  return normalizeWeekParse(raw);
}

/** Rule-based parser. Exported so tests can call it without the async wrapper. */
export function parseWeekWithRules(text) {
  const prepared = prepare(text);
  if (!prepared) return { goals: [], unread: [] };
  const goals = [];
  const unread = [];
  for (const clause of splitClauses(prepared)) {
    const parsed = parseClause(clause);
    if (!parsed) continue;
    if (parsed.goal) goals.push(parsed.goal);
    else if (parsed.unread) unread.push(parsed.unread);
  }
  return { goals, unread };
}

/**
 * Pairs of proposals whose weekdays and clock times overlap.
 * Touching endpoints (work ending at 5:00, school starting at 5:00) do not overlap.
 * @returns {{ titleA: string, titleB: string, days: number[], message: string }[]}
 */
export function findOverlaps(goals) {
  const list = Array.isArray(goals) ? goals : [];
  const notes = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];
      if (!a?.startTime || !b?.startTime) continue;
      const shared = sortDays((a.days || []).filter((d) => (b.days || []).includes(d)));
      if (!shared.length) continue;
      if (!timesOverlap(a, b)) continue;
      const when = formatOverlapDays(shared);
      notes.push({
        titleA: a.title,
        titleB: b.title,
        days: shared,
        message: `${a.title} and ${b.title} both happen on ${when}. You can still add both.`,
      });
    }
  }
  return notes;
}

function prepare(text) {
  return String(text || '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\r\n|\r|\n/g, '. ')
    .replace(/\b([ap])\.?\s*m\.?\b/gi, '$1m')
    .replace(/(\d)\s+([ap]m)\b/gi, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitClauses(text) {
  const clauses = [];
  for (const sentence of splitSentences(text)) clauses.push(...splitConnectors(sentence));
  return clauses.map(cleanEdge).filter(Boolean);
}

function splitSentences(text) {
  const parts = [];
  let buf = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const decimal = ch === '.' && /\d/.test(text[i - 1] || '') && /\d/.test(text[i + 1] || '');
    if (!decimal && (ch === '.' || ch === '!' || ch === '?' || ch === ';')) {
      const piece = buf.trim();
      if (piece) parts.push(piece);
      buf = '';
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);
  return parts;
}

function splitConnectors(sentence) {
  const re = /\bthen\b|,|\band\b|&/gi;
  const pieces = [];
  let start = 0;
  let match;
  while ((match = re.exec(sentence))) {
    const word = match[0].toLowerCase();
    if (!shouldSplit(sentence, match.index, word)) continue;
    const left = cleanEdge(sentence.slice(start, match.index));
    if (left) pieces.push(left);
    start = match.index + match[0].length;
  }
  const tail = cleanEdge(sentence.slice(start));
  if (tail) pieces.push(tail);
  return pieces.length ? pieces : [cleanEdge(sentence)].filter(Boolean);
}

const DURATION_WORDS = new Set(['hour', 'hours', 'hr', 'hrs', 'minute', 'minutes', 'min', 'mins']);

function shouldSplit(sentence, index, word) {
  const before = sentence.slice(0, index);
  const after = sentence.slice(index + word.length);
  const prev = lastContent(before);
  const next = firstContent(after);
  const nextPast = firstContent(after, true);
  if (word === 'then') return true;
  if (word === ',' && next === 'then') return false;
  if ((word === 'and' || word === '&') && DURATION_WORDS.has(prev) && /^\d/.test(next)) return false;
  if (isDayish(prev) && (isDayish(next) || isDayish(nextPast))) return false;
  if (isTimeish(prev) && (isTimeish(next) || isTimeish(nextPast))) return false;
  return true;
}

function firstContent(str, skipConnectors = false) {
  for (const token of contentTokens(str)) {
    if (token === 'then') return 'then';
    if (SKIP_AROUND.has(token)) continue;
    if (skipConnectors && (token === 'and' || token === 'or' || token === '&')) continue;
    return token;
  }
  return '';
}

function lastContent(str) {
  const tokens = contentTokens(str);
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    if (SKIP_AROUND.has(tokens[i])) continue;
    return tokens[i];
  }
  return '';
}

const SKIP_AROUND = new Set([
  'i', 'im', 'id', 'ill', 'ive', 'a', 'an', 'the', 'also', 'just', 'please',
  'would', 'my', 'me', 'like', 'have', 'has', 'had', 'do', 'does', 'of', 'it',
  'its', 'some', 'really', 'want', 'wanted', 'wanna', 'we', 'you', 'our',
  'your', 'got', 'get', 'need', 'needs', 'so', 'am', 'are', 'was', 'be', 'been',
  'too', 'lets', 'gonna',
]);

function contentTokens(str) {
  return str.split(/\s+/).map((token) => clean(token)).filter(Boolean);
}

function isDayish(token) {
  const word = clean(token);
  if (!word) return false;
  if (['weekdays', 'weekday', 'weekends', 'weekend', 'everyday', 'daily', 'day', 'days', 'week'].includes(word)) return true;
  if (word === 'every' || word === 'each') return true;
  return matchDayWord(word) != null;
}

function isTimeish(token) {
  const word = clean(token).replace(/\s/g, '');
  return /^(?:noon|midnight|\d{1,2}(?::\d{2})?(?:am|pm)?)$/.test(word);
}

function parseClause(original) {
  const source = cleanEdge(original);
  if (!source) return null;
  const lower = loosen(source.toLowerCase());
  const tokens = tokenize(lower);
  if (!tokens.some((token) => {
    const word = clean(token);
    return word && word !== ',' && !FILLER.has(word);
  })) return null;

  const duration = consumeDuration(lower);
  const times = consumeTimes(duration.text);
  const dayInfo = extractDays(tokenize(times.text));
  const title = titleFrom(tokenize(times.text), dayInfo.covered);
  if (!dayInfo.days.length || !title) return { unread: { text: source } };

  let start = times.start;
  let end = times.end;
  let durationMin = times.usedRange ? null : duration.minutes;
  if (start != null && end == null && durationMin) end = (start + durationMin) % 1440;
  if (start != null && end != null) {
    let diff = end - start;
    if (diff <= 0) diff += 1440;
    durationMin = diff > 0 && diff <= 18 * 60 ? diff : durationMin;
  }

  return {
    goal: {
      title,
      days: dayInfo.days,
      startTime: start == null ? null : toHM(start),
      endTime: end == null ? null : toHM(end),
      durationMin: durationMin || null,
      source,
    },
  };
}

function loosen(text) {
  return text
    .replace(/\b([a-z]{2,12})-([a-z]{2,12})\b/g, '$1 to $2')
    .replace(/\b(\d{1,2}(?::\d{2})?(?:am|pm)?)\s*-\s*(\d{1,2}(?::\d{2})?(?:am|pm)?)\b/g, '$1 to $2');
}

function consumeDuration(text) {
  const patterns = [
    {
      re: /\b(?:for\s+)?(\d+)\s*hours?\s+(?:and\s+)?(\d+)\s*(?:minutes?|mins?)\b/gi,
      minutes: (m) => Number(m[1]) * 60 + Number(m[2]),
    },
    { re: /\b(?:for\s+)?(?:an?\s+half|half\s+an?)\s+hours?\b/gi, minutes: () => 30 },
    { re: /\bfor\s+an?\s+hours?\b/gi, minutes: () => 60 },
    {
      re: /\b(?:for\s+)?(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/gi,
      minutes: (m) => Math.round(Number(m[1]) * 60),
    },
    {
      re: /\b(?:for\s+)?(\d+)\s*(?:minutes?|mins?)\b/gi,
      minutes: (m) => Number(m[1]),
    },
  ];
  const spans = [];
  for (const pattern of patterns) {
    const re = new RegExp(pattern.re.source, 'gi');
    let match;
    while ((match = re.exec(text))) {
      if (!match[0]) {
        re.lastIndex += 1;
        continue;
      }
      const minutes = pattern.minutes(match);
      if (minutes > 0 && minutes <= 18 * 60) {
        spans.push({ start: match.index, end: match.index + match[0].length, minutes, len: match[0].length });
      }
    }
  }
  spans.sort((a, b) => a.start - b.start || b.len - a.len);
  const kept = [];
  let cursor = 0;
  let minutes = null;
  for (const span of spans) {
    if (span.start < cursor) continue;
    kept.push(span);
    cursor = span.end;
    if (minutes == null) minutes = span.minutes;
  }
  return { text: blankSpans(text, kept), minutes };
}

function consumeTimes(text) {
  const re = /\b(?:(?:at|from)\s+)?(noon|midnight|\d{1,2}(?::[0-5]\d)?\s*(?:[ap]m)?)\b/gi;
  const found = [];
  let match;
  while ((match = re.exec(text))) {
    const clock = parseClock(match[1]);
    if (!clock) continue;
    found.push({
      start: match.index,
      end: match.index + match[0].length,
      clock,
      tokenStart: match.index + match[0].length - match[1].length,
    });
  }
  const keep = found.filter((item, index) => {
    if (!item.clock.bare) return true;
    const prev = found[index - 1];
    const next = found[index + 1];
    const before = prev && rangeBridge(text.slice(prev.end, item.tokenStart));
    const after = next && rangeBridge(text.slice(item.end, next.tokenStart));
    return Boolean(before || after);
  });

  let start = null;
  let end = null;
  let usedRange = false;
  const used = [];
  for (let i = 0; i < keep.length; i += 1) {
    const item = keep[i];
    const next = keep[i + 1];
    if (next && rangeBridge(text.slice(item.end, next.tokenStart))) {
      const pair = resolvePair(item.clock, next.clock);
      if (start == null) {
        start = pair.start;
        end = pair.end;
        usedRange = true;
      }
      used.push(item, next);
      i += 1;
      continue;
    }
    if (start == null && !item.clock.bare) {
      start = item.clock.mins;
      used.push(item);
    }
  }
  return { text: blankSpans(text, used), start, end, usedRange };
}

function rangeBridge(text) {
  return /^\s*(?:to|through|thru|until|till|-|and)\s*$/i.test(text);
}

function parseClock(raw) {
  const compact = String(raw || '').toLowerCase().replace(/[\s.]/g, '');
  if (compact === 'noon') return { mins: 12 * 60, explicit: true, bare: false, hour: 12, min: 0 };
  if (compact === 'midnight') return { mins: 0, explicit: true, bare: false, hour: 0, min: 0 };
  const match = compact.match(/^(\d{1,2})(?::([0-5]\d))?(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const min = match[2] ? Number(match[2]) : 0;
  const mer = match[3] || null;
  const hasColon = Boolean(match[2]);
  if (hour > 23 || min > 59) return null;
  if (mer) {
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = mer === 'am' ? 0 : 12;
    else if (mer === 'pm') hour += 12;
    return { mins: hour * 60 + min, explicit: true, bare: false, hour, min };
  }
  if (hour > 12) return { mins: hour * 60 + min, explicit: true, bare: false, hour, min };
  return {
    mins: hour * 60 + min,
    explicit: false,
    bare: !hasColon,
    hour,
    min,
  };
}

function resolvePair(a, b) {
  if (a.explicit && b.explicit) return { start: a.mins, end: b.mins };
  if (a.explicit && !b.explicit) return { start: a.mins, end: chooseEnd(a.mins, b) };
  if (!a.explicit && b.explicit) return { start: chooseStart(b.mins, a), end: b.mins };
  let start = a.mins;
  let end = b.mins;
  if (end <= start && b.hour <= 12 && a.hour <= 12) end = (b.hour % 12) * 60 + b.min + 12 * 60;
  return { start, end };
}

function chooseStart(endMins, clock) {
  const hour = clock.hour % 12;
  const options = [hour * 60 + clock.min, hour * 60 + clock.min + 12 * 60];
  const before = options.filter((mins) => mins < endMins);
  if (before.length) return Math.max(...before);
  return options[0];
}

function chooseEnd(startMins, clock) {
  const hour = clock.hour % 12;
  const base = hour * 60 + clock.min;
  const options = [base, base + 12 * 60].filter((mins) => mins > startMins);
  if (options.length) return Math.min(...options);
  return base;
}

function extractDays(tokens) {
  const mentions = [];
  for (let i = 0; i < tokens.length;) {
    const group = matchGroupAt(tokens, i);
    if (group) {
      mentions.push({ at: i, len: group.skip, days: group.days });
      i += group.skip;
    } else i += 1;
  }
  const covered = new Set();
  let days = [];
  mentions.forEach((mention, index) => {
    for (let j = 0; j < mention.len; j += 1) covered.add(mention.at + j);
    if (index > 0) {
      const from = mentions[index - 1].at + mentions[index - 1].len;
      for (let idx = from; idx < mention.at; idx += 1) {
        const word = clean(tokens[idx]);
        if (RANGE_WORDS.has(word) || LIST_WORDS.has(word) || ['on', 'except', 'but', 'not'].includes(word)) {
          covered.add(idx);
        }
      }
    }
    if (isNegated(tokens, mention.at)) {
      const remove = new Set(mention.days);
      days = days.filter((day) => !remove.has(day));
      return;
    }
    const between = index === 0 ? [] : tokens.slice(mentions[index - 1].at + mentions[index - 1].len, mention.at);
    if (connectorKind(between) === 'range' && days.length) {
      const from = days[days.length - 1];
      days = days.slice(0, -1).concat(expandRange(from, mention.days[0]), mention.days.slice(1));
    } else days.push(...mention.days);
  });
  return { days: sortDays(days), covered };
}

function matchGroupAt(tokens, index) {
  const a = clean(tokens[index]);
  const b = clean(tokens[index + 1] || '');
  if ((a === 'every' || a === 'each') && (b === 'day' || b === 'days')) return { days: ALL_DAYS, skip: 2 };
  if (a === 'all' && b === 'week') return { days: ALL_DAYS, skip: 2 };
  if (a === 'week' && (b === 'day' || b === 'days')) return { days: WEEKDAYS, skip: 2 };
  if (a === 'week' && (b === 'end' || b === 'ends')) return { days: WEEKENDS, skip: 2 };
  if (a === 'everyday' || a === 'daily') return { days: ALL_DAYS, skip: 1 };
  if (a === 'weekday' || a === 'weekdays') return { days: WEEKDAYS, skip: 1 };
  if (a === 'weekend' || a === 'weekends') return { days: WEEKENDS, skip: 1 };
  const one = matchDayWord(a);
  if (one != null) return { days: [one], skip: 1 };
  return null;
}

function matchDayWord(raw) {
  const word = clean(raw);
  if (!word || DAY_STOP.has(word)) return null;
  if (ALIAS.has(word)) return ALIAS.get(word);
  if (word.endsWith('s') && ALIAS.has(word.slice(0, -1))) return ALIAS.get(word.slice(0, -1));
  if (word.length < 5) return null;
  const probe = word.endsWith('s') && word.length > 4 ? word.slice(0, -1) : word;
  let best = null;
  let bestDist = 99;
  let second = 99;
  for (const day of DAY_NAMES) {
    const dist = Math.min(
      damerau(word, day.name),
      damerau(probe, day.name),
      damerau(word, `${day.name}s`),
    );
    if (dist < bestDist) {
      second = bestDist;
      bestDist = dist;
      best = day;
    } else if (dist < second) second = dist;
  }
  if (!best || bestDist === 0 || bestDist >= second) return null;
  const firstOk = probe[0] === best.name[0];
  const secondOk = probe.length > 1 && probe[1] === best.name[1];
  if (bestDist === 1 && firstOk) return best.dow;
  if (bestDist === 2 && firstOk && secondOk) return best.dow;
  return null;
}

function connectorKind(tokens) {
  const words = tokens.map((token) => clean(token)).filter((word) => word && !['on', 'the', 'a', 'an'].includes(word));
  if (!words.length) return 'list';
  if (words.every((word) => RANGE_WORDS.has(word))) return 'range';
  if (words.every((word) => LIST_WORDS.has(word))) return 'list';
  return 'other';
}

function isNegated(tokens, at) {
  const prev = tokens.slice(Math.max(0, at - 4), at).map((token) => clean(token));
  if (prev.includes('except')) return true;
  const but = prev.lastIndexOf('but');
  return but >= 0 && prev.slice(but).includes('not');
}

function expandRange(from, to) {
  const start = ORDER.indexOf(from);
  const end = ORDER.indexOf(to);
  if (start < 0 || end < 0) return [from, to];
  if (start <= end) return ORDER.slice(start, end + 1);
  return ORDER.slice(start).concat(ORDER.slice(0, end + 1));
}

function titleFrom(tokens, covered) {
  const words = [];
  tokens.forEach((token, index) => {
    if (covered.has(index)) return;
    const word = clean(token);
    if (!word || word === ',' || FILLER.has(word)) return;
    if (matchDayWord(word) != null) return;
    if (/^\d{1,2}(?::\d{2})?(?:am|pm)?$/.test(word)) return;
    words.push(word);
  });
  return niceTitle(words);
}

function niceTitle(words) {
  const cleaned = words.map((word) => word.replace(/[^a-z0-9]+/g, '')).filter(Boolean);
  if (!cleaned.length) return '';
  const set = new Set(cleaned);
  const only = (allowed) => cleaned.every((word) => allowed.has(word));
  if (set.has('gym') && (set.has('workout') || set.has('workouts') || set.has('exercise') || set.has('training'))
    && only(new Set(['gym', 'workout', 'workouts', 'exercise', 'training']))) {
    return 'Gym/Workout';
  }
  if (set.has('school') && set.has('online') && only(new Set(['school', 'online']))) return 'School online';
  return cleaned[0].charAt(0).toUpperCase() + cleaned[0].slice(1) + (cleaned.length > 1 ? ` ${cleaned.slice(1).join(' ')}` : '');
}

function timesOverlap(a, b) {
  const aSpans = spansOf(a);
  const bSpans = spansOf(b);
  return aSpans.some((left) => bSpans.some((right) => left[0] < right[1] && right[0] < left[1]));
}

function spansOf(goal) {
  const start = hmToMinutes(goal.startTime);
  if (start == null) return [];
  let end = goal.endTime ? hmToMinutes(goal.endTime) : start + 1;
  if (end == null) end = start + 1;
  if (end <= start) return [[start, 1440], [0, end]];
  return [[start, end]];
}

function formatOverlapDays(days) {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const list = ORDER.filter((day) => days.includes(day)).map((day) => names[day]);
  if (list.length <= 1) return list[0] || 'those days';
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

function normalizeWeekParse(raw) {
  const goals = [];
  const unread = [];
  for (const item of raw?.unread || []) {
    const text = typeof item === 'string' ? item : item?.text;
    if (text && String(text).trim()) unread.push({ text: String(text).trim() });
  }
  for (const goal of raw?.goals || []) {
    const title = String(goal?.title || '').replace(/\s+/g, ' ').trim();
    const days = sortDays((goal?.days || []).map(Number).filter((day) => day >= 0 && day <= 6));
    if (!title || !days.length) {
      const source = goal?.source ? String(goal.source).trim() : '';
      if (source) unread.push({ text: source });
      continue;
    }
    const startTime = validHM(goal.startTime);
    let endTime = validHM(goal.endTime);
    let durationMin = Number(goal.durationMin);
    if (!Number.isFinite(durationMin) || durationMin <= 0 || durationMin > 24 * 60) durationMin = null;
    if (startTime && !endTime && durationMin) endTime = toHM(hmToMinutes(startTime) + durationMin);
    if (startTime && endTime) {
      let diff = hmToMinutes(endTime) - hmToMinutes(startTime);
      if (diff <= 0) diff += 1440;
      if (diff > 0 && diff <= 18 * 60) durationMin = diff;
    }
    goals.push({
      title,
      days,
      startTime,
      endTime,
      durationMin,
      source: goal?.source ? String(goal.source) : '',
    });
  }
  return { goals, unread };
}

function tokenize(text) {
  return text.replace(/,/g, ' , ').split(/\s+/).map((token) => token.trim()).filter(Boolean);
}

function clean(token) {
  return String(token || '')
    .toLowerCase()
    .replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, '')
    .replace(/'/g, '');
}

function cleanEdge(text) {
  return String(text || '').replace(/^[\s,;:.!-]+|[\s,;:.!-]+$/g, '').trim();
}

function blankSpans(text, spans) {
  let out = text;
  const ordered = [...spans].sort((a, b) => b.start - a.start);
  for (const span of ordered) {
    out = `${out.slice(0, span.start)}${' '.repeat(Math.max(0, span.end - span.start))}${out.slice(span.end)}`;
  }
  return out;
}

function sortDays(days) {
  const set = new Set(days);
  return ORDER.filter((day) => set.has(day));
}

function hmToMinutes(hm) {
  const match = String(hm || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function toHM(mins) {
  const wrapped = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

function validHM(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const mins = hmToMinutes(value.trim());
  if (mins == null) return null;
  const hour = Math.floor(mins / 60);
  if (hour > 23) return null;
  return toHM(mins);
}

function damerau(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
    }
  }
  return dp[a.length][b.length];
}
