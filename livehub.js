import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export const FONTS = [
  'Fredoka', 'Quicksand', 'Pacifico', 'Mali', 'Sriracha', 'Kanit', 'Prompt', 'Zen Maru Gothic',
  'DotGothic16', 'Press Start 2P', 'Caveat', 'Bangers', 'Chakra Petch',
];
const SCENES = ['prep', 'live', 'brb', 'ending', 'off'];

export const DEFAULTS = {
  transition: { enabled: true, mediaId: null, cutMs: 0, muted: true }, // cutMs 0 = half of the video
  prep: {
    enabled: true, mediaId: null, blend: 'normal',
    title: 'Starting soon', subtitle: 'Grab a warm drink — the cat DJ is warming up',
  },
  widgets: { chat: true, stats: true, nowPlaying: true, mascot: true, petals: true, clock: true, captions: true, alerts: true, topBar: true },
  chat: { side: 'left', max: 8, hideCommands: true, fadeSec: 0, size: 26 },
  alerts: { baseSec: 10, perTierSec: 5, maxSec: 90, sound: true, memberAlerts: true },
  tts: {
    output: 'overlay', voice: '', lang: 'auto', rate: 1, pitch: 1.1, volume: 1,
    readChat: 'off', readSuper: true, maxLen: 140, skipLinks: true, skipCommands: true,
    prefixName: true, cooldownMs: 2500, blockWords: [], blockedUsers: [], duck: true,
  },
  caption: {
    font: 'Fredoka', size: 64, color: '#fff7ea', stroke: '#8a5a3c',
    anim: 'pop', pos: 'bottom', holdSec: 6,
  },
  music: { volume: 0.45, shuffle: true, loop: false, source: 'all', autoStart: true },
  theme: { sky: 'auto' },
  yt: { videoId: '' },
};

const ENUMS = {
  'tts.output': ['overlay', 'control', 'off'],
  'tts.readChat': ['off', 'all', 'members', 'superchats'],
  'caption.anim': ['pop', 'typewriter', 'wave', 'bounce', 'fade'],
  'caption.pos': ['top', 'middle', 'bottom'],
  'chat.side': ['left', 'right'],
  'prep.blend': ['normal', 'screen', 'lighten', 'multiply'],
  'music.source': ['all', 'music', 'live'],
  'theme.sky': ['auto', 'day', 'sunset', 'night'],
};
const RANGES = {
  'transition.cutMs': [0, 20000], 'chat.max': [3, 14], 'chat.fadeSec': [0, 600], 'chat.size': [16, 44],
  'alerts.baseSec': [3, 60], 'alerts.perTierSec': [0, 30], 'alerts.maxSec': [5, 180],
  'tts.rate': [0.5, 2], 'tts.pitch': [0, 2], 'tts.volume': [0, 1], 'tts.maxLen': [20, 300], 'tts.cooldownMs': [0, 30000],
  'caption.size': [20, 220], 'caption.holdSec': [0, 120], 'music.volume': [0, 1],
};

const clone = (o) => JSON.parse(JSON.stringify(o));
const nid = (() => { let n = 0; return () => `${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 5)}`; })();
const URL_RE = /(https?:\/\/|www\.)\S+/gi;

function mergeKnown(cur, patch, def) {
  for (const k of Object.keys(patch || {})) {
    if (!(k in def)) continue;
    const d = def[k];
    const v = patch[k];
    if (Array.isArray(d)) { if (Array.isArray(v)) cur[k] = v.map((x) => String(x).slice(0, 60)).slice(0, 300); }
    else if (d && typeof d === 'object') { if (v && typeof v === 'object') mergeKnown(cur[k], v, d); }
    else if (typeof d === 'number') { const n = Number(v); if (Number.isFinite(n)) cur[k] = n; }
    else if (typeof d === 'boolean') cur[k] = Boolean(v);
    else if (typeof v === 'string') cur[k] = v.slice(0, 500);
    else if (v === null && d === null) cur[k] = null;
  }
}

