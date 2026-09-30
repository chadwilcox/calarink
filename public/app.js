const DEFAULT_TZ = 'America/New_York';
const PUBLIC_DEFAULT = ['public', 'stick-puck', 'shinny', 'freestyle'];
// One more type covers everything that isn't walk-in public ice: practices, games,
// rentals, lessons, closures. Every type is shown until the visitor filters.
const TEAM = 'team';
const ALL_TYPES = [...PUBLIC_DEFAULT, TEAM];
const TYPE_INFO = {
  public: 'Open skating for anyone',
  'stick-puck': 'Skate with a stick and puck, no games',
  shinny: 'Drop-in pickup hockey',
  freestyle: 'Ice for figure skaters',
  [TEAM]: 'Practices, games, rentals, lessons and closures',
};
const STORE_KEY = 'maine-rink-times:v1'; // pre-Calarink name, kept so returning visitors keep their filters
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Times and days are shown in the chosen state's time zone (Minnesota is Central).
function makeFormatters(tz) {
  const f = (opts, locale = 'en-US') => new Intl.DateTimeFormat(locale, { timeZone: tz, ...opts });
  return {
    time: f({ hour: 'numeric', minute: '2-digit' }),
    dayKey: f({ year: 'numeric', month: '2-digit', day: '2-digit' }, 'en-CA'),
    dayHead: f({ weekday: 'long', month: 'long', day: 'numeric' }),
    dow: f({ weekday: 'short' }),
    parts: f({ hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}
let fmt = makeFormatters(DEFAULT_TZ);

// A rink in a different zone from the rest of its state (Dyer, on Chicago time, in Indiana)
// shows its own local times, marked with the zone: "6:00 – 7:30 PM CT".
const zoneFmts = new Map();
function zoneTime(tz) {
  if (!zoneFmts.has(tz)) zoneFmts.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }));
  return zoneFmts.get(tz);
}
const ZONE_ABBR = { EST: 'ET', EDT: 'ET', CST: 'CT', CDT: 'CT', MST: 'MT', MDT: 'MT', PST: 'PT', PDT: 'PT' };

// "8:00 – 9:00 AM" when both ends share AM/PM; "11:00 AM – 12:30 PM" otherwise.
function timeRange(start, end, tz) {
  let zone = '', a, b;
  if (tz && tz !== (currentState().tz || DEFAULT_TZ)) {
    const f = zoneTime(tz), strip = s => s.replace(/\s+\S+$/, '');
    const z = f.formatToParts(new Date(start)).find(p => p.type === 'timeZoneName')?.value || '';
    zone = ` ${ZONE_ABBR[z] || z}`;
    a = strip(f.format(new Date(start))); b = strip(f.format(new Date(end)));
  } else {
    a = fmt.time.format(new Date(start)); b = fmt.time.format(new Date(end));
  }
  const ap = s => (/\s?[AP]M$/i.exec(s) || [''])[0];
  return (ap(a) && ap(a) === ap(b) ? `${a.slice(0, -ap(a).length)} – ${b}` : `${a} – ${b}`) + zone;
}

let data = null;
let linkOpened = false; // a shared session link has been opened
let pageBase = null; // site root that state pages hang off: '/' on calarink.com
const state = loadState();

function loadState() {
  const base = { types: ALL_TYPES, typesChosen: false, days: 14, dow: [], usState: '', region: '', hiddenRinks: [] };
  try {
    const { showAll, hideCancelled, ...saved } = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    const s = { ...base, ...saved };
    // Types saved before the Filter pop-up were the old default, not a choice: start from all.
    if (!s.typesChosen) s.types = ALL_TYPES;
    return s;
  } catch { return base; }
}
function saveState() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}

