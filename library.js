import { EventEmitter } from 'node:events';
import { ChannelType } from 'discord.js';
import { config } from './config.js';

const AUDIO_EXT = /\.(mp3|wav|ogg|oga|opus|flac|m4a|aac|webm|mka|wma)$/i;
const URL_TTL_MS = 5 * 60 * 60 * 1000; // Discord CDN links expire, refresh after 5h

const MIME_BY_EXT = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  webm: 'audio/webm',
  mka: 'audio/x-matroska',
  wma: 'audio/x-ms-wma',
};

export function guessMime(filename = '') {
  const ext = filename.split('.').pop()?.toLowerCase();
  return MIME_BY_EXT[ext] || 'audio/mpeg';
}

function cleanTitle(filename) {
  return (
    filename
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[_]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim() || filename
  );
}

function isAudio(att) {
  return (att.contentType && att.contentType.startsWith('audio/')) || AUDIO_EXT.test(att.name || '');
}

export class Library extends EventEmitter {
  constructor(client) {
    super();
    this.client = client;
    this.tracks = new Map(); // id -> track
    this.channels = new Map(); // id -> { id, name, position }
    this.scanning = false;
    this.ready = false;
  }

  inCategory(channel) {
    return channel && channel.parentId === config.categoryId;
  }

  static isSongChannel(c) {
    return c && (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement);
  }

  #trackFrom(message, att, channel) {
    return {
      id: `${message.id}-${att.id}`,
      title: cleanTitle(att.name || 'Untitled'),
      filename: att.name,
      channelId: channel.id,
      channelName: channel.name,
      messageId: message.id,
      attachmentId: att.id,
      size: att.size,
      contentType: att.contentType || guessMime(att.name),
      url: att.url,
      urlAt: Date.now(),
      createdAt: message.createdTimestamp,
    };
  }

  #collect(message, channel, into) {
    const found = [];
    for (const att of message.attachments.values()) {
      if (!isAudio(att)) continue;
      const t = this.#trackFrom(message, att, channel);
      into.set(t.id, t);
      found.push(t);
    }
    return found;
  }

  // Pick the server that actually contains the music category
  async #findGuild() {
    if (config.guildId) {
      const g = this.client.guilds.cache.get(config.guildId);
      if (g) return g;
    }
    for (const g of this.client.guilds.cache.values()) {
      try {
        const chans = await g.channels.fetch();
        if (chans.has(config.categoryId)) return g;
      } catch {
        /* skip servers we cannot read */
      }
    }
    return this.client.guilds.cache.first();
  }

  async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const guild = await this.#findGuild();
      if (!guild) throw new Error('Bot is not in any server');
      const all = await guild.channels.fetch();
      const category = all.get(config.categoryId);
      if (!category) {
        console.warn(
          `[library] category ${config.categoryId} not found in server "${guild.name}". ` +
            'Check CATEGORY_ID, and that the bot can see that category.',
        );
      } else {
        console.log(`[library] reading category "${category.name}" in server "${guild.name}"`);
      }
      const songChannels = [...all.values()]
        .filter((c) => c && Library.isSongChannel(c) && c.parentId === config.categoryId)
        .sort((a, b) => a.rawPosition - b.rawPosition);

      const tracks = new Map();
      const channels = new Map();
      let seen = 0;
      for (const ch of songChannels) {
        channels.set(ch.id, { id: ch.id, name: ch.name, position: ch.rawPosition });
        try {
          let before;
          let fetched = 0;
          while (fetched < config.maxMessagesPerChannel) {
            const batch = await ch.messages.fetch({ limit: 100, before });
            if (!batch.size) break;
            for (const m of batch.values()) this.#collect(m, ch, tracks);
            fetched += batch.size;
            seen += batch.size;
            before = batch.last().id;
          }
        } catch (e) {
          console.warn(`[library] cannot read #${ch.name}: ${e.message}`);
        }
      }
      for (const ch of channels.values()) {
        const n = [...tracks.values()].filter((t) => t.channelId === ch.id).length;
        console.log(`[library] #${ch.name}: ${n} audio file(s)`);
      }
      if (tracks.size === 0) {
        console.warn(
          seen
            ? `[library] read ${seen} message(s) but found no audio files. Turn ON "Message Content Intent" ` +
                'in the Discord Developer Portal (Bot tab) and redeploy.'
            : '[library] no messages could be read. Give the bot View Channel + Read Message History ' +
                'on the song channels, and check CATEGORY_ID.',
        );
      }
      this.tracks = tracks;
      this.channels = channels;
      this.ready = true;
      console.log(`[library] ${tracks.size} tracks in ${channels.size} channels`);
      this.emit('update');
    } catch (e) {
      console.error('[library] scan failed:', e.message);
    } finally {
      this.scanning = false;
    }
  }

  scheduleScan(delay = 3000) {
    clearTimeout(this._scanTimer);
    this._scanTimer = setTimeout(() => this.scan(), delay);
  }

  addMessage(message, { live = false } = {}) {
    const channel = message.channel;
    if (!this.inCategory(channel) || !Library.isSongChannel(channel)) return;
    if (!this.channels.has(channel.id)) {
      this.channels.set(channel.id, { id: channel.id, name: channel.name, position: channel.rawPosition });
    }
    const found = this.#collect(message, channel, this.tracks);
    if (!found.length) return;
    this.emit('update');
    if (live) for (const t of found) this.emit('newtrack', t);
  }

  removeMessage(messageId) {
    let changed = false;
    for (const [id, t] of this.tracks) {
      if (t.messageId === messageId) {
        this.tracks.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit('update');
  }

  async freshUrl(track) {
    if (Date.now() - track.urlAt < URL_TTL_MS) return track.url;
    const channel = await this.client.channels.fetch(track.channelId);
    const message = await channel.messages.fetch(track.messageId);
    const att = message.attachments.get(track.attachmentId);
    if (!att) throw new Error('Attachment no longer exists');
    track.url = att.url;
    track.urlAt = Date.now();
    return track.url;
  }

  random(excludeIds = new Set()) {
    const all = [...this.tracks.values()];
    if (!all.length) return null;
    const pool = all.filter((t) => !excludeIds.has(t.id));
    const list = pool.length ? pool : all;
    return list[Math.floor(Math.random() * list.length)];
  }

  isNew(track) {
    return Date.now() - track.createdAt < config.newTrackDays * 86_400_000;
  }
}
