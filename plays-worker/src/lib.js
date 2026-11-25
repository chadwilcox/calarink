// Shared by Top Plays (index.js) and My Rink (rinks.js).
export const DAY = 86400;
export const now = () => Math.floor(Date.now() / 1000);
export const bad = (message, status = 400) => Object.assign(new Error(message), { status });
export const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
export const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
export const random = n => hex(crypto.getRandomValues(new Uint8Array(n)));
export const sha = async s => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
export const clean = (s, max) => String(s ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------- who's asking ----------

export const cookie = (req, name) => new RegExp(`(?:^|;\\s*)${name}=([0-9a-f]{64})(?:;|$)`).exec(req.headers.get('Cookie') || '')?.[1];
export const setCookie = (name, value, days) => `${name}=${value}; Path=/plays-api; Max-Age=${days * DAY}; HttpOnly; Secure; SameSite=Lax`;

export function network(req) {
  let ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  // One home or phone holds a whole IPv6 /64, so the address is cut to that.
  if (ip.includes(':')) {
    const [head, tail] = ip.split('::').map(s => (s ? s.split(':') : []));
    const full = tail ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head;
    ip = full.slice(0, 4).map(x => x.replace(/^0+(?=.)/, '')).join(':');
  }
  return ip;
}
export function saltedIp(req, env) {
  if (!env.IP_SALT) throw new Error('IP_SALT secret missing');
  return sha(`${env.IP_SALT}:${network(req)}`);
}
export const normEmail = s => {
  const e = String(s || '').trim().toLowerCase();
  return e.length <= 200 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(e) ? e : null;
};
export const isAdmin = (env, user) => !!user && !!env.ADMIN_EMAIL && user.email === normEmail(env.ADMIN_EMAIL);

export async function currentUser(req, env) {
  const t = cookie(req, 'cp_s');
  if (!t) return null;
  return env.DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ? AND s.expires_at > ? AND u.blocked = 0')
    .bind(await sha(t), now()).first();
}
export async function needUser(req, env) {
  const u = await currentUser(req, env);
  if (!u) throw bad('Sign in first', 401);
  return u;
}
export async function needAdmin(req, env) {
  const u = await currentUser(req, env);
  if (!isAdmin(env, u)) throw bad('Not found', 404);
  return u;
}
export async function body(req, max = 8000) {
  const text = new TextDecoder().decode(await readLimited(req, max));
  try { const b = JSON.parse(text); if (b && typeof b === 'object') return b; } catch { /* below */ }
  throw bad('Bad request');
}
export async function readLimited(req, max) {
  const tooBig = () => bad('That file is too big', 413);
  if (Number(req.headers.get('Content-Length') || 0) > max) throw tooBig();
  const chunks = [];
  let size = 0;
  for await (const c of req.body || []) {
    size += c.byteLength;
    if (size > max) throw tooBig();
    chunks.push(c);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out.buffer;
}

export async function sendMail(env, to, subject, text) {
  if (env.DEV === '1') { console.log(`[dev mail] to ${to}: ${subject}`); return; }
  try {
    await env.EMAIL.send({ to, from: { email: env.MAIL_FROM, name: 'Calarink' }, subject, text });
  } catch (err) {
    console.error('mail failed', err.code, err.message);
    throw bad("Couldn't send the email. Try again later.", 502);
  }
}
// Notes to the moderator never hold up or fail the visitor's request.
export const tellAdmin = (env, ctx, subject, text) => env.ADMIN_EMAIL && ctx.waitUntil(sendMail(env, env.ADMIN_EMAIL, subject, text).catch(e => console.error(e)));

