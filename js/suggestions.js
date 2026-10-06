/**
 * Suggested-goal delivery. The picker lives in js/suggest.js (another piece
 * of work). This file only decides when to ask, how to show a notice, and
 * how a suggestion becomes a task. If the engine is missing, callers get null.
 */

import { SUGGESTION_COIN_BONUS } from './shop.js';
import { dayOfWeek } from './model.js';

export const SUGGEST_POLL_MS = 60 * 60 * 1000;

const FREQS = new Set(['off', 'rare', 'normal', 'often']);
const PACES = new Set(['rare', 'normal', 'often']);
const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Overnight window used when the engine does not say whether it is quiet. */
export const DEFAULT_QUIET = { start: '21:00', end: '07:00' };

export function isHm(value) {
  return HM.test(String(value || ''));
}

export function normalizeSuggestFrequency(value) {
  return FREQS.has(value) ? value : 'normal';
}

/** Last Rarely / Normal / Often choice, even while suggestions are off. */
export function suggestPace(settings) {
  const freq = settings?.suggestFrequency;
  if (PACES.has(freq)) return freq;
  if (PACES.has(settings?.suggestPace)) return settings.suggestPace;
  return 'normal';
}

function hmMinutes(hm) {
  const [h, m] = String(hm).split(':').map(Number);
  return h * 60 + m;
}

/**
 * Quiet hours for suggestion notifications.
 * `settings.quietHours = false` or `{ on: false }` turns them off.
 * A `{ start, end }` window (also `from`/`to`, or `quietStart`/`quietEnd`) wins.
 * Anything else uses 21:00–07:00.
 */
export function quietWindow(settings) {
  const q = settings?.quietHours ?? settings?.quiet ?? null;
  if (q === false || q?.on === false || q?.enabled === false) return null;
  const start = isHm(q?.start) ? q.start
    : (isHm(q?.from) ? q.from : (isHm(settings?.quietStart) ? settings.quietStart : DEFAULT_QUIET.start));
  const end = isHm(q?.end) ? q.end
    : (isHm(q?.to) ? q.to : (isHm(settings?.quietEnd) ? settings.quietEnd : DEFAULT_QUIET.end));
  if (start === end) return null;
  return { start, end };
}

export function isQuietAtMinutes(mins, settings) {
  const window = quietWindow(settings);
  if (!window) return false;
  const start = hmMinutes(window.start);
  const end = hmMinutes(window.end);
  const t = ((Math.trunc(Number(mins)) % 1440) + 1440) % 1440;
  if (start < end) return t >= start && t < end;
  return t >= start || t < end;
}

export function isQuietHours(now, settings) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) return false;
  return isQuietAtMinutes(date.getHours() * 60 + date.getMinutes(), settings);
}

/**
 * Whether this suggestion may notify right now.
 * 'send' is fine, 'later' waits for a clock window, 'never' means the
 * suggestion itself is quiet and the card is the only delivery.
 * A missing `quiet` field and a missing canNotify use the app window.
 */
export function suggestionHold({ now, settings, suggestion, canNotify } = {}) {
  if (suggestion && suggestion.quiet === true) return 'never';
  if (typeof canNotify === 'function') {
    let allowed;
    try { allowed = canNotify(now); } catch { allowed = undefined; }
    if (allowed === false) return 'later';
    if (allowed === true) return 'send';
  }
  if (typeof suggestion?.quiet === 'boolean') return suggestion.quiet ? 'never' : 'send';
  return isQuietHours(now, settings) ? 'later' : 'send';
}

/**
 * Whether a suggestion notification may go out.
 * 'send' now, 'later' because of quiet hours, 'skip' when notifications
 * are off, this idea was already sent, or the suggestion itself is quiet.
 */
export function noticePlan({ now, settings, permission, alreadyNotified, suggestion, canNotify } = {}) {
  if (alreadyNotified) return 'skip';
  if (normalizeSuggestFrequency(settings?.suggestFrequency) === 'off') return 'skip';
  const allowed = Boolean(settings?.remindersWanted) && permission === 'granted';
  if (!allowed) return 'skip';
  const hold = suggestionHold({ now, settings, suggestion, canNotify });
  if (hold === 'never') return 'skip';
  if (hold === 'later') return 'later';
  return 'send';
}

export function suggestionNoticeCopy(card, settings) {
  const names = settings?.showNames !== false;
  const title = names ? (card?.title || 'A goal for you') : 'A goal for you';
  const body = names ? (card?.reason || 'Your pet has an idea.') : 'Your pet has an idea.';
  return { title, body };
}

/** Open and resume always ask. While the app stays open, ask at most hourly. */
export function shouldAskSuggestion({ reason, lastAskedAt, now, hasCard }) {
  if (hasCard) return false;
  if (reason === 'open' || reason === 'resume') return true;
  const last = Number(lastAskedAt) || 0;
  if (!last) return true;
  return Number(now) - last >= SUGGEST_POLL_MS;
}

/** Small positive clip. Reduced motion and celebrations off stay still. */
export function suggestionGesture({ reducedMotion, celebrations } = {}) {
  if (reducedMotion) return null;
  if (celebrations === 'off') return null;
  return 'wave';
}