// ---------- data ----------
async function load(refresh = false) {
  const btn = $('#refresh');
  btn.disabled = true; btn.classList.add('spinning');
  try {
    // Relative, so it works both from the local server and from a GitHub Pages subpath.
    const res = await fetch(`schedule.json${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    offline = res.headers.get('X-Calarink-Saved') === '1'; // sw.js served its saved copy
    const next = await res.json();
    // The published site keeps each state's sessions in its own file (sessions/maine.json), so a
    // visitor downloads only the state they're looking at. The local server sends everything.
    if (!next.sessions) next.sessions = data?.sessions && data.generatedAt === next.generatedAt ? data.sessions : null;
    data = next;
    btn.hidden = !!data.static; // the published site is rebuilt on a schedule; there's no server to refresh
    if (pageBase === null) applyUrlState();
    if (!data.sessions) {
      try { await loadStateSessions(); } catch (err) {
        if (!offline) throw err;
        unsavedState = currentState().name; data.sessions = []; // opened offline on a state never saved here
      }
    }
    buildStaticControls();
    render();
    // A shared session link (calarink.com/maine/?event=<id>) opens that session, once.
    if (!linkOpened) {
      linkOpened = true;
      const id = new URLSearchParams(location.search).get('event');
      if (id) openSession(id, { fromLink: true });
    }
  } catch (err) {
    // A failed background refresh keeps what's on screen; only say so if there's nothing to show.
    if (!data) $('#agenda').innerHTML = `<div class="empty"><strong>Couldn't load schedules.</strong>${esc(err.message)}. Try reloading the page.</div>`;
  } finally {
    btn.disabled = false; btn.classList.remove('spinning');
  }
}

async function loadStateSessions() {
  const slug = currentState().slug;
  const res = await fetch(`sessions/${slug}.json?v=${encodeURIComponent(data.generatedAt)}`);
  if (!res.ok) throw new Error(`Server returned ${res.status}`);
  const sessions = await res.json();
  if (currentState().slug === slug) data.sessions = sessions; // ignore a reply for a state the visitor already left
}

// ---------- US state ----------
// calarink.com/maine or ?state=maine opens that state; otherwise the last state used, then the
// visitor's own state (added to the page by the Cloudflare Worker, see worker/), else the default.
function findState(v) {
  v = String(v || '').toLowerCase();
  return v ? data.states.find(s => [s.slug, s.code, s.name].some(x => x.toLowerCase() === v)) : undefined;
}
function currentState() { return findState(state.usState) || data.states.find(s => s.default) || data.states[0]; }
const inState = r => r.state === currentState().code;

function applyUrlState() {
  const m = /^(.*\/)([^/]+)\/?$/.exec(location.pathname);
  const fromPath = m && findState(m[2]);
  pageBase = fromPath ? m[1] : location.pathname.replace(/[^/]*$/, '');
  const visitorRegion = document.querySelector('meta[name="visitor-region"]')?.content;
  const pick = findState(new URLSearchParams(location.search).get('state')) || fromPath
    || findState(state.usState) || findState(visitorRegion) || currentState();
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
  fmt = makeFormatters(us.tz || DEFAULT_TZ);
  document.title = `Calarink · ${us.name}`;
  const option = s => `<option value="${esc(s.code)}" ${s.code === us.code ? 'selected' : ''}>${esc(s.name)}</option>`;
  $('#usState').innerHTML = [['US', 'United States'], ['CA', 'Canada']]
    .map(([c, label]) => `<optgroup label="${label}">${data.states.filter(s => (s.country || 'US') === c).map(option).join('')}</optgroup>`).join('');

  renderTypeSummary();

  const regions = [...new Set(data.rinks.filter(inState).map(r => r.region))].sort();
  $('#region').innerHTML = `<option value="">All of ${esc(us.name)}</option>` + regions.map(r => `<option ${r === state.region ? 'selected' : ''}>${esc(r)}</option>`).join('');

  $('#dow').innerHTML = DOW.map((d, i) => `<button data-dow="${i}" aria-pressed="${state.dow.includes(i)}" title="Only ${d}">${d[0]}</button>`).join('');
  for (const b of document.querySelectorAll('#range button')) b.setAttribute('aria-pressed', String(+b.dataset.days === state.days));
}

// ---------- session types: summary in the sidebar, choices in the Filter pop-up ----------
function typeList() {
  const label = Object.fromEntries(data.categories.map(c => [c.id, c.label]));
  return ALL_TYPES.map(id => ({ id, label: id === TEAM ? label.other || 'Team / private ice' : label[id], color: id === TEAM ? 'other' : id }));
}
const typesFiltered = () => !ALL_TYPES.every(t => state.types.includes(t));

function renderTypeSummary() {
  const filtered = typesFiltered();
  $('#typeSummary').innerHTML = filtered
    ? `<div class="chips">${typeList().filter(t => state.types.includes(t.id)).map(t => `<span class="chip" style="--c:var(--c-${t.color})">${esc(t.label)}</span>`).join('')}</div>`
    : '<p class="type-all">All session types</p>';
  $('#typesOpen span').textContent = filtered ? 'Change' : 'Filter';
  $('#typesReset').hidden = !filtered;
}

function openTypeDialog() {
  $('#typeOptions').innerHTML = typeList().map(t => `
    <label class="type-option" style="--c:var(--c-${t.color})">
      <input type="checkbox" value="${t.id}" ${state.types.includes(t.id) ? 'checked' : ''}>
      <span class="type-dot"></span>
      <span><strong>${esc(t.label)}</strong><span class="muted">${esc(TYPE_INFO[t.id] || '')}</span></span>
    </label>`).join('');
  syncApply();
  $('#typeDialog').returnValue = ''; // Esc closes without a value; don't reuse the last "apply"
  $('#typeDialog').showModal();
}
const checkedTypes = () => [...document.querySelectorAll('#typeOptions input:checked')].map(i => i.value);
function syncApply() { $('#typesApply').disabled = checkedTypes().length === 0; }

function setTypes(types) {
  state.types = ALL_TYPES.filter(t => types.includes(t));
  state.typesChosen = true;
  renderTypeSummary();
  commit();
}

function wireControls() {
  $('#typesOpen').addEventListener('click', openTypeDialog);
  $('#typesReset').addEventListener('click', () => setTypes(ALL_TYPES));
  $('#typeOptions').addEventListener('change', syncApply);
  $('#typesAllOn').addEventListener('click', () => { document.querySelectorAll('#typeOptions input').forEach(i => { i.checked = true; }); syncApply(); });
  $('#typesAllOff').addEventListener('click', () => { document.querySelectorAll('#typeOptions input').forEach(i => { i.checked = false; }); syncApply(); });
  $('#typeDialog').addEventListener('close', () => {
    if ($('#typeDialog').returnValue === 'apply' && checkedTypes().length) setTypes(checkedTypes());
  });
  // Clicking the dimmed backdrop closes the pop-up without applying.
  $('#typeDialog').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close('cancel'); });
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
  $('#region').addEventListener('change', e => { state.region = e.target.value; commit(); });
  $('#usState').addEventListener('change', async e => {
    setUsState(e.target.value);
    if (data.static) {
      unsavedState = null;
      try { await loadStateSessions(); } catch {
        if (!offline && navigator.onLine) { load(); return; }
        unsavedState = currentState().name; data.sessions = []; // offline, and this state was never saved here
      }
    }
    buildStaticControls(); render();
  });
  $('#rinkList').addEventListener('change', e => {
    const id = e.target.dataset.rink; if (!id) return;
    state.hiddenRinks = e.target.checked ? state.hiddenRinks.filter(x => x !== id) : [...state.hiddenRinks, id];
    commit();
  });
  // The rink checklist stays folded to a one-line summary until the visitor asks to edit it.
  const toggleRinks = () => { rinksOpen = !rinksOpen; showRinkList(); };
  $('#rinksEdit').addEventListener('click', toggleRinks);
  $('#rinkSummary').addEventListener('click', toggleRinks);
  $('#rinksAll').addEventListener('click', () => { state.hiddenRinks = []; commit(); });
  // Clear every rink in the list (this state and region), then tick the ones you want.
  $('#rinksNone').addEventListener('click', () => {
    const shown = data.rinks.filter(r => listed(r) && inArea(r)).map(r => r.id);
    state.hiddenRinks = [...new Set([...state.hiddenRinks, ...shown])];
    commit();
  });
  $('#refresh').addEventListener('click', () => load(true));
  $('#agenda').addEventListener('click', e => {
    // Share shares; anything else on a session opens its details (add to calendar is in there).
    const sh = e.target.closest('[data-share]'); if (sh) return shareSession(sh.dataset.share);
    if (e.target.closest('a')) return;
    const card = e.target.closest('[data-event]'); if (card) openSession(card.dataset.event);
  });
}

