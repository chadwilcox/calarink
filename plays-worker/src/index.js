// Top Plays API (calarink.com/plays-api/*): upload a clip, approve it, vote on it.
// - Uploading needs a confirmed email (emailed 6-digit code). ADMIN_EMAIL is the moderator.
// - Nothing is public until the moderator approves it.
// - Voting needs no sign-in: one vote per device per clip, and a cap per network.
// - Clips live in R2, everything else in D1. Network addresses are kept only as salted hashes.
import { checkMp4, mp4Seconds } from './mp4.js';
import { allow, screenWaiting } from './screen.js';
import { DAY, now, bad, json, random, sha, clean, cookie, setCookie, network, saltedIp, normEmail, isAdmin, currentUser, needUser, needAdmin, body, readLimited, sendMail, tellAdmin } from './lib.js';
import { rinkRoute, rinkDaily } from './rinks.js';
import { contestMonth, monthOf } from './dates.js';
import { LEVELS } from './levels.js';

const SESSION_DAYS = 90;
const MAX_VIDEO = 12 * 1024 * 1024, MAX_POSTER = 400 * 1024;
const UPLOADS_PER_DAY = 5;
const VOTES_PER_NETWORK = 10; // per clip; leaves room for a family or a locker room on one Wi-Fi
const TOP = 10;
const DELETE_AFTER_DAYS = 30;
const CODE_TRIES = 5;
// Site-wide limits that keep costs inside what Cloudflare includes: 3,000 emails a month (codes,
// with room left for moderator notices) and 10 GB of clips (800 at the 12 MB maximum).
const CODES_PER_DAY = 80, CODES_FOR_RINKS = 20,  MAX_CLIPS = 800;

export default {
  async fetch(req, env, ctx) {
    try {
      const url = new URL(req.url);
      // First, before anything that costs: one network's flood stops here.
      if (!(await env.LIMIT.limit({ key: network(req) })).success) throw bad('Too many requests. Wait a minute.', 429);
      // Cookies are SameSite=Lax; this also refuses any change sent by another site's page.
      const origin = req.headers.get('Origin');
      if (!['GET', 'HEAD'].includes(req.method) && origin !== url.origin && !(env.DEV === '1' && origin === env.DEV_ORIGIN)) throw bad('Not allowed', 403);
      return await route(req, env, ctx, url);
    } catch (err) {
      if (!err.status) console.error(err);
      return json({ error: err.status ? err.message : 'Something went wrong. Try again.' }, err.status || 500);
    }
  },
  async scheduled(event, env) {
    if (event.cron === UPDATE_CRON) {
      await updateSite(env).catch(err => console.error(err));
      return screenWaiting(env);
    }
    await cleanup(env);
    await rinkDaily(env);
    await digest(env);
  },
};

// GitHub runs its own timers hours late, so this starts the site's build (the Publish workflow).
const UPDATE_CRON = '7,37 * * * *'; // as in wrangler.toml
async function updateSite(env) {
  if (!env.GITHUB_TOKEN) return;
  const r = await fetch('https://api.github.com/repos/chadwilcox/calarink/actions/workflows/publish.yml/dispatches', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'site-updates', 'X-GitHub-Api-Version': '2022-11-28' },
    body: '{"ref":"main"}',
  });
  if (!r.ok) console.error('could not start the build', r.status);
}

// One email a day about what's waiting, instead of one per clip.
async function digest(env) {
  if (!env.ADMIN_EMAIL) return;
  const n = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM clips WHERE status = 'pending') AS clips, (SELECT COUNT(DISTINCT clip_id) FROM reports) AS reports").first();
  if (!n.clips && !n.reports) return;
  await sendMail(env, env.ADMIN_EMAIL, `Calarink: ${n.clips} clip${n.clips === 1 ? '' : 's'} to review${n.reports ? `, ${n.reports} reported` : ''}`, 'Review them: https://calarink.com/plays/?review=1\n').catch(err => console.error(err));
}

