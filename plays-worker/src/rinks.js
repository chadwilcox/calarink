// My Rink API (calarink.com/plays-api/rinks/*): rink staff claim their rink, the moderator approves
// them, and they post times. The site's build reads /rinks/schedule; pages also read /rinks/live so
// changes show right away. Claim details (name, role, phone) are only for the moderator.
import { DAY, bad, body, clean, currentUser, isAdmin, json, needAdmin, needUser, now, random, saltedIp, sendMail, tellAdmin } from './lib.js';
import { addDays } from './dates.js';
import { RINKS } from '../../src/rinks.js';
import { rinkTz, toSession, windowRange } from '../../src/session.js';
import { expandPosted, isOff } from '../../src/expand.js';

const RINK_BY_ID = new Map(RINKS.map(r => [r.id, r]));

const MAX_ENTRIES = 300, MAX_CLAIMS = 3;
export const REMIND_DAYS = 14, EXPIRE_DAYS = 30;
const REMINDERS_PER_DAY = 20;

export async function rinkRoute(req, env, ctx, url, p) {
  const get = req.method === 'GET', post = req.method === 'POST';
  let m;
  if (get && p === '/schedule') return schedule(env);
  if (get && p === '/live') return live(env);
  if (get && p === '/mine') return mine(req, env);
  if (get && p === '/queue') return queue(req, env);
  if (post && p === '/claim') return claim(req, env, ctx, url);
  if (post && (m = /^\/claims\/(\d{1,9})\/(approve|deny|revoke)$/.exec(p))) return decide(req, env, ctx, url, Number(m[1]), m[2]);
  if ((m = /^\/r\/([a-z0-9-]{1,60})\/(manage|changes|undo|confirm|report|clear)$/.exec(p))) {
    const [, rink, what] = m;
    if (get && what === 'manage') return manage(req, env, rink);
    if (post && what !== 'manage') return { changes, undo, confirm, report, clear }[what](req, env, rink, ctx, url);
  }
  throw bad('Not found', 404);
}

// ---------- entries ----------
// weekly: { kind, title, dow, start, end, from, until }   once: { kind, title, date, start, end }
// cancel: { kind, date, start }                           closed: { kind, date, until, title }
const isDate = s => /^20\d\d-\d\d-\d\d$/.test(s || '') && !Number.isNaN(Date.parse(s)) && new Date(`${s}T12:00Z`).toISOString().startsWith(s);
const isTime = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');

export function cleanEntry(e) {
  const title = clean(e?.title, 80);
  const times = () => {
    if (!title) throw bad('Every session needs a type or title');
    if (!isTime(e.start) || !isTime(e.end) || e.start === e.end) throw bad('Check the start and end times');
  };
  if (e?.kind === 'weekly') {
    times();
    if (!Number.isInteger(e.dow) || e.dow < 0 || e.dow > 6) throw bad('Pick a day of the week');
    if (!isDate(e.from) || !isDate(e.until) || e.until < e.from) throw bad('Weekly times need a first and last date');
    if (e.until > addDays(e.from, 366)) throw bad('Weekly times can run up to a year');
    return { kind: 'weekly', title, dow: e.dow, start: e.start, end: e.end, from: e.from, until: e.until };
  }
  if (!isDate(e?.date)) throw bad('Check the date');
  if (e.kind === 'once') { times(); return { kind: 'once', title, date: e.date, start: e.start, end: e.end }; }
  if (e.kind === 'cancel') {
    if (!isTime(e.start)) throw bad('Check the start time');
    return { kind: 'cancel', date: e.date, start: e.start };
  }
  if (e.kind === 'closed') {
    const until = e.until || e.date;
    if (!isDate(until) || until < e.date || until > addDays(e.date, 200)) throw bad('Check the closing dates');
    return { kind: 'closed', date: e.date, until, title };
  }
  throw bad('Bad request');
}
const entryOf = r => ({ id: r.id, at: r.created_at, ...JSON.parse(r.data) });

// ---------- public ----------

// Only rinks that still have an approved manager in good standing.
const MANAGED = "EXISTS (SELECT 1 FROM rink_managers m JOIN users u ON u.id = m.user_id WHERE m.rink_id = e.rink_id AND m.status = 'approved' AND u.blocked = 0)";
const recent = () => new Date((now() - 2 * DAY) * 1000).toISOString().slice(0, 10);