function commit() { saveState(); render(); }

// ---------- filtering ----------
function rinkById(id) { return data.rinks.find(r => r.id === id); }
// Rink is in the chosen state and region.
const inArea = r => inState(r) && (!state.region || r.region === state.region);
// A rink with a schedule we read. One whose calendar has no upcoming times posted (between
// seasons, say) is left out until it posts some; one we couldn't reach still shows, flagged.
const listed = r => r.live && !(r.status?.ok && r.status.count === 0);

function baseFilter(s, now, until) {
  const start = Date.parse(s.start), end = Date.parse(s.end);
  if (end < now - 30 * 60 * 1000 || start > until) return false;
  const type = PUBLIC_DEFAULT.includes(s.category) ? s.category : TEAM;
  if (!state.types.includes(type)) return false;
  if (s.cancelled) return false;
  if (state.dow.length && !state.dow.includes(DOW.indexOf(fmt.dow.format(new Date(start))))) return false;
  if (!inArea(rinkById(s.rinkId))) return false;
  return true;
}

function windowEnd() {
  // Midnight at the end of the Nth local day (today is day 1), in the state's time zone.
  const [y, m, d] = fmt.dayKey.format(new Date()).split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d + state.days);
  const p = Object.fromEntries(fmt.parts.formatToParts(new Date(guess)).map(x => [x.type, x.value]));
  const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - guess;
  return guess - offset;
}

