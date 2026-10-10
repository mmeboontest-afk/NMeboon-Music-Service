import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
  NoSubscriberBehavior,
} from '@discordjs/voice';
import { parseStream } from 'music-metadata';
import { config } from './config.js';

const RECENT_MEMORY = 12;

export class MusicPlayer extends EventEmitter {
  constructor(client, library, stats) {
    super();
    this.client = client;
    this.library = library;
    this.stats = stats;

    this.connection = null;
    this.joining = false;
    this.busy = false;
    this.listeners = 0;
    this.queue = []; // { track, requestedBy, requestedAt, auto:false }
    this.nowPlaying = null; // { track, requestedBy, auto, startedAt, durationMs }
    this.resource = null;
    this.recent = [];
    this.durations = new Map();

    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });
    this.player.on(AudioPlayerStatus.Idle, () => this.#onIdle());
    this.player.on('error', (e) => console.error('[player] error:', e.message));
  }

  /* ------------------------------ voice ------------------------------ */

  async start() {
    await this.join();
    this.refreshListeners();
    // keep-alive: the bot never leaves the music room
    setInterval(() => this.#keepAlive(), 30_000);
  }

  async join() {
    if (this.joining) return;
    this.joining = true;
    try {
      const channel = await this.client.channels.fetch(config.voiceChannelId);
      if (!channel?.isVoiceBased()) throw new Error('VOICE_CHANNEL_ID is not a voice channel');

      const conn = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false,
      });
      this.connection = conn;

      conn.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(conn, VoiceConnectionStatus.Signalling, 5_000),
            entersState(conn, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          try {
            conn.destroy();
          } catch {
            /* already destroyed */
          }
          setTimeout(() => this.join().catch((e) => console.error('[voice] rejoin failed:', e.message)), 2_000);
        }
      });

      conn.subscribe(this.player);
      await entersState(conn, VoiceConnectionStatus.Ready, 30_000);
      console.log(`[voice] connected to #${channel.name}`);
      this.emitChange();
    } finally {
      this.joining = false;
    }
  }

  #keepAlive() {
    const status = this.connection?.state?.status;
    const guild = this.client.guilds.cache.get(config.guildId) ?? this.client.guilds.cache.first();
    const inRoom = guild?.members.me?.voice?.channelId === config.voiceChannelId;
    if (!this.connection || status === VoiceConnectionStatus.Destroyed || !inRoom) {
      this.join().catch((e) => console.error('[voice] keep-alive rejoin failed:', e.message));
    }
  }

  refreshListeners() {
    const channel = this.client.channels.cache.get(config.voiceChannelId);
    const n = channel?.members ? channel.members.filter((m) => !m.user.bot).size : 0;
    if (n === this.listeners) return;
    this.listeners = n;
    this.#evaluate();
    this.emitChange();
  }

  #evaluate() {
    const status = this.player.state.status;
    if (this.listeners === 0) {
      // nobody listening: pause so the song is not wasted
      if (status === AudioPlayerStatus.Playing) this.player.pause(true);
      return;
    }
    if (status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.AutoPaused) {
      this.player.unpause();
    }
    if (!this.nowPlaying) this.playNext();
  }

  /* ------------------------------ queue ------------------------------ */

  enqueue(trackId, requestedBy) {
    const track = this.library.tracks.get(trackId);
    if (!track) return { ok: false, error: 'Song not found' };
    if (this.nowPlaying?.track.id === trackId) return { ok: false, error: 'This song is playing right now' };
    if (this.queue.some((q) => q.track.id === trackId)) return { ok: false, error: 'Already in the queue' };
    if (this.queue.length >= config.queueMax) return { ok: false, error: 'The queue is full, try again later' };

    this.queue.push({ track, requestedBy, requestedAt: Date.now(), auto: false });
    this.stats.addRequest(trackId);
    this.emitChange();
    if (!this.nowPlaying && this.listeners > 0) this.playNext();
    return { ok: true, position: this.queue.length };
  }

  async playNext() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (let attempt = 0; attempt < 5; attempt++) {
        if (this.listeners === 0) break; // wait for someone to join
        const item = this.queue.shift() ?? this.#randomItem();
        if (!item) break;
        if (await this.#play(item)) break;
      }
    } finally {
      this.busy = false;
      this.emitChange();
    }
  }

  #randomItem() {
    const exclude = new Set(this.recent.slice(-Math.min(RECENT_MEMORY, Math.max(0, this.library.tracks.size - 1))));
    const track = this.library.random(exclude);
    return track ? { track, requestedBy: null, requestedAt: Date.now(), auto: true } : null;
  }

  async #play(item) {
    const { track } = item;
    try {
      const url = await this.library.freshUrl(track);
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const resource = createAudioResource(Readable.fromWeb(res.body), { inputType: StreamType.Arbitrary });
      this.resource = resource;
      this.nowPlaying = {
        ...item,
        startedAt: Date.now(),
        durationMs: this.durations.get(track.id) ?? null,
      };
      this.player.play(resource);

      this.stats.addPlay(track.id);
      this.recent.push(track.id);
      if (this.recent.length > 50) this.recent.shift();

      console.log(`[player] now playing: ${track.title} (${item.auto ? 'auto' : 'request'})`);
      this.emit('trackchange', this.nowPlaying);
      this.#probeDuration(track, url);
      return true;
    } catch (e) {
      console.warn(`[player] cannot play "${track.title}": ${e.message}`);
      this.nowPlaying = null;
      this.resource = null;
      return false;
    }
  }

  #onIdle() {
    if (!this.nowPlaying) return;
    this.nowPlaying = null;
    this.resource = null;
    this.emit('trackchange', null);
    this.emitChange();
    this.playNext();
  }

  async #probeDuration(track, url) {
    if (this.durations.has(track.id)) return;
    let stream;
    try {
      const res = await fetch(url);
      if (!res.ok || !res.body) return;
      stream = Readable.fromWeb(res.body);
      const meta = await Promise.race([
        parseStream(stream, { mimeType: track.contentType, size: track.size }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8_000)),
      ]);
      const seconds = meta?.format?.duration;
      if (seconds) {
        this.durations.set(track.id, seconds * 1000);
        if (this.nowPlaying?.track.id === track.id) {
          this.nowPlaying.durationMs = seconds * 1000;
          this.emitChange();
        }
      }
    } catch {
      /* duration is optional */
    } finally {
      stream?.destroy();
    }
  }

  /* ------------------------------ state ------------------------------ */

  emitChange() {
    this.emit('update');
  }

  #publicTrack(t) {
    return {
      id: t.id,
      title: t.title,
      channel: t.channelName,
      channelId: t.channelId,
      isNew: this.library.isNew(t),
      requests: this.stats.requests(t.id),
    };
  }

  snapshot() {
    const status = this.player.state.status;
    const paused = status === AudioPlayerStatus.Paused || status === AudioPlayerStatus.AutoPaused;
    const np = this.nowPlaying;
    const voice = this.client.channels.cache.get(config.voiceChannelId);
    return {
      botOnline: this.client.isReady(),
      inVoice: this.connection?.state?.status === VoiceConnectionStatus.Ready,
      voiceChannel: voice?.name ?? null,
      listeners: this.listeners,
      paused,
      nowPlaying: np
        ? {
            ...this.#publicTrack(np.track),
            requestedBy: np.requestedBy,
            auto: np.auto,
            durationMs: np.durationMs,
            positionMs: this.resource?.playbackDuration ?? 0,
          }
        : null,
      queue: this.queue.map((q) => ({
        ...this.#publicTrack(q.track),
        requestedBy: q.requestedBy,
      })),
    };
  }

  publicTrack(t) {
    return this.#publicTrack(t);
  }
}
