import { EventEmitter } from 'node:events';
import { ChannelType } from 'discord.js';
import { parseBuffer } from 'music-metadata';
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

// Discord strips non-ASCII letters from file names (e.g. Japanese). What is left is often
// empty or a random hex id, so such names are not shown as song titles.
function isBadName(name) {
  const n = (name || '').trim();
  return !n || /^[0-9a-f]{10,}$/i.test(n) || /^(unknown|untitled|file|audio)$/i.test(n);
}

// Optional: the uploader can type the song title as the message text (single file per message)
function textTitle(message, audioCount) {
  if (audioCount !== 1) return null;
  const line = (message.content || '')
    .split('\n')[0]
    .replace(/<[^>]+>|https?:\/\/\S+/g, '')
    .trim();
  return line && line.length <= 100 ? line : null;
}

function cleanTitle(filename) {
  return (
    filename
      .replace(AUDIO_EXT, '')
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
    this.meta = new Map(); // track id -> title read from the file's own tags
    this.metaTried = new Set();
    this.enriching = false;
    this.sampleLogged = 0;
  }

  inCategory(channel) {
    return channel && channel.parentId === config.categoryId;
  }

  static isSongChannel(c) {
    return c && (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement);
  }

  #trackFrom(message, att, channel, audioCount = 1) {
    const id = `${message.id}-${att.id}`;
    const attTitle = typeof att.title === 'string' ? att.title.trim() : '';
    const fromName = cleanTitle(att.name || '');
    const fromText = textTitle(message, audioCount);
    let title;
    let titleSource;
    if (attTitle && !isBadName(cleanTitle(attTitle))) {
      title = cleanTitle(attTitle);
      titleSource = 'discord';
    } else if (fromText) {
      title = fromText;
      titleSource = 'text';
    } else if (!isBadName(fromName)) {
      title = fromName;
      titleSource = 'filename';
    } else {
      title = `Untitled track (${(att.size / 1048576).toFixed(2)} MB)`;
      titleSource = 'none';
    }
    const cached = this.meta.get(id);
    if (cached && (titleSource === 'filename' || titleSource === 'none')) {
      title = cached;
      titleSource = 'tag';
    }
    return {
      id,
      title,
      titleSource,
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
    const audio = [...message.attachments.values()].filter(isAudio);
    for (const att of audio) {
      if (this.sampleLogged < 3) {
        this.sampleLogged++;
        console.log(`[library] sample attachment: name="${att.name}" title="${att.title ?? ''}"`);
      }
      const t = this.#trackFrom(message, att, channel, audio.length);
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
      this.enrich();
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
    this.enrich();
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

  // Read titles from the ID3/tag data inside the audio file (only for tracks with no usable name)
  async enrich() {
    if (this.enriching) return;
    this.enriching = true;
    try {
      const todo = [...this.tracks.values()].filter(
        (t) => (t.titleSource === 'filename' || t.titleSource === 'none') && !this.metaTried.has(t.id),
      );
      let changed = false;
      let i = 0;
      const worker = async () => {
        while (i < todo.length) {
          const t = todo[i++];
          this.metaTried.add(t.id);
          const name = await this.#probeTag(t);
          if (!name) continue;
          this.meta.set(t.id, name);
          const cur = this.tracks.get(t.id);
          if (cur) {
            cur.title = name;
            cur.titleSource = 'tag';
            changed = true;
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      if (changed) this.emit('update');
    } finally {
      this.enriching = false;
    }
  }

  async #probeTag(track) {
    try {
      const url = await this.freshUrl(track);
      const res = await fetch(url, { headers: { Range: 'bytes=0-524287' } });
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      const meta = await parseBuffer(buf, { mimeType: track.contentType, size: track.size }, { duration: false, skipCovers: true });
      const title = meta.common?.title?.trim();
      if (!title) return null;
      const artist = meta.common?.artist?.trim();
      return artist ? `${artist} \u2014 ${title}` : title;
    } catch {
      return null;
    }
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
