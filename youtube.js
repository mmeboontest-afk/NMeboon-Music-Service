import { EventEmitter } from 'node:events';

const API = 'https://www.googleapis.com/youtube/v3';
const COST = { 'liveChat/messages': 5, videos: 1, channels: 1 };

export function parseVideoId(input = '') {
  const s = String(input).trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname.includes('youtu.be')) return u.pathname.split('/').filter(Boolean)[0] || null;
    const v = u.searchParams.get('v');
    if (v) return v;
    const m = u.pathname.match(/\/(?:live|embed|shorts|v)\/([\w-]{11})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

/** Reads a YouTube live stream through the YouTube Data API v3 (API key, no OAuth). */
export class YouTube extends EventEmitter {
  constructor({ apiKey, minPollMs = 8000, statsSec = 45 }) {
    super();
    this.apiKey = apiKey;
    this.minPollMs = Math.max(2000, minPollMs);
    this.statsMs = Math.max(15, statsSec) * 1000;
    this.reset();
    this.quota = { used: 0, day: new Date().toDateString() };
  }

  reset() {
    this.status = 'idle'; // idle | connecting | live | ended | error
    this.error = null;
    this.videoId = null;
    this.liveChatId = null;
    this.channelId = null;
    this.title = '';
    this.channelTitle = '';
    this.pageToken = undefined;
    this.first = true;
    this.seen = new Set();
    this.generation = (this.generation || 0) + 1;
    clearTimeout(this.chatTimer);
    clearTimeout(this.statsTimer);
  }

  info() {
    return {
      keySet: Boolean(this.apiKey),
      status: this.status,
      error: this.error,
      videoId: this.videoId,
      title: this.title,
      channelTitle: this.channelTitle,
      quotaUsed: this.quota.used,
      minPollMs: this.minPollMs,
    };
  }

  #set(status, error = null) {
    this.status = status;
    this.error = error;
    this.emit('status', this.info());
  }

  async #call(path, params) {
    const today = new Date().toDateString();
    if (this.quota.day !== today) this.quota = { used: 0, day: today };
    this.quota.used += COST[path] ?? 1;
    const qs = new URLSearchParams({ ...params, key: this.apiKey });
    const res = await fetch(`${API}/${path}?${qs}`, { signal: AbortSignal.timeout(15_000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(body?.error?.message || `HTTP ${res.status}`);
      e.reason = body?.error?.errors?.[0]?.reason || String(res.status);
      e.status = res.status;
      throw e;
    }
    return body;
  }

  async connect(input) {
    if (!this.apiKey) throw new Error('YT_API_KEY is not set on the server');
    const id = parseVideoId(input);
    if (!id) throw new Error('That does not look like a YouTube video link or ID');
    this.reset();
    this.videoId = id;
    this.#set('connecting');
    const gen = this.generation;
    try {
      const v = await this.#call('videos', { part: 'snippet,liveStreamingDetails,statistics', id });
      const item = v.items?.[0];
      if (!item) throw Object.assign(new Error('Video not found (is it public / unlisted?)'), { reason: 'notFound' });
      if (gen !== this.generation) return;
      this.title = item.snippet?.title || '';
      this.channelTitle = item.snippet?.channelTitle || '';
      this.channelId = item.snippet?.channelId || null;
      this.liveChatId = item.liveStreamingDetails?.activeLiveChatId || null;
      if (!this.liveChatId) {
        throw Object.assign(
          new Error('This video has no active live chat (not live yet, chat off, or the stream ended)'),
          { reason: 'noChat' },
        );
      }
      this.#set('live');
      this.#emitStats(item, null);
      await this.#statsTick();
      this.#chatTick(gen);
    } catch (e) {
      if (gen === this.generation) this.#set('error', e.message);
      throw e;
    }
  }

  disconnect() {
    this.reset();
    this.#set('idle');
  }

  async #statsTick() {
    const gen = this.generation;
    if (this.status !== 'live') return;
    try {
      const v = await this.#call('videos', { part: 'statistics,liveStreamingDetails', id: this.videoId });
      let ch = null;
      if (this.channelId && (!this.subsAt || Date.now() - this.subsAt > 120_000)) {
        ch = await this.#call('channels', { part: 'statistics', id: this.channelId });
        this.subsAt = Date.now();
      }
      if (gen !== this.generation) return;
      this.#emitStats(v.items?.[0], ch?.items?.[0]);
      if (v.items?.[0]?.liveStreamingDetails?.actualEndTime) this.#ended();
    } catch (e) {
      if (e.reason === 'quotaExceeded') return this.#fatal('YouTube API quota exceeded for today');
    }
    if (gen === this.generation && this.status === 'live') {
      this.statsTimer = setTimeout(() => this.#statsTick(), this.statsMs);
    }
  }

  #emitStats(video, channel) {
    const st = video?.statistics || {};
    const ld = video?.liveStreamingDetails || {};
    if (channel) {
      const cs = channel.statistics || {};
      this.subs = cs.hiddenSubscriberCount ? null : Number(cs.subscriberCount);
      this.subsHidden = Boolean(cs.hiddenSubscriberCount);
    }
    this.emit('stats', {
      viewers: ld.concurrentViewers != null ? Number(ld.concurrentViewers) : null,
      views: st.viewCount != null ? Number(st.viewCount) : null,
      likes: st.likeCount != null ? Number(st.likeCount) : null,
      subs: this.subs ?? null,
      subsHidden: Boolean(this.subsHidden),
      startedAt: ld.actualStartTime ? Date.parse(ld.actualStartTime) : null,
    });
  }

  async #chatTick(gen) {
    if (gen !== this.generation || this.status !== 'live') return;
    let wait = this.minPollMs;
    try {
      const r = await this.#call('liveChat/messages', {
        liveChatId: this.liveChatId,
        part: 'snippet,authorDetails',
        maxResults: '200',
        ...(this.pageToken ? { pageToken: this.pageToken } : {}),
      });
      if (gen !== this.generation) return;
      this.pageToken = r.nextPageToken;
      wait = Math.max(this.minPollMs, r.pollingIntervalMillis || 0);
      const out = [];
      for (const it of r.items || []) {
        if (this.seen.has(it.id)) continue;
        this.seen.add(it.id);
        const n = normalize(it);
        if (!n) continue;
        if (n.kind === 'ended') { this.#ended(); return; }
        out.push(n);
      }
      if (this.seen.size > 3000) this.seen = new Set([...this.seen].slice(-1500));
      if (out.length) this.emit('messages', out, this.first);
      this.first = false;
    } catch (e) {
      if (e.reason === 'quotaExceeded' || e.reason === 'rateLimitExceeded') {
        return this.#fatal('YouTube API quota exceeded. Chat stops until the quota resets (midnight Pacific time).');
      }
      if (e.reason === 'liveChatEnded' || e.reason === 'liveChatNotFound') return this.#ended();
      if (e.reason === 'forbidden' || e.status === 403) return this.#fatal(`YouTube refused the request: ${e.message}`);
      wait = Math.max(wait, 15_000); // transient problem, back off
    }
    this.chatTimer = setTimeout(() => this.#chatTick(gen), wait);
  }

  #ended() {
    clearTimeout(this.chatTimer);
    clearTimeout(this.statsTimer);
    this.generation++;
    this.#set('ended');
    this.emit('ended');
  }

  #fatal(msg) {
    clearTimeout(this.chatTimer);
    clearTimeout(this.statsTimer);
    this.generation++;
    this.#set('error', msg);
  }
}

