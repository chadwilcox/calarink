// Static build for GitHub Pages: pull every rink once and write dist/ (the web page + schedule.json).
// Run from the project root (`npm run build`). The workflow restores data/cache.json from the
// previous run first, so a rink whose site is down keeps its last good copy instead of going blank.
import fs from 'node:fs/promises';
import path from 'node:path';
import { getSchedule, loadCache } from '../src/schedule.js';
import { STATES } from '../src/rinks.js';

const DIST = 'dist';

await loadCache();
const data = { ...(await getSchedule({ force: true })), static: true };

const failed = data.rinks.filter(r => r.status && !r.status.ok);
for (const r of failed) console.warn(`[${r.id}] ${r.status.errors.join('; ')}`);
console.log(`${data.sessions.length} sessions from ${data.rinks.filter(r => r.live).length} live rinks (${failed.length} with errors)`);

// Every source failing (e.g. no network) would publish an empty site; keep the old one instead.
if (!data.sessions.length) {
  console.error('No sessions pulled from any rink; not publishing.');
  process.exit(1);
}

await fs.rm(DIST, { recursive: true, force: true });
await fs.cp('public', DIST, { recursive: true });
await fs.writeFile(path.join(DIST, 'schedule.json'), JSON.stringify(data));
await fs.writeFile(path.join(DIST, '.nojekyll'), '');

// One page per state (calarink.com/maine/). Same page; <base> points its files back at the root,
// and app.js reads the state from the address.
const html = await fs.readFile(path.join('public', 'index.html'), 'utf8');
for (const s of STATES) {
  await fs.mkdir(path.join(DIST, s.slug), { recursive: true });
  await fs.writeFile(path.join(DIST, s.slug, 'index.html'), html.replace('<head>', '<head>\n  <base href="../">'));
}
