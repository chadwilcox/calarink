// Finnly Connect public schedule pages (e.g. https://tciv.finnlyconnect.com/schedule/612).
// The page embeds the whole schedule as a JSON array in `_onlineScheduleList = [...]`.
import { fetchText } from '../http.js';
import { parseNaiveNy } from '../time.js';

export async function fetchFinnly(source, { from, to }) {
  const html = await fetchText(source.url);
  const m = /_onlineScheduleList\s*=\s*(\[[\s\S]*?\]);\s*\n/.exec(html);
  if (!m) throw new Error('Schedule data not found on Finnly page (page layout may have changed)');
  const rows = JSON.parse(m[1]);

  const out = [];
  for (const r of rows) {
    if (r.Closed) continue;
    const start = parseNaiveNy(r.EventStartTime || r.start);
    const end = parseNaiveNy(r.EventEndTime || r.end);
    if (!start || !end || end < from || start > to) continue;
    const type = (r.EventTypeName || '').trim();
    const account = (r.AccountName || '').trim();
    // Public sessions carry their real name in Description ("Activity: $2 Tuesdays Public Skate");
    // some rinks file them all under one type ("Public Sessions"), so prefer it when present.
    const activity = /^\s*Activity:\s*(.+)/i.exec(r.Description || '')?.[1].trim();
    // Otherwise show the event type; add the account (team/group) when it says something different.
    const title = activity || (account && account.toLowerCase() !== type.toLowerCase() ? `${type} — ${account}` : type || account);
    out.push({
      title,
      categoryText: activity || type, // classify on the activity/event type, not the renter's name
      description: [r.ScheduleNotes, r.FacilityName].filter(Boolean).join(' · '),
      start, end,
    });
  }
  return out;
}
