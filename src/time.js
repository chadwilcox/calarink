// Time helpers. Each state has its own time zone (STATES in rinks.js); rinks read schedules
// that give local wall-clock times with no zone, so these convert wall-clock <-> real instants.
export const DEFAULT_TZ = 'America/New_York';

const fmtCache = new Map();
function partsFmt(tz) {
  if (!fmtCache.has(tz)) fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }));
  return fmtCache.get(tz);
}
const partsOf = (date, tz) => Object.fromEntries(partsFmt(tz).formatToParts(date).map(x => [x.type, x.value]));

// Offset (ms) between wall-clock time in `tz` and UTC at a given instant.
function offset(date, tz) {
  const p = partsOf(date, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// Convert a wall-clock time in `tz` to a real Date (handles DST).
export function zonedDate(tz, y, mo, d, h = 0, mi = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - offset(new Date(guess), tz);
  t = guess - offset(new Date(t), tz); // second pass settles DST edges
  return new Date(t);
}

// Parse "2026-09-18T10:00:00" (no zone) as wall-clock time in `tz`.
export function parseNaive(s, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || '');
  if (!m) return null;
  return zonedDate(tz, +m[1], +m[2], +m[3], +m[4], +m[5]);
}

// Today's date parts in `tz`.
export function zonedToday(tz) {
  const p = partsOf(new Date(), tz);
  return { y: +p.year, m: +p.month, d: +p.day };
}

export const DAY_MS = 24 * 60 * 60 * 1000;
