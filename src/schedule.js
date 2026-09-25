// Pulls every rink's sources, normalizes sessions, and caches results.
import fs from 'node:fs/promises';
import path from 'node:path';
import { RINKS, STATES } from './rinks.js';
import { categorize, isCancelled, CATEGORY_LIST } from './categorize.js';
import { nyDate, nyToday, DAY_MS } from './time.js';
import { fetchIcs } from './sources/ics.js';
import { fetchFinnly } from './sources/finnly.js';
import { fetchPageText } from './sources/pageText.js';

const ADAPTERS = { ics: fetchIcs, finnly: fetchFinnly, pageText: fetchPageText };
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

function windowRange() {
  const t = nyToday();
  const from = nyDate(t.y, t.m, t.d);
  return { from, to: new Date(from.getTime() + WINDOW_DAYS * DAY_MS) };
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
      const raw = await ADAPTERS[source.type](source, windowRange());
      const sessions = raw.map((s, i) => {
        const text = s.categoryText ?? `${s.title} ${s.description || ''}`;
        return {
          id: `${key}#${i}`,
          rinkId: rink.id,
          title: s.title || 'Ice time',
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
