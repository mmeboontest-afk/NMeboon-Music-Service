import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import express from 'express';
import { config } from './config.js';
import { guessMime } from './library.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function startWeb({ library, player, stats }) {
  const app = express();
  if (config.trustProxy) app.set('trust proxy', true);
  app.disable('x-powered-by');
  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  app.use(express.json({ limit: '4kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  /* ----------------------------- SSE ----------------------------- */
  const clients = new Set();
  const send = (event, data) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) res.write(msg);
  };

  let statePending = false;
  player.on('update', () => {
    if (statePending) return;
    statePending = true;
    setTimeout(() => {
      statePending = false;
      send('state', player.snapshot());
    }, 80);
  });

  let libPending = false;
  const notifyLibrary = () => {
    if (libPending) return;
    libPending = true;
    setTimeout(() => {
      libPending = false;
      send('library', {});
    }, 1000);
  };
  library.on('update', notifyLibrary);
  stats.on('change', notifyLibrary);
  library.on('newtrack', (t) => send('newtrack', player.publicTrack(t)));

  setInterval(() => send('state', player.snapshot()), 15_000); // resync progress
  setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 20_000);

  app.get('/api/events', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write(`event: state\ndata: ${JSON.stringify(player.snapshot())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  });

  /* ----------------------------- API ----------------------------- */
  app.get('/api/state', (_req, res) => res.json(player.snapshot()));

  app.get('/api/library', (_req, res) => {
    const counts = {};
    const tracks = [...library.tracks.values()].map((t) => {
      counts[t.channelId] = (counts[t.channelId] || 0) + 1;
      return {
        id: t.id,
        title: t.title,
        channelId: t.channelId,
        channel: t.channelName,
        createdAt: t.createdAt,
        isNew: library.isNew(t),
        requests: stats.requests(t.id),
        plays: stats.plays(t.id),
      };
    });
    const channels = [...library.channels.values()]
      .sort((a, b) => a.position - b.position)
      .map((c) => ({ id: c.id, name: c.name, count: counts[c.id] || 0 }));
    res.json({ ready: library.ready, channels, tracks });
  });

  // simple in-memory rate limit per IP
  const hits = new Map();
  const limited = (ip) => {
    const now = Date.now();
    const windowMs = config.rateLimitWindowSec * 1000;
    const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    if (list.length >= config.rateLimitCount) {
      hits.set(ip, list);
      return true;
    }
    list.push(now);
    hits.set(ip, list);
    return false;
  };
  setInterval(() => {
    const now = Date.now();
    for (const [ip, list] of hits) {
      if (!list.some((t) => now - t < config.rateLimitWindowSec * 1000)) hits.delete(ip);
    }
  }, 60_000);

  app.post('/api/queue', (req, res) => {
    if (limited(req.ip)) {
      return res.status(429).json({ ok: false, error: 'Slow down a little, kitty! Try again in a moment.' });
    }
    const trackId = String(req.body?.trackId ?? '');
    let nick = String(req.body?.nickname ?? '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trim()
      .slice(0, 24);
    if (!nick) nick = 'Guest cat';
    const result = player.enqueue(trackId, nick);
    res.status(result.ok ? 200 : 400).json(result);
  });

  // 30s preview proxy (supports Range so the browser can seek)
  app.get('/api/preview/:id', async (req, res) => {
    const track = library.tracks.get(req.params.id);
    if (!track) return res.sendStatus(404);
    let upstream;
    try {
      const url = await library.freshUrl(track);
      const headers = {};
      if (req.headers.range) headers.Range = req.headers.range;
      upstream = await fetch(url, { headers });
    } catch {
      return res.sendStatus(502);
    }
    if (!upstream.body || upstream.status >= 400) return res.sendStatus(502);

    res.status(upstream.status);
    const type = upstream.headers.get('content-type');
    res.setHeader('Content-Type', type && type.startsWith('audio/') ? type : guessMime(track.filename));
    for (const h of ['content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const body = Readable.fromWeb(upstream.body);
    body.on('error', () => res.destroy());
    res.on('close', () => body.destroy());
    body.pipe(res);
  });

  const server = app.listen(config.port, () => {
    console.log(`[web] Cat Cafe is open at http://localhost:${config.port}`);
  });
  return server;
}
