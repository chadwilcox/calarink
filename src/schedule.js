// Pulls every rink's sources, normalizes sessions, and caches results.
import fs from 'node:fs/promises';
import path from 'node:path';
import { RINKS, STATES } from './rinks.js';
import { categorize, isCancelled, CATEGORY_LIST } from './categorize.js';
import { zonedDate, zonedToday, DAY_MS, DEFAULT_TZ } from './time.js';
import { fetchIcs } from './sources/ics.js';
import { fetchFinnly } from './sources/finnly.js';
import { fetchPageText } from './sources/pageText.js';
import { fetchDaySmart } from './sources/daysmart.js';

const ADAPTERS = { ics: fetchIcs, finnly: fetchFinnly, pageText: fetchPageText, daysmart: fetchDaySmart };
const TZ_BY_STATE = Object.fromEntries(STATES.map(s => [s.code, s.tz || DEFAULT_TZ]));
const CACHE_TTL_MS = 30 * 60 * 1000;
const WINDOW_DAYS = 120;
const CACHE_FILE = path.resolve('data', 'cache.json');

// sourceKey -> { fetchedAt, sessions?, error? }
let cache = new Map();
const inflight = new Map();

export async function loadCache() {
  try {
    const raw = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
    cache = new Map(Object.entries(raw));
  } catch { /* first run */ }
}

async function saveCache() {
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(Object.fromEntries(cache)));
}

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

// From the start of today in the rink's time zone. `tz` goes to the adapters too, for
// schedules that give local times with no zone.
function windowRange(tz) {
  const t = zonedToday(tz);
  const from = zonedDate(tz, t.y, t.m, t.d);
  return { from, to: new Date(from.getTime() + WINDOW_DAYS * DAY_MS), tz };
}

async function pullSource(rink, source, index, force) {
  const key = `${rink.id}#${index}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit;
  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    const started = Date.now();
    let entry;
    try {
      const raw = await ADAPTERS[source.type](source, windowRange(TZ_BY_STATE[rink.state] || DEFAULT_TZ));
      const sessions = raw.map((s, i) => {
        const text = s.categoryText ?? `${s.title} ${s.description || ''}`;
        return {
          id: `${key}#${i}`,
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
      });
      entry = { fetchedAt: Date.now(), ms: Date.now() - started, sessions };
    } catch (err) {
      // Keep the last good data if we have it, but surface the error.
      entry = { fetchedAt: Date.now(), ms: Date.now() - started, error: String(err.message || err), sessions: hit?.sessions ?? [], stale: !!hit?.sessions?.length };
      console.warn(`[${rink.id}] ${entry.error}`);
    }
    cache.set(key, entry);
    return entry;
  })().finally(() => inflight.delete(key));

  inflight.set(key, job);
  return job;
}

export async function getSchedule({ force = false } = {}) {
  const now = Date.now();
  const rinkResults = await Promise.all(RINKS.map(async rink => {
    const sources = rink.sources || [];
    const entries = await Promise.all(sources.map((s, i) => pullSource(rink, s, i, force)));
    const errors = entries.filter(e => e.error).map(e => e.error);
    const sessions = entries.flatMap(e => e.sessions || []).filter(s => Date.parse(s.end) >= now - 6 * 60 * 60 * 1000);
    const { sources: _omit, ...meta } = rink;
    return {
      rink: {
        ...meta,
        live: sources.length > 0,
        sourceTypes: [...new Set(sources.map(s => s.type))],
        status: sources.length ? {
          ok: errors.length === 0,
          errors,
          fetchedAt: Math.min(...entries.map(e => e.fetchedAt)),
          count: sessions.length,
        } : null,
      },
      sessions,
    };
  }));
  await saveCache().catch(err => console.warn('cache save failed:', err.message));

  return {
    generatedAt: new Date().toISOString(),
    categories: CATEGORY_LIST,
    states: STATES,
    rinks: rinkResults.map(r => r.rink),
    sessions: rinkResults.flatMap(r => r.sessions).sort((a, b) => a.start.localeCompare(b.start)),
  };
}
