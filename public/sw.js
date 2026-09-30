// Service worker: lets Calarink be installed as an app and open without a connection.
//
// - Files stamped with ?v=<hash> by the build (app.js, styles.css, logo.svg) never change at that
//   address, so they come from the cache once saved.
// - Everything else (the page, schedule.json, sessions/<state>.json, unstamped files on the local
//   server) comes from the network, and the last good copy is saved for when it can't be reached.
//   Schedules are saved under their address without the query (sessions/maine.json), one copy each.
// - A state page (/maine/) that was never saved falls back to the saved main page, pointed back
//   at the site root the same way the build's state pages are.
const CACHE = 'calarink-v1';
const ROOT = new URL('./', self.location).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Save the main page and the files it names, so the app opens offline after the first visit.
    const cache = await caches.open(CACHE);
    const res = await fetch(ROOT, { cache: 'no-store' });
    if (!res.ok) return;
    const html = await res.clone().text();
    await cache.put(ROOT, res);
    const files = [...html.matchAll(/(?:href|src)="((?:app\.js|styles\.css|logo\.svg)(?:\?v=\w+)?)"/g)].map(m => new URL(m[1], ROOT).href);
    await Promise.all([...new Set([...files, `${ROOT}manifest.webmanifest`, `${ROOT}icons/icon-192.png`])].map(u => cache.add(u).catch(() => {})));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

// The page asks for the schedules it loaded before this worker was running (the first visit).
self.addEventListener('message', event => {
  if (event.data?.type !== 'save') return;
  event.waitUntil(Promise.all(event.data.urls.map(u => fromNetwork(new Request(new URL(u, ROOT).href)).catch(() => {}))));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || !req.url.startsWith(ROOT)) return;
  if (url.searchParams.has('refresh')) return; // the local server's Refresh button: always live
  if (req.mode === 'navigate') return event.respondWith(page(req));
  if (url.searchParams.has('v') && !url.pathname.startsWith(new URL('sessions/', ROOT).pathname)) return event.respondWith(stamped(req));
  event.respondWith(fromNetwork(req).catch(() => saved(req)));
});

// Where a copy is kept: schedules without their ?v= (one copy per state), everything else as is.
const keyOf = req => {
  const url = new URL(req.url);
  return /\.json$/.test(url.pathname) ? url.origin + url.pathname : req.url;
};

async function fromNetwork(req) {
  const res = await fetch(req, { cache: 'no-store' });
  if (res.ok) (await caches.open(CACHE)).put(keyOf(req), res.clone());
  return res;
}

// Marked so the page can say it's showing saved schedules (the browser's own online/offline
// flag misses weak Wi-Fi that's "connected" but gets nothing through).
async function saved(req) {
  const hit = await caches.match(keyOf(req));
  if (hit) {
    const headers = new Headers(hit.headers);
    headers.set('X-Calarink-Saved', '1');
    return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
  }
  throw new Error(`Offline, and no saved copy of ${req.url}`);
}

async function stamped(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    // Drop older stamps of the same file so the cache doesn't grow with every release.
    const path = new URL(req.url).pathname;
    for (const old of await cache.keys()) if (new URL(old.url).pathname === path) await cache.delete(old);
    await cache.put(req, res.clone());
  }
  return res;
}

async function page(req) {
  try {
    return await fromNetwork(req);
  } catch (err) {
    const hit = await caches.match(req.url, { ignoreSearch: true });
    if (hit) return hit;
    const main = await caches.match(ROOT);
    if (!main) throw err;
    const html = (await main.text()).replace(/<base [^>]*>\s*/, '').replace('<head>', `<head>\n  <base href="${ROOT}">`);
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}