/**
 * Next sensible clock time today. Before 8:00 lands on 8:00.
 * After 21:00 there isn't a good slot left, so the task stays untimed.
 */
export function defaultSuggestionTime(now) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) return null;
  const h = date.getHours();
  const m = date.getMinutes();
  let hour = m === 0 ? h : h + 1;
  if (hour < 8) hour = 8;
  if (hour > 21) return null;
  return `${String(hour).padStart(2, '0')}:00`;
}

export function displaySuggestionTime(card, now) {
  if (isHm(card?.time)) return card.time;
  if (isHm(card?.suggestedTime)) return card.suggestedTime;
  return defaultSuggestionTime(now);
}

export function sanitizeSuggestCard(card) {
  if (!card || typeof card !== 'object') return null;
  const id = String(card.id || '').trim().slice(0, 80);
  const title = String(card.title || '').trim().slice(0, 120);
  if (!id || !title) return null;
  const difficulty = ['easy', 'medium', 'hard'].includes(card.difficulty) ? card.difficulty : 'easy';
  const repeat = card.repeat === 'daily' || card.repeat === 'weekly' ? card.repeat : null;
  const suggestedTime = isHm(card.suggestedTime) ? card.suggestedTime : null;
  const time = isHm(card.time) ? card.time : suggestedTime;
  const notice = card.notice === 'sent' || card.notice === 'later' || card.notice === 'skipped' ? card.notice : null;
  const quiet = typeof card.quiet === 'boolean' ? card.quiet : null;
  return {
    id,
    title,
    category: String(card.category || '').slice(0, 40),
    reason: String(card.reason || '').slice(0, 160),
    difficulty,
    suggestedTime,
    repeat,
    time,
    shown: Boolean(card.shown),
    notice,
    quiet,
  };
}

export function suggestionFromEngine(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return sanitizeSuggestCard({
    id: raw.id,
    title: raw.title,
    category: raw.category,
    reason: raw.reason,
    difficulty: raw.difficulty,
    suggestedTime: raw.suggestedTime,
    repeat: raw.repeat,
    quiet: raw.quiet,
    time: isHm(raw.suggestedTime) ? raw.suggestedTime : null,
    shown: false,
    notice: null,
  });
}

export function matchCategoryId(category, categories) {
  const list = Array.isArray(categories) ? categories : [];
  const want = String(category || '').trim().toLowerCase();
  if (want) {
    const exact = list.find((cat) => String(cat.id).toLowerCase() === want || String(cat.name).toLowerCase() === want);
    if (exact) return exact.id;
    if (want.length >= 3) {
      const loose = list.find((cat) => {
        const name = String(cat.name || '').toLowerCase();
        return name.includes(want) || want.includes(name);
      });
      if (loose) return loose.id;
    }
  }
  return list[0]?.id || 'goals';
}

export function repeatFields(repeat, date) {
  if (repeat === 'daily') return { repeat: 'daily', days: [] };
  if (repeat === 'weekly') return { repeat: 'days', days: [dayOfWeek(date)] };
  return { repeat: 'none', days: [] };
}

export function buildSuggestionTask(card, { now, date, categories, defaultLead } = {}) {
  const time = displaySuggestionTime(card, now || new Date());
  const rep = repeatFields(card?.repeat, date);
  const lead = Number(defaultLead);
  const remindLeadMin = time ? (Number.isFinite(lead) ? lead : 10) : null;
  const title = String(card?.title || '').trim().slice(0, 120) || 'New goal';
  return {
    title,
    categoryId: matchCategoryId(card?.category, categories),
    difficulty: ['easy', 'medium', 'hard'].includes(card?.difficulty) ? card.difficulty : 'easy',
    time: time || null,
    durationMin: null,
    remindLeadMin,
    note: '',
    repeat: rep.repeat,
    days: rep.days,
    until: null,
    date,
  };
}

export function suggestionBonusId(taskId) {
  return `suggest:${taskId}`;
}

/** One coin bonus per suggested task. `firstTime` is the engine's answer. */
export function applySuggestionBonus({ bonuses, taskId, firstTime, date }) {
  const list = Array.isArray(bonuses) ? bonuses.slice() : [];
  if (!firstTime || !taskId) return { bonuses: list, applied: false };
  const id = suggestionBonusId(taskId);
  if (list.some((row) => row && row.id === id)) return { bonuses: list, applied: false };
  list.push({
    id,
    kind: 'suggestion',
    taskId,
    date: date || null,
    points: 0,
    coins: SUGGESTION_COIN_BONUS,
  });
  return { bonuses: list, applied: true };
}

/**
 * Resolve the engine. A missing file or a module without getSuggestion
 * resolves to null instead of throwing.
 */
export async function resolveSuggestEngine(loader) {
  try {
    const mod = await loader();
    const engine = mod && typeof mod.getSuggestion === 'function' ? mod : null;
    if (!engine) return null;
    try {
      if (typeof engine.loadLibrary === 'function') await engine.loadLibrary();
    } catch { /* the picker can still answer without its library */ }
    return engine;
  } catch {
    return null;
  }
}
