// City of Montréal arena pages (e.g. https://montreal.ca/lieux/arena-mont-royal). Each activity
// (Patinage libre, Hockey libre, Bâton-rondelle, Patinage artistique) lists periods — "du
// <time datetime=…> au <time datetime=…>" — each with weekly tables per audience:
//   <h3>Pour toutes et tous</h3> … <td>Mardi</td><td><span>15 h 30</span> à <span>16 h 45</span></td>
// Sessions are those weekly times repeated through each period.
//
// source: { type: 'montrealArena', url: 'https://montreal.ca/lieux/arena-mont-royal' }
import { fetchText } from '../http.js';
import { zonedDate, DAY_MS } from '../time.js';

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const ACTIVITIES = /patinage|hockey|b[âa]ton/i;

const clean = s => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;| /g, ' ').replace(/&rsquo;|&#8217;/g, '’')
  .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const hm = s => { const m = /(\d{1,2})\s*h\s*(\d{2})?/.exec(s); return m ? [+m[1], +(m[2] || 0)] : null; };
const ymd = s => s.slice(0, 10).split('-').map(Number);

export async function fetchMontrealArena(source, { from, to, tz }) {
  const html = (await fetchText(source.url)).replace(/&nbsp;/g, ' ');
  const out = [];
  // One chunk per activity heading.
  for (const part of html.split(/<h2[^>]*>/i).slice(1)) {
    const activity = clean(part.slice(0, part.indexOf('</h2>')));
    if (!ACTIVITIES.test(activity)) continue;
    let period = null, audience = '';
    // Walk the chunk in order: period dates, audience headings, table rows.
    const re = /du\s*<time datetime="([^"]+)"[^>]*>[\s\S]*?au\s*<time datetime="([^"]+)"|<h3[^>]*>([\s\S]*?)<\/h3>|<tr>\s*<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
    for (const m of part.matchAll(re)) {
      if (m[1]) { period = [ymd(m[1]), ymd(m[2])]; audience = ''; continue; }
      if (m[3] !== undefined) { audience = clean(m[3]); continue; }
      const day = DAYS.indexOf(clean(m[4]).toLowerCase());
      if (!period || day < 0) continue;
      // A cell can hold several time ranges: "<span>9 h 00</span> à <span>10 h 15</span>".
      const times = [...m[5].matchAll(/<span>([^<]+)<\/span>\s*à\s*<span>([^<]+)<\/span>/g)].map(t => [hm(t[1]), hm(t[2])]);
      const title = audience ? `${activity} (${audience.replace(/^Pour\s+/i, 'pour ')})` : activity;
      const [[y1, m1, d1], [y2, m2, d2]] = period;
      for (let t = Date.UTC(y1, m1 - 1, d1); t <= Date.UTC(y2, m2 - 1, d2); t += DAY_MS) {
        const d = new Date(t);
        if (d.getUTCDay() !== day) continue;
        for (const [a, b] of times) {
          if (!a || !b) continue;
          const [y, mo, dd] = [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
          const start = zonedDate(tz, y, mo, dd, a[0], a[1]);
          const end = zonedDate(tz, y, mo, dd, b[0], b[1]);
          if (end < from || start > to) continue;
          out.push({ title, start, end, recurring: true });
        }
      }
    }
  }
  return out;
}
