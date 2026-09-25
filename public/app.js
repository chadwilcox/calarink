const TZ = 'America/New_York';
const PUBLIC_DEFAULT = ['public', 'stick-puck', 'shinny', 'freestyle'];
const STORE_KEY = 'maine-rink-times:v1'; // pre-Calarink name, kept so returning visitors keep their filters
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtTime = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
const fmtDayKey = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const fmtDayHead = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' });
const fmtStamp = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit' });
const fmtDow = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });

let data = null;
let pageBase = null; // site root that state pages hang off: '/' on calarink.com
const state = loadState();

function loadState() {
  const base = { types: PUBLIC_DEFAULT, showAll: false, hideCancelled: true, days: 14, dow: [], usState: '', region: '', hiddenRinks: [] };
  try { return { ...base, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; } catch { return base; }
}
function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

// ---------- data ----------
async function load(refresh = false) {
  const btn = $('#refresh');
  btn.disabled = true; btn.classList.add('spinning');
  if (refresh) $('#updated').textContent = 'Pulling fresh schedules from every rink…';
  try {
    // Relative, so it works both from the local server and from a GitHub Pages subpath.
    const res = await fetch(`schedule.json${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    data = await res.json();
    btn.hidden = !!data.static; // the published site is rebuilt on a schedule; there's no server to refresh
    if (pageBase === null) applyUrlState();
    buildStaticControls();
    render();
  } catch (err) {
    $('#updated').textContent = `Couldn't load schedules: ${err.message}.`;
  } finally {
    btn.disabled = false; btn.classList.remove('spinning');
  }
}

// ---------- US state ----------
// calarink.com/maine or ?state=maine opens that state; otherwise the last state used, else the first.
function findState(v) {
  v = String(v || '').toLowerCase();
  return v ? data.states.find(s => [s.slug, s.code, s.name].some(x => x.toLowerCase() === v)) : undefined;
}
function currentState() { return findState(state.usState) || data.states[0]; }
const inState = r => r.state === currentState().code;

function applyUrlState() {
  const m = /^(.*\/)([^/]+)\/?$/.exec(location.pathname);
  const fromPath = m && findState(m[2]);
  pageBase = fromPath ? m[1] : location.pathname.replace(/[^/]*$/, '');
  const pick = findState(new URLSearchParams(location.search).get('state')) || fromPath || currentState();
  if (pick.code !== state.usState) setUsState(pick.code, { updateUrl: false });
}

function setUsState(code, { updateUrl = true } = {}) {
  const changed = code !== state.usState;
  state.usState = code;
  if (changed) { state.region = ''; state.hiddenRinks = []; } // regions and rinks belong to one state
  if (updateUrl) history.replaceState(null, '', pageBase + currentState().slug);
  saveState();
}

// ---------- controls ----------
function buildStaticControls() {
  const us = currentState();
  document.title = `Calarink · ${us.name}`;
  $('#usState').innerHTML = data.states.map(s => `<option value="${esc(s.code)}" ${s.code === us.code ? 'selected' : ''}>${esc(s.name)}</option>`).join('');

  const typeBox = $('#types');
  typeBox.innerHTML = data.categories.filter(c => c.public).sort((a, b) => PUBLIC_DEFAULT.indexOf(a.id) - PUBLIC_DEFAULT.indexOf(b.id)).map(c =>
    `<button class="chip" style="--c:var(--c-${c.id})" data-type="${c.id}" aria-pressed="${state.types.includes(c.id)}">${esc(c.label)}</button>`).join('');

  const regions = [...new Set(data.rinks.filter(inState).map(r => r.region))].sort();
  $('#region').innerHTML = `<option value="">All of ${esc(us.name)}</option>` + regions.map(r => `<option ${r === state.region ? 'selected' : ''}>${esc(r)}</option>`).join('');

  $('#dow').innerHTML = DOW.map((d, i) => `<button data-dow="${i}" aria-pressed="${state.dow.includes(i)}" title="Only ${d}">${d[0]}</button>`).join('');
  $('#showAll').checked = state.showAll;
  $('#hideCancelled').checked = state.hideCancelled;
  for (const b of document.querySelectorAll('#range button')) b.setAttribute('aria-pressed', String(+b.dataset.days === state.days));
}

function wireControls() {
  $('#types').addEventListener('click', e => {
    const b = e.target.closest('[data-type]'); if (!b) return;
    const t = b.dataset.type;
    state.types = state.types.includes(t) ? state.types.filter(x => x !== t) : [...state.types, t];
    b.setAttribute('aria-pressed', String(state.types.includes(t)));
    commit();
  });
  $('#range').addEventListener('click', e => {
    const b = e.target.closest('[data-days]'); if (!b) return;
    state.days = +b.dataset.days;
    for (const x of document.querySelectorAll('#range button')) x.setAttribute('aria-pressed', String(x === b));
    commit();
  });
  $('#dow').addEventListener('click', e => {
    const b = e.target.closest('[data-dow]'); if (!b) return;
    const d = +b.dataset.dow;
    state.dow = state.dow.includes(d) ? state.dow.filter(x => x !== d) : [...state.dow, d];
    b.setAttribute('aria-pressed', String(state.dow.includes(d)));
    commit();
  });
  $('#showAll').addEventListener('change', e => { state.showAll = e.target.checked; commit(); });
  $('#hideCancelled').addEventListener('change', e => { state.hideCancelled = e.target.checked; commit(); });
  $('#region').addEventListener('change', e => { state.region = e.target.value; commit(); });
  $('#usState').addEventListener('change', e => { setUsState(e.target.value); buildStaticControls(); render(); });
  $('#rinkList').addEventListener('change', e => {
    const id = e.target.dataset.rink; if (!id) return;
    state.hiddenRinks = e.target.checked ? state.hiddenRinks.filter(x => x !== id) : [...state.hiddenRinks, id];
    commit();
  });
  $('#rinksAll').addEventListener('click', () => { state.hiddenRinks = []; commit(); });
  $('#refresh').addEventListener('click', () => load(true));
  $('#agenda').addEventListener('click', e => {
    const b = e.target.closest('[data-ics]'); if (b) downloadIcs(b.dataset.ics);
  });
}

function commit() { saveState(); render(); }

// ---------- filtering ----------
function rinkById(id) { return data.rinks.find(r => r.id === id); }
// Rink is in the chosen state and region.
const inArea = r => inState(r) && (!state.region || r.region === state.region);

function baseFilter(s, now, until) {
  const start = Date.parse(s.start), end = Date.parse(s.end);
  if (end < now - 30 * 60 * 1000 || start > until) return false;
  const typeOk = state.types.includes(s.category) || (state.showAll && !['public', 'stick-puck', 'shinny', 'freestyle'].includes(s.category));
  if (!typeOk) return false;
  if (state.hideCancelled && s.cancelled) return false;
  if (state.dow.length && !state.dow.includes(DOW.indexOf(fmtDow.format(new Date(start))))) return false;
  if (!inArea(rinkById(s.rinkId))) return false;
  return true;
}

function windowEnd() {
  // End of the Nth local day, counting today as day 1.
  const now = new Date();
  const [y, m, d] = fmtDayKey.format(now).split('-').map(Number);
  return Date.UTC(y, m - 1, d + state.days, 5); // 05:00 UTC = local midnight (EST) / 1am (EDT)
}

// ---------- render ----------
function render() {
  if (!data) return;
  const now = Date.now();
  const until = windowEnd();
  const inScope = data.sessions.filter(s => baseFilter(s, now, until));
  const visible = inScope.filter(s => !state.hiddenRinks.includes(s.rinkId));

  renderUpdated();
  renderRinkList(inScope);
  renderSummary(visible);
  renderAgenda(visible, now);
  renderDirect();
}

function renderUpdated() {
  const stamps = data.rinks.filter(r => r.status).map(r => r.status.fetchedAt);
  const oldest = Math.min(...stamps);
  const mins = Math.round((Date.now() - oldest) / 60000);
  $('#updated').textContent = `${data.rinks.filter(r => r.live && inState(r)).length} rinks pulled live · data ${mins < 1 ? 'just now' : `${mins} min old`} · times shown in Eastern`;
}

function renderRinkList(inScope) {
  const counts = {};
  for (const s of inScope) counts[s.rinkId] = (counts[s.rinkId] || 0) + 1;
  const rinks = data.rinks.filter(r => r.live && inArea(r));
  $('#rinkList').innerHTML = rinks.map(r => {
    const n = counts[r.id] || 0;
    const err = r.status && !r.status.ok;
    return `<label class="rink-item" title="${esc(err ? r.status.errors.join('\n') : r.note || '')}">
      <input type="checkbox" data-rink="${r.id}" ${state.hiddenRinks.includes(r.id) ? '' : 'checked'}>
      <span>${esc(r.name)}<span class="town">${esc(r.town)}</span></span>
      <span class="badge ${err ? 'err' : n ? '' : 'zero'}">${err ? 'error' : n}</span>
    </label>`;
  }).join('');
}

function renderSummary(visible) {
  const rinksWith = new Set(visible.map(s => s.rinkId)).size;
  const live = data.rinks.filter(r => r.live && !state.hiddenRinks.includes(r.id) && inArea(r));
  const errored = live.filter(r => r.status && !r.status.ok);
  const unposted = live.filter(r => r.status?.ok && r.status.count === 0);
  $('#summary').innerHTML = `<span><strong>${visible.length}</strong> session${visible.length === 1 ? '' : 's'} at ${rinksWith} rink${rinksWith === 1 ? '' : 's'}</span>`;
  const link = r => `<a href="${esc(r.website)}" target="_blank" rel="noopener">${esc(r.name)}</a>`;
  const alerts = [];
  if (errored.length) alerts.push(`Couldn't reach ${errored.map(link).join(', ')} on the last pull${errored.some(r => r.status.count) ? ' (showing the last good copy)' : ''}.`);
  if (unposted.length) alerts.push(`No upcoming times posted yet by ${unposted.map(link).join(', ')}. Their calendars are empty for now.`);
  const box = document.getElementById('alerts') || Object.assign(document.createElement('div'), { id: 'alerts' });
  box.innerHTML = alerts.map(a => `<div class="alert">${a}</div>`).join('');
  $('#summary').after(box);
}

function renderAgenda(visible, now) {
  if (!visible.length) {
    $('#agenda').innerHTML = `<div class="empty"><strong>No sessions match these filters.</strong>Try a longer date range, more session types, or all regions.</div>`;
    return;
  }
  const todayKey = fmtDayKey.format(new Date());
  const byDay = new Map();
  for (const s of visible) {
    const k = fmtDayKey.format(new Date(s.start));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }
  const catLabel = Object.fromEntries(data.categories.map(c => [c.id, c.label]));
  let html = '';
  for (const [key, list] of byDay) {
    const d = new Date(list[0].start);
    html += `<section class="day"><div class="day-head"><h3>${fmtDayHead.format(d)}</h3>${key === todayKey ? '<span class="today-tag">Today</span>' : ''}<span class="count">${list.length}</span></div><div class="sessions">`;
    for (const s of list) {
      const start = Date.parse(s.start), end = Date.parse(s.end);
      const rink = rinkById(s.rinkId);
      const mins = Math.round((end - start) / 60000);
      const dur = mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? ` ${mins % 60}m` : ''}` : `${mins}m`;
      const isNow = start <= now && now < end;
      const flags = [
        isNow && '<span class="flag now">On now</span>',
        s.cancelled && '<span class="flag bad">Cancelled</span>',
        s.recurring && '<span class="flag" title="Projected from a weekly schedule posted on the rink\'s site">Weekly (posted)</span>',
        s.fromText && !s.recurring && '<span class="flag" title="Read from text on the rink\'s web page">From rink page</span>',
      ].filter(Boolean).join('');
      html += `<div class="session ${end < now ? 'past' : ''} ${s.cancelled ? 'cancelled' : ''}" style="--c:var(--c-${s.category})">
        <div class="time">${fmtTime.format(new Date(start))} – ${fmtTime.format(new Date(end))}<span class="dur">${dur}</span></div>
        <div>
          <div class="title">${esc(s.title)}</div>
          <div class="meta"><span class="pill">${esc(catLabel[s.category] || s.category)}</span><span>${esc(rink.name)} · ${esc(rink.town)}</span>${flags}</div>
        </div>
        <div class="actions">
          <button class="iconbtn" data-ics="${esc(s.id)}" title="Add to my calendar (.ics)" aria-label="Add to calendar"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 16H5V9h14zm-8-9h2v3h3v2h-3v3h-2v-3H8v-2h3z"/></svg></button>
          <a class="iconbtn" href="${esc(rink.scheduleUrl || rink.website)}" target="_blank" rel="noopener" title="Open the rink's schedule page" aria-label="Rink schedule page"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3zm5 16H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2z"/></svg></a>
        </div>
      </div>`;
    }
    html += '</div></section>';
  }
  $('#agenda').innerHTML = html;
}

function renderDirect() {
  const rinks = data.rinks.filter(r => !r.live && inArea(r));
  $('#directSection').hidden = !rinks.length;
  $('#direct').innerHTML = rinks.map(r => `<div class="card">
    <h3>${esc(r.name)}</h3><div class="town">${esc(r.town)}${r.address ? ` · ${esc(r.address.replace(/, ME$/, ''))}` : ''}</div>
    ${r.note ? `<p>${esc(r.note)}</p>` : ''}
    <div class="links">
      <a href="${esc(r.scheduleUrl || r.website)}" target="_blank" rel="noopener">Schedule / website ↗</a>
      ${r.phone ? `<a href="tel:${esc(r.phone.replace(/\D/g, ''))}">${esc(r.phone)}</a>` : ''}
    </div></div>`).join('');
}

// ---------- add to calendar ----------
function downloadIcs(id) {
  const s = data.sessions.find(x => x.id === id); if (!s) return;
  const rink = rinkById(s.rinkId);
  const stamp = iso => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escIcs = t => String(t).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Calarink//EN', 'BEGIN:VEVENT',
    `UID:${s.id.replace(/[^\w-]/g, '-')}@calarink.com`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(s.start)}`, `DTEND:${stamp(s.end)}`,
    `SUMMARY:${escIcs(`${s.title} @ ${rink.name}`)}`,
    `LOCATION:${escIcs(rink.address || `${rink.name}, ${rink.town}, ME`)}`,
    `DESCRIPTION:${escIcs(`Schedule: ${rink.scheduleUrl || rink.website}\nConfirm with the rink before you go.`)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })),
    download: `${rink.name} ${fmtDayKey.format(new Date(s.start))}.ics`.replace(/[^\w .-]/g, ''),
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const syncHeaderHeight = () => document.documentElement.style.setProperty('--head-h', `${document.querySelector('.top').offsetHeight}px`);
addEventListener('resize', syncHeaderHeight);
syncHeaderHeight();
wireControls();
load();
setInterval(() => data && render(), 60 * 1000); // keep "On now" and ages current
setInterval(() => data?.static && load(), 10 * 60 * 1000); // published site: pick up the latest scheduled build
