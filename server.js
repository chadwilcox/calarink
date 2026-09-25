import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSchedule, loadCache } from './src/schedule.js';
import { STATES } from './src/rinks.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
process.chdir(ROOT);
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT) || 5178;
const HOST = process.env.HOST || '127.0.0.1'; // local machine only; set HOST=0.0.0.0 to share on your network

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/schedule' || url.pathname === '/schedule.json') {
      const data = await getSchedule({ force: url.searchParams.get('refresh') === '1' });
      return send(res, 200, JSON.stringify(data));
    }
    if (req.method !== 'GET') return send(res, 405, '{"error":"method not allowed"}');

    // State pages (/maine): the same page, with its files pointed back at the root.
    const slug = url.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
    if (STATES.some(s => s.slug === slug)) {
      const html = await fs.readFile(path.join(PUBLIC, 'index.html'), 'utf8');
      return send(res, 200, html.replace('<head>', '<head>\n  <base href="/">'), TYPES['.html']);
    }

    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'forbidden', 'text/plain');
    const body = await fs.readFile(file).catch(() => null);
    if (!body) return send(res, 404, 'not found', 'text/plain');
    send(res, 200, body, TYPES[path.extname(file)] || 'application/octet-stream');
  } catch (err) {
    console.error(err);
    send(res, 500, JSON.stringify({ error: String(err.message || err) }));
  }
});

await loadCache();
server.listen(PORT, HOST, () => {
  console.log(`Calarink running at http://localhost:${PORT}`);
  getSchedule().catch(() => {}); // warm the cache
});
