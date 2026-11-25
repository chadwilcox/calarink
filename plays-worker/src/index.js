// Top Plays API (calarink.com/plays-api/*): upload a clip, approve it, vote on it.
// - Uploading needs a confirmed email (emailed 6-digit code). ADMIN_EMAIL is the moderator.
// - Nothing is public until the moderator approves it.
// - Voting needs no sign-in: one vote per device per clip, and a cap per network.
// - Clips live in R2, everything else in D1. Network addresses are kept only as salted hashes.
import { checkMp4 } from './mp4.js';
import { addDays, contestWeek, weekOf } from './weeks.js';

const DAY = 86400;
const SESSION_DAYS = 90;
const MAX_VIDEO = 12 * 1024 * 1024, MAX_POSTER = 400 * 1024;
const UPLOADS_PER_DAY = 5;
const VOTES_PER_NETWORK = 10; // per clip; leaves room for a family or a locker room on one Wi-Fi
const TOP = 10;
const DELETE_AFTER_DAYS = 30;
const CODE_TRIES = 5;
// Site-wide limits that keep costs inside what Cloudflare includes: 3,000 emails a month (codes,
// with room left for moderator notices) and 10 GB of clips (800 at the 12 MB maximum).
const CODES_PER_DAY = 80, MAX_CLIPS = 800;

const now = () => Math.floor(Date.now() / 1000);
const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const random = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha = async s => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
const clean = (s, max) => String(s ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export default {
  async fetch(req, env, ctx) {
    try {
      const url = new URL(req.url);
      // Cookies are SameSite=Lax; this also refuses any change sent by another site's page.
      const origin = req.headers.get('Origin');
      if (!['GET', 'HEAD'].includes(req.method) && origin !== url.origin && !(env.DEV === '1' && origin === env.DEV_ORIGIN)) throw bad('Not allowed', 403);
      return await route(req, env, ctx, url);
    } catch (err) {
      if (!err.status) console.error(err);
      return json({ error: err.status ? err.message : 'Something went wrong. Try again.' }, err.status || 500);
    }
  },
  async scheduled(_event, env) { await cleanup(env); },
};

async function route(req, env, ctx, url) {
  const p = url.pathname.replace(/^\/plays-api/, '');
  let m;
  if (req.method === 'GET' || req.method === 'HEAD') {
    if (p === '/plays') return listPlays(req, env, url);
    if (p === '/me') return me(req, env);
    if (p === '/queue') return queue(req, env);
    if ((m = /^\/media\/([0-9a-f]{24})\.(mp4|jpg)$/.exec(p))) return media(req, env, m[1], m[2]);
    throw bad('Not found', 404);
  }
  const { method } = req;
  if (method === 'POST' && p === '/auth/start') return authStart(req, env);
  if (method === 'POST' && p === '/auth/verify') return authVerify(req, env);
  if (method === 'POST' && p === '/auth/signout') return signOut(req, env);
  if (method === 'POST' && p === '/clips') return createClip(req, env);
  if (method === 'PUT' && (m = /^\/clips\/([0-9a-f]{24})\/(video|poster)$/.exec(p))) return putFile(req, env, ctx, url, m[1], m[2]);
  if (method === 'DELETE' && (m = /^\/clips\/([0-9a-f]{24})$/.exec(p))) return deleteClip(req, env, m[1]);
  if (method === 'POST' && (m = /^\/clips\/([0-9a-f]{24})\/(vote|report|approve|clear|block)$/.exec(p))) {
    return { vote, report, approve, clear: clearReports, block }[m[2]](req, env, m[1], ctx, url);
  }
  throw bad('Not found', 404);
}

// ---------- who's asking ----------

const cookie = (req, name) => new RegExp(`(?:^|;\\s*)${name}=([0-9a-f]{64})(?:;|$)`).exec(req.headers.get('Cookie') || '')?.[1];
const setCookie = (name, value, days) => `${name}=${value}; Path=/plays-api; Max-Age=${days * DAY}; HttpOnly; Secure; SameSite=Lax`;

function saltedIp(req, env) {
  if (!env.IP_SALT) throw new Error('IP_SALT secret missing');
  let ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  // One home or phone holds a whole IPv6 /64, so the address is cut to that.
  if (ip.includes(':')) {
    const [head, tail] = ip.split('::').map(s => (s ? s.split(':') : []));
    const full = tail ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail] : head;
    ip = full.slice(0, 4).map(x => x.replace(/^0+(?=.)/, '')).join(':');
  }
  return sha(`${env.IP_SALT}:${ip}`);
}
const normEmail = s => {
  const e = String(s || '').trim().toLowerCase();
  return e.length <= 200 && /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/.test(e) ? e : null;
};
const isAdmin = (env, user) => !!user && !!env.ADMIN_EMAIL && user.email === normEmail(env.ADMIN_EMAIL);

