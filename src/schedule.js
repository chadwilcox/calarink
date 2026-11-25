// Pulls every rink's sources, normalizes sessions, and caches results.
import fs from 'node:fs/promises';
import path from 'node:path';
import { RINKS, STATES } from './rinks.js';
import { CATEGORY_LIST } from './categorize.js';
import { rinkTz, toSession, windowRange } from './session.js';
import { fetchIcs } from './sources/ics.js';
import { fetchFinnly } from './sources/finnly.js';
import { fetchPageText } from './sources/pageText.js';
import { fetchDaySmart } from './sources/daysmart.js';
import { fetchCourtReserve } from './sources/courtreserve.js';
import { fetchTorontoDropIn } from './sources/torontoDropIn.js';
import { fetchClassList } from './sources/classList.js';
import { fetchMontrealArena } from './sources/montrealArena.js';
import { fetchActiveNet } from './sources/activenet.js';
import { fetchMyRec, fetchMyRecProgram } from './sources/myrec.js';
import { readManual } from './manual.js';
import { fetchPosted } from './posted.js';
import { expandPosted, isOff } from './expand.js';

const ADAPTERS = { ics: fetchIcs, finnly: fetchFinnly, pageText: fetchPageText, daysmart: fetchDaySmart, courtreserve: fetchCourtReserve,
  torontoDropIn: fetchTorontoDropIn, classList: fetchClassList, montrealArena: fetchMontrealArena, activenet: fetchActiveNet,
  myrec: fetchMyRec, myrecProgram: fetchMyRecProgram,
};
const CACHE_TTL_MS = 30 * 60 * 1000;
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

// Hand-entered times (manual/<rink id>.csv) join the rink's pulled ones. A pulled session the file
// hides is dropped; a hand-entered one the rink's own calendar now has too (same kind of ice,
// starting within 15 minutes) is dropped, so the rink's copy wins.
function mergeManual(rink, pulled, manual) {
  const hidden = new Set(manual.hide);
  const kept = pulled.filter(s => !hidden.has(Date.parse(s.start)));
  const added = manual.add.map(s => ({ ...toSession(rink, s), manual: true }))
    .filter(m => !kept.some(p => p.category === m.category && Math.abs(Date.parse(p.start) - Date.parse(m.start)) <= 15 * 60 * 1000));
  return [...kept, ...added].sort((a, b) => a.start.localeCompare(b.start));
}

// Times the rink's staff post on My Rink. Cancellations and closures mark whatever is there
// cancelled; a posted time the rink's own calendar has too gives way to the calendar's.
function mergePosted(rink, sessions, posted) {
  if (!posted) return sessions;
  const tz = rinkTz(rink);
  const { sessions: extra, off } = expandPosted(posted, tz, windowRange(tz));
  const mark = s => (isOff(Date.parse(s.start), s.postedAt, off) && !s.cancelled ? { ...s, cancelled: true, offPosted: true } : s);
  const base = sessions.map(mark);
  const added = extra.map(s => mark({ ...toSession(rink, s), posted: true, ...(s.postedAt && { postedAt: s.postedAt }) }))
    .filter(m => !base.some(p => !p.cancelled && p.category === m.category && Math.abs(Date.parse(p.start) - Date.parse(m.start)) <= 15 * 60 * 1000));
  return [...base, ...added].sort((a, b) => a.start.localeCompare(b.start));
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
      const raw = await ADAPTERS[source.type](source, windowRange(rinkTz(rink)));
      const sessions = raw.map(s => toSession(rink, s));
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
  const postedAll = await fetchPosted();
  const rinkResults = await Promise.all(RINKS.map(async rink => {
    const sources = rink.sources || [];
    const [entries, manual] = await Promise.all([
      Promise.all(sources.map((s, i) => pullSource(rink, s, i, force))),
      readManual(rink.id, rinkTz(rink)),
    ]);
    const errors = entries.filter(e => e.error).map(e => e.error);
    const seen = new Map(); // the same title at the same time twice (two sheets): number the repeats
    const posted = postedAll[rink.id];
    const sessions = mergePosted(rink, mergeManual(rink, entries.flatMap(e => e.sessions || []), manual), posted).filter(s => Date.parse(s.end) >= now - 6 * 60 * 60 * 1000)
      .map(s => { const n = (seen.get(s.id) || 0) + 1; seen.set(s.id, n); return n > 1 ? { ...s, id: `${s.id}-${n}` } : s; });
    const { sources: _omit, ...meta } = rink;
    return {
      rink: {
        ...meta,
        live: sources.length > 0 || manual.add.length > 0 || sessions.some(s => s.posted),
        ...(posted && { posted: { updated: posted.updated, stale: posted.stale } }),
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
