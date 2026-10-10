/* Nodistub Cat Cafe — web jukebox client */
const $ = (s) => document.querySelector(s);
const PAGE = 60;
const PREVIEW_SECONDS = 30;

const st = {
  state: null,
  receivedAt: 0,
  lib: { channels: [], tracks: [] },
  channel: 'all',
  search: '',
  sort: 'new',
  limit: PAGE,
  previewId: null,
  previewStart: 0,
  pending: new Set(),
};

/* ------------------------------ helpers ------------------------------ */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const fmt = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) return '--:--';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function toast(text, kind = '') {
  const el = h('div', { class: `toast ${kind}` }, text);
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 3800);
  setTimeout(() => el.remove(), 4300);
}

/* floating notes (ASMR ambience) */
(function spawnNotes() {
  const wrap = $('#notes');
  const glyphs = ['♪', '♫', '♩', '🐾', '♬'];
  for (let i = 0; i < 14; i++) {
    const n = h('span', { class: 'note' }, glyphs[i % glyphs.length]);
    n.style.left = `${Math.random() * 96}%`;
    n.style.animationDuration = `${14 + Math.random() * 14}s`;
    n.style.animationDelay = `${-Math.random() * 20}s`;
    n.style.fontSize = `${18 + Math.random() * 18}px`;
    wrap.append(n);
  }
})();

/* nickname */
const nickEl = $('#nick');
try { nickEl.value = localStorage.getItem('cafe-nick') || ''; } catch {}
nickEl.addEventListener('input', () => {
  try { localStorage.setItem('cafe-nick', nickEl.value); } catch {}
});

/* ------------------------------ data ------------------------------ */
async function loadLibrary() {
  try {
    const res = await fetch('/api/library');
    st.lib = await res.json();
    renderLibrary();
    renderTop();
    renderFresh();
  } catch {}
}
let libTimer;
const refreshLibrarySoon = () => { clearTimeout(libTimer); libTimer = setTimeout(loadLibrary, 400); };

function connect() {
  const es = new EventSource('/api/events');
  es.onopen = () => setConn(true);
  es.onerror = () => setConn(false);
  es.addEventListener('state', (e) => {
    st.state = JSON.parse(e.data);
    st.receivedAt = Date.now();
    renderState();
  });
  es.addEventListener('library', refreshLibrarySoon);
  es.addEventListener('newtrack', (e) => {
    const t = JSON.parse(e.data);
    toast(`✨ New song: ${t.title} (#${t.channel})`, 'new');
  });
}

function setConn(ok) {
  $('#connPill').classList.toggle('on', ok);
  $('#connText').textContent = ok ? (st.state?.botOnline === false ? 'Bot offline' : 'Cafe is open') : 'Reconnecting…';
}

/* ------------------------------ studio / queue ------------------------------ */
function renderState() {
  const s = st.state;
  if (!s) return;
  setConn(true);
  $('#listenCount').textContent = s.listeners;

  const np = s.nowPlaying;
  const playing = !!np && !s.paused;
  document.body.classList.toggle('playing', playing);
  document.body.classList.toggle('idle', !playing);

  $('#npEyebrow').textContent = !np ? 'Studio is resting' : s.paused ? 'Paused · waiting for listeners' : 'Now playing';
  $('#npTitle').textContent = np ? np.title : s.listeners ? 'Picking a cozy song…' : 'The studio is quiet…';
  $('#npHint').textContent = np
    ? s.paused
      ? 'Join the music room and the cat DJ will carry on. 🎧'
      : np.auto
        ? 'Nobody requested this one, so the cat DJ picked it for you. 🐱'
        : 'Picked by a lovely guest. Add your own song below! 🎶'
    : s.listeners
      ? 'One moment…'
      : `Hop into ${s.voiceChannel ? '“' + s.voiceChannel + '”' : 'the music room'} on Discord to wake the cat up. 😴`;

  const chips = $('#npChips');
  chips.replaceChildren();
  if (np) {
    chips.append(h('span', { class: 'chip' }, `# ${np.channel}`));
    if (np.isNew) chips.append(h('span', { class: 'chip req' }, '✨ NEW'));
    chips.append(
      np.auto
        ? h('span', { class: 'chip auto' }, '🎲 Auto shuffle')
        : h('span', { class: 'chip req' }, `💌 ${np.requestedBy || 'Guest cat'}`),
    );
    if (np.requests) chips.append(h('span', { class: 'chip' }, `🐾 ${np.requests} request${np.requests > 1 ? 's' : ''}`));
  }

  // queue
  const list = $('#queueList');
  list.replaceChildren(
    ...s.queue.map((q, i) =>
      h('li', { class: 'q-item' },
        h('span', { class: 'q-num' }, i + 1),
        h('div', {},
          h('div', { class: 'q-title' }, q.title),
          h('div', { class: 'q-sub' }, `#${q.channel} · 💌 ${q.requestedBy || 'Guest cat'}`),
        ),
      ),
    ),
  );
  $('#queueEmpty').hidden = s.queue.length > 0;
  $('#queueCount').textContent = s.queue.length ? `${s.queue.length} waiting` : '';

  tickProgress();
  renderLibrary(true);
}

