// My Rink: anyone can follow a home rink; rink staff sign in to post its times.
// The API is plays-worker/src/rinks.js. Pages lay what's posted over the schedules right away
// (posted-live.js); the next scheduled build includes it too.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const API = '/plays-api';
const HOME_KEY = 'calarink:home-rink';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const params = new URLSearchParams(location.search);

let data = null, live = null, me = { user: null, claims: [] };
let current = null;        // the rink on screen
let book = null;           // its entries, when managing
let drafts = [], removing = new Set();

async function api(path, body, method = body ? 'POST' : 'GET') {
  let res;
  try { res = await fetch(API + path, { method, cache: 'no-store', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) }); }
  catch { throw new Error("Couldn't reach Calarink. Check your connection."); }
  const d = await res.json().catch(() => null);
  if (!res.ok || !d) throw Object.assign(new Error(d?.error || 'Something went wrong. Try again.'), { status: res.status });
  return d;
}
function toast(m) {
  $('#toast').textContent = m; $('#toast').hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { $('#toast').hidden = true; }, 3500);
}
function count(path, title) { if (!/^(localhost|127\.)/.test(location.hostname)) window.goatcounter?.count?.({ path, title, event: true }); }
function showError(box, m = '') { const p = box.querySelector('.form-error'); p.textContent = m; p.hidden = !m; }
async function submitting(e, box, fn) {
  e.preventDefault();
  const b = e.target.querySelector('.btn');
  b.disabled = true; showError(box);
  try { await fn(e.target); } catch (err) { showError(box, err.message); }
  b.disabled = false;
}
for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => b.closest('dialog').close());

