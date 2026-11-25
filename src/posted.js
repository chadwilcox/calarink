// Times rink staff post on calarink.com/my-rink/ (kept by the Worker in plays-worker/). Read once per
// build; if the Worker can't be reached, the last copy (data/posted.json) is used.
import fs from 'node:fs/promises';
import path from 'node:path';
import { zonedDate, DAY_MS } from './time.js';

const URL_ = process.env.POSTED_URL || 'https://calarink.com/plays-api/rinks/schedule';
const FILE = path.resolve('data', 'posted.json');

export async function fetchPosted() {
  try {
    const res = await fetch(URL_, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { rinks } = await res.json();
    if (!rinks || typeof rinks !== 'object') throw new Error('unexpected reply');
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(rinks));
    return rinks;
  } catch (err) {
    console.warn(`Posted rink schedules: ${err.message}; using the last copy`);
    try { return JSON.parse(await fs.readFile(FILE, 'utf8')); } catch { return {}; }
  }
}

const day = s => s.split('-').map(Number);
const next = (s, n = 1) => new Date(Date.UTC(...day(s).map((x, i) => (i === 1 ? x - 1 : x))) + n * DAY_MS).toISOString().slice(0, 10);
const at = (tz, date, time = '00:00') => zonedDate(tz, ...day(date), ...time.split(':').map(Number));

// One rink's posted times as { sessions: [{ title, start, end, postedAt? }], off: [{ from, to, at }] }
// (off: times cancelled or closed, in ms). Weekly times stop once nobody has confirmed them lately.
export function expandPosted(posted, tz, { from, to }) {
  const sessions = [], off = [];
  const add = (e, date, extra) => {
    const start = at(tz, date, e.start);
    const end = at(tz, e.end <= e.start ? next(date) : date, e.end); // may run past midnight
    if (end >= from && start <= to) sessions.push({ title: e.title, start, end, ...extra });
  };
  const first = new Date(from.getTime() - DAY_MS).toISOString().slice(0, 10), last = to.toISOString().slice(0, 10);
  for (const e of posted?.entries || []) {
    if (e.kind === 'once') add(e, e.date, { postedAt: e.at });
    else if (e.kind === 'cancel') { const t = at(tz, e.date, e.start).getTime(); off.push({ from: t, to: t + 1, at: e.at }); }
    else if (e.kind === 'closed') off.push({ from: at(tz, e.date).getTime(), to: at(tz, next(e.until)).getTime(), at: e.at });
    else if (e.kind === 'weekly' && !posted.expired) {
      let d = e.from > first ? e.from : first;
      const dow = new Date(`${d}T12:00Z`).getUTCDay();
      d = next(d, (e.dow - dow + 7) % 7);
      for (const stop = e.until < last ? e.until : last; d <= stop; d = next(d, 7)) add(e, d, { recurring: true });
    }
  }
  return { sessions, off };
}

// A one-off added after a cancellation or closure replaces it, so it stays on.
export const isOff = (start, postedAt, off) => off.some(o => start >= o.from && start < o.to && !(postedAt && postedAt >= o.at));
