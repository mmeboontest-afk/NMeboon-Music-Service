/* Nodistub Cat Cafe — live overlay (OBS Browser Source, 1920x1080) */
(() => {
  const $ = (s) => document.querySelector(s);
  const params = new URLSearchParams(location.search);
  if (params.get('bg')) document.body.classList.add('checker');

  const stage = $('#stage');
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const fmtN = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US'));
  const two = (n) => String(n).padStart(2, '0');
  const hms = (s) => `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(Math.floor(s % 60))}`;
  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.style.cssText = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  }

  function fit() {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = `scale(${s})`;
    stage.style.left = `${(innerWidth - 1920 * s) / 2}px`;
    stage.style.top = `${(innerHeight - 1080 * s) / 2}px`;
  }
  fit();
  addEventListener('resize', fit);

  /* ------------------------------ state ------------------------------ */
  let snap = null;
  let offset = 0; // server clock − client clock
  let scene = 'off';
  let appliedSeq = -1;
  let first = true;
  const now = () => Date.now() + offset;
  const S = () => snap?.settings;

  const es = new EventSource('/api/live/stream');
  es.addEventListener('state', (e) => onState(JSON.parse(e.data)));
  es.addEventListener('scene', (e) => { const d = JSON.parse(e.data); appliedSeq = d.seq; goScene(d.scene, d.transition, d.force); });
  es.addEventListener('chat', (e) => addMsg(JSON.parse(e.data)));
  es.addEventListener('chat-del', (e) => removeMsg(JSON.parse(e.data).id));
  es.addEventListener('chat-clear', () => { chatEl.replaceChildren(); shown.clear(); });
  es.addEventListener('pin', (e) => showPin(JSON.parse(e.data)));
  es.addEventListener('alert', (e) => showAlert(JSON.parse(e.data)));
  es.addEventListener('alert-end', (e) => endAlert(JSON.parse(e.data).id));
  es.addEventListener('caption', (e) => showCaption(JSON.parse(e.data)));
  es.addEventListener('caption-clear', () => clearCaption());
  es.addEventListener('tts', (e) => enqueueTts(JSON.parse(e.data)));
  es.addEventListener('tts-stop', () => stopTts());
  es.addEventListener('music', (e) => onMusic(JSON.parse(e.data)));
  es.addEventListener('media', (e) => showClip(JSON.parse(e.data)));
  es.addEventListener('media-hide', () => hideClip());

  function onState(s) {
    snap = s;
    offset = s.now - Date.now();
    applySettings();
    renderStats();
    applySky();
    updatePrepMedia();
    renderRecap();
    if (first) {
      first = false;
      appliedSeq = s.sceneSeq;
      applyScene(s.scene);
      s.chat.slice(-S().chat.max).forEach((m) => addMsg(m, false));
      if (s.pinned) showPin(s.pinned);
      if (s.caption) showCaption(s.caption);
      if (s.alert && s.alert.endsAt > now()) showAlert(s.alert);
      if (s.clip) showClip(s.clip);
      onMusic(s.music);
    } else if (s.sceneSeq !== appliedSeq && s.scene !== scene) {
      appliedSeq = s.sceneSeq;
      applyScene(s.scene);
    }
    if (s.music && music && (s.music.volume !== music.volume)) { music.volume = s.music.volume; setVol(); }
  }

  function applySettings() {
    const w = S().widgets;
    for (const k of Object.keys(w)) stage.classList.toggle(`no-${k}`, !w[k]);
    stage.classList.toggle('side-right', S().chat.side === 'right');
    stage.style.setProperty('--cs', `${S().chat.size}px`);
    $('#prepTitle').textContent = S().prep.title;
    $('#prepSub').textContent = S().prep.subtitle;
    $('#prepVideo').style.mixBlendMode = S().prep.blend === 'normal' ? '' : S().prep.blend;
  }

  /* ------------------------------ sky / scenery ------------------------------ */
  const PAL = {
    day: ['#7cc6f4', '#e3f4ff', '#a8dbb0', '#86c593', '#63a978', '#ffffff', '#fff2a8', 0],
    sunset: ['#6a58a8', '#ff9f7c', '#9bb08e', '#7f9d82', '#678a70', '#ffc9bd', '#ffb88a', 0.3],
    night: ['#0a0e2c', '#262c63', '#34506a', '#2a4259', '#203548', '#59629a', '#cfd8ff', 1],
  };
  let skyKey = '';
  function applySky() {
    let t = S().theme.sky;
    if (t === 'auto') { const hr = new Date().getHours(); t = hr >= 6 && hr < 17 ? 'day' : hr >= 17 && hr < 19 ? 'sunset' : 'night'; }
    if (t === skyKey) return;
    skyKey = t;
    const p = PAL[t];
    ['--sky1', '--sky2', '--h1', '--h2', '--h3', '--cloud', '--orbc', '--dark'].forEach((n, i) => stage.style.setProperty(n, p[i]));
    $('#orb').style.left = t === 'night' ? '78%' : t === 'sunset' ? '22%' : '80%';
    $('#orb').style.top = t === 'sunset' ? '58%' : '22%';
  }
  (function scenery() {
    const clouds = $('#clouds');
    for (let i = 0; i < 8; i++) {
      const far = Math.random() < 0.45;
      const w = far ? rand(160, 280) : rand(300, 520);
      clouds.append(h('div', { class: 'cloud', style: `--w:${w}px;--y:${rand(40, far ? 300 : 460)}px;--t:${rand(far ? 120 : 80, far ? 200 : 130)}s;--d:${-rand(0, 160)}s;--o:${far ? 0.6 : 0.92};--b:${far ? 2 : 0}px` }));
    }
    const stars = $('#stars');
    for (let i = 0; i < 70; i++) stars.append(h('i', { class: 'star', style: `left:${rand(0, 100)}%;top:${rand(0, 100)}%;animation-delay:${rand(0, 4)}s;animation-duration:${rand(2, 5)}s` }));
  })();

  /* ------------------------------ scenes + transition ------------------------------ */
  const SCENE_EL = { prep: '#sc-prep', live: '#sc-live', brb: '#sc-brb', ending: '#sc-end' };
  function applyScene(next) {
    scene = next;
    for (const [k, sel] of Object.entries(SCENE_EL)) $(sel).classList.toggle('on', k === next);
    $('#bg').classList.toggle('on', next === 'prep' || next === 'brb' || next === 'ending');
    document.body.dataset.scene = next;
    updatePrepMedia();
  }

  let xBusy = false;
  let xPending = null;
  function goScene(next, withTransition, force) {
    if (next === scene && !xBusy && !force) return;
    if (!withTransition || !snap) return applyScene(next);
    if (xBusy) { xPending = next; return; }
    xBusy = true;
    const done = () => {
      xBusy = false;
      $('#xition').className = '';
      $('#xVideo').pause();
      if (xPending) { const n = xPending; xPending = null; applyScene(n); }
    };
    const role = snap.roles?.transition;
    const x = $('#xition');
    if (role) {
      const v = $('#xVideo');
      x.className = 'on video';
      v.muted = S().transition.muted;
      v.src = role.url;
      let cut = false;
      const doCut = () => { if (!cut) { cut = true; applyScene(xPending || next); xPending = null; } };
      const timer = (ms) => setTimeout(doCut, ms);
      v.onloadedmetadata = () => {
        const ms = S().transition.cutMs > 0 ? S().transition.cutMs : (v.duration || 2) * 500;
        timer(ms);
      };
      v.onended = () => { doCut(); done(); };
      v.onerror = () => { doCut(); done(); };
      v.currentTime = 0;
      v.play().catch(() => { v.muted = true; v.play().catch(() => { doCut(); done(); }); });
      setTimeout(() => { doCut(); done(); }, 30_000); // safety net
    } else {
      x.className = 'on wipe';
      void x.offsetWidth;
      x.classList.add('go');
      setTimeout(() => applyScene(xPending || next), 700);
      setTimeout(() => { xPending = null; done(); }, 1550);
    }
  }

  function updatePrepMedia() {
    if (!snap) return;
    const v = $('#prepVideo');
    const role = snap.roles?.prep;
    const want = scene === 'prep' && S().prep.enabled && role;
    if (want) {
      if (v.dataset.id !== role.id) { v.dataset.id = role.id; v.src = role.url; }
      v.classList.add('show');
      if (v.paused) v.play().catch(() => {});
      $('#prepCard').classList.remove('full');
      $('#prepCard').classList.toggle('hidden', false);
    } else {
      v.classList.remove('show');
      if (!v.paused) v.pause();
      if (scene !== 'prep') { v.removeAttribute('src'); v.dataset.id = ''; v.load(); }
      $('#prepCard').classList.add('full');
    }
  }

  /* ------------------------------ clock / stats / recap ------------------------------ */
  const money = (by) => {
    const e = Object.entries(by || {});
    return e.length ? e.map(([c, v]) => `${v.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${c}`).join(' + ') : '0';
  };
  const last = {};
  function setChip(id, text, chip) {
    const el = $(id);
    if (last[id] === text) return;
    if (last[id] !== undefined && chip) { const c = $(chip); c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
    last[id] = text;
    el.textContent = text;
  }
  function renderStats() {
    const st = snap.stats;
    const se = snap.session;
    setChip('#stViewers', fmtN(st.viewers), '#chipViewers');
    setChip('#stSubs', fmtN(st.subs), '#chipSubs');
    setChip('#stChat', fmtN(se?.comments ?? 0), '#chipChat');
    setChip('#stMoney', money(se?.byCurrency), '#chipMoney');
    $('#liveTitle').textContent = se?.title || '';
  }

  function renderRecap() {
    if (scene !== 'ending' && !(snap.scene === 'ending')) return;
    const se = snap.session;
    if (!se) return;
    $('#endTitle').textContent = se.title;
    const cards = [
      [hms(se.durationSec ?? 0), 'Stream length'], [fmtN(se.peakViewers), 'Peak viewers'], [fmtN(se.avgViewers), 'Average viewers'], [`+${fmtN(se.subsGained)}`, 'New subscribers'],
      [fmtN(se.viewsGained), 'Views gained'], [fmtN(se.comments), 'Comments'], [money(se.byCurrency), 'Super Chat total'], [fmtN(se.members?.new ?? 0), 'New members'],
    ];
    const key = JSON.stringify(cards);
    if ($('#recap').dataset.k === key) return;
    $('#recap').dataset.k = key;
    $('#recap').replaceChildren(...cards.map(([v, l], i) => h('div', { class: 'rc', style: `animation-delay:${i * 0.08}s` }, h('b', {}, v), h('small', {}, l))));
    const tops = se.top?.length ? `💖 Top supporters: ${se.top.slice(0, 3).map((t) => `${t.name} (${money(t.byCurrency)})`).join('  ·  ')}` : '';
    $('#endTops').textContent = tops;
  }

  function tick() {
    const d = new Date();
    const t = `${two(d.getHours())}:${two(d.getMinutes())}`;
    $('#clockTime').textContent = t;
    $('#prepTime').textContent = t;
    $('#brbTime').textContent = t;
    if (snap?.session) {
      const se = snap.session;
      const secs = se.status === 'live' ? (now() - se.startedAt) / 1000 : se.durationSec;
      $('#elapsed').textContent = hms(Math.max(0, secs));
    } else $('#elapsed').textContent = '00:00:00';
    if (snap) {
      const left = snap.prepCountdownEnd - now();
      $('#prepCount').textContent = snap.prepCountdownEnd && left > 0 ? `starts in ${two(Math.floor(left / 60000))}:${two(Math.floor((left % 60000) / 1000))}` : '';
      applySky();
    }
    // old chat messages fade away
    const fade = snap ? S().chat.fadeSec : 0;
    if (fade > 0) for (const [id, v] of shown) if (Date.now() - v.at > fade * 1000) removeMsg(id);
  }
  setInterval(tick, 500);

  /* ------------------------------ chat ------------------------------ */
  const chatEl = $('#chat');
  const shown = new Map();
  const TIER = { 1: ['#1e88e5', '#fff'], 2: ['#00b8d4', '#00262e'], 3: ['#00bfa5', '#00261f'], 4: ['#ffca28', '#3d2c00'], 5: ['#fb8c00', '#fff'], 6: ['#e91e63', '#fff'], 7: ['#e62117', '#fff'] };
  const tierCol = (t) => TIER[Math.min(7, Math.max(1, t || 1))];

  function avatar(m, cls = 'av') {
    const a = h('div', { class: cls });
    if (m.avatar) {
      const img = h('img', { src: m.avatar, alt: '', referrerpolicy: 'no-referrer' });
      img.onerror = () => { img.remove(); a.textContent = (m.author || '?')[0].toUpperCase(); };
      a.append(img);
    } else a.textContent = (m.author || '?')[0].toUpperCase();
    return a;
  }

  function addMsg(m, animate = true) {
    if (!snap || shown.has(m.id) || m.hidden) return;
    if (S().chat.hideCommands && m.kind === 'chat' && m.text.trim().startsWith('!')) return;
    const b = m.badges || {};
    const nameCls = b.owner ? 'owner' : b.mod ? 'mod' : b.member ? 'member' : '';
    const badges = [b.owner && '👑', b.mod && '🔧', b.member && '⭐', b.verified && '✔️'].filter(Boolean).join(' ');
    let el;
    if (m.kind === 'superchat' || m.kind === 'sticker') {
      const [bg, fg] = tierCol(m.amount?.tier);
      el = h('div', { class: 'msg sc', style: `--tc:${bg};--tt:${fg}` }, avatar(m),
        h('div', {}, h('div', { class: 'nm' }, m.author, ' · ', h('span', { class: 'amt' }, m.amount?.display || ''), m.kind === 'sticker' ? ' 🌸' : ''), m.text ? h('div', { class: 'tx' }, m.text) : null));
    } else if (m.kind === 'member' || m.kind === 'milestone' || m.kind === 'gift') {
      const line = m.kind === 'member' ? `⭐ ${m.author} became a member!` : m.kind === 'milestone' ? `🎉 ${m.author} · ${m.months} months a member` : `🎁 ${m.author} gifted ${m.count} memberships`;
      el = h('div', { class: 'msg evt' }, avatar(m), h('div', {}, h('div', { class: 'tx' }, line), m.kind === 'milestone' && m.text ? h('div', { class: 'tx' }, m.text) : null));
    } else {
      el = h('div', { class: 'msg' }, avatar(m), h('div', {}, h('div', { class: `nm ${nameCls}` }, m.author, badges ? h('span', {}, badges) : null), h('div', { class: 'tx' }, m.text)));
    }
    if (!animate) el.style.animation = 'none';
    chatEl.append(el);
    shown.set(m.id, { el, at: Date.now() });
    while (chatEl.children.length > S().chat.max) {
      const first = chatEl.firstElementChild;
      for (const [id, v] of shown) if (v.el === first) { shown.delete(id); break; }
      first.remove();
    }
  }
  function removeMsg(id) {
    const v = shown.get(id);
    if (!v) return;
    shown.delete(id);
    v.el.classList.add('out');
    setTimeout(() => v.el.remove(), 400);
  }

  /* ------------------------------ alerts ------------------------------ */
  const alertEl = $('#alert');
  let curAlert = null;
  let alertRaf = 0;
  const LABEL = { superchat: 'Super Chat', sticker: 'Super Sticker', member: 'New member', milestone: 'Member milestone', gift: 'Gifted memberships' };

  function showAlert(a) {
    if (!S().widgets.alerts) return;
    alertEl.replaceChildren();
    curAlert = a;
    const evt = !a.amount;
    const [bg, fg] = tierCol(a.tier);
    const card = h('div', { class: `al${evt ? ' evt' : ''}`, style: evt ? '' : `--tc:${bg};--tt:${fg}` },
      h('div', { class: 'al-head' }, avatar(a, 'al-av'),
        h('div', { class: 'al-who' }, h('small', {}, LABEL[a.kind] || 'Thank you'), h('b', {}, a.author)),
        h('div', { class: 'al-amt' }, a.amount ? a.amount.display : a.kind === 'gift' ? `×${a.count}` : a.kind === 'milestone' ? `${a.months} mo` : '⭐')),
      a.text && a.kind !== 'member' ? h('div', { class: 'al-msg' }, a.text) : h('div', { style: 'height:8px' }),
      h('div', { class: 'al-timer' }, h('div', { class: 'tb' }, h('i')), h('span', {}, '0:00')));
    alertEl.append(card);
    const bar = card.querySelector('.tb i');
    const label = card.querySelector('.al-timer span');
    cancelAnimationFrame(alertRaf);
    const loop = () => {
      const left = Math.max(0, a.endsAt - now());
      bar.style.transform = `scaleX(${Math.min(1, left / a.durationMs)})`;
      label.textContent = `${Math.floor(left / 60000)}:${two(Math.floor((left % 60000) / 1000))}`;
      if (curAlert === a && left > 0) alertRaf = requestAnimationFrame(loop);
    };
    loop();
    chime(a.tier, evt);
    react(`Thank you, ${a.author}! 💖`);
    petalBurst(960, 330, 36);
  }
  function endAlert(id) {
    if (!curAlert || curAlert.id !== id) return;
    const card = alertEl.firstElementChild;
    curAlert = null;
    if (card) { card.classList.add('out'); setTimeout(() => { if (!curAlert) alertEl.replaceChildren(); }, 600); }
  }

  /* soft bell chime (no files needed) */
  let actx = null;
  function chime(tier, evt) {
    if (!S().alerts.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      const ratios = evt || tier < 4 ? [1, 1.5] : tier < 7 ? [1, 1.25, 1.5] : [1, 1.25, 1.5, 2];
      ratios.forEach((r, i) => {
        const o = actx.createOscillator(); const g = actx.createGain();
        o.type = 'sine'; o.frequency.value = 523.25 * r;
        const t0 = actx.currentTime + i * 0.12;
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.4);
        o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + 1.5);
      });
    } catch { /* audio not available */ }
  }

  /* ------------------------------ mascot ------------------------------ */
  let reactT;
  function react(text) {
    const m = $('#mascot');
    m.classList.add('happy');
    $('#mBubble').textContent = text;
    $('#mBubble').classList.add('on');
    clearTimeout(reactT);
    reactT = setTimeout(() => { m.classList.remove('happy'); $('#mBubble').classList.remove('on'); }, 3500);
    const r = m.getBoundingClientRect();
    const sc = stage.getBoundingClientRect();
    const k = sc.width / 1920;
    for (let i = 0; i < 6; i++) {
      const hEl = h('span', { class: 'heart', style: `left:${(r.left - sc.left) / k + rand(40, 280)}px;top:${(r.top - sc.top) / k + rand(0, 100)}px;--hx:${rand(-60, 60)}px;animation-delay:${i * 0.12}s` }, pick(['💗', '💖', '🌸', '💕']));
      stage.append(hEl);
      setTimeout(() => hEl.remove(), 2400);
    }
  }

  /* ------------------------------ pinned chat ------------------------------ */
  const pinEl = $('#pin');
  function showPin(m) {
    if (!m) { const c = pinEl.firstElementChild; if (c) { c.classList.add('out'); setTimeout(() => pinEl.replaceChildren(), 450); } return; }
    pinEl.replaceChildren(h('div', { class: 'pinc' }, avatar(m, 'av'), h('div', {}, h('b', {}, m.author), h('p', {}, m.text || (m.amount ? m.amount.display : '')))));
  }

  /* ------------------------------ captions ------------------------------ */
  const capEl = $('#cap');
  let capT;
  function showCaption(c) {
    if (!S().widgets.captions) return;
    clearTimeout(capT);
    capEl.className = `pos-${c.pos}`;
    const t = h('div', { class: `capt ${c.anim}`, style: `font-family:'${c.font}',sans-serif;font-size:${c.size}px;color:${c.color};--fs:${c.size}px;--st:${c.stroke}` });
    if (c.anim === 'pop' || c.anim === 'fade') t.textContent = c.text;
    else {
      let i = 0;
      for (const w of c.text.split(/(\s+)/)) {
        if (/^\s+$/.test(w)) { t.append(' '); continue; }
        const word = h('span', { style: 'display:inline-block;white-space:nowrap' });
        for (const ch of [...w]) {
          const delay = c.anim === 'typewriter' ? i * 0.055 : c.anim === 'wave' ? i * 0.09 : i * 0.045;
          word.append(h('span', { class: 'ch', style: `animation-delay:${delay}s` }, ch));
          i++;
        }
        t.append(word);
      }
    }
    capEl.replaceChildren(t);
  }
  function clearCaption() {
    const t = capEl.firstElementChild;
    if (!t) return;
    t.classList.add('out');
    capT = setTimeout(() => capEl.replaceChildren(), 450);
  }

  /* ------------------------------ media clip ------------------------------ */
  const clipEl = $('#clip');
  function showClip(c) {
    clipEl.replaceChildren();
    clipEl.className = `on${c.mode === 'full' ? ' full' : ''}`;
    if (c.kind === 'video') {
      const v = h('video', { src: c.url, autoplay: true, playsinline: true });
      v.loop = c.loop; v.muted = c.muted;
      v.onended = () => { if (!c.loop) hideClip(); };
      v.onerror = () => hideClip();
      v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
      clipEl.append(v);
    } else clipEl.append(h('img', { src: c.url, alt: '' }));
  }
  function hideClip() { clipEl.className = ''; clipEl.replaceChildren(); }

  /* ------------------------------ music ------------------------------ */
  const bgm = $('#bgm');
  let music = null;
  let curKey = '';
  let duckF = 1;
  let errTries = 0;
  const pill = $('#audioPill');
  function setVol() { bgm.volume = Math.max(0, Math.min(1, (music?.volume ?? 0.4) * duckF)); }
  function tryPlay() {
    bgm.play().then(() => { pill.hidden = true; }).catch((e) => { if (e.name === 'NotAllowedError') pill.hidden = false; });
  }
  function onMusic(m) {
    music = m;
    const t = m.track;
    const np = $('#np');
    if (!t) { bgm.pause(); bgm.removeAttribute('src'); curKey = ''; np.classList.remove('on', 'playing'); document.body.classList.remove('music'); return; }
    const key = `${t.id}#${m.seq}`;
    if (key !== curKey) { curKey = key; bgm.src = t.src; bgm.load(); errTries = 0; }
    $('#npTitle').textContent = t.title;
    np.classList.add('on');
    np.classList.toggle('playing', m.playing);
    document.body.classList.toggle('music', m.playing);
    setVol();
    if (m.playing) tryPlay(); else bgm.pause();
  }
  const reportEnded = () => fetch('/api/live/overlay/music-ended', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seq: music?.seq }) }).catch(() => {});
  bgm.addEventListener('ended', reportEnded);
  bgm.addEventListener('error', () => { if (curKey && ++errTries <= 1) setTimeout(reportEnded, 1500); });
  pill.addEventListener('click', () => {
    tryPlay();
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); actx.resume(); } catch { /* ignore */ }
    try { speechSynthesis.speak(new SpeechSynthesisUtterance('')); } catch { /* ignore */ }
    pill.hidden = true;
  });

  /* ------------------------------ text to speech ------------------------------ */
  const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
  let ttsQ = [];
  let speaking = false;
  let warned = false;
  function notice(text) {
    const n = $('#notice');
    n.textContent = text; n.hidden = false;
    setTimeout(() => { n.hidden = true; }, 7000);
  }
  function voiceFor(t) {
    const vs = synth.getVoices();
    return vs.find((v) => v.name === t.voice) || vs.find((v) => v.lang.toLowerCase().startsWith(t.lang.slice(0, 2).toLowerCase())) || null;
  }
  function enqueueTts(t) {
    if (t.output !== 'overlay') return;
    if (!synth) { if (!warned) { warned = true; notice('Text-to-speech is not available in this browser — set "TTS output" to the control panel.'); } return; }
    if (t.priority !== 'high' && ttsQ.length >= 4) return;
    if (t.priority === 'high') ttsQ.unshift(t); else ttsQ.push(t);
    pumpTts();
  }
  function pumpTts() {
    if (speaking || !ttsQ.length) return;
    const t = ttsQ.shift();
    const u = new SpeechSynthesisUtterance(t.text);
    const v = voiceFor(t);
    if (v) u.voice = v;
    u.lang = v?.lang || t.lang; u.rate = t.rate; u.pitch = t.pitch; u.volume = t.volume;
    speaking = true;
    if (t.duck) { duckF = 0.25; setVol(); }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true; clearTimeout(wd); speaking = false;
      if (!ttsQ.length) { duckF = 1; setVol(); }
      pumpTts();
    };
    const wd = setTimeout(() => { try { synth.cancel(); } catch { /* ignore */ } finish(); }, 25_000);
    u.onend = finish; u.onerror = finish;
    try { synth.speak(u); } catch { finish(); }
  }
  function stopTts() { ttsQ = []; try { synth?.cancel(); } catch { /* ignore */ } speaking = false; duckF = 1; setVol(); }
  if (synth) synth.onvoiceschanged = () => {};

  /* ------------------------------ falling sakura ------------------------------ */
  const cv = $('#petals');
  const ctx = cv.getContext('2d');
  const petals = [];
  let wind = 0, windT = 0, gust = 0, lastT = 0;
  const newPetal = (x, y, burst) => ({
    x: x ?? rand(-100, 2000), y: y ?? rand(-60, -10), s: rand(9, 20), rot: rand(0, 6.28), vr: rand(-1.4, 1.4),
    vx: burst ? rand(-260, 260) : rand(-10, 20), vy: burst ? rand(-320, -60) : rand(35, 80), ph: rand(0, 6.28), sw: rand(0.8, 1.8), amp: rand(12, 34),
    c: pick(['#ffc8d8', '#ffb7cd', '#ffd6e2', '#ff9fbe', '#ffe3ec']), burst: !!burst, life: burst ? 2 : 99,
  });
  function petalBurst(x, y, n) { for (let i = 0; i < n; i++) petals.push(newPetal(x, y, true)); }
  function frame(ts) {
    requestAnimationFrame(frame);
    if (!snap || !S().widgets.petals) return;
    const dt = Math.min(0.05, (ts - lastT) / 1000 || 0.016);
    lastT = ts;
    ctx.clearRect(0, 0, 1920, 1080);
    if (Math.random() < 0.015) windT = rand(-30, 60);
    gust *= 0.985;
    wind += (windT + gust - wind) * dt * 0.8;
    while (petals.filter((p) => !p.burst).length < 38) petals.push(newPetal());
    for (let i = petals.length - 1; i >= 0; i--) {
      const p = petals[i];
      p.ph += p.sw * dt;
      if (p.burst) { p.vy += 240 * dt; p.vx *= 0.985; p.vy = Math.min(p.vy, 100); p.life -= dt * 0.5; }
      p.x += (p.vx + wind + Math.sin(p.ph) * p.amp) * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
      if (p.y > 1110 || p.x > 2040 || p.x < -120 || p.life <= 0) {
        if (p.burst) petals.splice(i, 1); else Object.assign(p, newPetal(rand(-100, 2000), -30));
        continue;
      }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.abs(Math.cos(p.ph * 0.7)) * 0.7 + 0.3);
      ctx.globalAlpha = Math.min(1, p.life); ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.moveTo(0, -p.s); ctx.bezierCurveTo(p.s * 0.9, -p.s * 0.7, p.s * 0.7, p.s * 0.6, 0, p.s * 0.45); ctx.bezierCurveTo(-p.s * 0.7, p.s * 0.6, -p.s * 0.9, -p.s * 0.7, 0, -p.s); ctx.fill();
      ctx.restore();
    }
  }
  requestAnimationFrame(frame);
})();