function currentPosition() {
  const s = st.state;
  if (!s?.nowPlaying) return 0;
  const base = s.nowPlaying.positionMs || 0;
  return s.paused ? base : base + (Date.now() - st.receivedAt);
}

function tickProgress() {
  const s = st.state;
  const np = s?.nowPlaying;
  const bar = document.querySelector('.bar');
  if (!np) {
    $('#barFill').style.width = '0%';
    bar.classList.remove('indeterminate');
    $('#tCur').textContent = '0:00';
    $('#tDur').textContent = '--:--';
    return;
  }
  const pos = currentPosition();
  $('#tCur').textContent = fmt(pos);
  if (np.durationMs) {
    bar.classList.remove('indeterminate');
    $('#tDur').textContent = fmt(np.durationMs);
    $('#barFill').style.width = `${Math.min(100, (pos / np.durationMs) * 100)}%`;
  } else {
    $('#tDur').textContent = '--:--';
    bar.classList.toggle('indeterminate', !s.paused);
  }
}
setInterval(tickProgress, 250);

/* ------------------------------ top / fresh ------------------------------ */
function renderTop() {
  const top = [...st.lib.tracks].filter((t) => t.requests > 0).sort((a, b) => b.requests - a.requests).slice(0, 8);
  const max = top[0]?.requests || 1;
  $('#topEmpty').hidden = top.length > 0;
  $('#topList').replaceChildren(
    ...top.map((t, i) =>
      h('li', { class: 'top-item' },
        h('span', { class: 'top-rank' }, i === 0 ? '👑' : i + 1),
        h('span', { class: 'top-name', title: t.title }, t.title),
        h('span', { class: 'top-count' }, `🐾 ${t.requests}`),
        h('div', { class: 'top-bar' }, h('i', { style: `width:${(t.requests / max) * 100}%` })),
      ),
    ),
  );
}

function renderFresh() {
  const fresh = st.lib.tracks.filter((t) => t.isNew).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
  $('#freshCard').hidden = fresh.length === 0;
  $('#freshStrip').replaceChildren(
    ...fresh.map((t) =>
      h('div', { class: 'fresh-card' },
        h('b', {}, t.title),
        h('small', {}, `#${t.channel}`),
        h('div', { class: 'fresh-actions' }, previewButton(t), addButton(t)),
      ),
    ),
  );
}

/* ------------------------------ library ------------------------------ */
function inQueue(id) {
  const s = st.state;
  if (!s) return null;
  if (s.nowPlaying?.id === id) return 'playing';
  const i = s.queue.findIndex((q) => q.id === id);
  return i >= 0 ? `#${i + 1}` : null;
}

function addButton(t) {
  const where = inQueue(t.id);
  const btn = h('button', { class: 'btn add', title: 'Add to queue' },
    where === 'playing' ? '▶ Playing' : where ? `In queue ${where}` : '➕ Queue');
  if (where || st.pending.has(t.id)) btn.disabled = true;
  btn.addEventListener('click', () => requestTrack(t, btn));
  return btn;
}

function previewButton(t) {
  const on = st.previewId === t.id;
  return h('button', {
    class: `btn round${on ? ' on' : ''}`, title: `Preview ${PREVIEW_SECONDS}s`,
    'data-preview': t.id, onclick: () => togglePreview(t),
  }, on ? '⏸' : '▶');
}

