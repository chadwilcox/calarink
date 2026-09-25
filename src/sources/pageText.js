// Schedules posted as plain text on a web page, e.g.
//   "Monday, September 21st ... 5:20 - 6:20 PM"     -> one dated session
//   "Sundays 3:50 - 4:50 PM"                        -> weekly session (projected forward)
// Pages like this change wording often, so every session from here is flagged
// `fromText` and the UI links back to the page.
import { fetchText } from '../http.js';
import { nyDate, nyToday } from '../time.js';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_RE = new RegExp(`\\b(${MONTHS.map(m => m.slice(0, 3) + `(?:${m.slice(3)})?`).join('|')})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i');
const TIME_RANGE_RE = /(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?/i;
const WEEKLY_RE = new RegExp(`^\\s*((?:${DAYS.join('|')})s\\b(?:\\s*(?:,|&|and)\\s*(?:${DAYS.join('|')})s\\b)*)`, 'i');

export function htmlToLines(html) {
  const text = html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ndash;/g, '–').replace(/&mdash;/g, '—')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
  return text.split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

function parseTimeRange(line) {
  const m = TIME_RANGE_RE.exec(line);
  if (!m) return null;
  const [, h1, m1 = '0', ap1, h2, m2 = '0', ap2] = m;
  if (!m[2] && !m[5] && !ap1) return null; // "21 - 25 pm"-style noise: need a colon or both meridiems
  const to24 = (h, ap) => (+h % 12) + (ap.toLowerCase() === 'p' ? 12 : 0);
  const endH = to24(h2, ap2);
  let startH = to24(h1, ap1 || ap2);
  // "11:00 - 1:00 PM" means 11 AM to 1 PM
  if (!ap1 && startH * 60 + +m1 > endH * 60 + +m2) startH -= 12;
  return { startH, startM: +m1, endH, endM: +m2 };
}

// Pick the year that puts month/day closest to today (schedules straddle New Year's).
function inferYear(month, day) {
  const t = nyToday();
  const today = Date.UTC(t.y, t.m - 1, t.d);
  let best = t.y, bestDiff = Infinity;
  for (const y of [t.y - 1, t.y, t.y + 1]) {
    const diff = Math.abs(Date.UTC(y, month - 1, day) - today);
    if (diff < bestDiff) { best = y; bestDiff = diff; }
  }
  return best;
}

export async function fetchPageText(source, { from, to }) {
  const lines = htmlToLines(await fetchText(source.url));
  const out = [];
  const titleFor = line => (/youth/i.test(line) ? `${source.title} (Youth)` : /adult/i.test(line) ? `${source.title} (Adult)` : source.title);

  // Months mentioned alongside "every ..." limit how far weekly sessions are projected.
  const everyLine = lines.find(l => /\bevery\b/i.test(l) && MONTHS.some(m => l.toLowerCase().includes(m)));
  const allowedMonths = everyLine ? MONTHS.map((m, i) => (everyLine.toLowerCase().includes(m) ? i + 1 : 0)).filter(Boolean) : null;

  for (const line of lines) {
    const tr = parseTimeRange(line);
    if (!tr) continue;

    const dm = MONTH_RE.exec(line);
    if (dm) {
      const month = MONTHS.findIndex(m => m.startsWith(dm[1].toLowerCase().slice(0, 3))) + 1;
      const day = +dm[2];
      const year = inferYear(month, day);
      const start = nyDate(year, month, day, tr.startH, tr.startM);
      const end = nyDate(year, month, day, tr.endH, tr.endM);
      if (end >= from && start <= to) out.push({ title: titleFor(line), description: line, start, end, fromText: true });
      continue;
    }

    const wm = WEEKLY_RE.exec(line);
    if (wm && source.projectWeekly) {
      const days = DAYS.map((d, i) => (new RegExp(`\\b${d}s\\b`, 'i').test(wm[1]) ? i : -1)).filter(i => i >= 0);
      const today = nyToday();
      for (let i = 0; i < source.projectWeekly * 7; i++) {
        const cal = new Date(Date.UTC(today.y, today.m - 1, today.d + i));
        const ymd = [cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate()];
        if (!days.includes(cal.getUTCDay())) continue;
        if (allowedMonths && !allowedMonths.includes(ymd[1])) continue;
        const start = nyDate(ymd[0], ymd[1], ymd[2], tr.startH, tr.startM);
        const end = nyDate(ymd[0], ymd[1], ymd[2], tr.endH, tr.endM);
        if (end >= from && start <= to) out.push({ title: titleFor(line), description: `Weekly: ${line}`, start, end, fromText: true, recurring: true });
      }
    }
  }
  return out;
}
