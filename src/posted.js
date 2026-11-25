// Times rink staff post on calarink.com/my-rink/ (kept by the Worker in plays-worker/). Read once per
// build; if the Worker can't be reached, the last copy (data/posted.json) is used.
import fs from 'node:fs/promises';
import path from 'node:path';

const URL_ = process.env.POSTED_URL || 'https://calarink.com/plays-api/rinks/schedule';
const FILE = path.resolve('data', 'posted.json');

export async function fetchPosted() {
  try {
    const res = await fetch(URL_, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { rinks } = await res.json();
    if (!rinks || typeof rinks !== 'object') throw new Error('unexpected reply');
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE, JSON.stringify(rinks));
    return rinks;
  } catch (err) {
    console.warn(`Posted rink schedules: ${err.message}; using the last copy`);
    try { return JSON.parse(await fs.readFile(FILE, 'utf8')); } catch { return {}; }
  }
}