function sanitize(s) {
  for (const [p, list] of Object.entries(ENUMS)) {
    const [a, b] = p.split('.');
    if (!list.includes(s[a][b])) s[a][b] = DEFAULTS[a][b];
  }
  for (const [p, [lo, hi]] of Object.entries(RANGES)) {
    const [a, b] = p.split('.');
    s[a][b] = Math.min(hi, Math.max(lo, Number(s[a][b])));
  }
  if (!FONTS.includes(s.caption.font)) s.caption.font = DEFAULTS.caption.font;
  for (const k of ['color', 'stroke']) if (!/^#[0-9a-f]{6}$/i.test(s.caption[k])) s.caption[k] = DEFAULTS.caption[k];
  return s;
}

function lang(text) {
  if (/[฀-๿]/.test(text)) return 'th-TH';
  if (/[぀-ヿ]/.test(text)) return 'ja-JP';
  if (/[가-힯]/.test(text)) return 'ko-KR';
  if (/[一-鿿]/.test(text)) return 'zh-CN';
  return 'en-US';
}

export class LiveHub extends EventEmitter {
  constructor({ yt, media, library }) {
    super();
    this.yt = yt;
    this.media = media;
    this.library = library;
    this.settings = clone(DEFAULTS);
    this.scene = 'off';
    this.sceneSeq = 0;
    this.session = null;
    this.history = [];
    this.chat = [];
    this.pinned = null;
    this.caption = null;
    this.alertQueue = [];
    this.alert = null;
    this.clip = null;
    this.prepCountdownEnd = 0;
    this.logs = [];
    this.stats = { viewers: null, subs: null, views: null, likes: null };
    this.music = { track: null, playing: false, seq: 0, queue: [] };
    this.recentTracks = [];
    this.lastChatTts = 0;
    this.#loadLocal();

    yt.on('messages', (list, backfill) => this.ingest(list, backfill));
    yt.on('stats', (s) => this.#onStats(s));
    yt.on('status', (i) => { this.log(`YouTube: ${i.status}${i.error ? ' — ' + i.error : ''}`, i.status === 'error' ? 'err' : 'info'); this.dirty(); });
    yt.on('ended', () => this.log('The YouTube live chat has ended. Press “End live” when you are done.', 'warn'));
    media.on('update', () => this.dirty());
    library.on('update', () => this.dirty());
  }

  /* ------------------------------ persistence ------------------------------ */

  get #settingsFile() { return path.resolve(config.dataDir, 'live-settings.json'); }
  get #historyFile() { return path.resolve(config.dataDir, 'live-history.json'); }

  #loadLocal() {
    try { mergeKnown(this.settings, JSON.parse(fs.readFileSync(this.#settingsFile, 'utf8')), DEFAULTS); sanitize(this.settings); } catch { /* first run */ }
    try { this.history = JSON.parse(fs.readFileSync(this.#historyFile, 'utf8')); } catch { /* first run */ }
  }

  #saveLocal() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => {
      try {
        fs.mkdirSync(config.dataDir, { recursive: true });
        fs.writeFileSync(this.#settingsFile, JSON.stringify(this.settings));
        fs.writeFileSync(this.#historyFile, JSON.stringify(this.history.slice(-300)));
      } catch (e) { console.warn('[live] cannot save locally:', e.message); }
    }, 1500);
  }

  /** after Discord is ready: bring back lives saved in the storage channel */
  async restore() {
    const remote = await this.media.loadHistory();
    const byId = new Map(this.history.map((h) => [h.id, h]));
    for (const r of remote) byId.set(r.id, { ...byId.get(r.id), ...r });
    this.history = [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
    const open = [...this.history].reverse().find((h) => h.status === 'live' && Date.now() - h.startedAt < 24 * 3600_000);
    if (open && !this.session) {
      this.session = this.#fromSummary(open);
      this.scene = 'live';
      this.sceneSeq++;
      this.log(`Restored the live “${open.title}” that was still running.`, 'info');
      this.#startCheckpoints();
    }
    this.history = this.history.filter((h) => h.status !== 'live' || h.id === this.session?.id);
    this.#saveLocal();
    this.dirty();
  }

  /* --------------------------------- logging -------------------------------- */

  log(text, kind = 'info') {
    const e = { at: Date.now(), text, kind };
    this.logs.push(e);
    if (this.logs.length > 80) this.logs.shift();
    this.emit('event', 'log', e, true);
  }

  dirty() {
    if (this._dirty) return;
    this._dirty = setTimeout(() => { this._dirty = null; this.emit('state'); }, 150);
  }

  /* --------------------------------- settings -------------------------------- */

  updateSettings(patch) {
    mergeKnown(this.settings, patch, DEFAULTS);
    sanitize(this.settings);
    this.#saveLocal();
    if (patch?.music?.volume !== undefined || patch?.music?.loop !== undefined) this.emit('event', 'music', this.#musicPayload());
    this.dirty();
  }

  /* --------------------------------- scenes --------------------------------- */

  setScene(scene, transition = true) {
    if (!SCENES.includes(scene)) return { ok: false, error: 'Unknown scene' };
    this.scene = scene;
    this.sceneSeq++;
    this.emit('event', 'scene', { scene, seq: this.sceneSeq, transition: Boolean(transition && this.settings.transition.enabled) });
    this.log(`Scene → ${scene}`);
    this.dirty();
    return { ok: true };
  }

  /* --------------------------------- session -------------------------------- */

  #blank(title, videoId) {
    return {
      id: nid(), status: 'live', title: title || 'Untitled live', videoId: videoId || '', channelTitle: '',
      startedAt: Date.now(), endedAt: null,
      peak: 0, samples: [], viewers: null,
      subsStart: null, subsNow: null, subsHidden: false, viewsStart: null, viewsNow: null, likes: 0,
      comments: 0, chatters: new Set(), chattersBase: 0,
      byCurrency: {}, scCount: 0, stickerCount: 0, supporters: new Map(),
      members: { new: 0, milestones: 0, gifts: 0 }, tracks: [], messageId: null,
    };
  }

  #fromSummary(h) {
    const s = this.#blank(h.title, h.videoId);
    Object.assign(s, {
      id: h.id, startedAt: h.startedAt, channelTitle: h.channelTitle || '', peak: h.peakViewers || 0,
      subsStart: h.subs?.start ?? null, subsNow: h.subs?.end ?? null, viewsStart: h.views?.start ?? null, viewsNow: h.views?.end ?? null,
      likes: h.likes || 0, comments: h.comments || 0, chattersBase: h.uniqueChatters || 0,
      byCurrency: { ...(h.superChats?.byCurrency || {}) }, scCount: h.superChats?.count || 0, stickerCount: h.superChats?.stickers || 0,
      members: { new: 0, milestones: 0, gifts: 0, ...(h.members || {}) }, tracks: h.tracks || [], messageId: h._messageId || null,
    });
    if (h.avgViewers) s.samples = [h.avgViewers];
    for (const t of h.superChats?.top || []) s.supporters.set(t.name, { name: t.name, byCurrency: { ...t.byCurrency }, count: t.count || 1 });
    return s;
  }

  #summary(s = this.session) {
    if (!s) return null;
    const end = s.endedAt || Date.now();
    const top = [...s.supporters.values()]
      .sort((a, b) => Object.values(b.byCurrency).reduce((x, y) => x + y, 0) - Object.values(a.byCurrency).reduce((x, y) => x + y, 0))
      .slice(0, 10);
    const avg = s.samples.length ? Math.round(s.samples.reduce((a, b) => a + b, 0) / s.samples.length) : 0;
    return {
      v: 1, id: s.id, status: s.status, title: s.title, videoId: s.videoId, channelTitle: s.channelTitle,
      startedAt: s.startedAt, endedAt: s.endedAt, durationSec: Math.round((end - s.startedAt) / 1000),
      peakViewers: s.peak, avgViewers: avg,
      subs: { start: s.subsStart, end: s.subsNow, gained: s.subsStart != null && s.subsNow != null ? s.subsNow - s.subsStart : 0, hidden: s.subsHidden },
      views: { start: s.viewsStart, end: s.viewsNow, gained: s.viewsStart != null && s.viewsNow != null ? s.viewsNow - s.viewsStart : 0 },
      likes: s.likes, comments: s.comments, uniqueChatters: s.chattersBase + s.chatters.size,
      superChats: { count: s.scCount, stickers: s.stickerCount, byCurrency: s.byCurrency, top },
      members: s.members, tracks: s.tracks.slice(-60),
    };
  }

  #startCheckpoints() {
    clearInterval(this._cp);
    this._cp = setInterval(() => this.#checkpoint(), 120_000);
  }

  async #checkpoint() {
    if (!this.session) return;
    const id = await this.media.save(this.#summary(), this.session.messageId);
    if (id) this.session.messageId = id;
    this.#upsertHistory(this.#summary());
  }

  #upsertHistory(sum) {
    const i = this.history.findIndex((h) => h.id === sum.id);
    if (i >= 0) this.history[i] = { ...this.history[i], ...sum }; else this.history.push(sum);
    this.#saveLocal();
  }

  async startLive({ title, videoId } = {}) {
    if (this.session?.status === 'live') return { ok: false, error: 'A live is already running — end it first' };
    const vid = String(videoId || this.settings.yt.videoId || config.ytVideoId || '').trim();
    this.session = this.#blank(String(title || '').slice(0, 120) || 'Untitled live', vid);
    this.chat = [];
    this.alertQueue = [];
    this.stats = { viewers: null, subs: null, views: null, likes: null };
    this.log(`Live started: “${this.session.title}”`);
    this.setScene('prep', false);
    this.#startCheckpoints();
    this.#checkpoint();
    if (this.settings.music.autoStart && !this.music.playing) this.musicCmd({ action: 'next' });
    let ytError = null;
    if (vid) {
      try { await this.yt.connect(vid); } catch (e) { ytError = e.message; }
    }
    this.dirty();
    return { ok: true, ytError };
  }

  async endLive() {
    const s = this.session;
    if (!s || s.status !== 'live') return { ok: false, error: 'No live is running' };
    s.status = 'ended';
    s.endedAt = Date.now();
    clearInterval(this._cp);
    this.yt.disconnect();
    this.setScene('ending', true);
    const sum = this.#summary();
    const id = await this.media.save(sum, s.messageId);
    if (id) s.messageId = id;
    this.#upsertHistory({ ...sum, _messageId: s.messageId });
    this.log(`Live saved${id ? ' to Discord storage' : ' locally (no Discord storage)'}: ${sum.comments} comments, ${sum.peakViewers} peak viewers`, 'info');
    this.dirty();
    return { ok: true, summary: sum, savedToDiscord: Boolean(id) };
  }

  /* ---------------------------------- YouTube ---------------------------------- */

  #onStats(s) {
    if (s.viewers != null) this.stats.viewers = s.viewers;
    if (s.views != null) this.stats.views = s.views;
    if (s.likes != null) this.stats.likes = s.likes;
    if (s.subs != null) this.stats.subs = s.subs;
    const ses = this.session;
    if (ses?.status === 'live') {
      ses.channelTitle = this.yt.channelTitle || ses.channelTitle;
      if (s.viewers != null) { ses.viewers = s.viewers; ses.peak = Math.max(ses.peak, s.viewers); ses.samples.push(s.viewers); if (ses.samples.length > 2000) ses.samples.shift(); }
      if (s.views != null) { if (ses.viewsStart == null) ses.viewsStart = s.views; ses.viewsNow = s.views; }
      if (s.subs != null) { if (ses.subsStart == null) ses.subsStart = s.subs; ses.subsNow = s.subs; }
      ses.subsHidden = s.subsHidden;
      if (s.likes != null) ses.likes = s.likes;
    }
    this.dirty();
  }

  async connectYouTube(input) {
    try {
      await this.yt.connect(input);
      this.settings.yt.videoId = this.yt.videoId || '';
      if (this.session) this.session.videoId = this.yt.videoId;
      this.#saveLocal();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /* ----------------------------------- chat ----------------------------------- */

  ingest(list, backfill = false) {
    for (const m of list) {
      if (m.kind === 'deleted') { this.hideChat(m.targetId); continue; }
      this.#addMessage(m, backfill);
    }
    this.dirty();
  }

  #addMessage(m, backfill) {
    this.chat.push(m);
    if (this.chat.length > 200) this.chat.shift();
    const s = this.session?.status === 'live' && !m.test ? this.session : null;
    if (s) {
      if (m.kind === 'chat' || m.kind === 'superchat' || m.kind === 'sticker') { s.comments++; if (m.channelId) s.chatters.add(m.channelId); }
      if (m.kind === 'superchat' || m.kind === 'sticker') {
        if (m.kind === 'superchat') s.scCount++; else s.stickerCount++;
        const cur = m.amount.currency || '?';
        s.byCurrency[cur] = Math.round(((s.byCurrency[cur] || 0) + m.amount.value) * 100) / 100;
        const sup = s.supporters.get(m.author) || { name: m.author, byCurrency: {}, count: 0 };
        sup.byCurrency[cur] = Math.round(((sup.byCurrency[cur] || 0) + m.amount.value) * 100) / 100;
        sup.count++;
        s.supporters.set(m.author, sup);
      }
      if (m.kind === 'member') s.members.new++;
      if (m.kind === 'milestone') s.members.milestones++;
      if (m.kind === 'gift') s.members.gifts += m.count || 1;
    }
    this.emit('event', 'chat', m);
    if (backfill) return;

    if (m.kind === 'superchat' || m.kind === 'sticker') this.#enqueueAlert(m);
    else if ((m.kind === 'member' || m.kind === 'milestone' || m.kind === 'gift') && this.settings.alerts.memberAlerts) this.#enqueueAlert(m);
    else if (m.kind === 'chat') this.#maybeReadChat(m);
  }

  hideChat(id) {
    const m = this.chat.find((x) => x.id === id);
    if (m) m.hidden = true;
    if (this.pinned?.id === id) this.pin(null);
    this.emit('event', 'chat-del', { id });
  }

  clearChat() {
    this.chat = [];
    this.emit('event', 'chat-clear', {});
    this.dirty();
  }

  pin(msgOrId) {
    this.pinned = typeof msgOrId === 'string' ? this.chat.find((x) => x.id === msgOrId) || null : msgOrId;
    this.emit('event', 'pin', this.pinned);
    this.dirty();
  }

  /* ------------------------------------ TTS ------------------------------------ */

  #speak(text, { kind = 'chat', priority = 'normal' } = {}) {
    const t = this.settings.tts;
    if (t.output === 'off' || !text) return;
    const clean = String(text).replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!clean) return;
    this.emit('event', 'tts', {
      id: nid(), text: clean, kind, priority, output: t.output,
      voice: t.voice, lang: t.lang === 'auto' ? lang(clean) : t.lang, rate: t.rate, pitch: t.pitch, volume: t.volume, duck: t.duck,
    });
  }

  #maybeReadChat(m) {
    const t = this.settings.tts;
    if (t.readChat === 'off' || t.readChat === 'superchats') return;
    if (t.readChat === 'members' && !(m.badges.member || m.badges.mod || m.badges.owner)) return;
    if (t.blockedUsers.some((u) => u.toLowerCase() === m.author.toLowerCase())) return;
    let text = m.text;
    if (t.skipCommands && text.trim().startsWith('!')) return;
    if (t.skipLinks) text = text.replace(URL_RE, ' ');
    text = text.trim();
    if (!text) return;
    if (t.blockWords.some((w) => w && text.toLowerCase().includes(w.toLowerCase()))) return;
    if (Date.now() - this.lastChatTts < t.cooldownMs) return;
    this.lastChatTts = Date.now();
    if (text.length > t.maxLen) text = `${text.slice(0, t.maxLen)}…`;
    this.#speak(t.prefixName ? `${m.author} says ${text}` : text, { kind: 'chat' });
  }

  sayChat(id) {
    const m = this.chat.find((x) => x.id === id);
    if (!m) return { ok: false, error: 'Message not found' };
    this.#speak(`${m.author} says ${m.text}`, { kind: 'chat', priority: 'high' });
    return { ok: true };
  }

  /* ---------------------------------- alerts ---------------------------------- */

  #alertSpeech(m) {
    const t = this.settings.tts;
    const who = m.author;
    const clean = (x) => (t.skipLinks ? String(x || '').replace(URL_RE, ' ') : String(x || '')).trim().slice(0, t.maxLen);
    switch (m.kind) {
      case 'superchat': return `${who} sent ${m.amount.display || m.amount.value + ' ' + m.amount.currency}. ${clean(m.text)}`;
      case 'sticker': return `${who} sent a Super Sticker, ${m.amount.display}.`;
      case 'member': return `Welcome ${who}, our newest member!`;
      case 'milestone': return `${who} has been a member for ${m.months} months. ${clean(m.text)}`;
      case 'gift': return `${who} gifted ${m.count} memberships. Thank you!`;
      default: return '';
    }
  }

  #enqueueAlert(m) {
    const a = this.settings.alerts;
    const tier = m.amount?.tier || 1;
    let ms = m.amount ? (a.baseSec + a.perTierSec * (tier - 1)) * 1000 : 8000;
    ms = Math.min(ms, a.maxSec * 1000);
    const speech = this.settings.tts.readSuper ? this.#alertSpeech(m) : '';
    if (speech && this.settings.tts.output !== 'off') ms = Math.max(ms, speech.length * 75 + 2200);
    this.alertQueue.push({
      id: nid(), kind: m.kind, msgId: m.id, author: m.author, avatar: m.avatar, text: m.text,
      amount: m.amount || null, tier, months: m.months, count: m.count, level: m.level, test: Boolean(m.test),
      durationMs: ms, speech,
    });
    this.#pumpAlerts();
  }

  #pumpAlerts() {
    if (this.alert || !this.alertQueue.length) return;
    const a = this.alertQueue.shift();
    a.startedAt = Date.now();
    a.endsAt = a.startedAt + a.durationMs;
    this.alert = a;
    if (this.settings.widgets.alerts) this.emit('event', 'alert', a);
    if (a.speech) this.#speak(a.speech, { kind: 'alert', priority: 'high' });
    this._alertT = setTimeout(() => this.#endAlert(a.id), this.settings.widgets.alerts ? a.durationMs : 100);
    this.dirty();
  }

  #endAlert(id) {
    if (this.alert?.id !== id) return;
    this.emit('event', 'alert-end', { id });
    this.alert = null;
    this.dirty();
    setTimeout(() => this.#pumpAlerts(), 700);
  }

  skipAlert() {
    if (!this.alert) return { ok: false, error: 'No alert is showing' };
    clearTimeout(this._alertT);
    this.emit('event', 'tts-stop', {});
    this.#endAlert(this.alert.id);
    return { ok: true };
  }

  /* --------------------------------- captions --------------------------------- */

  say({ text, mode = 'both', style = {} } = {}) {
    const raw = String(text || '').trim().slice(0, 300);
    if (!raw) return { ok: false, error: 'Type something first' };
    const base = this.settings.caption;
    const f = FONTS.includes(style.font) ? style.font : base.font;
    const hold = Number.isFinite(Number(style.holdSec)) ? Math.min(120, Math.max(0, Number(style.holdSec))) : base.holdSec;
    if (mode === 'text' || mode === 'both') {
      clearTimeout(this._capT);
      this.caption = {
        id: nid(), text: raw, font: f,
        size: Math.min(220, Math.max(20, Number(style.size) || base.size)),
        color: /^#[0-9a-f]{6}$/i.test(style.color) ? style.color : base.color,
        stroke: /^#[0-9a-f]{6}$/i.test(style.stroke) ? style.stroke : base.stroke,
        anim: ENUMS['caption.anim'].includes(style.anim) ? style.anim : base.anim,
        pos: ENUMS['caption.pos'].includes(style.pos) ? style.pos : base.pos,
        holdSec: hold,
      };
      this.emit('event', 'caption', this.caption);
      if (hold > 0) this._capT = setTimeout(() => this.clearCaption(), hold * 1000);
    }
    if (mode === 'speak' || mode === 'both') this.#speak(raw, { kind: 'say', priority: 'high' });
    this.dirty();
    return { ok: true };
  }

  clearCaption() {
    clearTimeout(this._capT);
    this.caption = null;
    this.emit('event', 'caption-clear', {});
    this.dirty();
  }

  /* ----------------------------------- music ----------------------------------- */

  tracks() {
    const src = this.settings.music.source;
    const out = [];
    if (src !== 'live') {
      for (const t of this.library.tracks.values()) {
        out.push({ id: `m:${t.id}`, title: t.title, group: `#${t.channelName}`, src: `/api/preview/${encodeURIComponent(t.id)}`, source: 'music' });
      }
    }
    if (src !== 'music') {
      for (const i of this.media.items.values()) {
        if (i.kind === 'audio') out.push({ id: `l:${i.id}`, title: i.base, group: 'Live folder', src: `/api/live/media/${encodeURIComponent(i.id)}`, source: 'live' });
      }
    }
    return out;
  }

  #musicPayload() {
    return { track: this.music.track, playing: this.music.playing, seq: this.music.seq, volume: this.settings.music.volume, loop: this.settings.music.loop, queue: this.music.queue.length };
  }

  #setTrack(t) {
    this.music.track = t ? { id: t.id, title: t.title, src: t.src, source: t.source, group: t.group } : null;
    this.music.playing = Boolean(t);
    this.music.seq++;
    if (t) {
      this.recentTracks.push(t.id);
      if (this.recentTracks.length > 20) this.recentTracks.shift();
      this.session?.tracks.push(t.title);
    }
    this.emit('event', 'music', this.#musicPayload());
    this.dirty();
  }

  #pickNext() {
    const all = this.tracks();
    if (!all.length) return null;
    if (!this.settings.music.shuffle) {
      const i = all.findIndex((t) => t.id === this.music.track?.id);
      return all[(i + 1) % all.length];
    }
    const recent = new Set(this.recentTracks.slice(-Math.min(10, all.length - 1)));
    const pool = all.filter((t) => !recent.has(t.id));
    return (pool.length ? pool : all)[Math.floor(Math.random() * (pool.length || all.length))];
  }

  musicCmd({ action, trackId } = {}) {
    const all = () => this.tracks();
    switch (action) {
      case 'play': {
        if (trackId) {
          const t = all().find((x) => x.id === trackId);
          if (!t) return { ok: false, error: 'Track not found' };
          this.#setTrack(t);
        } else if (this.music.track) {
          this.music.playing = true; this.emit('event', 'music', this.#musicPayload());
        } else this.#setTrack(this.#pickNext());
        break;
      }
      case 'pause': this.music.playing = false; this.emit('event', 'music', this.#musicPayload()); break;
      case 'stop': this.#setTrack(null); break;
      case 'next': {
        const q = this.music.queue.shift();
        const t = q ? all().find((x) => x.id === q) : this.#pickNext();
        this.#setTrack(t || null);
        break;
      }
      case 'queue': {
        const t = all().find((x) => x.id === trackId);
        if (!t) return { ok: false, error: 'Track not found' };
        this.music.queue.push(t.id);
        if (!this.music.track) return this.musicCmd({ action: 'next' });
        break;
      }
      case 'queue-clear': this.music.queue = []; break;
      default: return { ok: false, error: 'Unknown music action' };
    }
    this.dirty();
    return { ok: true };
  }

  /** the overlay tells us the song ended */
  musicEnded(seq) {
    if (seq !== this.music.seq || !this.music.playing) return;
    if (this.settings.music.loop && this.music.track) { this.music.seq++; this.emit('event', 'music', this.#musicPayload()); return; }
    this.musicCmd({ action: 'next' });
  }

  /* ------------------------------------ media ------------------------------------ */

  #role(id, re, kinds) {
    let it = id ? this.media.items.get(id) : null;
    if (!it) it = [...this.media.items.values()].find((i) => kinds.includes(i.kind) && re.test(i.base)) || null;
    return it ? { id: it.id, name: it.name, kind: it.kind, url: `/api/live/media/${encodeURIComponent(it.id)}`, type: it.type } : null;
  }

  roles() {
    return {
      prep: this.#role(this.settings.prep.mediaId, /setlivescreen|set.?live.?screen/i, ['video']),
      transition: this.#role(this.settings.transition.mediaId, /^(translation|transition)/i, ['video']),
    };
  }

  showClip({ mediaId, seconds = 0, mode = 'center', loop = false, muted = false }) {
    const it = this.media.items.get(mediaId);
    if (!it || it.kind === 'audio') return { ok: false, error: 'Pick a video or an image' };
    clearTimeout(this._clipT);
    this.clip = {
      id: nid(), mediaId, kind: it.kind, name: it.name, url: `/api/live/media/${encodeURIComponent(it.id)}`,
      mode: mode === 'full' ? 'full' : 'center', loop: Boolean(loop), muted: Boolean(muted), seconds: Math.min(600, Math.max(0, Number(seconds) || 0)),
    };
    this.emit('event', 'media', this.clip);
    if (this.clip.seconds > 0) this._clipT = setTimeout(() => this.hideClip(), this.clip.seconds * 1000);
    this.dirty();
    return { ok: true };
  }

  hideClip() {
    clearTimeout(this._clipT);
    this.clip = null;
    this.emit('event', 'media-hide', {});
    this.dirty();
  }

  /* ---------------------------------- test data ---------------------------------- */

  test(kind, p = {}) {
    const names = ['Mochi', 'Sakura', 'Ryo', 'Nina', 'Pim', 'Taro', 'Luna', 'Kenji'];
    const who = String(p.author || '').slice(0, 40) || names[Math.floor(Math.random() * names.length)];
    const base = { id: `test-${nid()}`, author: who, channelId: '', avatar: '', badges: { owner: false, mod: false, member: false, verified: false }, at: Date.now(), test: true };
    const text = String(p.text || '').slice(0, 200);
    const value = Math.max(0, Number(p.value) || 5);
    const tier = Math.min(11, Math.max(1, Number(p.tier) || (value >= 100 ? 7 : value >= 50 ? 6 : value >= 20 ? 5 : value >= 10 ? 4 : value >= 5 ? 3 : 2)));
    const cur = String(p.currency || 'USD').slice(0, 4).toUpperCase();
    const amount = { micros: value * 1e6, value, currency: cur, display: `${cur} ${value}`, tier };
    switch (kind) {
      case 'chat': this.#addMessage({ ...base, kind: 'chat', text: text || 'Hello from the cat cafe! 🐱' }, false); break;
      case 'superchat': this.#addMessage({ ...base, kind: 'superchat', text: text || 'Love the stream! Keep it up 💖', amount }, false); break;
      case 'sticker': this.#addMessage({ ...base, kind: 'sticker', text: 'Super Sticker', amount }, false); break;
      case 'member': this.#addMessage({ ...base, kind: 'member', text: 'New member' }, false); break;
      case 'milestone': this.#addMessage({ ...base, kind: 'milestone', text, months: 6, level: 'Cat Club' }, false); break;
      case 'gift': this.#addMessage({ ...base, kind: 'gift', count: 5, text: 'Cat Club' }, false); break;
      default: return { ok: false, error: 'Unknown test' };
    }
    this.dirty();
    return { ok: true };
  }

  /* --------------------------------- snapshots --------------------------------- */

  #publicSession() {
    const s = this.session;
    if (!s) return null;
    const sum = this.#summary();
    return {
      id: s.id, status: s.status, title: s.title, startedAt: s.startedAt, endedAt: s.endedAt,
      peakViewers: sum.peakViewers, avgViewers: sum.avgViewers, subsGained: sum.subs.gained, viewsGained: sum.views.gained,
      comments: sum.comments, uniqueChatters: sum.uniqueChatters, byCurrency: s.byCurrency, superCount: s.scCount + s.stickerCount,
      members: s.members, top: sum.superChats.top.slice(0, 5), durationSec: sum.durationSec,
    };
  }

  snapshot(control = false) {
    const snap = {
      now: Date.now(),
      scene: this.scene, sceneSeq: this.sceneSeq,
      settings: this.settings, fonts: FONTS,
      session: this.#publicSession(),
      stats: this.stats,
      yt: { status: this.yt.status, title: this.yt.title, error: control ? this.yt.error : null },
      chat: this.chat.filter((m) => !m.hidden).slice(-40),
      pinned: this.pinned,
      caption: this.caption,
      alert: this.alert,
      music: this.#musicPayload(),
      roles: this.roles(),
      clip: this.clip,
      prepCountdownEnd: this.prepCountdownEnd,
    };
    if (control) {
      const totals = { lives: 0, comments: 0, views: 0, subs: 0, peak: 0, byCurrency: {}, seconds: 0 };
      for (const h of this.history) {
        if (h.status === 'live') continue;
        totals.lives++;
        totals.comments += h.comments || 0;
        totals.views += h.views?.gained || 0;
        totals.subs += h.subs?.gained || 0;
        totals.peak = Math.max(totals.peak, h.peakViewers || 0);
        totals.seconds += h.durationSec || 0;
        for (const [c, v] of Object.entries(h.superChats?.byCurrency || {})) totals.byCurrency[c] = Math.round(((totals.byCurrency[c] || 0) + v) * 100) / 100;
      }
      Object.assign(snap, {
        control: true,
        media: this.media.list(),
        mediaReady: this.media.ready,
        storage: this.media.storage ? `#${this.media.storage.name}` : null,
        history: this.history.slice(-40).reverse().map(({ tracks, ...h }) => h),
        totals,
        ytInfo: this.yt.info(),
        trackCount: this.tracks().length,
        queue: this.music.queue.map((id) => this.tracks().find((t) => t.id === id)?.title || id),
        alertsWaiting: this.alertQueue.length,
        logs: this.logs.slice(-40),
      });
    }
    return snap;
  }

  /* ---------------------------------- commands ---------------------------------- */

  async command(c = {}) {
    switch (c.type) {
      case 'start': return this.startLive(c);
      case 'end': return this.endLive();
      case 'ready': return this.setScene('live', true);
      case 'scene': return this.setScene(String(c.scene), c.transition !== false);
      case 'test-transition':
        this.sceneSeq++;
        this.emit('event', 'scene', { scene: this.scene, seq: this.sceneSeq, transition: this.settings.transition.enabled, force: true });
        return { ok: true };
      case 'prep-countdown': {
        const min = Math.min(240, Math.max(0, Number(c.minutes) || 0));
        this.prepCountdownEnd = min ? Date.now() + min * 60_000 : 0;
        this.dirty();
        return { ok: true };
      }
      case 'say': return this.say(c);
      case 'caption-clear': this.clearCaption(); return { ok: true };
      case 'tts-stop': this.emit('event', 'tts-stop', {}); return { ok: true };
      case 'skip-alert': return this.skipAlert();
      case 'test': return this.test(String(c.kind), c);
      case 'chat-clear': this.clearChat(); return { ok: true };
      case 'chat-hide': this.hideChat(String(c.id)); this.dirty(); return { ok: true };
      case 'chat-pin': this.pin(c.id ? String(c.id) : null); return { ok: true };
      case 'chat-say': return this.sayChat(String(c.id));
      case 'block-user': {
        const n = String(c.name || '').trim();
        if (n && !this.settings.tts.blockedUsers.some((u) => u.toLowerCase() === n.toLowerCase())) {
          this.settings.tts.blockedUsers.push(n); this.#saveLocal(); this.dirty();
        }
        return { ok: true };
      }
      case 'yt-connect': return this.connectYouTube(c.input);
      case 'yt-disconnect': this.yt.disconnect(); return { ok: true };
      case 'music': return this.musicCmd(c);
      case 'media-show': return this.showClip(c);
      case 'media-hide': this.hideClip(); return { ok: true };
      case 'rescan-media': this.media.scan().catch(() => {}); return { ok: true };
      case 'save-now': await this.#checkpoint(); return { ok: true };
      default: return { ok: false, error: 'Unknown command' };
    }
  }
}