async function currentUser(req, env) {
  const t = cookie(req, 'cp_s');
  if (!t) return null;
  return env.DB.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.hash = ? AND s.expires_at > ? AND u.blocked = 0')
    .bind(await sha(t), now()).first();
}
async function needUser(req, env) {
  const u = await currentUser(req, env);
  if (!u) throw bad('Sign in first', 401);
  return u;
}
async function needAdmin(req, env) {
  const u = await currentUser(req, env);
  if (!isAdmin(env, u)) throw bad('Not found', 404);
  return u;
}
async function body(req) {
  const text = new TextDecoder().decode(await readLimited(req, 8000));
  try { const b = JSON.parse(text); if (b && typeof b === 'object') return b; } catch { /* below */ }
  throw bad('Bad request');
}
async function readLimited(req, max) {
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

// ---------- sign-in ----------

async function authStart(req, env) {
  const email = normEmail((await body(req)).email);
  if (!email) throw bad("That email address doesn't look right");
  const ip = await saltedIp(req, env);
  const n = await env.DB.prepare('SELECT SUM(email = ?1) AS e, SUM(ip = ?2) AS i FROM codes WHERE created_at > ?3').bind(email, ip, now() - 3600).first();
  if (n.e >= 5 || n.i >= 10) throw bad('Too many codes asked for. Try again in an hour.', 429);
  const all = await env.DB.prepare('SELECT COUNT(*) AS n FROM codes WHERE created_at > ?').bind(now() - DAY).first();
  if (all.n >= CODES_PER_DAY) throw bad('Sign-in is full for today. Try again tomorrow.', 429);
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  await env.DB.prepare('INSERT INTO codes (email, hash, ip, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(email, await sha(`${env.IP_SALT}:${email}:${code}`), ip, now() + 900, now()).run();
  await sendMail(env, email, `${code} is your Calarink code`,
    `Your Calarink code is ${code}\n\nEnter it on the page where you asked for it. It works for 15 minutes.\nIf you didn't ask for this, ignore this email.\n`);
  return json({ ok: true });
}

async function authVerify(req, env) {
  const b = await body(req);
  const email = normEmail(b.email), code = String(b.code || '').replace(/\D/g, '');
  if (!email) throw bad('Ask for a new code');
  // Counting the try and reading the code is one statement, so parallel guesses can't share a try.
  const row = await env.DB.prepare(`UPDATE codes SET tries = tries + 1
    WHERE rowid = (SELECT rowid FROM codes WHERE email = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1)
    AND expires_at > ?2 AND tries < ?3 RETURNING hash`).bind(email, now(), CODE_TRIES).first();
  if (!row) throw bad('That code has expired. Ask for a new one.');
  if (row.hash !== await sha(`${env.IP_SALT}:${email}:${code}`)) throw bad("That code isn't right");
  // Used up, but kept for the hourly limit.
  await env.DB.prepare('UPDATE codes SET expires_at = 0 WHERE email = ?').bind(email).run();
  await env.DB.prepare('INSERT OR IGNORE INTO users (email, created_at) VALUES (?, ?)').bind(email, now()).run();
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (user.blocked) throw bad("This email can't upload to Calarink", 403);
  const token = random(32);
  await env.DB.prepare('INSERT INTO sessions (hash, user_id, expires_at) VALUES (?, ?, ?)').bind(await sha(token), user.id, now() + SESSION_DAYS * DAY).run();
  return json({ ok: true }, 200, { 'Set-Cookie': setCookie('cp_s', token, SESSION_DAYS) });
}

async function signOut(req, env) {
  const t = cookie(req, 'cp_s');
  if (t) await env.DB.prepare('DELETE FROM sessions WHERE hash = ?').bind(await sha(t)).run();
  return json({ ok: true }, 200, { 'Set-Cookie': setCookie('cp_s', '', 0) });
}

async function me(req, env) {
  const u = await currentUser(req, env);
  if (!u) return json({ user: null, clips: [] });
  const { results } = await env.DB.prepare("SELECT id, title, status, week FROM clips WHERE user_id = ? AND status IN ('pending', 'approved') ORDER BY created_at DESC LIMIT 50").bind(u.id).all();
  return json({ user: { email: u.email, admin: isAdmin(env, u) }, clips: results });
}

async function sendMail(env, to, subject, text) {
  if (env.DEV === '1') { console.log(`[dev mail] to ${to}: ${subject}`); return; }
  try {
    await env.EMAIL.send({ to, from: { email: env.MAIL_FROM, name: 'Calarink' }, subject, text });
  } catch (err) {
    console.error('mail failed', err.code, err.message);
    throw bad("Couldn't send the email. Try again later.", 502);
  }
}
// Notes to the moderator never hold up or fail the visitor's request.
const tellAdmin = (env, ctx, subject, text) => env.ADMIN_EMAIL && ctx.waitUntil(sendMail(env, env.ADMIN_EMAIL, subject, text).catch(e => console.error(e)));

// ---------- the contest ----------

async function listPlays(req, env, url) {
  const current = weekOf();
  const week = url.searchParams.get('week') || current;
  if (!/^\d{4}-\d\d-\d\d$/.test(week) || week > current) throw bad('No such week', 404);
  const device = cookie(req, 'cp_d');
  const { results } = await env.DB.prepare(`SELECT c.id, c.title, c.credit, c.state, c.rink_id AS rink,
      (SELECT COUNT(*) FROM votes v WHERE v.clip_id = c.id) AS votes,
      EXISTS (SELECT 1 FROM votes v WHERE v.clip_id = c.id AND v.device = ?2) AS voted
    FROM clips c WHERE c.status = 'approved' AND c.week = ?1
    ORDER BY votes DESC, c.approved_at, c.id LIMIT ?3`)
    .bind(week, device ? await sha(device) : '', week === current ? 200 : TOP).all();
  const weeks = await env.DB.prepare("SELECT DISTINCT week FROM clips WHERE status = 'approved' AND week <= ? ORDER BY week DESC LIMIT 60").bind(current).all();
  return json({ week, current, weeks: [...new Set([current, ...weeks.results.map(w => w.week)])], plays: results.map(r => ({ ...r, voted: !!r.voted })) });
}

async function publicClip(env, id) {
  const c = await env.DB.prepare("SELECT * FROM clips WHERE id = ? AND status = 'approved' AND week <= ?").bind(id, weekOf()).first();
  if (!c) throw bad('That clip is no longer here', 404);
  return c;
}

async function vote(req, env, id) {
  const { on } = await body(req);
  const clip = await publicClip(env, id);
  if (clip.week !== weekOf()) throw bad('Voting for that week is over');
  const token = cookie(req, 'cp_d') || random(32);
  const device = await sha(token), ip = await saltedIp(req, env);
  if (on) {
    const r = await env.DB.prepare(`INSERT OR IGNORE INTO votes (clip_id, device, ip, created_at)
      SELECT ?1, ?2, ?3, ?4 WHERE (SELECT COUNT(*) FROM votes WHERE clip_id = ?1 AND ip = ?3) < ?5`).bind(id, device, ip, now(), VOTES_PER_NETWORK).run();
    if (!r.meta.changes && !await env.DB.prepare('SELECT 1 FROM votes WHERE clip_id = ? AND device = ?').bind(id, device).first()) {
      throw bad('This network has used all its votes for this clip', 429);
    }
  } else {
    await env.DB.prepare('DELETE FROM votes WHERE clip_id = ? AND device = ?').bind(id, device).run();
  }
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM votes WHERE clip_id = ?').bind(id).first();
  return json({ votes: n.n, voted: !!on }, 200, { 'Set-Cookie': setCookie('cp_d', token, 400) });
}

async function report(req, env, id, ctx, url) {
  const reason = clean((await body(req)).reason, 300) || 'No reason given';
  const clip = await publicClip(env, id), ip = await saltedIp(req, env);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE ip = ? AND created_at > ?').bind(ip, now() - DAY).first();
  if (n.n >= 10) throw bad('Too many reports today', 429);
  const r = await env.DB.prepare('INSERT OR IGNORE INTO reports (clip_id, ip, reason, created_at) VALUES (?, ?, ?, ?)').bind(id, ip, reason, now()).run();
  if (r.meta.changes) tellAdmin(env, ctx, 'Calarink: a clip was reported', `"${clip.title}" was reported: ${reason}\n\nReview it: ${url.origin}/plays/?review=1\n`);
  return json({ ok: true });
}

// ---------- uploading ----------

async function createClip(req, env) {
  const u = await needUser(req, env), b = await body(req);
  const title = clean(b.title, 80), credit = clean(b.credit, 60);
  const state = /^[A-Z]{2}$/.test(b.state) ? b.state : null;
  const rink = /^[a-z0-9-]{1,60}$/.test(b.rink || '') ? b.rink : '';
  if (title.length < 3) throw bad('Give the play a title');
  if (!state) throw bad('Pick a state or province');
  if (b.consent !== true) throw bad('Please confirm you have permission to share the clip');
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM clips').first();
  if (total.n >= MAX_CLIPS) throw bad('Uploads are full right now. Try again later.', 503);
  const id = random(12);
  // Counted in the same statement as the insert, so parallel requests can't slip past the limit.
  const r = await env.DB.prepare(`INSERT INTO clips (id, user_id, title, credit, state, rink_id, consent_at, created_at)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7 WHERE (SELECT COUNT(*) FROM clips WHERE user_id = ?2 AND created_at > ?7 - ${DAY}) < ?8`)
    .bind(id, u.id, title, credit, state, rink, now(), UPLOADS_PER_DAY).run();
  if (!r.meta.changes) throw bad(`You can upload ${UPLOADS_PER_DAY} clips a day. Try again tomorrow.`, 429);
  return json({ id });
}

async function putFile(req, env, ctx, url, id, kind) {
  const u = await needUser(req, env);
  const clip = await env.DB.prepare("SELECT * FROM clips WHERE id = ? AND user_id = ? AND status = 'uploading'").bind(id, u.id).first();
  if (!clip) throw bad('That upload has ended. Start again.', 404);
  const video = kind === 'video';
  if (!video && !clip.has_video) throw bad('The video is missing. Start again.');
  const data = await readLimited(req, video ? MAX_VIDEO : MAX_POSTER);
  const head = new Uint8Array(data);
  const problem = video ? checkMp4(data) : (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff ? null : 'The preview picture is not a JPEG');
  if (problem) throw bad(problem);
  // Each file is written once, so nothing can be swapped in behind an approved clip.
  const col = video ? 'has_video' : 'has_poster';
  const claim = await env.DB.prepare(`UPDATE clips SET ${col} = 1 WHERE id = ? AND status = 'uploading' AND ${col} = 0`).bind(id).run();
  if (!claim.meta.changes) throw bad('Already uploaded', 409);
  try {
    await env.CLIPS.put(`${id}.${video ? 'mp4' : 'jpg'}`, data, { httpMetadata: { contentType: video ? 'video/mp4' : 'image/jpeg' } });
  } catch (err) {
    await env.DB.prepare(`UPDATE clips SET ${col} = 0 WHERE id = ?`).bind(id).run();
    throw err;
  }
  if (!video) { // sent last: the clip is complete and joins the review queue
    await env.DB.prepare("UPDATE clips SET status = 'pending' WHERE id = ? AND status = 'uploading'").bind(id).run();
    tellAdmin(env, ctx, 'Calarink: a clip is waiting for review', `"${clip.title}" from ${u.email}\n\nReview it: ${url.origin}/plays/?review=1\n`);
  }
  return json({ ok: true });
}

async function remove(env, ids) {
  if (!ids.length) return;
  const list = JSON.stringify(ids), IN = 'IN (SELECT value FROM json_each(?))';
  // Off the site first, then the files, then the rows; if a step fails the daily cleanup finishes it.
  await env.DB.prepare(`UPDATE clips SET status = 'deleting' WHERE id ${IN}`).bind(list).run();
  const keys = ids.flatMap(id => [`${id}.mp4`, `${id}.jpg`]);
  for (let i = 0; i < keys.length; i += 1000) await env.CLIPS.delete(keys.slice(i, i + 1000)); // R2's limit per call
  await env.DB.batch(['votes WHERE clip_id', 'reports WHERE clip_id', 'clips WHERE id'].map(t => env.DB.prepare(`DELETE FROM ${t} ${IN}`).bind(list)));
}

async function deleteClip(req, env, id) { // the uploader, or the moderator (reject / take down)
  const u = await needUser(req, env);
  const c = await env.DB.prepare('SELECT user_id FROM clips WHERE id = ?').bind(id).first();
  if (!c || (c.user_id !== u.id && !isAdmin(env, u))) throw bad('That clip is no longer here', 404);
  await remove(env, [id]);
  return json({ ok: true });
}

// ---------- moderating ----------

async function queue(req, env) {
  await needAdmin(req, env);
  const pending = await env.DB.prepare("SELECT c.id, c.title, c.credit, c.state, c.rink_id AS rink, u.email FROM clips c JOIN users u ON u.id = c.user_id WHERE c.status = 'pending' ORDER BY c.created_at").all();
  const reported = await env.DB.prepare(`SELECT c.id, c.title, c.credit, c.state, c.rink_id AS rink, u.email, COUNT(*) AS reports, GROUP_CONCAT(r.reason, ' | ') AS reasons
    FROM reports r JOIN clips c ON c.id = r.clip_id JOIN users u ON u.id = c.user_id WHERE c.status = 'approved' GROUP BY c.id ORDER BY reports DESC`).all();
  return json({ pending: pending.results, reported: reported.results, week: contestWeek(), current: weekOf() });
}
async function approve(req, env, id) {
  await needAdmin(req, env);
  const week = contestWeek();
  const r = await env.DB.prepare("UPDATE clips SET status = 'approved', week = ?, approved_at = ? WHERE id = ? AND status = 'pending'").bind(week, now(), id).run();
  if (!r.meta.changes) throw bad('That clip is no longer waiting', 404);
  return json({ ok: true, week });
}
async function clearReports(req, env, id) {
  await needAdmin(req, env);
  await env.DB.prepare('DELETE FROM reports WHERE clip_id = ?').bind(id).run();
  return json({ ok: true });
}
async function block(req, env, id) { // the uploader is blocked and everything of theirs is removed
  const admin = await needAdmin(req, env);
  const c = await env.DB.prepare('SELECT user_id FROM clips WHERE id = ?').bind(id).first();
  if (!c) throw bad('That clip is no longer here', 404);
  if (c.user_id === admin.id) throw bad("That's your own clip");
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET blocked = 1 WHERE id = ?').bind(c.user_id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(c.user_id),
  ]);
  const { results } = await env.DB.prepare('SELECT id FROM clips WHERE user_id = ?').bind(c.user_id).all();
  await remove(env, results.map(r => r.id));
  return json({ ok: true });
}