// ---------- render ----------
function render() {
  if (!data) return;
  const now = Date.now();
  const until = windowEnd();
  const inScope = data.sessions.filter(s => baseFilter(s, now, until));
  const visible = inScope.filter(s => !state.hiddenRinks.includes(s.rinkId));

  renderRinkList(inScope);
  renderSummary(visible);
  renderAgenda(visible, now);
  renderDirect();
}

let rinksOpen = false;
function showRinkList() {
  $('#rinkList').hidden = !rinksOpen;
  $('#rinkSummary').hidden = rinksOpen;
  $('#rinksAll').hidden = $('#rinksNone').hidden = !rinksOpen;
  $('#rinksEdit').textContent = rinksOpen ? 'done' : 'edit';
  $('#rinksEdit').setAttribute('aria-expanded', String(rinksOpen));
}

function renderRinkList(inScope) {
  const counts = {};
  for (const s of inScope) counts[s.rinkId] = (counts[s.rinkId] || 0) + 1;
  const rinks = data.rinks.filter(r => listed(r) && inArea(r));
  const shown = rinks.filter(r => !state.hiddenRinks.includes(r.id)).length;
  const noun = n => `${n} rink${n === 1 ? '' : 's'}`;
  $('#rinkSummary').textContent = !rinks.length ? 'No rinks with schedules here'
    : shown === rinks.length ? `All ${noun(rinks.length)}`
    : shown ? `${shown} of ${noun(rinks.length)}` : 'No rinks selected';
  showRinkList();
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
  $('#summary').innerHTML = `<span><strong>${visible.length}</strong> session${visible.length === 1 ? '' : 's'} at ${rinksWith} rink${rinksWith === 1 ? '' : 's'}</span>`;
  const link = r => `<a href="${esc(r.website)}" target="_blank" rel="noopener">${esc(r.name)}</a>`;
  const alerts = [];
  if (offline || unsavedState) {
    const saved = new Date(data.generatedAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    alerts.push(unsavedState ? `You're offline, and ${esc(unsavedState)} hasn't been saved on this device yet. Connect to load it.`
      : `You're offline. Showing the schedules saved ${saved}; check with the rink before you drive.`);
  }
  if (errored.length) alerts.push(`Couldn't reach ${errored.map(link).join(', ')} on the last pull${errored.some(r => r.status.count) ? ' (showing the last good copy)' : ''}.`);
  const box = document.getElementById('alerts') || Object.assign(document.createElement('div'), { id: 'alerts' });
  box.innerHTML = alerts.map(a => `<div class="alert">${a}</div>`).join('');
  $('#summary').after(box);
}

function renderAgenda(visible, now) {
  if (!visible.length) {
    $('#agenda').innerHTML = `<div class="empty"><strong>No sessions match these filters.</strong>Try a longer date range, more session types, or all regions.</div>`;
    return;
  }
  const todayKey = fmt.dayKey.format(new Date());
  const byDay = new Map();
  for (const s of visible) {
    const k = fmt.dayKey.format(new Date(s.start));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }
  const catLabel = Object.fromEntries(data.categories.map(c => [c.id, c.label]));
  // Each session's type label only shows once the visitor has filtered types.
  const showPills = typesFiltered();
  let html = '';
  for (const [key, list] of byDay) {
    const d = new Date(list[0].start);
    html += `<section class="day"><div class="day-head"><h3>${fmt.dayHead.format(d)}</h3>${key === todayKey ? '<span class="today-tag">Today</span>' : ''}<span class="count">${list.length}</span></div><div class="sessions">`;
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
      // Title and rink are separate grid cells so phones can show the rink right under the time.
      html += `<div class="session ${end < now ? 'past' : ''} ${s.cancelled ? 'cancelled' : ''}" data-event="${esc(s.id)}" style="--c:var(--c-${s.category})">
        <div class="time"><span class="range">${timeRange(start, end, rink.tz)}</span><span class="dur">${dur}</span>${flags && `<span class="flags-sm">${flags}</span>`}</div>
        <div class="title">${esc(s.title)}</div>
        <div class="meta">${showPills ? `<span class="pill">${esc(catLabel[s.category] || s.category)}</span>` : ''}<span class="where"><span class="rink-name">${esc(rink.name)}</span> <span class="town">· ${esc(rink.town)}</span></span>${flags && `<span class="flags-lg">${flags}</span>`}</div>
        <div class="actions">
          <button class="iconbtn" data-share="${esc(s.id)}" title="Share this session" aria-label="Share"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11A2.99 2.99 0 0 0 21 5a3 3 0 1 0-5.91.7L8.04 9.81A3 3 0 1 0 6 15a3 3 0 0 0 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65A2.92 2.92 0 1 0 18 16.08"/></svg></button>
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
    <h3>${esc(r.name)}</h3><div class="town">${esc(r.town)}${r.address ? ` · ${esc(r.address.replace(/, [A-Z]{2}$/, ''))}` : ''}</div>
    ${r.note ? `<p>${esc(r.note)}</p>` : ''}
    <div class="links">
      <a href="${esc(r.scheduleUrl || r.website)}" target="_blank" rel="noopener">Schedule / website ↗</a>
      ${r.phone ? `<a href="tel:${esc(r.phone.replace(/\D/g, ''))}">${esc(r.phone)}</a>` : ''}
    </div></div>`).join('');
}

// ---------- one session: details, share, add to calendar ----------
// Each session has its own link (calarink.com/maine/?event=<id>) that opens these details, so it
// can be shared. The id stays the same as long as the session does (see sessionId in schedule.js).
const sessionById = id => data?.sessions?.find(x => x.id === id);
const stateOfRink = rink => data.states.find(x => x.code === rink.state) || currentState();
const sessionUrl = s => new URL(`${pageBase || '/'}${stateOfRink(rinkById(s.rinkId)).slug}/?event=${encodeURIComponent(s.id)}`, location.origin).href;
const whereOf = rink => rink.address || `${rink.name}, ${rink.town}, ${rink.state}`;
const whenOf = s => `${fmt.dayHead.format(new Date(s.start))} · ${timeRange(Date.parse(s.start), Date.parse(s.end), rinkById(s.rinkId).tz)}`;
const icsStamp = iso => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const ICONS = {
  share: 'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11A2.99 2.99 0 0 0 21 5a3 3 0 1 0-5.91.7L8.04 9.81A3 3 0 1 0 6 15a3 3 0 0 0 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65A2.92 2.92 0 1 0 18 16.08',
  calendar: 'M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 16H5V9h14zm-8-9h2v3h3v2h-3v3h-2v-3H8v-2h3z',
  open: 'M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3zm5 16H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2z',
  map: 'M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7m0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5',
};
const icon = name => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="${ICONS[name]}"/></svg>`;

function openSession(id, { fromLink = false } = {}) {
  const s = sessionById(id);
  const dialog = $('#eventDialog');
  if (!s) {
    // A shared link to a session that's over, or that the rink changed: point at the rink instead.
    const rink = rinkById(String(id).split('.')[0]);
    $('#eventBody').innerHTML = `<h2 id="eventTitle">This session isn't listed anymore</h2>
      <p class="muted">It may have already happened, or ${rink ? esc(rink.name) : 'the rink'} changed its schedule.
      ${rink ? 'Here are its other times, or check the rink directly.' : 'Browse the other times below.'}</p>
      <div class="event-actions">${rink ? `<a class="btn-outline wide" href="${esc(rink.scheduleUrl || rink.website)}" target="_blank" rel="noopener">${icon('open')}<span>${esc(rink.name)}'s schedule</span></a>` : ''}
      <button type="button" class="btn wide" data-close>Browse ice times</button></div>`;
    dialog.showModal();
    return;
  }
  const rink = rinkById(s.rinkId);
  const catLabel = data.categories.find(c => c.id === s.category)?.label || '';
  $('#eventBody').innerHTML = `
    <p class="event-when">${esc(whenOf(s))}</p>
    <h2 id="eventTitle">${esc(s.title)}</h2>
    ${s.cancelled ? '<p><span class="flag bad">Cancelled</span></p>' : ''}
    <p class="event-where"><strong>${esc(rink.name)}</strong> · ${esc(rink.town)}${rink.address ? `<br>${esc(rink.address.replace(/, [A-Z]{2}$/, ''))}` : ''}
      ${catLabel ? `<br><span class="pill" style="--c:var(--c-${s.category})">${esc(catLabel)}</span>` : ''}</p>
    <div class="event-actions">
      <button type="button" class="btn wide" data-share="${esc(s.id)}">${icon('share')}<span>Share</span></button>
      <p class="event-label wide">${icon('calendar')} Add to calendar</p>
      <button type="button" class="btn-outline" data-ics="${esc(s.id)}" title="Apple Calendar, Outlook and most other calendar apps">Apple / Outlook</button>
      <a class="btn-outline" href="${esc(googleCalendarUrl(s))}" target="_blank" rel="noopener" data-gcal>Google</a>
      <a class="btn-outline" href="${esc(rink.scheduleUrl || rink.website)}" target="_blank" rel="noopener">${icon('open')}<span>Rink's schedule</span></a>
      <a class="btn-outline" href="${esc(directionsUrl(rink))}" target="_blank" rel="noopener">${icon('map')}<span>Directions</span></a>
    </div>
    <p class="muted event-note">Times come from the rink's own calendar and can change. Confirm with the rink before you go.</p>`;
  if (fromLink) count('event-link-opened', 'Opened a shared session link');
  dialog.showModal();
}

