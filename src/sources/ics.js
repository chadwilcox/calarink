// iCalendar (.ics) feeds, e.g. a public Google Calendar.
// Expands recurring events and applies per-occurrence overrides/cancellations.
import ICAL from 'ical.js';
import { fetchText } from '../http.js';

const MAX_OCCURRENCES_PER_EVENT = 5000;
const SLACK_DAYS = 2; // DTSTART dates are compared as bare YYYYMMDD, so pad for time zones

// Some feeds carry years of history (Penobscot Ice Arena: ~20k events, 6 MB), and
// ical.js gets slow and memory-hungry on those. Drop one-off events outside the
// window on the raw text before parsing. Recurring masters are kept unless their
// UNTIL has passed; overrides are kept if either their original or new date is in range.
function trimToWindow(text, from, to) {
  const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
  const lo = ymd(new Date(from.getTime() - SLACK_DAYS * 864e5));
  const hi = ymd(new Date(to.getTime() + SLACK_DAYS * 864e5));
  const inRange = d => d && d >= lo && d <= hi;
  const dateOf = (block, prop) => block.match(new RegExp(`^${prop}[;:][^\\r\\n]*?(\\d{8})`, 'm'))?.[1];

  return text.replace(/BEGIN:VEVENT[\s\S]*?END:VEVENT\r?\n?/g, block => {
    if (/^(RRULE|RDATE)[;:]/m.test(block)) {
      const until = block.match(/^RRULE:[^\r\n]*UNTIL=(\d{8})/m)?.[1];
      return until && until < lo ? '' : block;
    }
    return inRange(dateOf(block, 'DTSTART')) || inRange(dateOf(block, 'RECURRENCE-ID')) ? block : '';
  });
}

export async function fetchIcs(source, { from, to }) {
  const text = trimToWindow(await fetchText(source.url), from, to);
  const root = new ICAL.Component(ICAL.parse(text));

  for (const tz of root.getAllSubcomponents('vtimezone')) {
    const tzid = tz.getFirstPropertyValue('tzid');
    if (tzid && !ICAL.TimezoneService.has(tzid)) ICAL.TimezoneService.register(tz);
  }

  const masters = new Map();
  const loose = [];
  for (const ve of root.getAllSubcomponents('vevent')) {
    const ev = new ICAL.Event(ve);
    if (ev.isRecurrenceException()) loose.push(ev);
    else masters.set(ev.uid, ev);
  }
  const singles = [];
  for (const ex of loose) {
    const master = masters.get(ex.uid);
    if (master) master.relateException(ex);
    else singles.push(ex);
  }

  const out = [];
  const push = (item, start, end) => {
    if (start.isDate) return; // all-day entries are notes/holds, not ice times
    if (item.component.getFirstPropertyValue('status') === 'CANCELLED') return;
    const s = start.toJSDate(), e = end.toJSDate();
    if (e < from || s > to) return;
    out.push({
      title: (item.summary || '').trim(),
      description: (item.description || '').trim(),
      start: s, end: e,
    });
  };

  const rangeEnd = ICAL.Time.fromJSDate(to, true);
  for (const ev of [...masters.values(), ...singles]) {
    if (!ev.isRecurring()) { push(ev, ev.startDate, ev.endDate); continue; }
    const it = ev.iterator();
    let next, n = 0;
    while ((next = it.next()) && n++ < MAX_OCCURRENCES_PER_EVENT) {
      if (next.compare(rangeEnd) > 0) break;
      const occ = ev.getOccurrenceDetails(next);
      push(occ.item, occ.startDate, occ.endDate);
    }
  }
  return out;
}