// ---------- files ----------

async function media(req, env, id, ext) {
  const c = await env.DB.prepare('SELECT user_id, status, week FROM clips WHERE id = ?').bind(id).first();
  const open = c?.status === 'approved' && c.week <= weekOf();
  if (!open) {
    const u = c && c.status !== 'deleting' && await currentUser(req, env);
    if (!u || (u.id !== c.user_id && !isAdmin(env, u))) throw bad('Not found', 404);
  }
  const key = `${id}.${ext}`;
  const info = await env.CLIPS.head(key);
  if (!info) throw bad('Not found', 404);
  const headers = {
    'Content-Type': ext === 'mp4' ? 'video/mp4' : 'image/jpeg',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    // Short, so a clip that's taken down stops playing soon after.
    'Cache-Control': open ? 'private, max-age=300' : 'private, no-store',
  };
  // Safari won't play video without byte ranges.
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('Range') || '');
  let start = 0, end = info.size - 1, status = 200;
  if (m && (m[1] || m[2])) {
    if (m[1]) { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
    else start = Math.max(0, info.size - Number(m[2]));
    if (start > end) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${info.size}` } });
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
  }
  headers['Content-Length'] = String(end - start + 1);
  if (req.method === 'HEAD') return new Response(null, { status, headers });
  const obj = await env.CLIPS.get(key, { range: { offset: start, length: end - start + 1 } });
  if (!obj) throw bad('Not found', 404);
  return new Response(obj.body, { status, headers });
}

// ---------- daily cleanup ----------

async function cleanup(env, today = new Date()) {
  const t = Math.floor(today.getTime() / 1000);
  // Weeks that ended more than DELETE_AFTER_DAYS ago keep only their top ten.
  const cutoff = addDays(weekOf(today), -DELETE_AFTER_DAYS - 7);
  const { results } = await env.DB.prepare(`SELECT id FROM (SELECT c.id, ROW_NUMBER() OVER (PARTITION BY c.week
        ORDER BY (SELECT COUNT(*) FROM votes v WHERE v.clip_id = c.id) DESC, c.approved_at, c.id) AS place
      FROM clips c WHERE c.status = 'approved' AND c.week < ?1) WHERE place > ?2
    UNION SELECT id FROM clips WHERE (status = 'uploading' AND created_at < ?3) OR status = 'deleting' LIMIT 100`)
    .bind(cutoff, TOP, t - DAY).all();
  await remove(env, results.map(r => r.id));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM codes WHERE created_at < ?').bind(t - DAY),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t),
  ]);
}
