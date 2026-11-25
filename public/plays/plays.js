// Top Plays page: watch and vote, upload a clip, and (for the moderator) review clips.
// The API is the Worker in plays-worker/. Clips are trimmed and converted here in the uploader's
// browser, so any phone's video ends up a small MP4 that plays everywhere, with no location data.
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const API = '/plays-api';
const MAX_SECONDS = 15, MIN_SECONDS = 1;
const MAX_FILE = 2 * 1024 ** 3;
const params = new URLSearchParams(location.search);
const linkedClip = params.get('clip');

let places = { states: [], rinks: [] };
let board = null;    // the month on screen
let me = { user: null, clips: [] };
let playSelection = false;

async function api(path, { method = 'GET', body, type, raw } = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      method, cache: 'no-store',
      headers: body ? { 'Content-Type': type || 'application/json' } : {},
      body: raw ? body : body && JSON.stringify(body),
    });
  } catch { throw new Error("Couldn't reach Calarink. Check your connection."); }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw Object.assign(new Error(data?.error || 'Something went wrong. Try again.'), { status: res.status });
  return data;
}

function toast(message) {
  const t = $('#toast');
  t.textContent = message; t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
}
function count(path, title) {
  if (!/^(localhost|127\.)/.test(location.hostname)) window.goatcounter?.count?.({ path, title, event: true });
}

// ---------- names and dates ----------
const stateName = code => places.states.find(s => s.code === code)?.name || code;
const rinkName = id => places.rinks.find(r => r.id === id)?.name || '';
const whereOf = p => [rinkName(p.rink), stateName(p.state)].filter(Boolean).join(', ');
const monthLabel = m => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
// Same list as plays-worker/src/levels.js. Canada names its age groups differently.
const LEVELS_US = ['6U', '8U', '10U', '12U', '14U', '16U', '18U'], LEVELS_CA = ['U7', 'U9', 'U11', 'U13', 'U15', 'U18'];
const LEVELS_BOTH = ['High School', 'Junior', 'College', 'Beer League A', 'Beer League B', 'Beer League C', 'Adult', 'Other'];
const LEVELS = [...LEVELS_US, ...LEVELS_CA, ...LEVELS_BOTH];
const votesText = n => `${n} vote${n === 1 ? '' : 's'}`;

// ---------- the list ----------
async function loadBoard(month = '') {
  try {
    board = await api(`/plays${month ? `?month=${encodeURIComponent(month)}` : ''}`);
  } catch (err) {
    $('#list').innerHTML = `<div class="empty"><strong>Couldn't load the plays.</strong>${esc(err.message)}</div>`;
    return;
  }
  $('#month').innerHTML = board.months.map(w => `<option value="${esc(w)}"${w === board.month ? ' selected' : ''}>${w === board.current ? 'This month' : monthLabel(w)}</option>`).join('');
  renderBoard();
}

function renderBoard() {
  const live = board.month === board.current;
  $('#monthNote').textContent = live
    ? `${monthLabel(board.month)}. Vote for as many as you like. Voting ends when the month does (Eastern).`
    : `${monthLabel(board.month)}. Final results.`;
  const filter = $('#stateFilter'), chosen = filter.value;
  const codes = [...new Set(board.plays.map(p => p.state))].sort((a, b) => stateName(a).localeCompare(stateName(b)));
  if (chosen && !codes.includes(chosen)) codes.push(chosen);
  filter.innerHTML = '<option value="">Everywhere</option>' + codes.map(c => `<option value="${esc(c)}"${c === chosen ? ' selected' : ''}>${esc(stateName(c))}</option>`).join('');

  const levels = LEVELS.filter(l => board.plays.some(p => p.level === l) || l === $('#levelFilter').value), level = $('#levelFilter').value;
  $('#levelFilter').innerHTML = '<option value="">All levels</option>' + levels.map(l => `<option${l === level ? ' selected' : ''}>${esc(l)}</option>`).join('');

  // Places are for the whole contest, so a state's or level's list can start at #3.
  const shown = board.plays.map((p, i) => ({ ...p, place: i + 1 })).filter(p => !chosen || p.state === chosen).filter(p => !level || p.level === level);
  $('#list').innerHTML = shown.map(p => `
    <article class="play" data-id="${p.id}">
      <video src="${API}/media/${p.id}.mp4" poster="${API}/media/${p.id}.jpg" controls loop playsinline preload="none" aria-label="${esc(p.title)}"></video>
      <div class="play-body">
        <h3><span class="place">#${p.place}</span>${esc(p.title)}</h3>
        <p class="muted">${[p.level, p.credit, whereOf(p)].filter(Boolean).map(esc).join(' · ')}</p>
        <div class="play-actions">
          ${live ? `<button type="button" class="btn-outline vote" data-act="vote" aria-pressed="${p.voted}">${p.voted ? 'Voted' : 'Vote'} · ${p.votes}</button>` : `<strong>${votesText(p.votes)}</strong>`}
          <span class="spacer"></span>
          <button type="button" class="linkbtn" data-act="share">Share</button>
          <button type="button" class="linkbtn" data-act="report">Report</button>
        </div>
      </div>
    </article>`).join('') || `<div class="empty"><strong>No plays ${live ? 'yet this month' : 'here'}.</strong>${live ? 'Got a good one? Upload it and be first.' : ''}</div>`;
}