function closeSession() {
  $('#eventDialog').close();
  // Opened from a shared link: back to the plain state address, so a reload doesn't reopen it.
  if (new URLSearchParams(location.search).has('event')) history.replaceState(null, '', location.pathname);
}

async function shareSession(id) {
  const s = sessionById(id); if (!s) return;
  const rink = rinkById(s.rinkId);
  const url = sessionUrl(s);
  const text = `${s.title} at ${rink.name} (${rink.town}), ${whenOf(s)}. Found on Calarink: ice times from every rink, free on your phone.`;
  if (navigator.share) {
    try { await navigator.share({ title: `${s.title} at ${rink.name}`, text, url }); count('event-shared', 'Shared a session'); } catch { /* closed the share sheet */ }
    return;
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    count('event-shared', 'Shared a session');
    toast('Link copied. Paste it anywhere to share.');
  } catch { window.prompt('Copy this link to share it:', url); }
}

function googleCalendarUrl(s) {
  const rink = rinkById(s.rinkId);
  const q = new URLSearchParams({
    action: 'TEMPLATE', text: `${s.title} @ ${rink.name}`, dates: `${icsStamp(s.start)}/${icsStamp(s.end)}`,
    location: whereOf(rink), details: `${sessionUrl(s)}\nConfirm with the rink before you go. Found on Calarink.`,
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

function directionsUrl(rink) {
  const q = encodeURIComponent(whereOf(rink));
  return isIOS ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

function downloadIcs(id) {
  const s = sessionById(id); if (!s) return;
  const rink = rinkById(s.rinkId);
  const escIcs = t => String(t).replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Calarink//EN', 'BEGIN:VEVENT',
    `UID:${s.id.replace(/[^\w-]/g, '-')}@calarink.com`,
    `DTSTAMP:${icsStamp(new Date().toISOString())}`,
    `DTSTART:${icsStamp(s.start)}`, `DTEND:${icsStamp(s.end)}`,
    `SUMMARY:${escIcs(`${s.title} @ ${rink.name}`)}`,
    `LOCATION:${escIcs(whereOf(rink))}`,
    `URL:${sessionUrl(s)}`,
    `DESCRIPTION:${escIcs(`${sessionUrl(s)}\nRink schedule: ${rink.scheduleUrl || rink.website}\nConfirm with the rink before you go. Found on Calarink.`)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })),
    download: `${rink.name} ${fmt.dayKey.format(new Date(s.start))}.ics`.replace(/[^\w .-]/g, ''),
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  count('added-to-calendar', 'Added a session to a calendar');
}

let toastTimer;
function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  // Inside the open dialog, or the dialog (drawn on top of everything) would hide it.
  ($('#eventDialog').open ? $('#eventDialog') : document.body).append(el);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

$('#eventDialog').addEventListener('click', e => {
  if (e.target === e.currentTarget || e.target.closest('.event-close, [data-close]')) return closeSession();
  const sh = e.target.closest('[data-share]'); if (sh) return shareSession(sh.dataset.share);
  const ics = e.target.closest('[data-ics]'); if (ics) return downloadIcs(ics.dataset.ics);
  if (e.target.closest('[data-gcal]')) count('added-to-calendar', 'Added a session to a calendar');
});
$('#eventDialog').addEventListener('cancel', e => { e.preventDefault(); closeSession(); }); // Esc key

// ---------- install as an app, and offline ----------
// sw.js keeps the page and the last schedules loaded, so the installed app opens without a signal.
let offline = false;     // the schedules on screen are sw.js's saved copy
let unsavedState = null; // a state picked while offline that this device never saved
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').then(async () => {
    // The first visit loads its schedules before the worker is running; ask it to save them.
    if (navigator.serviceWorker.controller) return;
    const reg = await navigator.serviceWorker.ready;
    const waitForData = () => data?.states ? Promise.resolve() : new Promise(r => setTimeout(() => r(waitForData()), 500));
    await waitForData();
    reg.active?.postMessage({ type: 'save', urls: [location.href, 'schedule.json', ...(data.static ? [`sessions/${currentState().slug}.json`] : [])] });
  }).catch(() => {});
}
addEventListener('online', () => { unsavedState = null; load(); });
addEventListener('offline', () => { offline = true; if (data) render(); });

// "Free Mobile App" floats on phones and tablets that don't have the app yet. On Android, Chrome
// offers its own install prompt only when the app isn't installed; on an iPhone or iPad the only
// way is Safari's Share → Add to Home Screen, so the button shows how. Not shown on computers.
const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(navigator.userAgent);
let installPrompt = null;
if (!installed && isIOS) $('#install').hidden = false;
addEventListener('beforeinstallprompt', e => {
  if (!isAndroid) return; // desktop Chrome and Edge keep their own install icon in the address bar
  e.preventDefault(); installPrompt = e; $('#install').hidden = false;
});
addEventListener('appinstalled', () => { installPrompt = null; $('#install').hidden = true; });
$('#install').addEventListener('click', async () => {
  if (!installPrompt) { $('#installDialog').showModal(); return; }
  installPrompt.prompt();
  await installPrompt.userChoice;
  $('#install').hidden = true; // installed, or not now: the browser offers it again later
  installPrompt = null;
});
$('#installDialog').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); });

// ---------- counts (calarink.goatcounter.com) ----------
// GoatCounter's script counts each page load by itself. This adds what it can't see: the app
// being opened from a home screen, its first launch on a device (the closest thing to an install
// count that works on iPhones too; the installed app keeps its own storage, apart from the
// browser's), and state picks, which change the address without loading a page.
function count(path, title, event = true) {
  const send = () => window.goatcounter?.count?.({ path, title, event });
  if (window.goatcounter?.count) send();
  else document.querySelector('script[data-goatcounter]')?.addEventListener('load', send);
}
if (installed) {
  count('app-opened', 'Opened the app');
  try {
    if (!localStorage.getItem('calarink.appSeen')) {
      localStorage.setItem('calarink.appSeen', '1');
      count('app-installed', 'App installed (first launch on a device)');
    }
  } catch { /* storage blocked: skip the install count */ }
}
$('#usState').addEventListener('change', e => {
  const s = findState(e.target.value);
  if (s) count(`${pageBase || '/'}${s.slug}/`, `Calarink · ${s.name}`, false); // as the published pages are addressed
});

const syncHeaderHeight = () => document.documentElement.style.setProperty('--head-h', `${document.querySelector('.top').offsetHeight}px`);
addEventListener('resize', syncHeaderHeight);
syncHeaderHeight();
wireControls();
load();
setInterval(() => data && render(), 60 * 1000); // keep "On now" and past sessions current
setInterval(() => data?.static && load(), 10 * 60 * 1000); // published site: pick up the latest scheduled build
