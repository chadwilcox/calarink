// Contest weeks run Monday through Sunday, Eastern time, named by the Monday's date.
const ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });

export function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekday = day => (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0

export function weekOf(date = new Date()) {
  const day = ET.format(date);
  return addDays(day, -weekday(day));
}

// A clip approved on Saturday or Sunday waits for Monday, so nothing joins a week that's
// nearly over.
export function contestWeek(date = new Date()) {
  const week = weekOf(date);
  return weekday(ET.format(date)) >= 5 ? addDays(week, 7) : week;
}
