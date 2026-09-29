// ActiveNet (ActiveCommunities) drop-in calendars, e.g. Vancouver's "Public Skating & Ice Hockey":
// https://anc.ca.apm.activecommunities.com/vancouver/calendars?defaultCalendarId=3
// The calendar page reads its events from <site>/rest/onlinecalendar/multicenter/events.
// Center IDs are listed by POST <site>/rest/onlinecalendar/filters with {"calendar_id": N}.
//
// source: { type: 'activenet', site: 'https://anc.ca.apm.activecommunities.com/vancouver',
//           calendarId: 3, centerId: 28, exclude?: /goalies/i }
import { fetchText } from '../http.js';
import { parseNaive } from '../time.js';

// "Trout Lake Arena - Public Hockey - Monday 11:45am" -> "Public Hockey"; "|Public Skate|" -> "Public Skate"
const tidy = t => t.replace(/\|/g, '').replace(/^[^-]*\b(?:arena|rink)\s*-\s*/i, '')
  .replace(/\s*-\s*(?:mon|tues|wednes|thurs|fri|satur|sun)day\b.*$/i, '').trim();

export async function fetchActiveNet(source, { from, to, tz }) {
  const ymd = d => d.toISOString().slice(0, 10);
  const j = JSON.parse(await fetchText(`${source.site}/rest/onlinecalendar/multicenter/events?locale=en-US`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      calendar_id: source.calendarId, center_ids: [source.centerId], display_all: 0,
      search_start_time: ymd(from), search_end_time: ymd(to),
    }),
  }));
  if (j.headers?.response_code !== '0000') throw new Error(`ActiveNet: ${j.headers?.response_message || 'bad response'}`);

  const out = [];
  for (const center of j.body?.center_events || []) {
    for (const e of center.events || []) {
      const title = tidy(e.title || '');
      if (!title || source.exclude?.test(e.title)) continue;
      const start = parseNaive((e.start_time || '').replace(' ', 'T'), tz);
      const end = parseNaive((e.end_time || '').replace(' ', 'T'), tz);
      if (!start || !end || end < from || start > to) continue;
      out.push({ title, start, end });
    }
  }
  return out;
}
