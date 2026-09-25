// Time helpers. All rinks are in Maine, so "local" always means America/New_York.
export const TZ = 'America/New_York';

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});

// Offset (ms) between New York wall-clock time and UTC at a given instant.
function nyOffset(date) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// Convert a New York wall-clock time to a real Date (handles DST).
export function nyDate(y, mo, d, h = 0, mi = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - nyOffset(new Date(guess));
  t = guess - nyOffset(new Date(t)); // second pass settles DST edges
  return new Date(t);
}

// Parse "2026-09-18T10:00:00" (no zone) as New York local time.
export function parseNaiveNy(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  return nyDate(+m[1], +m[2], +m[3], +m[4], +m[5]);
}

// Today's date parts in New York.
export function nyToday() {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date()).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}

export const DAY_MS = 24 * 60 * 60 * 1000;