async function requestTrack(t, btn) {
  st.pending.add(t.id);
  btn.disabled = true;
  try {
    const res = await fetch('/api/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackId: t.id, nickname: nickEl.value }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok) toast(`🐾 Added “${t.title}” to the queue (#${data.position})`);
    else toast(data.error || 'Something went wrong', 'err');
  } catch {
    toast('Cannot reach the cafe right now', 'err');
  } finally {
    st.pending.delete(t.id);
    renderLibrary(true);
  }
}

function filtered() {
  const q = st.search.trim().toLowerCase();
  let list = st.lib.tracks.filter(
    (t) => (st.channel === 'all' || t.channelId === st.channel) && (!q || t.title.toLowerCase().includes(q)),
  );
  if (st.sort === 'new') list.sort((a, b) => b.createdAt - a.createdAt);
  else if (st.sort === 'top') list.sort((a, b) => b.requests - a.requests || b.createdAt - a.createdAt);
  else list.sort((a, b) => a.title.localeCompare(b.title));
  return list;
}

function renderTabs() {
  const tabs = $('#tabs');
  const total = st.lib.tracks.length;
  const mk = (id, name, count) =>
    h('button', {
      class: `tab${st.channel === id ? ' active' : ''}`,
      onclick: () => { st.channel = id; st.limit = PAGE; renderLibrary(); },
    }, id === 'all' ? '🐾 All' : `# ${name}`, h('small', {}, count));
  tabs.replaceChildren(mk('all', 'All', total), ...st.lib.channels.filter((c) => c.count).map((c) => mk(c.id, c.name, c.count)));
}

function renderLibrary(keepTabs = false) {
  if (!keepTabs) renderTabs();
  const list = filtered();
  $('#libCount').textContent = `${list.length} song${list.length === 1 ? '' : 's'}`;
  $('#libEmpty').hidden = list.length > 0;
  $('#moreBtn').hidden = list.length <= st.limit;

  const playingId = st.state?.nowPlaying?.id;
  $('#tracks').replaceChildren(
    ...list.slice(0, st.limit).map((t) =>
      h('li', { class: `track${playingId === t.id ? ' playing' : ''}` },
        previewButton(t),
        h('div', {},
          h('div', { class: 't-title' }, t.title),
          h('div', { class: 't-meta' },
            t.isNew ? h('span', { class: 'badge-new' }, 'NEW') : null,
            h('span', {}, `# ${t.channel}`),
            h('span', { class: 't-paws' }, t.requests ? `🐾 requested ${t.requests}×` : null),
            t.plays ? h('span', {}, `played ${t.plays}×`) : null,
          ),
        ),
        h('div', { class: 't-actions' }, addButton(t)),
      ),
    ),
  );
}

$('#search').addEventListener('input', (e) => { st.search = e.target.value; st.limit = PAGE; renderLibrary(true); });
$('#sort').addEventListener('change', (e) => { st.sort = e.target.value; renderLibrary(true); });
$('#moreBtn').addEventListener('click', () => { st.limit += PAGE; renderLibrary(true); });

/* ------------------------------ preview ------------------------------ */
const audio = $('#preview');
audio.volume = 0.8;

function stopPreview() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  st.previewId = null;
  document.querySelectorAll('[data-preview]').forEach((b) => { b.classList.remove('on'); b.textContent = '▶'; });
}

function togglePreview(t) {
  if (st.previewId === t.id) return stopPreview();
  stopPreview();
  st.previewId = t.id;
  st.previewStart = 0;
  audio.src = `/api/preview/${encodeURIComponent(t.id)}`;
  audio.addEventListener('loadedmetadata', function onMeta() {
    audio.removeEventListener('loadedmetadata', onMeta);
    // jump into the chorus-ish part of longer songs
    if (Number.isFinite(audio.duration) && audio.duration > 90) {
      st.previewStart = audio.duration * 0.3;
      try { audio.currentTime = st.previewStart; } catch {}
    }
  });
  audio.play().catch(() => { toast('Cannot play this preview', 'err'); stopPreview(); });
  document.querySelectorAll(`[data-preview="${CSS.escape(t.id)}"]`).forEach((b) => { b.classList.add('on'); b.textContent = '⏸'; });
}

audio.addEventListener('timeupdate', () => {
  if (st.previewId && audio.currentTime - st.previewStart >= PREVIEW_SECONDS) stopPreview();
});
audio.addEventListener('ended', stopPreview);
audio.addEventListener('error', () => { if (st.previewId) { toast('Preview failed to load', 'err'); stopPreview(); } });

/* ------------------------------ go ------------------------------ */
loadLibrary();
connect();
setInterval(loadLibrary, 60_000);
