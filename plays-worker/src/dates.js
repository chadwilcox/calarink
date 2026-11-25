// Contest months are calendar months, Eastern time, named "2026-11".
const ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const monthOf = (date = new Date()) => ET.format(date).slice(0, 7);

// A clip approved in the last three days of a month waits for the next one, so nothing joins a
// contest that's nearly over.
export const LAST_DAYS = 3;
export const contestMonth = (date = new Date()) => addDays(ET.format(date), LAST_DAYS).slice(0, 7);