async function toggleVote(id, button) {
  const p = board.plays.find(x => x.id === id);
  button.disabled = true;
  try {
    Object.assign(p, await api(`/clips/${id}/vote`, { method: 'POST', body: { on: !p.voted } }));
    if (p.voted) count('play-voted', 'Voted on a play');
  } catch (err) { toast(err.message); }
  button.disabled = false;
  // The order stays put until the next load, so clips don't jump under the visitor's finger.
  button.setAttribute('aria-pressed', p.voted);
  button.textContent = `${p.voted ? 'Voted' : 'Vote'} · ${p.votes}`;
}

async function share(id) {
  const p = board.plays.find(x => x.id === id);
  const url = `${location.origin}${location.pathname}?month=${board.month}&clip=${id}`;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: p.title, text: `${p.title} · Calarink Top Plays`, url });
    else { await navigator.clipboard.writeText(url); toast('Link copied'); }
    count('play-shared', 'Shared a play');
  } catch (err) { if (err.name !== 'AbortError') toast("Couldn't share the link"); }
}

$('#list').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = b.closest('.play').dataset.id;
  if (b.dataset.act === 'vote') toggleVote(id, b);
  if (b.dataset.act === 'share') share(id);
  if (b.dataset.act === 'report') { $('#reportForm').reset(); $('#reportForm').dataset.id = id; $('#reportDialog').showModal(); }
});
// One clip plays at a time. ("play" events don't bubble, so listen on the way down.)
$('#list').addEventListener('play', e => {
  for (const v of document.querySelectorAll('#list video')) if (v !== e.target) v.pause();
}, true);
$('#month').addEventListener('change', e => loadBoard(e.target.value));
$('#stateFilter').addEventListener('change', renderBoard);
$('#levelFilter').addEventListener('change', renderBoard);
$('#reportForm').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await api(`/clips/${e.target.dataset.id}/report`, { method: 'POST', body: { reason: e.target.reason.value } });
    $('#reportDialog').close();
    toast('Thanks. We\'ll take a look.');
  } catch (err) { toast(err.message); }
});
$('#rulesOpen').addEventListener('click', () => $('#rulesDialog').showModal());
for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => b.closest('dialog').close());