async function posted(env) {
  const { results } = await env.DB.prepare(`SELECT e.*, s.updated_at, s.confirmed_at FROM rink_entries e JOIN rink_status s ON s.rink_id = e.rink_id WHERE e.ends >= ? AND ${MANAGED} ORDER BY e.created_at`).bind(recent()).all();
  const rinks = {};
  for (const r of results) {
    const age = now() - r.confirmed_at;
    const k = rinks[r.rink_id] ??= { updated: r.updated_at, stale: age > REMIND_DAYS * DAY, expired: age > EXPIRE_DAYS * DAY, entries: [] };
    k.entries.push(entryOf(r));
  }
  return rinks;
}
async function schedule(env) { // for the build
  return json({ rinks: await posted(env) }, 200, { 'Cache-Control': 'public, max-age=60' });
}
let liveCache = { at: 0, body: '' };
async function live(env) { // for visitors: ready-made sessions, so posted times show before the next build
  if (now() - liveCache.at > 20) {
    const rinks = {};
    for (const [id, p] of Object.entries(await posted(env))) {
      const rink = RINK_BY_ID.get(id);
      if (!rink) continue;
      const tz = rinkTz(rink), { sessions, off } = expandPosted(p, tz, windowRange(tz));
      rinks[id] = {
        updated: p.updated, stale: p.stale, off,
        sessions: sessions.map(s => {
          const x = { ...toSession(rink, s), posted: true, ...(s.postedAt && { postedAt: s.postedAt }) };
          return isOff(s.start.getTime(), s.postedAt, off) ? { ...x, cancelled: true, offPosted: true } : x;
        }),
      };
    }
    liveCache = { at: now(), body: JSON.stringify({ rinks }) };
  }
  return new Response(liveCache.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=20' } });
}

async function report(req, env, rink, ctx, url) {
  const reason = clean((await body(req)).reason, 300);
  if (!reason) throw bad('Say what looks wrong');
  if (!await env.DB.prepare('SELECT 1 FROM rink_status WHERE rink_id = ?').bind(rink).first()) throw bad('That rink posts its times elsewhere', 404);
  const ip = await saltedIp(req, env);
  const n = await env.DB.prepare('SELECT COUNT(*) AS n, (SELECT COUNT(*) FROM rink_reports WHERE created_at > ?2) AS all_n FROM rink_reports WHERE ip = ?1 AND created_at > ?2').bind(ip, now() - DAY).first();
  if (n.n >= 5 || n.all_n >= 50) throw bad('Too many reports today', 429);
  const r = await env.DB.prepare('INSERT OR IGNORE INTO rink_reports (rink_id, ip, reason, created_at) VALUES (?, ?, ?, ?)').bind(rink, ip, reason, now()).run();
  if (r.meta.changes) tellAdmin(env, ctx, `Calarink: wrong times reported at ${rink}`, `${reason}\n\nReview: ${url.origin}/my-rink/?review=1\n`);
  return json({ ok: true });
}

// ---------- claiming ----------

async function mine(req, env) {
  const u = await currentUser(req, env);
  if (!u) return json({ user: null, claims: [] });
  const { results } = await env.DB.prepare("SELECT rink_id AS rink, new_rink AS newRink, status FROM rink_managers WHERE user_id = ? AND status != 'revoked' ORDER BY id").bind(u.id).all();
  return json({ user: { email: u.email, admin: isAdmin(env, u) }, claims: results });
}

async function claim(req, env, ctx, url) {
  const u = await needUser(req, env), b = await body(req);
  const rink = /^[a-z0-9-]{1,60}$/.test(b.rink || '') ? b.rink : '';
  const newRink = rink ? '' : clean(b.newRink, 200);
  const name = clean(b.name, 80), role = clean(b.role, 80), phone = clean(b.phone, 40);
  if (!rink && newRink.length < 5) throw bad("Give the rink's name, town and website");
  if (name.length < 2 || role.length < 2) throw bad('Fill in your name and job at the rink');
  if (phone.replace(/\D/g, '').length < 7) throw bad('Give a work phone number');
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM rink_managers WHERE user_id = ? AND status = 'pending'").bind(u.id).first();
  if (n.n >= MAX_CLAIMS) throw bad('We still need to look at your earlier requests', 429);
  const r = await env.DB.prepare('INSERT OR IGNORE INTO rink_managers (user_id, rink_id, new_rink, name, role, phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(u.id, rink, newRink, name, role, phone, now()).run();
  if (!r.meta.changes) throw bad("You've already asked to manage that rink");
  tellAdmin(env, ctx, `Calarink: request to manage ${rink || newRink}`, `${name} (${role}), ${u.email}, ${phone}\nasks to manage ${rink || newRink}.\n\nCheck with the rink using the phone number on its own website, then approve or deny:\n${url.origin}/my-rink/?review=1\n`);
  return json({ ok: true });
}

async function queue(req, env) {
  await needAdmin(req, env);
  const people = await env.DB.prepare("SELECT m.id, m.rink_id AS rink, m.new_rink AS newRink, m.status, m.name, m.role, m.phone, u.email FROM rink_managers m JOIN users u ON u.id = m.user_id WHERE m.status IN ('pending', 'approved') ORDER BY m.status DESC, m.id").all();
  const reports = await env.DB.prepare("SELECT rink_id AS rink, GROUP_CONCAT(reason, ' | ') AS reasons, COUNT(*) AS n FROM rink_reports GROUP BY rink_id").all();
  return json({ people: people.results, reports: reports.results });
}

async function decide(req, env, ctx, url, id, what) {
  await needAdmin(req, env);
  const c = await env.DB.prepare('SELECT m.*, u.email FROM rink_managers m JOIN users u ON u.id = m.user_id WHERE m.id = ?').bind(id).first();
  if (!c) throw bad('That request is gone', 404);
  if (what === 'approve') {
    const b = await body(req), rink = c.rink_id || (/^[a-z0-9-]{1,60}$/.test(b.rink || '') ? b.rink : '');
    if (!rink) throw bad("Add the rink to Calarink first, then give its id");
    const r = await env.DB.prepare("UPDATE OR IGNORE rink_managers SET status = 'approved', rink_id = ? WHERE id = ? AND status = 'pending'").bind(rink, id).run();
    if (!r.meta.changes) throw bad('That request was already handled');
    ctx.waitUntil(sendMail(env, c.email, 'You can now post your rink\'s schedule on Calarink', `Your request was approved. Sign in with this email to post times:\n${url.origin}/my-rink/?rink=${rink}&manage=1\n`).catch(e => console.error(e)));
  } else if (what === 'deny') await env.DB.prepare("DELETE FROM rink_managers WHERE id = ? AND status = 'pending'").bind(id).run();
  else await env.DB.prepare("UPDATE rink_managers SET status = 'revoked' WHERE id = ?").bind(id).run();
  return json({ ok: true });
}
async function clear(req, env, rink) {
  await needAdmin(req, env);
  await env.DB.prepare('DELETE FROM rink_reports WHERE rink_id = ?').bind(rink).run();
  return json({ ok: true });
}

// ---------- managing ----------

async function needManager(req, env, rink) { // an approved manager of this rink, or the moderator
  const u = await needUser(req, env);
  if (!isAdmin(env, u) && !await env.DB.prepare("SELECT 1 FROM rink_managers WHERE user_id = ? AND rink_id = ? AND status = 'approved'").bind(u.id, rink).first()) throw bad("You don't manage that rink", 403);
  return u;
}
async function manage(req, env, rink) {
  await needManager(req, env, rink);
  const [entries, log, status] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM rink_entries WHERE rink_id = ? ORDER BY created_at').bind(rink),
    env.DB.prepare('SELECT l.id, l.change, l.undone, l.created_at AS at, u.email FROM rink_log l JOIN users u ON u.id = l.user_id WHERE l.rink_id = ? ORDER BY l.id DESC LIMIT 15').bind(rink),
    env.DB.prepare('SELECT * FROM rink_status WHERE rink_id = ?').bind(rink),
  ]);
  return json({
    entries: entries.results.map(entryOf),
    log: log.results.map(l => ({ ...l, change: JSON.parse(l.change) })),
    confirmed: status.results[0]?.confirmed_at || null,
  });
}
const touch = (env, rink) => (liveCache.at = 0, env.DB.prepare('INSERT INTO rink_status (rink_id, updated_at, confirmed_at) VALUES (?1, ?2, ?2) ON CONFLICT (rink_id) DO UPDATE SET updated_at = ?2, confirmed_at = ?2').bind(rink, now()));
const put = (env, rink, e) => {
  const { id, at, ...data } = e;
  return env.DB.prepare('INSERT INTO rink_entries (id, rink_id, data, ends, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, rink, JSON.stringify(data), data.until || data.date, at);
};
const drop = (env, rink, ids) => env.DB.prepare('DELETE FROM rink_entries WHERE rink_id = ? AND id IN (SELECT value FROM json_each(?))').bind(rink, JSON.stringify(ids));

async function changes(req, env, rink) {
  const u = await needManager(req, env, rink), b = await body(req, 30000);
  if (!Array.isArray(b.add) || !Array.isArray(b.remove) || b.add.length > 60 || b.remove.length > 60) throw bad('Publish up to 60 changes at a time');
  const { results } = await env.DB.prepare('SELECT * FROM rink_entries WHERE rink_id = ?').bind(rink).all();
  const removed = results.filter(r => b.remove.includes(r.id)).map(entryOf);
  const added = b.add.map(e => ({ id: random(8), at: now(), ...cleanEntry(e) }));
  if (!added.length && !removed.length) throw bad('There is nothing to publish');
  if (results.length - removed.length + added.length > MAX_ENTRIES) throw bad(`A rink can have up to ${MAX_ENTRIES} entries. Use weekly times for repeats.`);
  await env.DB.batch([ // all or nothing
    drop(env, rink, removed.map(e => e.id)),
    ...added.map(e => put(env, rink, e)),
    env.DB.prepare('INSERT INTO rink_log (rink_id, user_id, change, created_at) VALUES (?, ?, ?, ?)').bind(rink, u.id, JSON.stringify({ added, removed }), now()),
    touch(env, rink),
  ]);
  return json({ ok: true });
}

async function undo(req, env, rink) {
  await needManager(req, env, rink);
  const l = await env.DB.prepare('SELECT * FROM rink_log WHERE rink_id = ? AND undone = 0 ORDER BY id DESC LIMIT 1').bind(rink).first();
  if (!l) throw bad('There is nothing to undo');
  const { added, removed } = JSON.parse(l.change);
  await env.DB.batch([
    drop(env, rink, [...added, ...removed].map(e => e.id)),
    ...removed.map(e => put(env, rink, e)),
    env.DB.prepare('UPDATE rink_log SET undone = 1 WHERE id = ?').bind(l.id),
    touch(env, rink),
  ]);
  return json({ ok: true });
}

async function confirm(req, env, rink) {
  await needManager(req, env, rink);
  await env.DB.prepare('UPDATE rink_status SET confirmed_at = ? WHERE rink_id = ?').bind(now(), rink).run();
  return json({ ok: true });
}

// ---------- daily ----------

export async function rinkDaily(env) {
  const t = now(), today = new Date(t * 1000).toISOString().slice(0, 10);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM rink_entries WHERE ends < ?').bind(addDays(today, -14)), // "copy last week" needs a little history
    env.DB.prepare('DELETE FROM rink_log WHERE created_at < ?').bind(t - 180 * DAY),
  ]);
  const { results } = await env.DB.prepare(`SELECT s.rink_id FROM rink_status s WHERE s.confirmed_at < ?1 AND s.reminded_at < s.confirmed_at
      AND EXISTS (SELECT 1 FROM rink_entries e WHERE e.rink_id = s.rink_id AND e.ends >= ?2 AND json_extract(e.data, '$.kind') = 'weekly') LIMIT ?3`)
    .bind(t - REMIND_DAYS * DAY, today, REMINDERS_PER_DAY).all();
  let sent = 0;
  for (const { rink_id: rink } of results) {
    const people = await env.DB.prepare("SELECT u.email FROM rink_managers m JOIN users u ON u.id = m.user_id WHERE m.rink_id = ? AND m.status = 'approved' AND u.blocked = 0 LIMIT 3").bind(rink).all();
    if (sent + people.results.length > REMINDERS_PER_DAY) break;
    let ok = false;
    for (const { email } of people.results) {
      try {
        await sendMail(env, email, 'Is your rink\'s schedule on Calarink still right?', `Please check your posted times and tap "Still correct":\nhttps://calarink.com/my-rink/?rink=${rink}&manage=1\n\nSkaters see a warning until you do, and weekly times come down ${EXPIRE_DAYS} days after they were last confirmed.\n`);
        ok = true; sent++;
      } catch (err) { console.error(err); }
    }
    if (ok) await env.DB.prepare('UPDATE rink_status SET reminded_at = ? WHERE rink_id = ?').bind(t, rink).run();
  }
}
