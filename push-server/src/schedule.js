/** Pure reminder scheduling helpers. No Cloudflare APIs. */

const DAY = 24 * 60 * 60 * 1000;

export function clampReminders(reminders, nowMs, horizonMs = 7 * DAY) {
  return (reminders || []).filter((item) => {
    const t = Date.parse(item.fireAtUTC);
    return item.id && !Number.isNaN(t) && t <= nowMs + horizonMs;
  });
}

/**
 * Split stored reminders into ones to send, ones to keep, and ones to drop.
 * Due means fire time has arrived and is not older than maxAge (default 2 hours).
 * Anything past the 7-day horizon or too old to be useful is dropped.
 */
export function partitionDue(reminders, nowMs, { maxAgeMs = 2 * 60 * 60 * 1000, horizonMs = 7 * DAY } = {}) {
  const due = [];
  const keep = [];
  const drop = [];
  for (const item of reminders || []) {
    const t = Date.parse(item.fireAtUTC);
    if (!item.id || Number.isNaN(t) || t > nowMs + horizonMs) {
      drop.push(item);
      continue;
    }
    if (t <= nowMs && t >= nowMs - maxAgeMs) due.push(item);
    else if (t < nowMs - maxAgeMs) drop.push(item);
    else keep.push(item);
  }
  return { due, keep, drop };
}
