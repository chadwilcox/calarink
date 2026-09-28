// CourtReserve public calendars (e.g. https://book.midcoastrec.org/Online/Public/EmbedCode/16147/58434).
// The calendar page reads its events over SignalR (hub "calendarEventsHub", method "read"), and
// every occurrence comes back with UTC times — recurring sessions and programs included. We speak
// SignalR's long-polling transport over plain HTTP: negotiate -> connect -> start -> send(read).
//
// source: { type: 'courtreserve', url: '<embed calendar url>', categories: /hockey|skat/i, exclude?: /off-ice only/i }
// `categories` picks the org's event categories by name; a multi-sport club lists tennis,
// pickleball and golf on the same calendar. `exclude` drops sessions by name.
import https from 'node:https';
import { DAY_MS } from '../time.js';
import { categorize, OTHER } from '../categorize.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';
const HUB = 'calendareventshub';
const CHUNK_DAYS = 42; // what the page's own month view asks for

// Node's fetch() gets Cloudflare challenges on some CourtReserve hosts; node:https doesn't,
// and it lets us carry the SignalR session cookie by hand.
function request(url, { method = 'GET', body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method,
      headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
      timeout: 30000,
    }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => res.statusCode === 200
        ? resolve({ body: data, cookies: (res.headers['set-cookie'] || []).map(c => c.split(';')[0]) })
        : reject(new Error(`HTTP ${res.statusCode} from ${new URL(url).host}`)));
    });
    req.on('timeout', () => req.destroy(new Error(`Timed out reading ${new URL(url).host}`)));
    req.on('error', reject);
    req.end(body);
  });
}

const decode = s => s.replace(/&amp;/g, '&').replace(/\\u0026/g, '&');

// "Freestyle Ice (Fall) - Wednesdays, 3:40 pm" -> "Freestyle Ice"; the day and time are on the listing.
const tidy = t => t
  .replace(/\s*\((?:fall|winter|spring|summer)\)/gi, '')
  .replace(/\s*-\s*(?:mon|tues|wednes|thurs|fri|satur|sun)days?\b.*$/i, '')
  .trim();

export async function fetchCourtReserve(source, { from, to, tz }) {
  const origin = new URL(source.url).origin;
  const orgId = /\/(\d+)\//.exec(new URL(source.url).pathname)?.[1];
  const page = (await request(source.url, { headers: { Accept: 'text/html' } })).body;
  const categoryIds = [...page.matchAll(/"#category_checkbox_(\d+)"\)\.kendoCheckBox\(\{[^}]*"label":"([^"]*)"/g)]
    .filter(m => source.categories.test(decode(m[2])))
    .map(m => m[1]);
  if (!orgId || !categoryIds.length) throw new Error('No matching CourtReserve event categories (page layout may have changed)');
  const costTypeId = /CostTypeId: '(\d+)'/.exec(page)?.[1] || '';

  const jar = new Set();
  const call = async (path, opts = {}) => {
    const res = await request(`${origin}/signalr/${path}`, { ...opts, headers: { ...opts.headers, Cookie: [...jar].join('; ') } });
    res.cookies.forEach(c => jar.add(c));
    return res.body;
  };
  const connectionData = encodeURIComponent(JSON.stringify([{ name: HUB }]));
  const { ConnectionToken } = JSON.parse(await call(`negotiate?clientProtocol=2.1&connectionData=${connectionData}`));
  const qs = `transport=longPolling&clientProtocol=2.1&connectionToken=${encodeURIComponent(ConnectionToken)}&connectionData=${connectionData}`;
  await call(`connect?${qs}`);
  await call(`start?${qs}`);

  const ymd = d => {
    const [y, m, day] = d.toLocaleDateString('en-CA', { timeZone: tz }).split('-').map(Number);
    return { Year: y, Month: m, Day: day };
  };
  const events = [];
  try {
    for (let s = from, i = 0; s < to; s = new Date(s.getTime() + CHUNK_DAYS * DAY_MS), i++) {
      const e = new Date(Math.min(s.getTime() + CHUNK_DAYS * DAY_MS, to.getTime()));
      const criteria = {
        startDate: s, end: e, Date: s.toUTCString(),
        orgId, TimeZone: tz, KendoStart: ymd(s), KendoEnd: ymd(e),
        Categories: categoryIds, CostTypeId: costTypeId, MonthlySelectedDate: '',
        IncludeLeagues: 'True', IncludeEvents: true,
      };
      const data = JSON.stringify({ H: HUB, M: 'read', A: [JSON.stringify(criteria)], I: i });
      const reply = JSON.parse(await call(`send?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams({ data }).toString(),
      }));
      if (reply.E) throw new Error(`CourtReserve calendar: ${reply.E}`);
      events.push(...(reply.R || []));
    }
  } finally {
    call(`abort?${qs}`, { method: 'POST' }).catch(() => {});
  }

  const out = [];
  const seen = new Set();
  for (const e of events) {
    const name = (e.EventName || e.Title || '').trim();
    if (source.exclude?.test(name)) continue;
    const start = new Date(e.Start), end = new Date(e.End);
    if (isNaN(start) || isNaN(end) || end < from || start > to) continue;
    const key = e.UqId ? `${e.UqId}|${e.ReservationId}` : `${name}|${e.Start}`;
    if (seen.has(key)) continue; // chunks overlap at their edges
    seen.add(key);
    const title = tidy(name) || name;
    out.push({
      title,
      // The session's own name decides; the category ("Public Skate") helps when it says nothing.
      categoryText: categorize(title) !== OTHER.id ? title : `${title} ${e.EventType || ''}`,
      description: e.EventNote || '',
      start, end,
    });
  }
  return out;
}