// ---------- my clips ----------
async function loadMe() {
  try { me = await api('/me'); } catch { return; }
  const mine = $('#mine');
  mine.hidden = !me.user;
  if (!me.user) { $('#review').hidden = true; return; }
  mine.innerHTML = `<h2>Your clips</h2>${me.clips.map(c => `
    <div class="mine-row" data-id="${c.id}"><span><strong>${esc(c.title)}</strong> <span class="muted">${c.status === 'pending' ? 'Waiting for approval' : monthLabel(c.month)}</span></span>
    <button type="button" class="linkbtn danger" data-delete>Delete</button></div>`).join('') || '<p class="muted">None yet.</p>'}
    <p class="mine-foot muted">Signed in as ${esc(me.user.email)}. <button type="button" class="linkbtn" data-signout>Sign out</button></p>`;
  if (me.user.admin) loadReview();
}
$('#mine').addEventListener('click', async e => {
  try {
    if (e.target.closest('[data-delete]')) {
      if (!confirm('Delete this clip? This removes it for good.')) return;
      await api(`/clips/${e.target.closest('.mine-row').dataset.id}`, { method: 'DELETE' });
      await Promise.all([loadMe(), loadBoard(board?.month)]);
    }
    if (e.target.closest('[data-signout]')) { await api('/auth/signout', { method: 'POST' }); await loadMe(); }
  } catch (err) { toast(err.message); }
});

// ---------- reviewing (moderator) ----------
async function loadReview() {
  let q;
  try { q = await api('/queue'); } catch { return; }
  const card = (p, buttons) => `
    <article class="play" data-id="${p.id}">
      <video src="${API}/media/${p.id}.mp4" poster="${API}/media/${p.id}.jpg" controls loop playsinline preload="none"></video>
      <div class="play-body"><h3>${esc(p.title)}</h3><p class="muted">${[p.level, p.credit, whereOf(p), p.email].filter(Boolean).map(esc).join(' · ')}</p>
      ${p.screen ? `<p class="screen ${esc(p.screen.verdict)}"><strong>${{ ok: 'Looks fine', unsure: 'Look closely', bad: 'Probably not OK' }[p.screen.verdict]}</strong> (automatic check, pictures only): ${esc(p.screen.summary)}${p.screen.concerns.length ? ` Concerns: ${esc(p.screen.concerns.join('; '))}.` : ''}</p>` : p.reports ? '' : '<p class="muted">Not checked automatically yet.</p>'}
      ${p.hidden ? '<p class="danger">Hidden until you decide.</p>' : ''}
      ${p.reports ? `<p class="danger">${p.reports} report${p.reports === 1 ? '' : 's'}: ${esc(p.reasons)}</p>` : ''}
      <div class="play-actions">${buttons}<span class="spacer"></span><button type="button" class="linkbtn danger" data-act="block">Block uploader</button></div></div>
    </article>`;
  const when = q.month === q.current ? 'this month' : monthLabel(q.month);
  $('#review').innerHTML = `<h2>Waiting for review (${q.pending.length})</h2>
    ${q.pending.length ? `<p class="muted small">Approved clips join ${when}.</p><div class="plays-grid">${q.pending.map(p => card(p, '<button type="button" class="btn" data-act="approve">Approve</button><button type="button" class="btn-outline danger" data-act="reject">Reject</button>')).join('')}</div>` : '<p class="muted small">Nothing waiting.</p>'}
    ${q.reported.length ? `<h2>Reported (${q.reported.length})</h2><div class="plays-grid">${q.reported.map(p => card(p, '<button type="button" class="btn-outline" data-act="clear">Keep it</button><button type="button" class="btn-outline danger" data-act="reject">Take down</button>')).join('')}</div>` : ''}`;
  $('#review').hidden = false;
}
$('#review').addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const id = b.closest('.play').dataset.id, act = b.dataset.act;
  if (act === 'reject' && !confirm('Delete this clip for good?')) return;
  if (act === 'block' && !confirm('Block this uploader and delete all their clips?')) return;
  b.disabled = true;
  try {
    if (act === 'reject') await api(`/clips/${id}`, { method: 'DELETE' });
    else await api(`/clips/${id}/${act}`, { method: 'POST' });
  } catch (err) { toast(err.message); }
  await Promise.all([loadMe(), loadBoard(board?.month)]);
});

// ---------- uploading: steps ----------
const STEPS = ['emailStep', 'codeStep', 'clipStep', 'doneStep'];
function step(name) {
  for (const s of STEPS) $(`#${s}`).hidden = s !== name;
  showError('');
}
function showError(message) { $('#uploadError').textContent = message; $('#uploadError').hidden = !message; }

