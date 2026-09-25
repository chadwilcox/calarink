// DaySmart Recreation ("Dash") schedules, via the same public API the rink's online booking
// page uses: https://api.dashplatform.com/v1/events?company=<slug>. The slug is in the rink's
// links to apps.daysmartrecreation.com/dash/x/#/online/<slug>/...
//
// source: { type: 'daysmart', company: 'stamford', facilityIds?: [1] }
// Times come with a GMT copy (start_gmt), so no time-zone guessing is needed.
import { fetchText } from '../http.js';
import { categorize, OTHER } from '../categorize.js';

const API = 'https://api.dashplatform.com/v1/events';
const PAGE_SIZE = 100;
const MAX_PAGES = 40;

const ymd = d => d.toISOString().slice(0, 10);
const gmt = s => (s ? new Date(`${s}Z`) : null);

export async function fetchDaySmart(source, { from, to }) {
  const included = new Map(); // "type:id" -> attributes
  const events = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = new URLSearchParams({
      'cache[save]': 'false',
      company: source.company,
      'filter[start_date__gte]': ymd(new Date(from.getTime() - 86400000)),
      'filter[start_date__lte]': ymd(new Date(to.getTime() + 86400000)),
      'page[size]': String(PAGE_SIZE),
      'page[number]': String(page),
      sort: 'start',
      include: 'summary,eventType,resource',
    });
    const j = JSON.parse(await fetchText(`${API}?${q}`));
    for (const x of j.included || []) included.set(`${x.type}:${x.id}`, x.attributes);
    events.push(...(j.data || []));
    if (page >= (j.meta?.page?.['last-page'] ?? 1)) break;
  }

  const rel = (e, name) => {
    const d = e.relationships?.[name]?.data;
    return d ? included.get(`${d.type}:${d.id}`) : undefined;
  };

  const out = [];
  for (const e of events) {
    const a = e.attributes;
    if (!a.publish) continue;
    const resource = rel(e, 'resource');
    if (source.facilityIds && resource && !source.facilityIds.includes(resource.facility_id)) continue;
    const start = gmt(a.start_gmt), end = gmt(a.end_gmt);
    if (!start || !end || end < from || start > to) continue;

    const type = (rel(e, 'eventType')?.name || '').trim();
    const name = (rel(e, 'summary')?.name || (a.desc || '').replace(/^\s*(class|event|program)\s*:\s*/i, '')).trim();
    // Rentals are booked by a customer; show the type, never the customer's name.
    const isBooking = /rental|private|customer/i.test(type) || rel(e, 'eventType')?.has_customer;
    const title = isBooking ? (type || 'Rental') : name && name.toLowerCase() !== type.toLowerCase() ? name : type || name;
    out.push({
      title,
      // The session's own name decides ("Shinny" filed under a "Stick & Puck" type is shinny);
      // the event type only helps when the name says nothing.
      categoryText: isBooking ? type : categorize(name) !== OTHER.id ? name : `${name} ${type}`,
      description: resource?.name || '',
      start, end,
    });
  }
  return out;
}
