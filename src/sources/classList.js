// Drop-in schedules on the booking platform Calgary uses (liveandplay.calgary.ca/REGPROG). Each
// category (Public Skate, Shinny) has one page per day listing every arena's sessions:
//   <base>/public/Category/ClassList?CategoryGUID=<guid>&StartDate=YYYY-MM-DD
// One page serves every arena in the city, so pages are shared between rinks for a few minutes.
//
// source: { type: 'classList', base: 'https://liveandplay.calgary.ca/REGPROG',
//           categories: ['<guid>', ...], venue: 'Rose Kohn Arena' (or a list), days: 28, exclude?: /goalies/i }
import { fetchText } from '../http.js';
import { zonedDate, zonedToday, DAY_MS } from '../time.js';

const SHARE_MS = 10 * 60 * 1000;
const pages = new Map(); // url -> { at, text: Promise<string> }

function page(url) {
  const hit = pages.get(url);
  if (hit && Date.now() - hit.at < SHARE_MS) return hit.text;
  const text = fetchText(url);
  pages.set(url, { at: Date.now(), text });
  text.catch(() => pages.delete(url));
  return text;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const clock = (h, m, ap) => ((+h % 12) + (/p/i.test(ap) ? 12 : 0)) * 60 + +m;

// The page lists each session as label/value lines: "<title>", "Date:", "Sat, 03-Oct-26",
// "Time:", "12:00 PM - 1:30 PM", ..., "Venue:", "Rose Kohn Arena".
function sessions(html, tz) {
  const lines = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '\n')
    .replace(/&amp;/g, '&').split('\n').map(s => s.trim()).filter(Boolean);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] !== 'Date:') continue;
    const date = /(\d{1,2})-([A-Za-z]{3})-(\d{2})/.exec(lines[i + 1] || '');
    const time = /(\d{1,2}):(\d{2})\s*([AP]M)\s*-\s*(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(lines[i + 3] || '');
    const v = lines.indexOf('Venue:', i);
    if (!date || !time || v < 0 || v > i + 12) continue;
    const [y, mo, d] = [2000 + +date[3], MONTHS.indexOf(date[2].toLowerCase()) + 1, +date[1]];
    const s = clock(time[1], time[2], time[3]), e = clock(time[4], time[5], time[6]);
    out.push({
      title: lines[i - 1],
      venue: lines[v + 1],
      start: zonedDate(tz, y, mo, d, Math.floor(s / 60), s % 60),
      end: zonedDate(tz, y, mo, d, Math.floor(e / 60), e % 60),
    });
  }
  return out;
}

export async function fetchClassList(source, { from, to, tz }) {
  const today = zonedToday(tz);
  const days = source.days || 28;
  const venues = [].concat(source.venue); // one arena, or every sheet of a multi-pad centre
  const urls = [];
  for (const guid of source.categories) {
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.UTC(today.y, today.m - 1, today.d) + i * DAY_MS).toISOString().slice(0, 10);
      urls.push(`${source.base}/public/Category/ClassList?CategoryGUID=${guid}&StartDate=${d}&Participant=00000000-0000-0000-0000-000000000000`);
    }
  }
  const out = [];
  for (const url of urls) {
    for (const s of sessions(await page(url), tz)) {
      if (!venues.includes(s.venue) || s.end < from || s.start > to || source.exclude?.test(s.title)) continue;
      out.push({ title: s.title.replace(/\s*\(book\)\s*$/i, ''), start: s.start, end: s.end });
    }
  }
  return out;
}
