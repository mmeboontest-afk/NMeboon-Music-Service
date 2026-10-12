/* Nodistub Cat Cafe — live control room */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const two = (n) => String(n).padStart(2, '0');
  const fmtN = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'));
  const hms = (s) => `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(Math.floor(s % 60))}`;
  const money = (by) => { const e = Object.entries(by || {}); return e.length ? e.map(([c, v]) => `${v.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${c}`).join(' + ') : '0'; };
  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  };
  function toast(text, kind = '') {
    const el = h('div', { class: `toast ${kind}` }, text);
    $('#toasts').append(el);
    setTimeout(() => el.classList.add('out'), 3800);
    setTimeout(() => el.remove(), 4300);
  }

  let snap = null;
  let logs = [];
  let tracks = [];
  let trackCount = -1;
  let es = null;
  let started = false;
  const once = { fonts: false, say: false, yt: false };

  /* ------------------------------ api ------------------------------ */
  async function call(path, method, body) {
    const res = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401 && path !== '/api/live/login') { showGate(); }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok !== false, status: res.status, data };
  }
  async function cmd(c, quiet) {
    const r = await call('/api/live/cmd', 'POST', c);
    if (!r.ok) toast(r.data.error || 'That did not work', 'err');
    else if (!quiet && r.data.ytError) toast(`Live started, but YouTube said: ${r.data.ytError}`, 'err');
    return r;
  }
  const patch = (obj) => call('/api/live/settings', 'PATCH', obj);

  /* ------------------------------ gate ------------------------------ */
  function showGate(msg) {
    $('#app').hidden = true;
    $('#gate').hidden = false;
    if (es) { es.close(); es = null; started = false; }
    if (msg) $('#gateMsg').textContent = msg;
  }
  async function init() {
    const me = (await call('/api/live/me', 'GET')).data;
    if (!me.pinConfigured) {
      showGate('The server has no CONTROL_PIN yet. Add the CONTROL_PIN environment variable (Render → Environment), redeploy, and reload this page.');
      $('#gateForm button').disabled = true; $('#pin').disabled = true;
      return;
    }
    if (me.authed) startApp(); else showGate();
  }
  $('#gateForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#gateErr').textContent = '';
    const r = await call('/api/live/login', 'POST', { pin: $('#pin').value });
    if (r.ok) { $('#pin').value = ''; startApp(); } else $('#gateErr').textContent = r.data.error || 'Could not unlock';
  });
  $('#btnLogout').addEventListener('click', async () => { await call('/api/live/logout', 'POST'); location.reload(); });

  /* ------------------------------ app start ------------------------------ */
  function startApp() {
    $('#gate').hidden = true;
    $('#app').hidden = false;
    if (started) return;
    started = true;
    es = new EventSource('/api/live/control/stream');
    es.onopen = () => setPill('#pConn', 'on', 'Connected');
    es.onerror = () => setPill('#pConn', '', 'Reconnecting…');
    es.addEventListener('state', (e) => { snap = JSON.parse(e.data); render(); });
    es.addEventListener('log', (e) => { logs.push(JSON.parse(e.data)); if (logs.length > 60) logs.shift(); renderLogs(); });
    es.addEventListener('tts', (e) => { const t = JSON.parse(e.data); if (t.output === 'control') speak(t); });
    es.addEventListener('tts-stop', () => { try { speechSynthesis.cancel(); } catch { /* ignore */ } });
    $('#ovUrl').textContent = `${location.origin}/overlay`;
  }

  function setPill(sel, cls, text) {
    const p = $(sel);
    p.className = `pill ${cls}`.trim();
    p.lastElementChild.textContent = text;
  }

  /* ------------------------------ tabs / generic buttons ------------------------------ */
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (!b) return;
    $$('.tab').forEach((t) => t.classList.toggle('active', t === b));
    $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === b.dataset.tab));
    if (b.dataset.tab === 'music') loadTracks(true);
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b) cmd(JSON.parse(b.dataset.cmd));
  });

  /* ------------------------------ settings binding ------------------------------ */
  const getPath = (o, p) => p.split('.').reduce((a, k) => a?.[k], o);
  function nest(path, value) {
    const keys = path.split('.');
    const out = {};
    let cur = out;
    keys.forEach((k, i) => { cur[k] = i === keys.length - 1 ? value : {}; cur = cur[k]; });
    return out;
  }
  const timers = new Map();
  function readEl(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.dataset.list !== undefined) return el.value.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (el.type === 'number' || el.type === 'range') return Number(el.value);
    return el.value;
  }
  function bindSettings() {
    $$('[data-path]').forEach((el) => {
      const send = () => { const o = el.parentElement.querySelector('output'); if (o) o.textContent = el.value; patch(nest(el.dataset.path, readEl(el))); };
      if (el.type === 'range' || el.type === 'number' || el.tagName === 'TEXTAREA' || el.type === 'text') {
        el.addEventListener('input', () => { clearTimeout(timers.get(el)); timers.set(el, setTimeout(send, 350)); });
      } else el.addEventListener('change', send);
    });
  }
  function fillSettings() {
    $$('[data-path]').forEach((el) => {
      if (document.activeElement === el) return;
      const v = getPath(snap.settings, el.dataset.path);
      if (v === undefined) return;
      if (el.type === 'checkbox') el.checked = Boolean(v);
      else if (el.dataset.list !== undefined) el.value = (v || []).join(', ');
      else el.value = v ?? '';
      const o = el.parentElement.querySelector('output');
      if (o) o.textContent = el.value;
    });
  }
  bindSettings();

  /* ------------------------------ render ------------------------------ */
  const keys = {};
  const changed = (k, v) => { const s = JSON.stringify(v); if (keys[k] === s) return false; keys[k] = s; return true; };

  function render() {
    snapAt = Date.now();
    fillSettings();
    if (!once.fonts) { once.fonts = true; $('#sayFont').replaceChildren(...snap.fonts.map((f) => h('option', { value: f, style: `font-family:'${f}'` }, f))); }
    if (!once.say) { once.say = true; initSay(); }
    if (!once.yt && snap.settings.yt.videoId) { once.yt = true; $('#ytInput').value = snap.settings.yt.videoId; $('#liveVideoIn').value = snap.settings.yt.videoId; }
    if (!logs.length && snap.logs) { logs = snap.logs.slice(); renderLogs(); }
    renderTop(); renderLive(); renderMusic(); renderMedia(); renderYt(); renderStats(); renderVoices();
    if (snap.trackCount !== trackCount) { trackCount = snap.trackCount; loadTracks(); }
  }

  function renderTop() {
    const se = snap.session;
    if (se?.status === 'live') setPill('#pLive', 'live', `LIVE · ${hms((snap.now - se.startedAt) / 1000)}`);
    else setPill('#pLive', '', se?.status === 'ended' ? 'Live ended' : 'Offline');
    const y = snap.ytInfo;
    setPill('#pYt', y.status === 'live' ? 'on' : y.status === 'error' ? 'warn' : '', `YouTube: ${y.status}`);
  }

  function renderLive() {
    const se = snap.session;
    const live = se?.status === 'live';
    $('#btnStart').disabled = live;
    $('#btnReady').disabled = !live; $('#btnBrb').disabled = !live; $('#btnEnd').disabled = !live;
    $('#liveHint').textContent = live
      ? `“${se.title}” is live. Use the scene buttons or ✨ ready to change what viewers see.`
      : 'Start live → the starting-soon video plays. Press “I’m ready” to run the transition and show the stream screen.';
    $$('.scn').forEach((b) => b.classList.toggle('active', b.dataset.scene === snap.scene));

    const g = [
      ['Viewers now', fmtN(snap.stats.viewers)], ['Subscribers', fmtN(snap.stats.subs) + (se && se.subsGained ? `  (+${se.subsGained})` : '')],
      ['Comments', fmtN(se?.comments ?? 0)], ['Super Chat', money(se?.byCurrency)], ['Peak viewers', fmtN(se?.peakViewers ?? 0)],
      ['Members', fmtN(se?.members?.new ?? 0)], ['Elapsed', '<e>'],
    ];
    if (changed('stats', g.slice(0, 6))) {
      $('#statGrid').replaceChildren(...g.map(([l, v]) => h('div', { class: 'stat' }, h('small', {}, l), h('b', l === 'Elapsed' ? { id: 'statElapsed' } : {}, v === '<e>' ? '00:00:00' : v))));
    }
    tickElapsed();
    if (!$('#statElapsed')) $('#statGrid').append(h('div', { class: 'stat' }, h('small', {}, 'Elapsed'), h('b', { id: 'statElapsed' }, '00:00:00')));
    $('#alertWait').textContent = `${snap.alertsWaiting + (snap.alert ? 1 : 0)} in line`;

    const msgs = snap.chat.slice().reverse();
    if (changed('chat', [msgs.map((m) => m.id), openChat])) {
      $('#chatEmpty').hidden = msgs.length > 0;
      $('#chatList').replaceChildren(...msgs.map((m) => {
        const tag = m.amount ? h('span', { class: 'tag' }, m.amount.display) : m.kind !== 'chat' ? h('span', { class: 'tag' }, m.kind) : null;
        return h('li', { class: `cm${m.amount ? ' sc' : ''}${openChat === m.id ? ' open' : ''}`, onclick: (e) => { if (e.target.closest('button')) return; openChat = openChat === m.id ? null : m.id; changed('chat', null); render(); } },
          h('b', {}, m.author), tag, ': ', m.text || '',
          h('div', { class: 'acts' },
            h('button', { class: 'btn ghost sm', onclick: () => cmd({ type: 'chat-pin', id: m.id }) }, '📌 Show big'),
            h('button', { class: 'btn ghost sm', onclick: () => cmd({ type: 'chat-say', id: m.id }) }, '🗣️ Read aloud'),
            h('button', { class: 'btn ghost sm', onclick: () => cmd({ type: 'chat-hide', id: m.id }) }, '🙈 Hide'),
            h('button', { class: 'btn ghost sm', onclick: () => cmd({ type: 'block-user', name: m.author }) }, '🔇 Mute voice')));
      }));
    }
  }
  let openChat = null;
  function tickElapsed() {
    const se = snap?.session;
    const el = $('#statElapsed');
    if (!el) return;
    el.textContent = se ? hms(se.status === 'live' ? (Date.now() + (snap.now - snapAt) - se.startedAt) / 1000 : se.durationSec) : '00:00:00';
  }
  let snapAt = Date.now();
  setInterval(() => { if (snap) { tickElapsed(); renderTop(); } }, 1000);

  function renderLogs() {
    $('#logList').replaceChildren(...logs.slice().reverse().map((l) => {
      const d = new Date(l.at);
      return h('li', { class: l.kind }, h('time', {}, `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`), l.text);
    }));
  }

  /* start / scenes */
  $('#btnStart').addEventListener('click', async () => {
    const r = await cmd({ type: 'start', title: $('#liveTitleIn').value, videoId: $('#liveVideoIn').value });
    if (r.ok) toast('Live started 🌸 Starting-soon scene is on.');
  });
  $('#btnReady').addEventListener('click', () => cmd({ type: 'scene', scene: 'live', transition: $('#useTransition').checked }));
  $('#btnBrb').addEventListener('click', () => cmd({ type: 'scene', scene: 'brb', transition: $('#useTransition').checked }));
  $('#btnEnd').addEventListener('click', async () => {
    if (!confirm('End the live and save the numbers?')) return;
    const r = await cmd({ type: 'end' });
    if (r.ok) toast(r.data.savedToDiscord ? 'Saved to the Discord storage channel 💌' : 'Saved locally (Discord storage not reachable).');
  });
  $('#sceneBtns').addEventListener('click', (e) => {
    const b = e.target.closest('.scn');
    if (b) cmd({ type: 'scene', scene: b.dataset.scene, transition: $('#useTransition').checked });
  });
  $('#btnCd').addEventListener('click', () => cmd({ type: 'prep-countdown', minutes: Number($('#cdMin').value) || 0 }));

  /* ------------------------------ say ------------------------------ */
  function sayStyle() {
    return { font: $('#sayFont').value, anim: $('#sayAnim').value, pos: $('#sayPos').value, holdSec: Number($('#sayHold').value), size: Number($('#saySize').value), color: $('#sayColor').value, stroke: $('#sayStroke').value };
  }
  function initSay() {
    const c = snap.settings.caption;
    $('#sayFont').value = c.font; $('#sayAnim').value = c.anim; $('#sayPos').value = c.pos; $('#sayHold').value = c.holdSec;
    $('#saySize').value = Math.min(160, c.size); $('#sayColor').value = c.color; $('#sayStroke').value = c.stroke;
    paintPreview();
  }
  function paintPreview() {
    const s = sayStyle();
    $('#saySizeO').textContent = s.size;
    const p = $('#sayPreview');
    p.textContent = $('#sayText').value.trim() || 'Hello, cat friends!';
    p.style.cssText = `font-family:'${s.font}',sans-serif;font-size:${Math.round(s.size * 0.55)}px;color:${s.color};-webkit-text-stroke:${Math.max(1, s.size * 0.05)}px ${s.stroke};paint-order:stroke fill;`;
  }
  ['sayText', 'sayFont', 'sayAnim', 'saySize', 'sayColor', 'sayStroke'].forEach((id) => $(`#${id}`).addEventListener('input', paintPreview));
  async function say(mode) {
    const text = $('#sayText').value.trim();
    if (!text) return toast('Type something first 🐱', 'err');
    const r = await cmd({ type: 'say', text, mode, style: sayStyle() });
    if (r.ok && mode !== 'text' && snap.settings.tts.output === 'off') toast('Voice is off in “Chat & TTS”.', 'err');
  }
  $('#sayBoth').addEventListener('click', () => say('both'));
  $('#sayText1').addEventListener('click', () => say('text'));
  $('#saySpeak').addEventListener('click', () => say('speak'));
  $('#sayText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) say('both'); });
  $('#sayDefault').addEventListener('click', async () => { await patch({ caption: { ...sayStyle(), size: sayStyle().size } }); toast('Saved as the default style'); });

  function renderPhrases() {
    const list = store.get('cafe-phrases', []);
    $('#phraseEmpty').hidden = list.length > 0;
    $('#phraseList').replaceChildren(...list.map((t, i) => h('li', {},
      h('span', { onclick: () => { $('#sayText').value = t; paintPreview(); } }, t),
      h('button', { title: 'Delete', onclick: () => { store.set('cafe-phrases', list.filter((_, j) => j !== i)); renderPhrases(); } }, '✕'))));
  }
  $('#sayPhrase').addEventListener('click', () => {
    const t = $('#sayText').value.trim();
    if (!t) return;
    const list = store.get('cafe-phrases', []);
    if (!list.includes(t)) store.set('cafe-phrases', [t, ...list].slice(0, 30));
    renderPhrases();
  });
  renderPhrases();

  /* ------------------------------ local TTS (when "control page speaks") ------------------------------ */
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  let q = [];
  let speaking = false;
  function speak(t) {
    if (!synth) return toast('This browser has no text-to-speech', 'err');
    if (t.priority !== 'high' && q.length >= 4) return;
    if (t.priority === 'high') q.unshift(t); else q.push(t);
    pump();
  }
  function pump() {
    if (speaking || !q.length) return;
    const t = q.shift();
    const u = new SpeechSynthesisUtterance(t.text);
    const vs = synth.getVoices();
    const v = vs.find((x) => x.name === t.voice) || vs.find((x) => x.lang.toLowerCase().startsWith(t.lang.slice(0, 2).toLowerCase()));
    if (v) u.voice = v;
    u.lang = v?.lang || t.lang; u.rate = t.rate; u.pitch = t.pitch; u.volume = t.volume;
    speaking = true;
    let done = false;
    const fin = () => { if (done) return; done = true; clearTimeout(wd); speaking = false; pump(); };
    const wd = setTimeout(() => { try { synth.cancel(); } catch { /* ignore */ } fin(); }, 25_000);
    u.onend = fin; u.onerror = fin;
    synth.speak(u);
  }
  function renderVoices() {
    if (!synth) return;
    const sel = $('#voiceSel');
    const vs = synth.getVoices();
    const key = `${vs.length}|${snap.settings.tts.voice}`;
    if (sel.dataset.k === key) return;
    sel.dataset.k = key;
    sel.replaceChildren(h('option', { value: '' }, '(automatic, by language)'), ...vs.map((v) => h('option', { value: v.name }, `${v.name} (${v.lang})`)));
    sel.value = snap.settings.tts.voice;
  }
  if (synth) synth.onvoiceschanged = () => { if (snap) { $('#voiceSel').dataset.k = ''; renderVoices(); } };
  $('#voiceSel').addEventListener('change', (e) => patch({ tts: { voice: e.target.value } }));
  $('#ttsTest').addEventListener('click', () => {
    const t = snap.settings.tts;
    try { synth.cancel(); } catch { /* ignore */ }
    q = []; speaking = false;
    speak({ text: 'Hello! This is how I sound at the cat cafe.', voice: t.voice, lang: t.lang === 'auto' ? 'en-US' : t.lang, rate: t.rate, pitch: t.pitch, volume: t.volume, priority: 'high' });
  });
  $('#ttsTestOverlay').addEventListener('click', () => cmd({ type: 'say', text: 'Testing the overlay voice. Meow!', mode: 'speak', style: {} }));

  /* ------------------------------ alerts test ------------------------------ */
  const tp = () => ({ author: $('#tName').value, text: $('#tText').value, value: Number($('#tValue').value), currency: $('#tCur').value, tier: Number($('#tTier').value) });
  $('#tSuper').addEventListener('click', () => cmd({ type: 'test', kind: 'superchat', ...tp() }));
  $('#tSticker').addEventListener('click', () => cmd({ type: 'test', kind: 'sticker', ...tp() }));
  $('#tMember').addEventListener('click', () => cmd({ type: 'test', kind: 'member', ...tp() }));
  $('#tMile').addEventListener('click', () => cmd({ type: 'test', kind: 'milestone', ...tp() }));
  $('#tGift').addEventListener('click', () => cmd({ type: 'test', kind: 'gift', ...tp() }));

  /* ------------------------------ music ------------------------------ */
  async function loadTracks(force) {
    if (!started) return;
    const r = await call('/api/live/control/tracks', 'GET');
    if (Array.isArray(r.data)) { tracks = r.data; renderTracks(); }
  }
  function renderTracks() {
    const qv = $('#trackSearch').value.trim().toLowerCase();
    const list = tracks.filter((t) => !qv || t.title.toLowerCase().includes(qv)).slice(0, 250);
    $('#trackCount').textContent = `${tracks.length} songs`;
    $('#trackList').replaceChildren(...list.map((t) => h('li', { class: 'tr' },
      h('span', { class: 't' }, t.title, h('small', {}, t.group)),
      h('span', { class: 'acts' },
        h('button', { class: 'btn add sm', onclick: () => cmd({ type: 'music', action: 'play', trackId: t.id }) }, '▶'),
        h('button', { class: 'btn ghost sm', onclick: () => cmd({ type: 'music', action: 'queue', trackId: t.id }) }, '＋ Queue')))));
  }
  $('#trackSearch').addEventListener('input', renderTracks);
  function renderMusic() {
    const m = snap.music;
    $('#mTitle').textContent = m.track ? m.track.title : '—';
    $('#mState').textContent = m.track ? (m.playing ? 'Playing on the overlay' : 'Paused') : 'Stopped';
    $('#mTitle').closest('.np-box').classList.toggle('playing', Boolean(m.track && m.playing));
    $('#queueN').textContent = snap.queue.length ? `${snap.queue.length} waiting` : '';
    $('#mQueue').replaceChildren(...snap.queue.map((t) => h('li', {}, t)));
  }

  /* ------------------------------ media ------------------------------ */
  const ICON = { video: '🎞️', image: '🖼️', audio: '🎵' };
  const size = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);
  function renderMedia() {
    $('#roleprep').textContent = snap.roles.prep?.name || 'none';
    $('#roletransition').textContent = snap.roles.transition?.name || 'none';
    $('#storageName').textContent = snap.storage ? `· saving stats to ${snap.storage}` : '· Discord storage channel not found';
    $('#storageName2').textContent = $('#storageName').textContent;
    $('#mediaEmpty').hidden = snap.media.length > 0;
    if (!changed('media', [snap.media.map((m) => m.id), snap.roles.prep?.id, snap.roles.transition?.id])) return;
    $('#mediaList').replaceChildren(...snap.media.map((m) => {
      const isPrep = snap.roles.prep?.id === m.id;
      const isTr = snap.roles.transition?.id === m.id;
      const acts = [];
      if (m.kind === 'video') {
        acts.push(h('button', { class: 'btn ghost sm', onclick: () => patch({ prep: { mediaId: isPrep && !snap.settings.prep.mediaId ? null : m.id } }).then(() => toast('Starting-soon video set')) }, isPrep ? '✓ Starting-soon' : 'Use as starting-soon'));
        acts.push(h('button', { class: 'btn ghost sm', onclick: () => patch({ transition: { mediaId: m.id } }).then(() => toast('Transition video set')) }, isTr ? '✓ Transition' : 'Use as transition'));
      }
      if (m.kind !== 'audio') acts.push(h('button', { class: 'btn add sm', onclick: () => cmd({ type: 'media-show', mediaId: m.id, seconds: Number($('#clipSec').value) || 0, mode: $('#clipFull').checked ? 'full' : 'center', loop: $('#clipLoop').checked }) }, '▶ Show on stream'));
      if (isPrep && snap.settings.prep.mediaId) acts.push(h('button', { class: 'btn ghost sm', onclick: () => patch({ prep: { mediaId: null } }) }, 'Auto-detect'));
      if (isTr && snap.settings.transition.mediaId) acts.push(h('button', { class: 'btn ghost sm', onclick: () => patch({ transition: { mediaId: null } }) }, 'Auto-detect'));
      return h('li', { class: `tr${isPrep || isTr ? ' role' : ''}` }, h('span', { class: 't' }, `${ICON[m.kind]} ${m.name}`, h('small', {}, `${size(m.size)}${isPrep ? ' · starting-soon' : ''}${isTr ? ' · transition' : ''}`)), h('span', { class: 'acts' }, acts));
    }));
  }

  /* ------------------------------ youtube ------------------------------ */
  $('#ytConnect').addEventListener('click', async () => {
    const r = await cmd({ type: 'yt-connect', input: $('#ytInput').value });
    if (r.ok) toast('Connected to the YouTube live chat 🎉');
  });
  function renderYt() {
    const y = snap.ytInfo;
    $('#keyBadge').textContent = y.keySet ? 'set ✓' : 'missing — add YT_API_KEY';
    $('#keyBadge').className = `badge ${y.keySet ? 'ok' : 'bad'}`;
    $('#ytStatus').textContent = `${y.status}${y.title ? ` · ${y.title}` : ''}${y.error ? ` — ${y.error}` : ''}`;
    $('#quotaUsed').textContent = fmtN(y.quotaUsed);
    $('#quotaBar').style.width = `${Math.min(100, (y.quotaUsed / 10000) * 100)}%`;
    $('#pollMs').textContent = (y.minPollMs / 1000).toFixed(0);
    $('#quotaHr').textContent = fmtN(Math.round((3600_000 / y.minPollMs) * 5 + 3600 / 45 * 2));
  }

  /* ------------------------------ stats ------------------------------ */
  function renderStats() {
    const t = snap.totals;
    const cards = [['Lives saved', fmtN(t.lives)], ['Total stream time', hms(t.seconds)], ['Comments', fmtN(t.comments)], ['Views gained', fmtN(t.views)], ['Subscribers gained', fmtN(t.subs)], ['Best peak viewers', fmtN(t.peak)], ['Super Chat total', money(t.byCurrency)]];
    if (changed('totals', cards)) $('#totalGrid').replaceChildren(...cards.map(([l, v]) => h('div', { class: 'stat' }, h('small', {}, l), h('b', {}, v))));
    $('#histEmpty').hidden = snap.history.length > 0;
    if (changed('hist', snap.history.map((x) => [x.id, x.status, x.comments, x.peakViewers, x.endedAt]))) {
      $('#histTable tbody').replaceChildren(...snap.history.map((x) => {
        const d = new Date(x.startedAt);
        return h('tr', {}, h('td', {}, `${d.toLocaleDateString('en-GB')} ${two(d.getHours())}:${two(d.getMinutes())}`), h('td', {}, x.status === 'live' ? `🔴 ${x.title}` : x.title),
          h('td', {}, hms(x.durationSec || 0)), h('td', {}, fmtN(x.peakViewers)), h('td', {}, fmtN(x.avgViewers)), h('td', {}, `+${fmtN(x.subs?.gained ?? 0)}`),
          h('td', {}, `+${fmtN(x.views?.gained ?? 0)}`), h('td', {}, fmtN(x.comments)), h('td', {}, money(x.superChats?.byCurrency)));
      }));
    }
  }

  init();
})();
