// How a time becomes a session on the site. Used by the build, and by the Top Plays / My Rink
// Worker so times a rink posts look the same before the next build.
import { STATES } from './rinks.js';
import { categorize, isCancelled } from './categorize.js';
import { zonedDate, zonedToday, DAY_MS, DEFAULT_TZ } from './time.js';

const TZ_BY_STATE = Object.fromEntries(STATES.map(s => [s.code, s.tz || DEFAULT_TZ]));
const WINDOW_DAYS = 120;

// Rinks often stamp the season on every session ("Public Skating Sept-Dec 2026 - Weekend",
// "Open Skate Oct. 2026", "Hockey 101 Fall '26"); the date is already on the listing.
const MON = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const YEAR = "(?:'\\d{2}|20\\d{2})\\b"; // '26 or 2026 — never a bare day number like "Oct. 12"
const SEASON_RE = new RegExp(`\\s*\\b(?:${MON}\\s*[-–/]\\s*${MON}\\s*${YEAR}|${MON}\\s+${YEAR}|(?:fall|winter|spring|summer)\\s*${YEAR}(?:\\s*[-–/]\\s*${YEAR})?)`, 'gi');
function tidyTitle(t) {
  return String(t || '')
    .replace(SEASON_RE, '')
    .replace(/^(.+?)\s+\1$/i, '$1')          // "Open Skate Open Skate"
    .replace(/\s*[-–—|]\s*$/, '')          // dangling separator left behind
    .replace(/\s*[-–—]\s*[-–—]\s*/g, ' — ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// A session's id is its address in a shared link (calarink.com/maine/?event=<id>), so it must
// stay the same while the session does: the rink, the start time and a short hash of the title
// ("usm-gorham.20261003T1700.k3f9"), never its position in the rink's calendar, which shifts
// whenever the rink adds or removes something.
function sessionId(rinkId, start, title) {
  let h = 2166136261; // FNV-1a
  for (const c of title.toLowerCase()) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  return `${rinkId}.${start.toISOString().slice(0, 16).replace(/[-:]/g, '')}.${(h >>> 0).toString(36).slice(0, 4)}`;
}

// From the start of today in the rink's time zone. `tz` goes to the adapters too, for
// schedules that give local times with no zone.
export function windowRange(tz) {
  const t = zonedToday(tz);
  const from = zonedDate(tz, t.y, t.m, t.d);
  return { from, to: new Date(from.getTime() + WINDOW_DAYS * DAY_MS), tz };
}

export const rinkTz = rink => rink.tz || TZ_BY_STATE[rink.state] || DEFAULT_TZ;

export function toSession(rink, s) {
  const text = s.categoryText ?? `${s.title} ${s.description || ''}`;
  return {
    id: sessionId(rink.id, s.start, tidyTitle(s.title) || 'Ice time'),
    rinkId: rink.id,
    title: tidyTitle(s.title) || 'Ice time',
    description: s.description || '',
    category: categorize(text),
    cancelled: isCancelled(`${s.title} ${s.description || ''}`),
    start: s.start.toISOString(),
    end: s.end.toISOString(),
    fromText: !!s.fromText,
    recurring: !!s.recurring,
  };
}