$('#upload').addEventListener('click', openUpload);
async function openUpload() {
  resetClip();
  step(me.user ? 'clipStep' : 'emailStep');
  $('#uploadDialog').showModal();
}
let email = '';
async function formStep(e, fn) {
  e.preventDefault();
  const b = e.target.querySelector('.btn');
  b.disabled = true; showError('');
  try { await fn(e.target); } catch (err) { showError(err.message); }
  b.disabled = false;
}
$('#emailStep').addEventListener('submit', e => formStep(e, async f => {
  email = f.email.value.trim();
  await api('/auth/start', { method: 'POST', body: { email } });
  $('#codeEmail').textContent = email;
  $('#codeStep').reset();
  step('codeStep');
  $('#codeStep').code.focus();
}));
$('#codeStep').addEventListener('submit', e => formStep(e, async f => {
  await api('/auth/verify', { method: 'POST', body: { email, code: f.code.value } });
  await loadMe();
  step('clipStep');
}));
$('#codeBack').addEventListener('click', () => step('emailStep'));

// ---------- uploading: picking and trimming ----------
let file = null, fileUrl = null, busy = false, conversion = null;
const preview = $('#preview'), startEl = $('#start'), endEl = $('#end');
const stamp = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

function resetClip() {
  $('#clipStep').reset();
  if (fileUrl) URL.revokeObjectURL(fileUrl);
  file = fileUrl = null; playSelection = false;
  preview.removeAttribute('src'); preview.load();
  $('#trim').hidden = true; $('#progress').hidden = true; $('#send').disabled = true;
  fillPlaces();
}
function fillPlaces() {
  const f = $('#clipStep');
  let last = '';
  try { last = JSON.parse(localStorage.getItem('maine-rink-times:v1') || '{}').usState || ''; } catch { /* storage unavailable */ }
  // Same order of guesses as the schedule page: the visitor's last pick, then where they seem to be.
  last = (places.states.find(s => [s.code, s.slug].includes(last)) || places.states.find(s => s.code === document.querySelector('meta[name="visitor-region"]')?.content))?.code || '';
  f.state.innerHTML = '<option value="">Choose…</option>' + places.states.map(s => `<option value="${esc(s.code)}"${s.code === last ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  fillRinks();
}
function fillRinks() {
  const f = $('#clipStep');
  const ca = places.states.find(x => x.code === f.state.value)?.country === 'CA', keep = f.level.value;
  f.level.innerHTML = '<option value="">Choose…</option>' + [...(ca ? LEVELS_CA : LEVELS_US), ...LEVELS_BOTH].map(l => `<option${l === keep ? ' selected' : ''}>${l}</option>`).join('');
  const rinks = places.rinks.filter(r => r.state === f.state.value).sort((a, b) => a.name.localeCompare(b.name));
  f.rink.innerHTML = '<option value="">Not listed / skip</option>' + rinks.map(r => `<option value="${esc(r.id)}">${esc(r.name)}${r.town ? ` (${esc(r.town)})` : ''}</option>`).join('');
}
$('#clipStep').state.addEventListener('change', fillRinks);

$('#file').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  showError('');
  if (f.size > MAX_FILE) return showError('That video is over 2 GB. Trim it on your device first.');
  if (fileUrl) URL.revokeObjectURL(fileUrl);
  file = f; fileUrl = URL.createObjectURL(f);
  $('#trim').hidden = true; $('#send').disabled = true;
  preview.src = fileUrl;
});
const UNREADABLE = "This browser can't open that video. Try Safari on an iPhone or Mac, or Chrome, or save the video as an MP4 first.";
preview.addEventListener('error', () => { if (file) { $('#trim').hidden = true; $('#send').disabled = true; showError(UNREADABLE); } });
preview.addEventListener('loadedmetadata', () => {
  const d = preview.duration;
  if (!Number.isFinite(d) || !preview.videoWidth) return showError(UNREADABLE);
  if (d < MIN_SECONDS) return showError('That video is too short.');
  startEl.max = endEl.max = d;
  startEl.value = 0; endEl.value = Math.min(d, MAX_SECONDS);
  $('#trim').hidden = false; $('#send').disabled = false;
  showTrim();
  preview.currentTime = 0.01; // iPhones show a black box until the video is moved
});
function selection() {
  const d = preview.duration;
  // A slider's top step can land just short of the true end; treat it as the end.
  const end = d - Number(endEl.value) < 0.1 ? d : Number(endEl.value);
  return { start: Number(startEl.value), end };
}
function showTrim() {
  const { start, end } = selection();
  $('#startOut').textContent = stamp(start);
  $('#endOut').textContent = stamp(end);
  $('#trimLength').textContent = `${Math.min(end - start, MAX_SECONDS).toFixed(1)} seconds`;
}
// Moving one end drags the other along to keep 1–15 seconds selected.
startEl.addEventListener('input', () => {
  const d = preview.duration;
  if (Number(startEl.value) > d - MIN_SECONDS) startEl.value = d - MIN_SECONDS;
  const s = Number(startEl.value);
  if (Number(endEl.value) > s + MAX_SECONDS) endEl.value = s + MAX_SECONDS;
  if (Number(endEl.value) < s + MIN_SECONDS) endEl.value = s + MIN_SECONDS;
  stopPreview(); preview.currentTime = s; showTrim();
});
endEl.addEventListener('input', () => {
  if (Number(endEl.value) < MIN_SECONDS) endEl.value = MIN_SECONDS;
  const e = Number(endEl.value);
  if (Number(startEl.value) < e - MAX_SECONDS) startEl.value = e - MAX_SECONDS;
  if (Number(startEl.value) > e - MIN_SECONDS) startEl.value = e - MIN_SECONDS;
  stopPreview(); preview.currentTime = Math.max(0, e - 0.05); showTrim(); // the very end can show blank
});
function stopPreview() { playSelection = false; preview.pause(); $('#playTrim').textContent = 'Play selection'; }
$('#playTrim').addEventListener('click', () => {
  if (playSelection) return stopPreview();
  playSelection = true;
  preview.currentTime = selection().start;
  preview.play().catch(() => {});
  $('#playTrim').textContent = 'Stop';
});
preview.addEventListener('timeupdate', () => {
  if (playSelection && preview.currentTime >= selection().end) preview.currentTime = selection().start;
});
preview.addEventListener('ended', () => {
  if (playSelection) { preview.currentTime = selection().start; preview.play().catch(() => {}); }
});
$('#uploadDialog').addEventListener('cancel', e => { if (busy) e.preventDefault(); });
$('#uploadDialog').addEventListener('close', () => { stopPreview(); conversion?.cancel(); });

// ---------- uploading: converting and sending ----------
async function convert(source, { start, end }, sound, onProgress) {
  if (!('VideoEncoder' in window)) throw new Error("This browser can't prepare videos. Update it, or try Safari or Chrome.");
  // ~180 KB, loaded only when someone uploads.
  const { Input, Output, Conversion, BlobSource, BufferTarget, Mp4OutputFormat, ALL_FORMATS } = await import('../vendor/mediabunny-1.65.2.min.js');
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('There is no video in that file.');
  // Fit inside 1280x720 (or 720x1280 upright), never enlarging; H.264 needs even sizes.
  const w = track.displayWidth, h = track.displayHeight;
  const scale = Math.min(1, 1280 / Math.max(w, h), 720 / Math.min(w, h));
  const even = n => Math.max(2, Math.round(n * scale / 2) * 2);
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  conversion = await Conversion.init({
    input, output, tracks: 'primary',
    trim: { start, end: Math.min(end, start + MAX_SECONDS) },
    video: { codec: 'avc', width: even(w), height: even(h), fit: 'fill', frameRate: 30, bitrate: 4_000_000, forceTranscode: true, allowTransformationMetadata: false },
    // Phones record AAC, which is copied as is; other sound is converted where the browser can.
    audio: sound ? { codec: 'aac' } : { discard: true },
    copy: { boundaryPolicy: 'shrink' }, // no sound from outside the selection
    tags: {}, // drops the original's location, device and date
    showWarnings: false,
  });
  if (!conversion.isValid) throw new Error(UNREADABLE);
  if (sound && conversion.discardedTracks.some(d => d.track.type === 'audio' && !['discarded_by_user', 'max_track_count_of_type_reached'].includes(d.reason))
    && !conversion.utilizedTracks.some(t => t.type === 'audio')
    && !confirm("This browser can't include this video's sound. Upload it without sound?")) {
    conversion = null;
    throw new Error('Upload stopped. Try Safari or Chrome to keep the sound.');
  }
  conversion.onProgress = onProgress;
  try { await conversion.execute(); } finally { conversion = null; }
  return new Blob([target.buffer], { type: 'video/mp4' });
}

// A still from the middle of the finished clip, shown before it plays.
async function posterOf(blob) {
  const v = document.createElement('video');
  const url = URL.createObjectURL(blob);
  try {
    v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    const wait = name => new Promise((ok, no) => {
      v.addEventListener(name, ok, { once: true });
      v.addEventListener('error', () => no(new Error(UNREADABLE)), { once: true });
      setTimeout(() => no(new Error('Preparing the clip took too long. Try again.')), 15000);
    });
    let ready = wait('loadeddata'); v.load(); await ready;
    ready = wait('seeked'); v.currentTime = v.duration / 2; await ready;
    const c = document.createElement('canvas');
    const k = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
    c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    return await new Promise((ok, no) => c.toBlob(b => (b ? ok(b) : no(new Error('Could not make a preview picture.'))), 'image/jpeg', 0.8));
  } finally { URL.revokeObjectURL(url); }
}

$('#clipStep').addEventListener('submit', async e => {
  e.preventDefault();
  if (busy || !file) return;
  const f = e.target, send = $('#send'), bar = $('#progress');
  busy = true; send.disabled = true; showError(''); stopPreview();
  bar.hidden = false; bar.value = 0;
  for (const b of document.querySelectorAll('#uploadDialog [data-close]')) b.disabled = true;
  try {
    const details = { title: f.title.value, credit: f.credit.value, state: f.state.value, level: f.level.value, rink: f.rink.value, consent: f.consent.checked };
    send.textContent = 'Preparing…';
    let video;
    try { video = await convert(file, selection(), f.sound.checked, p => { bar.value = p * 0.7; }); }
    catch (err) { console.error(err); throw new Error(/[.]$/.test(err.message) ? err.message : UNREADABLE); }
    const poster = await posterOf(video);
    send.textContent = 'Uploading…'; bar.value = 0.75;
    const { id } = await api('/clips', { method: 'POST', body: details });
    await api(`/clips/${id}/video`, { method: 'PUT', body: video, raw: true, type: 'video/mp4' });
    bar.value = 0.95;
    await api(`/clips/${id}/poster`, { method: 'PUT', body: poster, raw: true, type: 'image/jpeg' });
    count('play-uploaded', 'Uploaded a play');
    resetClip();
    step('doneStep');
    loadMe();
  } catch (err) {
    if (err.status === 401) { me = { user: null, clips: [] }; step('emailStep'); }
    showError(err.message);
  } finally {
    busy = false; send.textContent = 'Upload'; send.disabled = !file; bar.hidden = true;
    for (const b of document.querySelectorAll('#uploadDialog [data-close]')) b.disabled = false;
  }
});

// ---------- start ----------
// Rink and state names come with the schedules. The plays don't wait for them.
fetch('../schedule.json').then(r => r.json()).then(d => {
  places = { states: d.states, rinks: d.rinks };
  if (board && ![...document.querySelectorAll('#list video')].some(v => !v.paused)) renderBoard(); // not under a clip that's playing
  if (!$('#clipStep').state.value) fillPlaces();
  if (me.user?.admin) loadReview();
}).catch(() => { /* names fall back to codes */ });

(async () => {
  await loadBoard(params.get('month') || '');
  if (!board) await loadBoard(); // a link to a month that isn't there
  await loadMe();
  if (linkedClip) {
    const el = document.querySelector(`#list .play[data-id="${CSS.escape(linkedClip)}"]`);
    if (el) { el.classList.add('linked'); el.scrollIntoView({ block: 'center' }); }
    else toast('That clip is no longer here');
  } else if (params.get('review') && !me.user) openUpload(); // from a moderator email, signed out
})();
