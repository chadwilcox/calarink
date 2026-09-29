// City of Toronto drop-in skating, from the city's open data (refreshed weekly, about six weeks
// ahead): https://open.toronto.ca/dataset/registered-programs-and-drop-in-courses-offering/
// Each row is a session at one location: leisure skate, shinny, pick-up hockey, figure skating.
//
// source: { type: 'torontoDropIn', locationId: 523 }   ("Location ID" in the Locations table)
import { fetchText } from '../http.js';
import { zonedDate, DAY_MS } from '../time.js';

const API = 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search';
const DROP_IN = 'c99ec04f-4540-482c-9ee4-efb38774eab4'; // the "Drop-in" table
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const ymd = s => String(s || '').split('-').map(Number);

function ages(r) {
  const min = parseInt(r['Age Min'], 10), max = parseInt(r['Age Max'], 10);
  if (min > 0 && max > 0) return `Ages ${min}–${max}`;
  if (min > 0) return `Ages ${min}+`;
  if (max > 0) return `Ages up to ${max}`;
  return '';
}

export async function fetchTorontoDropIn(source, { from, to, tz }) {
  const q = new URLSearchParams({
    resource_id: DROP_IN,
    limit: '5000',
    filters: JSON.stringify({ 'Location ID': source.locationId, Section: 'Skate - Drop-In' }),
  });
  const j = JSON.parse(await fetchText(`${API}?${q}`));
  if (!j.success) throw new Error('Toronto open data query failed');

  const out = [];
  for (const r of j.result.records) {
    const [y1, m1, d1] = ymd(r['First Date']);
    const [y2, m2, d2] = ymd(r['Last Date'] || r['First Date']);
    if (!y1) continue;
    // Rows are usually one date; a range repeats on its day of the week.
    const day = DAYS.indexOf(String(r.DayOftheWeek || '').toLowerCase());
    for (let t = Date.UTC(y1, m1 - 1, d1); t <= Date.UTC(y2, m2 - 1, d2); t += DAY_MS) {
      const d = new Date(t);
      if (day >= 0 && d.getUTCDay() !== day) continue;
      const [y, m, dd] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
      const start = zonedDate(tz, y, m, dd, +r['Start Hour'], +r['Start Minute']);
      const end = zonedDate(tz, y, m, dd, +r['End Hour'], +r['End Min']);
      if (end < from || start > to) continue;
      const title = String(r['Course Title'] || '').trim();
      // A drop-in "Figure Skating" session is open practice ice, which the site calls freestyle.
      out.push({ title, categoryText: /^figure skating\b/i.test(title) ? `Freestyle ${title}` : title, description: ages(r), start, end });
    }
  }
  return out;
}