// ---------- dates (all on the rink's own clock) ----------
const tzOf = r => r.tz || data.states.find(s => s.code === r.state)?.tz || 'America/New_York';
const stampFmts = new Map();
function local(date, tz) {
  if (!stampFmts.has(tz)) stampFmts.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }));
  const p = Object.fromEntries(stampFmts.get(tz).formatToParts(new Date(date)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
const today = () => local(Date.now(), tzOf(current)).date;
const noon = d => new Date(`${d}T12:00:00Z`);
const plus = (d, n) => { const x = noon(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dayText = d => noon(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const shortDay = d => noon(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const timeText = t => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };

// ---------- the home rink ----------
const rinkById = id => data.rinks.find(r => r.id === id);
const readHome = () => { try { return localStorage.getItem(HOME_KEY) || ''; } catch { return ''; } };
const saveHome = id => { try { localStorage.setItem(HOME_KEY, id); } catch { /* storage unavailable */ } };

function fillRinks(id = '') {
  const list = data.rinks.filter(r => r.state === $('#state').value).sort((a, b) => a.name.localeCompare(b.name));
  $('#rink').innerHTML = '<option value="">Choose a rink…</option>' + list.map(r => `<option value="${esc(r.id)}"${r.id === id ? ' selected' : ''}>${esc(r.name)} (${esc(r.town)})</option>`).join('');
}
async function pick(id, { save = false } = {}) {
  if (drafts.length + removing.size && current?.id !== id && !confirm('Leave without publishing your changes?')) { $('#state').value = current.state; fillRinks(current.id); return; }
  current = rinkById(id) || null;
  book = null; drafts = []; removing = new Set();
  $('#manage').hidden = true; $('#staff').hidden = false;
  $('#manageOpen').hidden = !current;
  if (current && save) { saveHome(id); count('home-rink-set', 'Chose a home rink'); }
  if (!current) { $('#rinkInfo').innerHTML = '<p class="muted">Choose your home rink to see its ice times here.</p>'; $('#agenda').innerHTML = ''; return; }
  const r = current;
  $('#rinkInfo').innerHTML = `<div class="muted">${esc(r.address || `${r.town}, ${r.state}`)}</div><div class="links">
    <a href="${esc(r.scheduleUrl || r.website)}" target="_blank" rel="noopener">Schedule / website ↗</a>
    ${r.phone ? `<a href="tel:${esc(r.phone.replace(/\D/g, ''))}">${esc(r.phone)}</a>` : ''}
    <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.address || `${r.name}, ${r.town}, ${r.state}`)}" target="_blank" rel="noopener">Directions</a></div>
    ${r.posted?.stale ? '<div class="alert">This rink has not confirmed its posted times lately. Call before you drive.</div>' : ''}
    ${r.posted ? `<p class="muted">Posted by the rink, updated ${esc(new Date(r.posted.updated * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}. <button type="button" class="linkbtn" id="reportOpen">Report a wrong time</button></p>` : ''}`;
  $('#reportOpen')?.addEventListener('click', () => { $('#reportForm').reset(); showError($('#reportForm')); $('#reportDialog').showModal(); });
  await renderSessions();
}

const sessionsByState = new Map();
async function sessionsFor(state) {
  if (data.sessions) return data.sessions; // the local server sends everything
  if (!sessionsByState.has(state)) {
    const slug = data.states.find(s => s.code === state).slug;
    const res = await fetch(`../sessions/${slug}.json?v=${encodeURIComponent(data.generatedAt)}`);
    if (!res.ok) throw new Error('not available');
    sessionsByState.set(state, await res.json());
  }
  return sessionsByState.get(state);
}
async function upcoming(r, days) {
  const now = Date.now(), tz = tzOf(r), last = plus(local(now, tz).date, days - 1);
  return window.mergePostedLive(data, await sessionsFor(r.state), live).filter(s => s.rinkId === r.id && Date.parse(s.end) > now)
    .map(s => { const l = local(s.start, tz); return { ...s, l, endTime: local(s.end, tz).time, off: s.cancelled }; })
    .filter(s => s.l.date <= last);
}
async function renderSessions() {
  const r = current;
  let list;
  try { list = await upcoming(r, 7); } catch { $('#agenda').innerHTML = '<div class="empty">Couldn\'t load the times. Try again.</div>'; return; }
  if (current !== r) return;
  const t = local(Date.now(), tzOf(r)).date;
  const soon = Date.now() + 7 * 864e5;
  const closed = (live?.[r.id]?.off || []).filter(o => o.to - o.from > 1 && o.to > Date.now() && o.from < soon)
    .map(o => [local(o.from, tzOf(r)).date, local(o.to - 1, tzOf(r)).date]).map(([a, b]) => `<div class="alert">Closed ${a === b ? dayText(a) : `${dayText(a)} – ${dayText(b)}`}, posted by the rink.</div>`).join('');
  const byDay = new Map();
  for (const s of list) { if (!byDay.has(s.l.date)) byDay.set(s.l.date, []); byDay.get(s.l.date).push(s); }
  $('#agenda').innerHTML = closed + ([...byDay].map(([d, ss]) => `<section class="day"><div class="day-head"><h3>${esc(dayText(d))}</h3>${d === t ? '<span class="today-tag">Today</span>' : ''}</div><div class="sessions">${ss.map(s => `
    <div class="session ${s.off ? 'cancelled' : ''}" style="--c:var(--c-${esc(s.category)})"><div class="time">${timeText(s.l.time)} – ${timeText(s.endTime)}</div><div class="title">${esc(s.title)}</div>
    <div class="meta">${s.off ? '<span class="flag bad">Cancelled</span>' : ''}${s.posted ? '<span class="flag">From the rink</span>' : ''}</div></div>`).join('')}</div></section>`).join('')
    || `<div class="empty"><strong>No times listed for the next 7 days.</strong>${r.live ? '' : 'This rink\'s schedule isn\'t on Calarink yet. Check its website, or ask them to post it here.'}</div>`);
}
$('#state').addEventListener('change', () => { fillRinks(); pick(''); });
$('#rink').addEventListener('change', e => pick(e.target.value, { save: true }));
$('#reportForm').addEventListener('submit', e => submitting(e, e.target, async f => {
  await api(`/rinks/r/${current.id}/report`, { reason: f.reason.value });
  $('#reportDialog').close(); toast("Thanks. We'll check it.");
}));

// ---------- sign in and claim ----------
let email = '', claimNew = false;
const sign = $('#signDialog');
function step(id) { for (const s of ['emailStep', 'codeStep', 'claimStep', 'sentStep']) $(`#${s}`).hidden = s !== id; showError(sign); }
async function loadMe() {
  try { me = await api('/rinks/mine'); } catch { return; }
  $('#signedIn').innerHTML = me.user ? `Signed in as ${esc(me.user.email)}. <button type="button" class="linkbtn" id="signOut">Sign out</button>` : '';
  $('#signOut')?.addEventListener('click', async () => { try { await api('/auth/signout', {}); location.href = './'; } catch (err) { toast(err.message); } });
  if (me.user?.admin) loadReview(); else $('#review').hidden = true;
}
// Where a person goes next: sign in, ask, wait, or manage.
async function proceed() {
  if (!me.user) { $('#signTitle').textContent = 'Sign in'; step('emailStep'); if (!sign.open) sign.showModal(); return; }
  const mine = !claimNew && current && me.claims.find(c => c.rink === current.id);
  if (!claimNew && current && (me.user.admin || mine?.status === 'approved')) { sign.close(); return openManage(); }
  if (!sign.open) sign.showModal();
  if (mine?.status === 'pending') { $('#signTitle').textContent = 'Request sent'; return step('sentStep'); }
  $('#signTitle').textContent = claimNew ? 'Add my rink' : `Manage ${current.name}`;
  $('#newRinkField').hidden = !claimNew;
  step('claimStep');
}
$('#manageOpen').addEventListener('click', () => { claimNew = false; proceed(); });
$('#newRinkOpen').addEventListener('click', () => { claimNew = true; proceed(); });
$('#emailStep').addEventListener('submit', e => submitting(e, sign, async f => {
  email = f.email.value.trim();
  await api('/auth/start', { email });
  $('#codeEmail').textContent = email; $('#codeStep').reset();
  step('codeStep'); $('#codeStep').code.focus();
}));
$('#codeStep').addEventListener('submit', e => submitting(e, sign, async f => {
  await api('/auth/verify', { email, code: f.code.value });
  await loadMe();
  await proceed();
}));
$('#codeBack').addEventListener('click', () => step('emailStep'));
$('#claimStep').addEventListener('submit', e => submitting(e, sign, async f => {
  await api('/rinks/claim', { rink: claimNew ? '' : current.id, newRink: f.newRink.value, name: f.name.value, role: f.elements.role.value, phone: f.phone.value });
  count('rink-claimed', 'Asked to manage a rink');
  await loadMe();
  $('#signTitle').textContent = 'Request sent'; step('sentStep');
}));

// ---------- managing ----------
async function openManage() {
  const r = current;
  try { const b = await api(`/rinks/r/${r.id}/manage`); if (current !== r) return; book = b; } catch (err) { toast(err.message); return; }
  $('#staff').hidden = true; $('#manage').hidden = false;
  await renderManage();
  $('#manage').scrollIntoView({ block: 'start' });
}
function entryText(e) {
  if (e.kind === 'weekly') return `<strong>${esc(e.title)}</strong>: ${DAYS[e.dow]}s ${timeText(e.start)} – ${timeText(e.end)}, ${shortDay(e.from)} to ${shortDay(e.until)}`;
  if (e.kind === 'once') return `<strong>${esc(e.title)}</strong>: ${dayText(e.date)} ${timeText(e.start)} – ${timeText(e.end)}`;
  if (e.kind === 'cancel') return `<strong>Cancelled</strong>: ${dayText(e.date)} ${timeText(e.start)}`;
  return `<strong>Closed</strong>${e.title ? ` (${esc(e.title)})` : ''}: ${e.until === e.date ? dayText(e.date) : `${dayText(e.date)} to ${dayText(e.until)}`}`;
}
// What the next 14 days would look like, drafts included.
function preview(listed) {
  const t = today(), all = [...book.entries.filter(e => !removing.has(e.id)), ...drafts];
  const days = new Map(Array.from({ length: 14 }, (_, i) => [plus(t, i), []]));
  const offs = all.filter(e => e.kind === 'cancel' || e.kind === 'closed');
  const gone = (d, start, at) => offs.some(o => (o.kind === 'cancel' ? o.date === d && o.start === start : d >= o.date && d <= o.until) && !(at && at >= (o.at ?? Infinity)));
  for (const s of listed) if (!s.posted && days.has(s.l.date)) days.get(s.l.date).push({ start: s.l.time, end: s.endTime, title: s.title, calendar: true, off: (s.cancelled && !s.offPosted) || gone(s.l.date, s.l.time) });
  for (const e of all) {
    if (e.kind === 'once' && days.has(e.date)) days.get(e.date).push({ ...e, off: gone(e.date, e.start, e.at ?? Infinity) });
    if (e.kind === 'weekly') for (const [d, list] of days) if (d >= e.from && d <= e.until && noon(d).getUTCDay() === e.dow) list.push({ ...e, off: gone(d, e.start) });
  }
  for (const list of days.values()) list.sort((a, b) => a.start.localeCompare(b.start));
  return days;
}
async function renderManage() {
  const r = current, t = today();
  let listed = [];
  try { listed = await upcoming(r, 14); } catch { /* preview shows posted times only */ }
  if (current !== r || !book) return;
  const live = book.entries.filter(e => (e.until || e.date) >= t);
  const order = { weekly: 0, once: 1, cancel: 2, closed: 3 };
  live.sort((a, b) => order[a.kind] - order[b.kind] || (a.date || '').localeCompare(b.date || '') || (a.dow ?? 0) - (b.dow ?? 0) || (a.start || '').localeCompare(b.start || ''));
  const age = book.confirmed ? Math.floor((Date.now() / 1000 - book.confirmed) / 86400) : null;
  const n = drafts.length + removing.size;
  const calendar = (r.sourceTypes || []).length > 0;
  $('#manage').innerHTML = `<h2>${esc(r.name)}: schedule</h2>
    ${calendar ? '<p class="muted">Calarink already reads this rink\'s own calendar. Add what it leaves out, or cancel a time that is wrong.</p>' : ''}
    ${age !== null && live.length ? `<p class="muted">Last confirmed ${age === 0 ? 'today' : `${age} day${age === 1 ? '' : 's'} ago`}. ${age >= 14 ? '<strong>Skaters see a warning until you confirm.</strong> ' : ''}${age >= 30 ? '<strong>Weekly times are hidden until you confirm.</strong> ' : ''}<button type="button" class="linkbtn" data-do="confirm">Still correct</button></p>` : ''}
    <div class="tools"><button type="button" class="btn" data-do="add">Add times</button><button type="button" class="btn-outline" data-do="copy">Copy last week's one-time sessions</button></div>
    <h3>Posted</h3><div class="rows">${live.map(e => `<div><span class="${removing.has(e.id) ? 'gone' : ''}">${entryText(e)}</span><button type="button" class="linkbtn ${removing.has(e.id) ? '' : 'danger'}" data-remove="${esc(e.id)}">${removing.has(e.id) ? 'Keep' : 'Remove'}</button></div>`).join('')}
    ${drafts.map((e, i) => `<div class="draft"><span>${entryText(e)} <span class="flag">Not published yet</span></span><button type="button" class="linkbtn danger" data-draft="${i}">Remove</button></div>`).join('')}
    ${live.length + drafts.length ? '' : '<p class="muted">Nothing posted yet.</p>'}</div>
    <h3>Next 14 days, as skaters will see it</h3><div class="rows">${[...preview(listed)].flatMap(([d, list]) => list.map(s => `<div><span class="${s.off ? 'gone' : ''}">${dayText(d)} ${timeText(s.start)} – ${timeText(s.end)} · ${esc(s.title)}${s.calendar ? ' <span class="flag">From your calendar</span>' : ''}</span>${s.off ? '<span class="flag bad">Cancelled</span>' : `<button type="button" class="linkbtn danger" data-cancel="${d}T${s.start}">Cancel it</button>`}</div>`)).join('') || '<p class="muted">No sessions.</p>'}</div>
    <h3>History</h3><div class="rows">${book.log.map((l, i) => `<div><span class="${l.undone ? 'gone' : ''}">${new Date(l.at * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${esc(l.email)}: ${[l.change.added.length && `${l.change.added.length} added`, l.change.removed.length && `${l.change.removed.length} removed`].filter(Boolean).join(', ')}</span>${!l.undone && book.log.findIndex(x => !x.undone) === i ? '<button type="button" class="linkbtn" data-do="undo">Undo</button>' : ''}</div>`).join('') || '<p class="muted">No changes yet.</p>'}</div>
    ${n ? `<div class="publish"><span><strong>${n} change${n === 1 ? '' : 's'}</strong> not published</span><span class="tools"><button type="button" class="btn-ghost" data-do="discard">Discard</button><button type="button" class="btn" data-do="publish">Publish</button></span></div>` : ''}`;
}
async function reload() { book = await api(`/rinks/r/${current.id}/manage`); drafts = []; removing = new Set(); try { live = (await api('/rinks/live')).rinks; } catch { /* keep */ } await renderManage(); renderSessions(); }
$('#manage').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const { remove, draft, cancel, do: act } = b.dataset;
  if (remove) removing.has(remove) ? removing.delete(remove) : removing.add(remove);
  else if (draft) drafts.splice(Number(draft), 1);
  else if (cancel) { const [date, start] = cancel.split('T'); drafts.push({ kind: 'cancel', date, start }); }
  else if (act === 'add') return openEntry();
  else if (act === 'copy') {
    const t = today(), from = plus(t, -7);
    const have = new Set([...book.entries, ...drafts].filter(x => x.kind === 'once').map(x => `${x.date}${x.start}${x.title}`));
    const add = book.entries.filter(x => x.kind === 'once' && x.date >= from && x.date < t).map(({ id, at, ...x }) => ({ ...x, date: plus(x.date, 7) })).filter(x => !have.has(`${x.date}${x.start}${x.title}`));
    drafts.push(...add);
    toast(add.length ? `${add.length} copied. Check them, then publish.` : 'No one-time sessions in the last 7 days to copy.');
  } else if (act === 'discard') { drafts = []; removing = new Set(); }
  else if (['publish', 'confirm', 'undo'].includes(act)) {
    if (act !== 'publish' && drafts.length + removing.size && !confirm('This drops your unpublished changes. Continue?')) return;
    b.disabled = true;
    try {
      await api(`/rinks/r/${current.id}/${act === 'publish' ? 'changes' : act}`, act === 'publish' ? { add: drafts, remove: [...removing] } : {});
      toast(act === 'publish' ? 'Published. Skaters see it within a minute or two.' : act === 'confirm' ? 'Thanks, confirmed.' : 'Undone.');
      await reload();
    } catch (err) { toast(err.message); b.disabled = false; }
    return;
  } else return;
  renderManage();
});
addEventListener('beforeunload', e => { if (drafts.length + removing.size) e.preventDefault(); });

const form = $('#entryForm');
function openEntry() {
  const keep = form.kind.value; // people add several of the same kind in a row
  form.reset(); form.kind.value = keep; showError(form);
  form.date.min = form.until.min = today(); form.date.value = today();
  form.until.value = '';
  showKind();
  $('#entryDialog').showModal();
}
function showKind() {
  const k = form.kind.value;
  for (const el of form.querySelectorAll('[data-for]')) el.hidden = !el.dataset.for.split(' ').includes(k);
  $('#dateLabel').textContent = k === 'weekly' ? 'First date' : k === 'closed' ? 'First closed day' : 'Date';
  $('#untilLabel').textContent = k === 'closed' ? 'Last closed day' : 'Last date';
}
form.kind.addEventListener('change', showKind);
form.addEventListener('submit', e => {
  e.preventDefault();
  const k = form.kind.value, title = [form.type.value, form.detail.value.trim()].filter(Boolean).join(': ');
  const fail = m => showError(form, m);
  if ((k === 'weekly' || k === 'once') && (!form.start.value || !form.end.value || form.start.value === form.end.value)) return fail('Fill in the start and end times.');
  if (k === 'weekly' && (!form.until.value || form.until.value < form.date.value)) return fail('Pick the last date, such as the end of the season.');
  if (k === 'weekly' && form.until.value > plus(form.date.value, 366)) return fail('Weekly times can run up to a year.');
  if (k === 'closed' && form.until.value && form.until.value < form.date.value) return fail('The last day is before the first.');
  const span = { start: form.start.value, end: form.end.value };
  drafts.push(k === 'weekly' ? { kind: k, title, dow: Number(form.dow.value), ...span, from: form.date.value, until: form.until.value }
    : k === 'once' ? { kind: k, title, date: form.date.value, ...span }
      : { kind: k, title: '', date: form.date.value, until: form.until.value || form.date.value });
  $('#entryDialog').close();
  renderManage();
});

// ---------- reviewing (moderator) ----------
async function loadReview() {
  let q;
  try { q = await api('/rinks/queue'); } catch { return; }
  const name = id => { const r = rinkById(id); return r ? `${esc(r.name)}, ${esc(r.town)}` : esc(id); };
  const site = id => { const r = rinkById(id); return r ? ` · <a href="${esc(r.website)}" target="_blank" rel="noopener">rink website ↗</a>${r.phone ? ` · listed phone ${esc(r.phone)}` : ''}` : ''; };
  const row = p => `<div data-id="${p.id}" data-new="${p.rink ? '' : 1}"><span><strong>${p.rink ? name(p.rink) : `New rink: ${esc(p.newRink)}`}</strong><br>${esc(p.name)}, ${esc(p.role)} · ${esc(p.email)} · they gave ${esc(p.phone)}${p.rink ? site(p.rink) : ''}</span>
    <span>${p.status === 'pending' ? '<button type="button" class="linkbtn" data-decide="approve">Approve</button><button type="button" class="linkbtn danger" data-decide="deny">Deny</button>' : '<button type="button" class="linkbtn danger" data-decide="revoke">Revoke</button>'}</span></div>`;
  const pending = q.people.filter(p => p.status === 'pending'), ok = q.people.filter(p => p.status === 'approved');
  $('#review').innerHTML = `<h2>Rink requests (${pending.length})</h2><p class="muted">Check with the rink using the phone number on its own website, not the one given here.</p><div class="rows">${pending.map(row).join('') || '<p class="muted">Nothing waiting.</p>'}</div>
    ${q.reports.length ? `<h3>Reported times</h3><div class="rows">${q.reports.map(r => `<div data-rink="${esc(r.rink)}"><span><strong>${name(r.rink)}</strong>: ${esc(r.reasons)}</span><button type="button" class="linkbtn" data-clear>Done</button></div>`).join('')}</div>` : ''}
    ${ok.length ? `<h3>Managers</h3><div class="rows">${ok.map(row).join('')}</div>` : ''}`;
  $('#review').hidden = false;
}
$('#review').addEventListener('click', async e => {
  const b = e.target.closest('[data-decide], [data-clear]'); if (!b) return;
  const row = b.closest('[data-id], [data-rink]');
  try {
    if (b.dataset.decide) {
      const what = b.dataset.decide, body = {};
      if (what === 'approve' && row.dataset.new) { body.rink = prompt('Add the rink to Calarink first. What is its id in rinks.js?')?.trim(); if (!body.rink) return; }
      if (what !== 'approve' && !confirm(what === 'deny' ? 'Deny this request?' : 'Remove this manager? If no one else manages the rink, its posted times come down.')) return;
      await api(`/rinks/claims/${row.dataset.id}/${what}`, body);
    } else await api(`/rinks/r/${row.dataset.rink}/clear`, {});
  } catch (err) { toast(err.message); }
  loadReview();
});

// ---------- start ----------
(async () => {
  try { data = await (await fetch('../schedule.json')).json(); } catch { $('#rinkInfo').innerHTML = '<div class="empty">Couldn\'t load the rinks. Try reloading.</div>'; $('#staff').hidden = true; return; }
  try { live = (await api('/rinks/live')).rinks; } catch { /* the schedules still show */ }
  const wanted = rinkById(params.get('rink')) || rinkById(readHome());
  let st = wanted?.state;
  if (!st) {
    let last = '';
    try { last = JSON.parse(localStorage.getItem('maine-rink-times:v1') || '{}').usState; } catch { /* storage unavailable */ }
    const region = document.querySelector('meta[name="visitor-region"]')?.content;
    st = (data.states.find(s => s.code === last) || data.states.find(s => s.code === region) || data.states.find(s => s.default) || data.states[0]).code;
  }
  $('#state').innerHTML = data.states.map(s => `<option value="${esc(s.code)}"${s.code === st ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  fillRinks(wanted?.id);
  await Promise.all([pick(wanted?.id || ''), loadMe()]);
  if (params.get('manage') && current) proceed();
  if (params.get('report') && current?.posted) $('#reportOpen').click();
  if (params.get('review') && !me.user) proceed();
})();
