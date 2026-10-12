import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { config } from './config.js';
import { mimeOf } from './livemedia.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COOKIE = 'cafe_live';
const TOKEN_HOURS = 12;

export function mountLive(app, { hub, media }) {
  /* ------------------------------- auth (PIN) ------------------------------- */
  const secret = crypto
    .createHash('sha256')
    .update(`cafe-live:${config.liveSecret || config.controlPin}`)
    .digest();
  const b64 = (b) => Buffer.from(b).toString('base64url');
  const sign = (payload) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

  function makeToken() {
    const payload = b64(JSON.stringify({ exp: Date.now() + TOKEN_HOURS * 3600_000 }));
    return `${payload}.${sign(payload)}`;
  }

  function validToken(tok) {
    if (!tok || !config.controlPin) return false;
    const [payload, mac] = String(tok).split('.');
    if (!payload || !mac) return false;
    const want = Buffer.from(sign(payload));
    const got = Buffer.from(mac);
    if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return false;
    try { return JSON.parse(Buffer.from(payload, 'base64url').toString()).exp > Date.now(); } catch { return false; }
  }

  const cookies = (req) => {
    const out = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  };
  const authed = (req) => validToken(cookies(req)[COOKIE]);
  const needAuth = (req, res, next) => (authed(req) ? next() : res.status(401).json({ ok: false, error: 'Locked — enter the PIN' }));

  const fails = new Map(); // ip -> { n, until }
  function samePin(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
  }

  app.get('/api/live/me', (req, res) => {
    res.json({ pinConfigured: Boolean(config.controlPin), authed: authed(req), ytKeySet: Boolean(config.ytApiKey) });
  });

  app.post('/api/live/login', (req, res) => {
    if (!config.controlPin) {
      return res.status(503).json({ ok: false, error: 'CONTROL_PIN is not set on the server yet.' });
    }
    const f = fails.get(req.ip) || { n: 0, until: 0 };
    if (f.until > Date.now()) {
      return res.status(429).json({ ok: false, error: `Too many tries. Wait ${Math.ceil((f.until - Date.now()) / 1000)}s.` });
    }
    if (!samePin(req.body?.pin ?? '', config.controlPin)) {
      f.n++;
      if (f.n >= 5) { f.until = Date.now() + 5 * 60_000; f.n = 0; }
      fails.set(req.ip, f);
      return res.status(401).json({ ok: false, error: 'Wrong PIN' });
    }
    fails.delete(req.ip);
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.setHeader(
      'Set-Cookie',
      `${COOKIE}=${encodeURIComponent(makeToken())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${TOKEN_HOURS * 3600}${secure ? '; Secure' : ''}`,
    );
    res.json({ ok: true });
  });

  app.post('/api/live/logout', (_req, res) => {
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.json({ ok: true });
  });

  /* ------------------------------ realtime (SSE) ------------------------------ */
  const overlay = new Set();
  const control = new Set();
  const write = (set, event, data) => {
    if (!set.size) return;
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const r of set) r.write(msg);
  };

  hub.on('event', (name, data, controlOnly) => {
    if (!controlOnly) write(overlay, name, data);
    write(control, name, data);
  });
  const pushState = () => {
    if (overlay.size) write(overlay, 'state', hub.snapshot(false));
    if (control.size) write(control, 'state', hub.snapshot(true));
  };
  hub.on('state', pushState);
  setInterval(pushState, 20_000);
  setInterval(() => { for (const r of [...overlay, ...control]) r.write(': ping\n\n'); }, 15_000);

  function sse(set, snapFor) {
    return (req, res) => {
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      res.write(`retry: 2000\nevent: state\ndata: ${JSON.stringify(snapFor())}\n\n`);
      set.add(res);
      req.on('close', () => set.delete(res));
    };
  }
  app.get('/api/live/stream', sse(overlay, () => hub.snapshot(false)));
  app.get('/api/live/control/stream', needAuth, sse(control, () => hub.snapshot(true)));

  /* --------------------------------- control API --------------------------------- */
  app.post('/api/live/cmd', needAuth, async (req, res) => {
    try {
      const out = await hub.command(req.body || {});
      res.status(out?.ok === false ? 400 : 200).json(out ?? { ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.patch('/api/live/settings', needAuth, (req, res) => {
    hub.updateSettings(req.body || {});
    res.json({ ok: true });
  });

  app.get('/api/live/control/tracks', needAuth, (_req, res) => {
    res.json(hub.tracks().map(({ id, title, group, source }) => ({ id, title, group, source })));
  });

  /* the overlay reports "song finished" (cannot do anything except move to the next song) */
  const ended = new Map();
  app.post('/api/live/overlay/music-ended', (req, res) => {
    const now = Date.now();
    const last = ended.get(req.ip) || 0;
    if (now - last < 1500) return res.json({ ok: true });
    ended.set(req.ip, now);
    hub.musicEnded(Number(req.body?.seq));
    res.json({ ok: true });
  });

  /* ------------------------------ media (Range proxy) ------------------------------ */
  app.get('/api/live/media/:id', async (req, res) => {
    const item = media.items.get(req.params.id);
    if (!item) return res.sendStatus(404);
    let up;
    try {
      const url = await media.freshUrl(item);
      const headers = {};
      if (req.headers.range) headers.Range = req.headers.range;
      up = await fetch(url, { headers });
    } catch {
      return res.sendStatus(502);
    }
    if (!up.body || up.status >= 400) return res.sendStatus(502);
    res.status(up.status);
    const ct = up.headers.get('content-type');
    res.setHeader('Content-Type', ct && /^(video|audio|image)\//.test(ct) ? ct : mimeOf(item.name, item.type));
    for (const h of ['content-length', 'content-range', 'accept-ranges']) {
      const v = up.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const body = Readable.fromWeb(up.body);
    body.on('error', () => res.destroy());
    res.on('close', () => body.destroy());
    body.pipe(res);
  });

  /* ---------------------------------- pages ---------------------------------- */
  const page = (file, noStore = true) => (_req, res) => {
    if (noStore) res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, file));
  };
  app.get(['/overlay', '/overlay/'], page('overlay.html'));
  app.get(['/control-live', '/control-live/'], page('control.html'));
  app.get(['/contro-livel', '/control-livel', '/controllive'], (_req, res) => res.redirect('/control-live'));
  for (const f of ['overlay.css', 'overlay.js', 'control.css', 'control.js']) app.get(`/Live/${f}`, page(f, false));
}