/** Turn one liveChatMessages item into the shape the overlay uses. */
export function normalize(it) {
  const sn = it.snippet || {};
  const au = it.authorDetails || {};
  const base = {
    id: it.id,
    author: au.displayName || 'Someone',
    channelId: au.channelId || sn.authorChannelId || '',
    avatar: au.profileImageUrl || '',
    badges: { owner: !!au.isChatOwner, mod: !!au.isChatModerator, member: !!au.isChatSponsor, verified: !!au.isVerified },
    text: sn.displayMessage || sn.textMessageDetails?.messageText || '',
    at: sn.publishedAt ? Date.parse(sn.publishedAt) : Date.now(),
  };
  const money = (d) => ({
    micros: Number(d.amountMicros || 0),
    value: Number(d.amountMicros || 0) / 1e6,
    currency: d.currency || '',
    display: d.amountDisplayString || '',
    tier: Number(d.tier || 1),
  });
  switch (sn.type) {
    case 'textMessageEvent':
      return { ...base, kind: 'chat' };
    case 'superChatEvent': {
      const d = sn.superChatDetails || {};
      return { ...base, kind: 'superchat', text: d.userComment || '', amount: money(d) };
    }
    case 'superStickerEvent': {
      const d = sn.superStickerDetails || {};
      return { ...base, kind: 'sticker', text: d.superStickerMetadata?.altText || 'Super Sticker', amount: money(d) };
    }
    case 'newSponsorEvent':
      return { ...base, kind: 'member', text: sn.newSponsorDetails?.memberLevelName || 'New member' };
    case 'memberMilestoneChatEvent': {
      const d = sn.memberMilestoneChatDetails || {};
      return { ...base, kind: 'milestone', text: d.userComment || '', months: Number(d.memberMonth || 0), level: d.memberLevelName || '' };
    }
    case 'membershipGiftingEvent': {
      const d = sn.membershipGiftingDetails || {};
      return { ...base, kind: 'gift', count: Number(d.giftMembershipsCount || 0), text: d.giftMembershipsLevelName || '' };
    }
    case 'messageDeletedEvent':
      return { kind: 'deleted', id: it.id, targetId: sn.messageDeletedDetails?.deletedMessageId };
    case 'chatEndedEvent':
      return { kind: 'ended', id: it.id };
    default:
      return null; // gift received, bans, tombstones… not shown
  }
}
