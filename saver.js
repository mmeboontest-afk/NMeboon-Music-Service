/* Nodistub Cat Cafe — Sakura Cat Window (screensaver) */
(() => {
  const $ = (s) => document.querySelector(s);
  const saver = $('#saver');
  if (!saver) return;

  const IDLE_MS = 90_000; // open automatically after this much inactivity
  const CALM_MS = 4_000; // hide the buttons after this much stillness
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const svgNS = 'http://www.w3.org/2000/svg';

  /* ------------------------------ sky by local time ------------------------------ */
  // [hour, sky top, sky bottom, hill1, hill2, hill3, cloud, sun glow, darkness 0..1]
  const KEYS = [
    [0,    '#0a0e2c', '#262c63', '#34506a', '#2a4259', '#203548', '#59629a', '#cfd8ff', 1],
    [4.5,  '#10163f', '#343a7a', '#38546e', '#2d465d', '#233a4d', '#6a72a8', '#cfd8ff', 1],
    [5.8,  '#4a4a8c', '#f3a58f', '#8fb89c', '#76a487', '#5d8f73', '#ffd7cf', '#ffc8a0', 0.35],
    [7,    '#86c8f2', '#ffe7c4', '#a8dbb0', '#86c593', '#63a978', '#fff4ea', '#fff0b0', 0],
    [12,   '#68baf0', '#e6f5ff', '#a8dbb0', '#86c593', '#63a978', '#ffffff', '#fff2a8', 0],
    [16.5, '#78b0e6', '#fff0d2', '#a8d3a4', '#86be8a', '#63a36e', '#fff8ee', '#ffe9a0', 0],
    [18.2, '#6a58a8', '#ff9f7c', '#9bb08e', '#7f9d82', '#678a70', '#ffc9bd', '#ffb88a', 0.3],
    [19.6, '#252a66', '#7a5890', '#52708a', '#436079', '#365368', '#8d7aa8', '#e9d5ff', 0.8],
    [21,   '#10153e', '#2e3470', '#38546e', '#2d465d', '#233a4d', '#5d669e', '#cfd8ff', 1],
    [24,   '#0a0e2c', '#262c63', '#34506a', '#2a4259', '#203548', '#59629a', '#cfd8ff', 1],
  ];
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const mix = (a, b, t) => {
    const A = hex(a), B = hex(b);
    return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
  };

  function skyAt(h) {
    let i = 0;
    while (i < KEYS.length - 2 && h >= KEYS[i + 1][0]) i++;
    const a = KEYS[i], b = KEYS[i + 1];
    const t = Math.max(0, Math.min(1, (h - a[0]) / (b[0] - a[0])));
    const names = ['--sky1', '--sky2', '--hill1', '--hill2', '--hill3', '--cloud', '--sun'];
    names.forEach((n, k) => saver.style.setProperty(n, mix(a[k + 1], b[k + 1], t)));
    saver.style.setProperty('--dark', (a[8] + (b[8] - a[8]) * t).toFixed(3));
  }

  function orbs(h) {
    const sun = $('#sSun'), moon = $('#sMoon');
    const place = (el, p, visible) => {
      el.style.left = `${8 + 84 * p}%`;
      el.style.top = `${68 - 30 * Math.sin(Math.PI * p)}%`; // arc stays below the clock
      el.style.opacity = visible ? '1' : '0';
    };
    const dayP = (h - 5.5) / 13; // 05:30 → 18:30
    const nightH = h >= 18 ? h - 18 : h + 6;
    const nightP = nightH / 12; // 18:00 → 06:00
    place(sun, Math.max(0, Math.min(1, dayP)), dayP > -0.04 && dayP < 1.04);
    place(moon, Math.max(0, Math.min(1, nightP)), nightP >= 0 && nightP <= 1 && (h >= 18 || h < 6.2));
  }

  /* ------------------------------ clock ------------------------------ */
  let is24 = store.get('saver-24h', '1') === '1';
  const sTime = $('#sTime');
  sTime.innerHTML = '<span id="sH"></span><span class="colon">:</span><span id="sM"></span><small id="sAp"></small>';
  const fmtBtn = $('#sFmt');
  fmtBtn.textContent = is24 ? '🕒 24h' : '🕒 12h';
  fmtBtn.addEventListener('click', () => {
    is24 = !is24;
    store.set('saver-24h', is24 ? '1' : '0');
    fmtBtn.textContent = is24 ? '🕒 24h' : '🕒 12h';
    tickClock(true);
  });

  const greeting = (h) =>
    h < 5 ? 'Late night, sleepy kitty 🌙'
      : h < 12 ? 'Good morning, kitty ☀️'
        : h < 17 ? 'Good afternoon, kitty 🌤️'
          : h < 21 ? 'Good evening, kitty 🌇'
            : 'Good night, kitty 🌙';

  let lastMin = -1;
  function tickClock(force) {
    const d = new Date();
    const m = d.getMinutes();
    let H = d.getHours();
    let ap = '';
    if (!is24) { ap = H >= 12 ? 'PM' : 'AM'; H = H % 12 || 12; }
    $('#sH').textContent = is24 ? String(H).padStart(2, '0') : String(H);
    $('#sM').textContent = String(m).padStart(2, '0');
    $('#sAp').textContent = ap;
    if (force || m !== lastMin) {
      lastMin = m;
      const h = d.getHours() + m / 60;
      $('#sDate').textContent = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
      $('#sGreet').textContent = greeting(d.getHours());
      skyAt(h);
      orbs(h);
    }
  }

  /* ------------------------------ scenery ------------------------------ */
  function build() {
    // stars
    const stars = $('#sStars');
    for (let i = 0; i < 80; i++) {
      const s = document.createElement('i');
      s.className = 'star';
      s.style.cssText = `left:${rand(0, 100)}%;top:${rand(0, 100)}%;animation-delay:${rand(0, 4)}s;animation-duration:${rand(2, 5)}s;`;
      if (Math.random() < 0.2) s.style.transform = 'scale(1.5)';
      stars.append(s);
    }
    // clouds
    const clouds = $('#sClouds');
    for (let i = 0; i < 8; i++) {
      const c = document.createElement('div');
      c.className = 'cloud';
      const far = Math.random() < 0.45;
      const w = far ? rand(110, 190) : rand(200, 340);
      c.style.cssText =
        `--w:${w}px;--y:${rand(6, far ? 34 : 52)}%;--t:${rand(far ? 110 : 70, far ? 190 : 120)}s;` +
        `--d:${-rand(0, 140)}s;--o:${far ? 0.6 : 0.92};--b:${far ? 1.5 : 0}px;`;
      clouds.append(c);
    }
    // fireflies
    const flies = $('#sFlies');
    for (let i = 0; i < 16; i++) {
      const f = document.createElement('i');
      f.className = 'fly';
      f.style.cssText =
        `left:${rand(4, 96)}%;top:${rand(52, 92)}%;--x:${rand(-60, 60)}px;--y:${rand(-70, 30)}px;` +
        `--t:${rand(5, 11)}s;animation-delay:${-rand(0, 8)}s,${-rand(0, 3)}s;`;
      flies.append(f);
    }
    // blossoms on the tree branch
    const g = $('#sBlossoms');
    const cols = ['#ffc8d8', '#ffb7cd', '#ffd6e2', '#ffa9c3', '#ffe0ea'];
    const blob = (x, y, r) => {
      const c = document.createElementNS(svgNS, 'circle');
      c.setAttribute('cx', x.toFixed(1)); c.setAttribute('cy', y.toFixed(1)); c.setAttribute('r', r.toFixed(1));
      c.setAttribute('fill', pick(cols));
      c.setAttribute('opacity', rand(0.8, 1).toFixed(2));
      c.setAttribute('class', 'blossom');
      c.style.animationDelay = `${-rand(0, 4)}s`;
      g.append(c);
    };
    for (let i = 0; i < 70; i++) {
      const t = Math.random();
      blob(-10 + 530 * t + rand(-30, 30), 40 + 160 * Math.pow(t, 1.3) + rand(-38, 38), rand(10, 24));
    }
    for (let i = 0; i < 22; i++) blob(rand(200, 420) + rand(-10, 10), 52 + rand(-30, 28), rand(9, 20));
    for (let i = 0; i < 14; i++) blob(345 + rand(-34, 34), rand(230, 310), rand(8, 16));
    for (let i = 0; i < 12; i++) blob(470 + rand(-30, 30), rand(240, 330), rand(8, 15));
  }
  build();

  /* ------------------------------ falling sakura (canvas) ------------------------------ */
  const cv = $('#sFx');
  const ctx = cv.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  const petals = [];
  let wind = 0, windTarget = 0, gust = 0;
  const MAX = reduceMotion ? 18 : 55;

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function newPetal(x, y, burst) {
    const size = rand(7, 15);
    return {
      x: x ?? rand(-W * 0.1, W * 1.05), y: y ?? rand(-40, -10),
      s: size, rot: rand(0, 6.28), vr: rand(-1.4, 1.4),
      vx: burst ? rand(-180, 180) : rand(-10, 20), vy: burst ? rand(-220, -40) : rand(30, 70),
      ph: rand(0, 6.28), sw: rand(0.8, 1.8), amp: rand(10, 28),
      hue: pick(['#ffc8d8', '#ffb7cd', '#ffd6e2', '#ff9fbe', '#ffe3ec']),
      fade: burst ? 1.6 : 99,
    };
  }

  function drawPetal(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(1, Math.abs(Math.cos(p.ph * 0.7)) * 0.7 + 0.3); // flutter
    ctx.globalAlpha = Math.min(1, p.fade);
    ctx.fillStyle = p.hue;
    ctx.beginPath();
    ctx.moveTo(0, -p.s);
    ctx.bezierCurveTo(p.s * 0.9, -p.s * 0.7, p.s * 0.7, p.s * 0.6, 0, p.s * 0.45);
    ctx.bezierCurveTo(-p.s * 0.7, p.s * 0.6, -p.s * 0.9, -p.s * 0.7, 0, -p.s);
    ctx.fill();
    ctx.restore();
  }

  let raf = 0, last = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    ctx.clearRect(0, 0, W, H);

    if (Math.random() < 0.015) windTarget = rand(-25, 55);
    gust *= 0.985;
    wind += (windTarget + gust - wind) * dt * 0.8;

    while (petals.filter((p) => p.fade > 50).length < MAX) petals.push(newPetal());

    for (let i = petals.length - 1; i >= 0; i--) {
      const p = petals[i];
      p.ph += p.sw * dt;
      p.vy += (p.fade < 50 ? 220 : 0) * dt; // burst petals fall back down
      if (p.fade < 50) { p.vx *= 0.985; p.vy = Math.min(p.vy, 90); p.fade -= dt * 0.6; }
      p.x += (p.vx + wind + Math.sin(p.ph) * p.amp) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.y > H + 30 || p.x > W + 60 || p.x < -80 || p.fade <= 0) {
        if (p.fade > 50) { Object.assign(p, newPetal(rand(-W * 0.1, W * 1.05), -20)); }
        else petals.splice(i, 1);
        continue;
      }
      drawPetal(p);
    }
  }

  function burst(x, y, n = 14) {
    for (let i = 0; i < n; i++) petals.push(newPetal(x, y, true));
  }

  $('#sGust').addEventListener('click', () => {
    gust = 260;
    windTarget = 40;
    for (let i = 0; i < 18; i++) petals.push(newPetal(rand(-60, W * 0.3), rand(0, H * 0.6)));
  });

  saver.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.s-controls, .s-np, .s-cat')) return;
    burst(e.clientX, e.clientY);
  });

  /* ------------------------------ cat ------------------------------ */
  const cat = $('#sCat');
  const bubble = $('#sBubble');
  const lines = ['meow~', 'purr purr…', 'nya!', '♪ la la la', 'more pets pls', 'mrrp?', 'this song slaps 🎧', 'zzz… oh! hi'];
  let pets = Number(store.get('saver-pets', '0')) || 0;
  const petsEl = $('#sPets');
  const renderPets = () => { petsEl.textContent = pets ? `🐾 petted ${pets}×` : ''; };
  renderPets();
  let bubbleT, happyT;

  function pet(e) {
    pets++;
    store.set('saver-pets', String(pets));
    renderPets();
    cat.classList.add('happy');
    clearTimeout(happyT);
    happyT = setTimeout(() => cat.classList.remove('happy'), 1100);
    bubble.textContent = pick(lines);
    bubble.classList.add('on');
    clearTimeout(bubbleT);
    bubbleT = setTimeout(() => bubble.classList.remove('on'), 1800);
    const r = cat.getBoundingClientRect();
    for (let i = 0; i < 4; i++) {
      const h = document.createElement('span');
      h.className = 'heart';
      h.textContent = pick(['💗', '💕', '🌸', '💖']);
      h.style.left = `${r.width * rand(0.25, 0.75)}px`;
      h.style.top = `${r.height * rand(0.05, 0.35)}px`;
      h.style.setProperty('--hx', `${rand(-40, 40)}px`);
      h.style.animationDelay = `${i * 0.1}s`;
      cat.append(h);
      setTimeout(() => h.remove(), 1800 + i * 100);
    }
    burst(r.left + r.width / 2, r.top + r.height * 0.2, 8);
  }
  cat.addEventListener('click', pet);
  cat.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pet(); } });

  /* ------------------------------ music state ------------------------------ */
  const sAudio = $('#sAudio');
  let soundOn = false;
  const loopBtn = $('#sLoop');
  const soundBtn = $('#sSound');
  let lastKey = '';

  function renderMusic() {
    const s = (typeof st !== 'undefined' && st.state) || null;
    const np = s?.nowPlaying;
    const key = `${np?.id}|${np?.durationMs}|${s?.paused}|${s?.loop}|${s?.listeners}`;
    if (key !== lastKey) {
      lastKey = key;
      $('#sEyebrow').textContent = !np ? 'Studio is resting' : s.paused ? 'Paused' : 'Now playing';
      $('#sTitle').textContent = np ? np.title : 'The studio is quiet…';
      $('#sSub').textContent = np
        ? `# ${np.channel} · ${np.auto ? '🎲 auto shuffle' : '💌 ' + (np.requestedBy || 'Guest cat')}`
        : s?.listeners ? '' : 'Join the music room to wake the cat';
      loopBtn.classList.toggle('on', !!s?.loop);
      loopBtn.textContent = s?.loop ? '🔁 Loop: on' : '🔁 Loop: off';
      loopBtn.disabled = !np;
    }
    if (np) {
      const pos = typeof currentPosition === 'function' ? currentPosition() : 0;
      $('#sCur').textContent = fmt(pos);
      if (np.durationMs) {
        $('#sDur').textContent = fmt(np.durationMs);
        $('#sBar').style.width = `${Math.min(100, (pos / np.durationMs) * 100)}%`;
      } else {
        $('#sDur').textContent = '--:--';
        $('#sBar').style.width = '0%';
      }
    } else {
      $('#sCur').textContent = '0:00';
      $('#sDur').textContent = '--:--';
      $('#sBar').style.width = '0%';
    }
  }

  loopBtn.addEventListener('click', async () => {
    const want = !(st.state?.loop);
    loopBtn.disabled = true;
    try {
      const res = await fetch('/api/loop', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: want }),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) toast(data.error || 'Cannot change loop right now', 'err');
      else toast(data.loop ? '🔁 Looping this song for everyone' : '➡️ Loop off');
    } catch {
      toast('Cannot reach the cafe right now', 'err');
    }
  });

  // optional: play the same song inside this page, kept in sync with the room
  function syncAudio() {
    const s = st.state;
    const np = s?.nowPlaying;
    if (!soundOn || !np || s.paused) {
      if (!sAudio.paused) sAudio.pause();
      return;
    }
    const want = (currentPosition() || 0) / 1000;
    if (sAudio.dataset.id !== np.id) {
      sAudio.dataset.id = np.id;
      sAudio.src = `/api/preview/${encodeURIComponent(np.id)}`;
      sAudio.addEventListener('loadedmetadata', function once() {
        sAudio.removeEventListener('loadedmetadata', once);
        try { sAudio.currentTime = Math.max(0, (currentPosition() || 0) / 1000); } catch { /* ignore */ }
      });
      sAudio.play().catch(() => {});
      return;
    }
    if (sAudio.paused || sAudio.ended) sAudio.play().catch(() => {});
    if (Number.isFinite(sAudio.duration) && Math.abs(sAudio.currentTime - want) > 3.5) {
      try { sAudio.currentTime = want; } catch { /* ignore */ }
    }
  }

  soundBtn.addEventListener('click', () => {
    soundOn = !soundOn;
    soundBtn.classList.toggle('on', soundOn);
    soundBtn.textContent = soundOn ? '🔊 Sound on' : '🔇 Sound';
    if (soundOn) {
      if (typeof stopPreview === 'function') stopPreview();
      sAudio.dataset.id = '';
      syncAudio();
    } else {
      sAudio.pause();
    }
  });

  /* ------------------------------ open / close / idle ------------------------------ */
  let isOpen = false;
  let calmT, idleT;
  let autoOn = store.get('saver-auto', '1') === '1';
  const autoBtn = $('#sAuto');
  const renderAuto = () => {
    autoBtn.textContent = autoOn ? '💤 Auto: on' : '💤 Auto: off';
    autoBtn.classList.toggle('on', autoOn);
  };
  renderAuto();
  autoBtn.addEventListener('click', () => {
    autoOn = !autoOn;
    store.set('saver-auto', autoOn ? '1' : '0');
    renderAuto();
    toast(autoOn ? '💤 Screensaver opens after 90s of no activity' : '💤 Auto screensaver is off');
  });

  let ticker, musicTicker;
  function open() {
    if (isOpen) return;
    isOpen = true;
    clearTimeout(idleT);
    saver.hidden = false;
    saver.setAttribute('aria-hidden', 'false');
    resize();
    tickClock(true);
    renderMusic();
    requestAnimationFrame(() => saver.classList.add('show'));
    last = performance.now();
    raf = requestAnimationFrame(frame);
    ticker = setInterval(() => tickClock(false), 1000);
    musicTicker = setInterval(() => { renderMusic(); syncAudio(); }, 300);
    wake();
    document.body.style.overflow = 'hidden';
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    saver.classList.remove('show');
    saver.setAttribute('aria-hidden', 'true');
    clearInterval(ticker); clearInterval(musicTicker);
    cancelAnimationFrame(raf);
    soundOn = false;
    soundBtn.classList.remove('on');
    soundBtn.textContent = '🔇 Sound';
    sAudio.pause();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    setTimeout(() => { if (!isOpen) saver.hidden = true; }, 750);
    document.body.style.overflow = '';
    armIdle();
  }

  function wake() {
    saver.classList.remove('calm');
    clearTimeout(calmT);
    calmT = setTimeout(() => saver.classList.add('calm'), CALM_MS);
  }

  function armIdle() {
    clearTimeout(idleT);
    if (!autoOn || isOpen) return;
    idleT = setTimeout(() => { if (autoOn && !document.hidden) open(); else armIdle(); }, IDLE_MS);
  }

  ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach((ev) =>
    window.addEventListener(ev, () => (isOpen ? wake() : armIdle()), { passive: true }),
  );
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen) close(); });
  addEventListener('resize', () => { if (isOpen) resize(); });

  $('#sClose').addEventListener('click', close);
  $('#sFull').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else saver.requestFullscreen?.().catch(() => toast('Fullscreen is not available here', 'err'));
  });
  const openBtn = $('#openSaver');
  if (openBtn) openBtn.addEventListener('click', open);

  armIdle();
  window.__saver = { open, close };
})();
