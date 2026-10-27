// Times entered by hand: manual/<rink id>.csv, for a rink whose own calendar leaves things out
// (a scheduler's weekly graphic, say). Read fresh on every build, so editing the file on GitHub
// publishes the change. Columns:
//
//   date,start,end,title,hide
//   2026-10-28,3:00 PM,4:00 PM,Stick & Puck: Bantams & older,
//   2026-10-29,11:15 AM,,,x
//
// A row with anything in `hide` removes the session the rink's calendar has starting then (for
// one the rink cancelled but never took down); it needs only the date and start. A blank line or
// one starting with # is skipped.
import fs from 'node:fs/promises';
import path from 'node:path';
import { zonedDate } from './time.js';

const DIR = path.resolve('manual');

// Fields split on commas; a field in double quotes can hold commas ("10U, 12U").
function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const cells = [];
    let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { cells.push(cur.trim()); cur = ''; } else cur += c;
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

// "3:00 PM", "3 pm", "15:00" -> [hour, minute]
function parseTime(s) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/i.exec(s || '');
  if (!m) return null;
  let h = +m[1];
  const ap = m[3]?.toLowerCase();
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  return [h, +(m[2] || 0)];
}

// { add: [{ title, start, end }], hide: [start ms] } for one rink; empty when it has no file.
export async function readManual(rinkId, tz) {
  let text;
  try { text = await fs.readFile(path.join(DIR, `${rinkId}.csv`), 'utf8'); } catch { return { add: [], hide: [] }; }
  const add = [], hide = [];
  const [head, ...rows] = parseCsv(text);
  const col = Object.fromEntries(head.map((h, i) => [h.toLowerCase(), i]));
  rows.forEach((r, i) => {
    const get = k => r[col[k]] || '';
    const where = `manual/${rinkId}.csv line ${i + 2}`;
    const d = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(get('date'));
    const st = parseTime(get('start'));
    if (!d || !st) { console.warn(`${where}: needs a date (2026-10-28) and a start time (3:00 PM); skipped`); return; }
    const start = zonedDate(tz, +d[1], +d[2], +d[3], ...st);
    if (get('hide')) { hide.push(start.getTime()); return; }
    const en = parseTime(get('end'));
    if (!en || !get('title')) { console.warn(`${where}: needs an end time and a title; skipped`); return; }
    let end = zonedDate(tz, +d[1], +d[2], +d[3], ...en);
    if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000); // runs past midnight
    add.push({ title: get('title'), start, end });
  });
  return { add, hide };
}