async function route(req, env, ctx, url) {
  const p = url.pathname.replace(/^\/plays-api/, '');
  if (p.startsWith('/rinks/')) return rinkRoute(req, env, ctx, url, p.slice(6));
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

// ---------- sign-in ----------

async function authStart(req, env) {
  const email = normEmail((await body(req)).email);
  if (!email) throw bad("That email address doesn't look right");
  const ip = await saltedIp(req, env);
  const n = await env.DB.prepare('SELECT SUM(email = ?1) AS e, SUM(ip = ?2) AS i FROM codes WHERE created_at > ?3').bind(email, ip, now() - 3600).first();
  if (n.e >= 5 || n.i >= 10) throw bad('Too many codes asked for. Try again in an hour.', 429);
  const all = await env.DB.prepare('SELECT COUNT(*) AS n FROM codes WHERE created_at > ?').bind(now() - DAY).first();
  // The last of the day's codes are kept for rink staff, who may need to post a cancellation.
  const staff = all.n >= CODES_PER_DAY - CODES_FOR_RINKS && await env.DB.prepare("SELECT 1 FROM rink_managers m JOIN users u ON u.id = m.user_id WHERE u.email = ? AND m.status = 'approved'").bind(email).first();
  if (all.n >= CODES_PER_DAY - (staff ? 0 : CODES_FOR_RINKS)) throw bad('Sign-in is full for today. Try again tomorrow.', 429);
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
  const { results } = await env.DB.prepare("SELECT id, title, status, month FROM clips WHERE user_id = ? AND status IN ('pending', 'approved') ORDER BY created_at DESC LIMIT 50").bind(u.id).all();
  return json({ user: { email: u.email, admin: isAdmin(env, u) }, clips: results });
}

// ---------- the contest ----------

let monthsCache = { at: 0, current: '', months: [] }; // past months rarely change, so each server copy looks once a minute
async function pastMonths(env, current) {
  if (now() - monthsCache.at > 60 || monthsCache.current !== current) {
    const { results } = await env.DB.prepare("SELECT DISTINCT month FROM clips WHERE status = 'approved' AND month <= ? ORDER BY month DESC LIMIT 60").bind(current).all();
    monthsCache = { at: now(), current, months: results.map(m => m.month) };
  }
  return monthsCache.months;
}
async function listPlays(req, env, url) {
  const current = monthOf();
  const month = url.searchParams.get('month') || current;
  if (!/^\d{4}-\d\d$/.test(month) || month > current) throw bad('No such month', 404);
  const device = cookie(req, 'cp_d');
  const { results } = await env.DB.prepare(`SELECT c.id, c.title, c.credit, c.state, c.level, c.rink_id AS rink, c.votes,
      EXISTS (SELECT 1 FROM votes v WHERE v.clip_id = c.id AND v.device = ?2) AS voted
    FROM clips c WHERE c.status = 'approved' AND c.hidden = 0 AND c.month = ?1
    ORDER BY c.votes DESC, c.approved_at, c.id LIMIT ?3`)
    .bind(month, device ? await sha(device) : '', month === current ? 200 : TOP).all();
  return json({ month, current, months: [...new Set([current, ...await pastMonths(env, current)])], plays: results.map(r => ({ ...r, voted: !!r.voted })) });
}

async function publicClip(env, id) {
  const c = await env.DB.prepare("SELECT * FROM clips WHERE id = ? AND status = 'approved' AND hidden = 0 AND month <= ?").bind(id, monthOf()).first();
  if (!c) throw bad('That clip is no longer here', 404);
  return c;
}

async function vote(req, env, id) {
  const { on } = await body(req);
  const clip = await publicClip(env, id);
  if (clip.month !== monthOf()) throw bad('Voting for that month is over');
  const token = cookie(req, 'cp_d') || random(32);
  const device = await sha(token), ip = await saltedIp(req, env);
  const retotal = env.DB.prepare('UPDATE clips SET votes = (SELECT COUNT(*) FROM votes WHERE clip_id = ?1) WHERE id = ?1').bind(id);
  if (on) {
    const [r] = await env.DB.batch([env.DB.prepare(`INSERT OR IGNORE INTO votes (clip_id, device, ip, created_at)
      SELECT ?1, ?2, ?3, ?4 WHERE (SELECT COUNT(*) FROM votes WHERE clip_id = ?1 AND ip = ?3) < ?5`).bind(id, device, ip, now(), VOTES_PER_NETWORK), retotal]);
    if (!r.meta.changes && !await env.DB.prepare('SELECT 1 FROM votes WHERE clip_id = ? AND device = ?').bind(id, device).first()) {
      throw bad('This network has used all its votes for this clip', 429);
    }
  } else {
    await env.DB.batch([env.DB.prepare('DELETE FROM votes WHERE clip_id = ? AND device = ?').bind(id, device), retotal]);
  }
  const n = await env.DB.prepare('SELECT votes AS n FROM clips WHERE id = ?').bind(id).first();
  return json({ votes: n.n, voted: !!on }, 200, { 'Set-Cookie': setCookie('cp_d', token, 400) });
}

async function report(req, env, id, ctx, url) {
  const reason = clean((await body(req)).reason, 300) || 'No reason given';
  const clip = await publicClip(env, id), ip = await saltedIp(req, env);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM reports WHERE ip = ? AND created_at > ?').bind(ip, now() - DAY).first();
  if (n.n >= 10) throw bad('Too many reports today', 429);
  const r = await env.DB.prepare('INSERT OR IGNORE INTO reports (clip_id, ip, reason, created_at) VALUES (?, ?, ?, ?)').bind(id, ip, reason, now()).run();
  // Two reports from different networks hide it until the moderator looks.
  if (r.meta.changes) await env.DB.prepare('UPDATE clips SET hidden = 1 WHERE id = ?1 AND kept = 0 AND (SELECT COUNT(*) FROM reports WHERE clip_id = ?1) >= 2').bind(id).run();
  if (r.meta.changes && await allow(env, 'report-mail', 20)) tellAdmin(env, ctx, 'Calarink: a clip was reported', `"${clip.title}" was reported: ${reason}\n\nReview it: ${url.origin}/plays/?review=1\n`);
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
  if (!LEVELS.has(b.level)) throw bad('Pick the level of play');
  if (b.consent !== true) throw bad('Please confirm you have permission to share the clip');
  const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM clips').first();
  if (total.n >= MAX_CLIPS) throw bad('Uploads are full right now. Try again later.', 503);
  const id = random(12);
  // Counted in the same statement as the insert, so parallel requests can't slip past the limit.
  const r = await env.DB.prepare(`INSERT INTO clips (id, user_id, title, credit, state, rink_id, consent_at, created_at, level)
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?9 WHERE (SELECT COUNT(*) FROM clips WHERE user_id = ?2 AND created_at > ?7 - ${DAY}) < ?8`)
    .bind(id, u.id, title, credit, state, rink, now(), UPLOADS_PER_DAY, b.level).run();
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
  const claim = await env.DB.prepare(`UPDATE clips SET ${col} = 1, seconds = CASE WHEN ?2 > 0 THEN ?2 ELSE seconds END WHERE id = ?1 AND status = 'uploading' AND ${col} = 0`).bind(id, video ? mp4Seconds(data) : 0).run();
  if (!claim.meta.changes) throw bad('Already uploaded', 409);
  try {
    await env.CLIPS.put(`${id}.${video ? 'mp4' : 'jpg'}`, data, { httpMetadata: { contentType: video ? 'video/mp4' : 'image/jpeg' } });
  } catch (err) {
    await env.DB.prepare(`UPDATE clips SET ${col} = 0 WHERE id = ?`).bind(id).run();
    throw err;
  }
  if (!video) { // sent last: the clip is complete and joins the review queue
    await env.DB.prepare("UPDATE clips SET status = 'pending' WHERE id = ? AND status = 'uploading'").bind(id).run();
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
  const pending = await env.DB.prepare("SELECT c.id, c.title, c.credit, c.state, c.level, c.rink_id AS rink, c.screen, u.email FROM clips c JOIN users u ON u.id = c.user_id WHERE c.status = 'pending' ORDER BY c.created_at").all();
  const reported = await env.DB.prepare(`SELECT c.id, c.title, c.credit, c.state, c.level, c.rink_id AS rink, c.hidden, u.email, COUNT(*) AS reports, GROUP_CONCAT(r.reason, ' | ') AS reasons
    FROM reports r JOIN clips c ON c.id = r.clip_id JOIN users u ON u.id = c.user_id WHERE c.status = 'approved' GROUP BY c.id ORDER BY reports DESC`).all();
  return json({ pending: pending.results.map(p => ({ ...p, screen: p.screen && JSON.parse(p.screen) })), reported: reported.results, month: contestMonth(), current: monthOf() });
}
async function approve(req, env, id) {
  await needAdmin(req, env);
  const month = contestMonth();
  const r = await env.DB.prepare("UPDATE clips SET status = 'approved', month = ?, approved_at = ? WHERE id = ? AND status = 'pending'").bind(month, now(), id).run();
  if (!r.meta.changes) throw bad('That clip is no longer waiting', 404);
  return json({ ok: true, month });
}
async function clearReports(req, env, id) {
  await needAdmin(req, env);
  await env.DB.batch([env.DB.prepare('DELETE FROM reports WHERE clip_id = ?').bind(id), env.DB.prepare('UPDATE clips SET hidden = 0, kept = 1 WHERE id = ?').bind(id)]);
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
  const c = await env.DB.prepare('SELECT user_id, status, month, hidden FROM clips WHERE id = ?').bind(id).first();
  const open = c?.status === 'approved' && !c.hidden && c.month <= monthOf();
  if (!open) {
    const u = c && c.status !== 'deleting' && await currentUser(req, env);
    if (!u || (u.id !== c.user_id && !isAdmin(env, u))) throw bad('Not found', 404);
  }
  const key = `${id}.${ext}`;
  // Safari won't play video without byte ranges. One storage read per request, so it stays cheap.
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('Range') || '');
  let range;
  if (m && m[1]) {
    const offset = Number(m[1]);
    if (m[2] && Number(m[2]) < offset) return new Response(null, { status: 416 });
    range = m[2] ? { offset, length: Number(m[2]) - offset + 1 } : { offset };
  } else if (m && Number(m[2])) range = { suffix: Number(m[2]) };
  let obj;
  try {
    obj = req.method === 'HEAD' ? await env.CLIPS.head(key) : await env.CLIPS.get(key, { range });
  } catch (err) {
    if (range) return new Response(null, { status: 416 }); // starts past the end
    throw err;
  }
  if (!obj) throw bad('Not found', 404);
  const headers = {
    'Content-Type': ext === 'mp4' ? 'video/mp4' : 'image/jpeg',
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
    // Short, so a clip that's taken down stops playing soon after.
    'Cache-Control': open ? 'private, max-age=300' : 'private, no-store',
  };
  const size = obj.size;
  if (!range || req.method === 'HEAD') return new Response(obj.body ?? null, { headers: { ...headers, 'Content-Length': String(size) } });
  const start = range.suffix ? Math.max(0, size - range.suffix) : range.offset;
  if (start >= size) { await obj.body.cancel(); return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } }); }
  const end = range.length ? Math.min(size, start + range.length) - 1 : size - 1;
  return new Response(obj.body, { status: 206, headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) } });
}

// ---------- daily cleanup ----------

async function cleanup(env, today = new Date()) {
  const t = Math.floor(today.getTime() / 1000);
  // Months that ended more than DELETE_AFTER_DAYS ago keep only their top ten.
  const cutoff = monthOf(new Date((t - DELETE_AFTER_DAYS * DAY) * 1000));
  const { results } = await env.DB.prepare(`SELECT id FROM (SELECT c.id, ROW_NUMBER() OVER (PARTITION BY c.month
        ORDER BY c.votes DESC, c.approved_at, c.id) AS place
      FROM clips c WHERE c.status = 'approved' AND c.month < ?1) WHERE place > ?2
    UNION SELECT id FROM clips WHERE (status = 'uploading' AND created_at < ?3) OR status = 'deleting' LIMIT 100`)
    .bind(cutoff, TOP, t - DAY).all();
  await remove(env, results.map(r => r.id));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM codes WHERE created_at < ?').bind(t - DAY),
    env.DB.prepare('DELETE FROM usage WHERE day < ?').bind(new Date((t - 3 * DAY) * 1000).toISOString().slice(0, 10)),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(t),
  ]);
}
