// MyRec (myrec.com), the parks & recreation booking site many towns use (bangorme.myrec.com).
//
// 'myrec' – the site's public calendar, through the same web service its calendar page calls
//   (/info/calendar/CalWebService.asmx/GetCalendarPublic). `facilityId` is the value of the
//   arena in the calendar page's location picker ("8710,0" -> 8710). It carries the dated
//   programs the town sells there (Learn to Skate), not walk-in ice.
//   source: { type: 'myrec', site: 'https://bangorme.myrec.com', facilityId: 8710 }
//
// 'myrecProgram' – a program page (/info/activities/program_details.aspx?ProgramID=<n>) that
//   posts a weekly timetable as headed blocks:
//     WEEKDAY PUBLIC SKATE / Cost: $3 per person / Days: Monday–Friday / Time: 12:30–1:30 PM
//     WEEKEND PUBLIC SKATE / Cost: $5 per person / Saturday: 3:30–5:00 PM / Sunday: 2:30–4:00 PM
//   Each block is repeated weekly for `projectWeekly` weeks. A line "Beginning Monday,
//   October 26" holds the timetable back until that date (the weeks before it are often a
//   modified schedule, described in prose). `titles` renames a heading where it wouldn't
//   sort into the right category on its own.
//   source: { type: 'myrecProgram', site, programId: 29198, projectWeekly: 8, titles: { 'Figure Skate': '...' } }
import { fetchText } from '../http.js';
import { zonedDate, zonedToday } from '../time.js';
import { htmlToLines, parseTimeRange } from './pageText.js';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAY_ALT = DAYS.join('|');

export async function fetchMyRec(source, { from, to, tz }) {
  const ymd = d => d.toISOString().slice(0, 10);
  const body = new URLSearchParams({
    SearchBy: '1', FacilityID: String(source.facilityId), AreaID: String(source.areaId || 0), FacilityTypeID: '0',
    AllowViewAll: 'false', ShowFacilities: 'false', EventType: '', Debug: 'false',
    start: ymd(new Date(from.getTime() - 86400000)), end: ymd(new Date(to.getTime() + 86400000)),
  });
  const events = JSON.parse(await fetchText(`${source.site}/info/calendar/CalWebService.asmx/GetCalendarPublic`, {
    method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }));

  // "11/1/2026 4:10:00 PM", local time
  const parse = s => {
    const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})(?::\d{2})? ([AP])M$/i.exec(String(s).trim());
    if (!m) return null;
    const h = (+m[4] % 12) + (m[6].toUpperCase() === 'P' ? 12 : 0);
    return zonedDate(tz, +m[3], +m[1], +m[2], h, +m[5]);
  };
  const out = [];
  for (const e of events) {
    const start = parse(e.start), end = parse(e.end);
    if (!start || !end || end < from || start > to) continue;
    const title = String(e.title || '').replace(/\\'/g, "'").trim();
    if (source.exclude?.test(title)) continue;
    out.push({ title, start, end });
  }
  return out;
}

// "Monday–Friday" -> [1..5]; "Tuesday & Thursday" -> [2, 4]
function parseDays(text) {
  const range = new RegExp(`\\b(${DAY_ALT})\\s*(?:-|–|—|through|thru|to)\\s*(${DAY_ALT})\\b`, 'i').exec(text);
  if (range) {
    const a = DAYS.indexOf(range[1].toLowerCase()), b = DAYS.indexOf(range[2].toLowerCase());
    const out = [];
    for (let d = a; ; d = (d + 1) % 7) { out.push(d); if (d === b) break; }
    return out;
  }
  return DAYS.map((d, i) => (new RegExp(`\\b${d}s?\\b`, 'i').test(text) ? i : -1)).filter(i => i >= 0);
}

const titleCase = s => s.toLowerCase().replace(/(^|[\s&/-])(\w)/g, (_, p, c) => p + c.toUpperCase());
const isHeading = l => /^[A-Z][A-Z0-9 &'/–-]{3,}$/.test(l) && /[A-Z]{3}/.test(l);

export async function fetchMyRecProgram(source, { from, to, tz }) {
  const url = `${source.site}/info/activities/program_details.aspx?ProgramID=${source.programId}`;
  const lines = htmlToLines(await fetchText(url));

  // The timetable starts after "Beginning Monday, October 26", if the page has one.
  let startAt = 0, effective = null;
  const begin = new RegExp(`^\\s*(?:beginning|starting|effective)\\b.*?\\b(${MONTHS.join('|')})\\s+(\\d{1,2})`, 'i');
  lines.forEach((l, i) => {
    const m = begin.exec(l);
    if (m && !effective) {
      const t = zonedToday(tz), month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
      const year = month < t.m - 6 ? t.y + 1 : t.y;
      effective = zonedDate(tz, year, month, +m[2]);
      startAt = i + 1;
    }
  });

  // Headed blocks -> [{ title, cost, slots: [{ days, time }] }]
  const blocks = [];
  let cur = null, pendingDays = null;
  for (const line of lines.slice(startAt)) {
    if (isHeading(line)) {
      if (/additional information|return to/i.test(line)) break;
      cur = { title: titleCase(line), cost: '', slots: [] };
      blocks.push(cur);
      pendingDays = null;
      continue;
    }
    if (!cur) continue;
    const cost = /^cost:\s*(.+)$/i.exec(line);
    if (cost) { cur.cost = cost[1]; continue; }
    const days = /^days?:\s*(.+)$/i.exec(line);
    if (days) { pendingDays = parseDays(days[1]); continue; }
    const time = parseTimeRange(line);
    if (!time) continue;
    const lead = /^([a-z ,&]+):/i.exec(line); // "Saturday: 3:30–5:00 PM"
    const d = lead && parseDays(lead[1]).length ? parseDays(lead[1]) : pendingDays;
    if (d?.length) cur.slots.push({ days: d, time });
  }
  const sessions = blocks.filter(b => b.slots.length);
  if (!sessions.length) throw new Error('no weekly schedule found on the program page');

  const t = zonedToday(tz);
  const out = [];
  for (let i = 0; i < (source.projectWeekly || 8) * 7; i++) {
    const cal = new Date(Date.UTC(t.y, t.m - 1, t.d + i));
    const [y, m, d, dow] = [cal.getUTCFullYear(), cal.getUTCMonth() + 1, cal.getUTCDate(), cal.getUTCDay()];
    if (effective && zonedDate(tz, y, m, d) < effective) continue;
    for (const b of sessions) {
      for (const s of b.slots) {
        if (!s.days.includes(dow)) continue;
        const start = zonedDate(tz, y, m, d, s.time.startH, s.time.startM);
        const end = zonedDate(tz, y, m, d, s.time.endH, s.time.endM);
        if (end < from || start > to) continue;
        out.push({
          title: source.titles?.[b.title] || b.title,
          description: [b.cost && `Cost: ${b.cost}`, 'Weekly schedule posted on the program page; hours may change.'].filter(Boolean).join('\n'),
          start, end, fromText: true, recurring: true,
        });
      }
    }
  }
  return out;
}
