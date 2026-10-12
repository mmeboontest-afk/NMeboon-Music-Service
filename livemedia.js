import { EventEmitter } from 'node:events';
import { ChannelType, EmbedBuilder } from 'discord.js';
import { config } from './config.js';

const EXT = {
  video: /\.(mp4|webm|mov|m4v|mkv|ogv)$/i,
  image: /\.(png|jpe?g|gif|webp|avif|svg)$/i,
  audio: /\.(mp3|wav|ogg|oga|opus|flac|m4a|aac)$/i,
};
const MIME = {
  mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', ogv: 'video/ogg',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
};
const URL_TTL = 5 * 60 * 60 * 1000;

export function kindOf(att) {
  const ct = att.contentType || '';
  const name = att.name || '';
  if (ct.startsWith('video/') || EXT.video.test(name)) return 'video';
  if (ct.startsWith('image/') || EXT.image.test(name)) return 'image';
  if (ct.startsWith('audio/') || EXT.audio.test(name)) return 'audio';
  return null;
}

export function mimeOf(name = '', fallback = 'application/octet-stream') {
  return MIME[name.split('.').pop()?.toLowerCase()] || fallback;
}

const money = (by) =>
  Object.entries(by || {}).map(([c, v]) => `${v.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${c}`).join(' + ') || '0';
const dur = (s) => `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;

/** Media from the Discord "Live folder" + the Discord "Live storage" channel (long-term memory). */
export class LiveMedia extends EventEmitter {
  constructor(client) {
    super();
    this.client = client;
    this.items = new Map(); // id -> media
    this.folderIds = new Set(); // text channel ids to read
    this.storage = null; // text channel used for saving live summaries
    this.ready = false;
    this.scanning = false;
  }

  /* --------------------------------- setup --------------------------------- */

  async #resolveFolder() {
    this.folderIds = new Set();
    try {
      const ch = await this.client.channels.fetch(config.liveFolderId);
      if (!ch) return;
      if (ch.type === ChannelType.GuildCategory) {
        const all = await ch.guild.channels.fetch();
        for (const c of all.values()) {
          if (c?.parentId === ch.id && (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)) {
            this.folderIds.add(c.id);
          }
        }
      } else if (ch.isTextBased?.()) {
        this.folderIds.add(ch.id);
      }
    } catch (e) {
      console.warn(`[live] cannot open the live folder ${config.liveFolderId}: ${e.message}`);
    }
  }

  async #resolveStorage() {
    this.storage = null;
    try {
      const ch = await this.client.channels.fetch(config.liveStorageId);
      if (!ch) return;
      if (ch.type === ChannelType.GuildCategory) {
        const all = await ch.guild.channels.fetch();
        const kids = [...all.values()].filter((c) => c?.parentId === ch.id && c.type === ChannelType.GuildText);
        this.storage = kids.find((c) => /stor|memory|log|live/i.test(c.name)) || kids[0] || null;
      } else if (ch.isTextBased?.()) {
        this.storage = ch;
      }
      if (this.storage) console.log(`[live] storage channel: #${this.storage.name}`);
      else console.warn('[live] no storage channel found; stats are kept locally only');
    } catch (e) {
      console.warn(`[live] cannot open the live storage ${config.liveStorageId}: ${e.message}`);
    }
  }

  inFolder(channelId) {
    return this.folderIds.has(channelId);
  }

  /* --------------------------------- media --------------------------------- */

  #collect(message, into) {
    const out = [];
    for (const att of message.attachments.values()) {
      const kind = kindOf(att);
      if (!kind) continue;
      const name = att.name || 'file';
      const item = {
        id: `${message.id}-${att.id}`,
        name,
        base: name.replace(/\.[a-z0-9]{2,5}$/i, ''),
        kind,
        size: att.size,
        type: att.contentType || mimeOf(name),
        url: att.url,
        urlAt: Date.now(),
        channelId: message.channelId,
        messageId: message.id,
        attachmentId: att.id,
        createdAt: message.createdTimestamp,
      };
      into.set(item.id, item);
      out.push(item);
    }
    return out;
  }

  async scan() {
    if (this.scanning) return;
    this.scanning = true;
    try {
      await this.#resolveFolder();
      if (!this.storage) await this.#resolveStorage();
      const next = new Map();
      for (const id of this.folderIds) {
        try {
          const ch = await this.client.channels.fetch(id);
          let before;
          for (let page = 0; page < 20; page++) {
            const batch = await ch.messages.fetch({ limit: 100, before });
            if (!batch.size) break;
            for (const m of batch.values()) this.#collect(m, next);
            before = batch.last().id;
          }
        } catch (e) {
          console.warn(`[live] cannot read live folder channel ${id}: ${e.message}`);
        }
      }
      this.items = next;
      this.ready = true;
      console.log(`[live] ${next.size} media file(s): ${[...next.values()].map((i) => i.name).join(', ') || '—'}`);
      this.emit('update');
    } finally {
      this.scanning = false;
    }
  }

  addMessage(message) {
    if (!this.inFolder(message.channelId) || !message.attachments?.size) return;
    if (this.#collect(message, this.items).length) this.emit('update');
  }

  removeMessage(messageId) {
    let changed = false;
    for (const [id, it] of this.items) {
      if (it.messageId === messageId) { this.items.delete(id); changed = true; }
    }
    if (changed) this.emit('update');
  }

  list() {
    return [...this.items.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ id, name, base, kind, size, createdAt }) => ({ id, name, base, kind, size, createdAt }));
  }

  /** first item whose name matches (case-insensitive), optionally of a given kind */
  find(re, kind) {
    return [...this.items.values()].find((i) => re.test(i.base) && (!kind || i.kind === kind)) || null;
  }

  async freshUrl(item) {
    if (Date.now() - item.urlAt < URL_TTL) return item.url;
    const ch = await this.client.channels.fetch(item.channelId);
    const msg = await ch.messages.fetch(item.messageId);
    const att = msg.attachments.get(item.attachmentId);
    if (!att) throw new Error('Attachment no longer exists');
    item.url = att.url;
    item.urlAt = Date.now();
    return item.url;
  }

  /* ------------------------- storage (live memory) ------------------------- */

  #embed(s) {
    const live = s.status === 'live';
    const rev = money(s.superChats?.byCurrency);
    return new EmbedBuilder()
      .setColor(live ? 0xe8798f : 0x97c4a0)
      .setTitle(`${live ? '🔴 LIVE (in progress)' : '🌸 Live finished'} · ${s.title || 'Untitled live'}`)
      .setDescription(`Started <t:${Math.floor(s.startedAt / 1000)}:F>${s.endedAt ? ` · Length ${dur(s.durationSec)}` : ''}`)
      .addFields(
        { name: '👀 Peak viewers', value: String(s.peakViewers ?? 0), inline: true },
        { name: '📺 Views gained', value: String(s.views?.gained ?? 0), inline: true },
        { name: '💗 Subs gained', value: String(s.subs?.gained ?? 0), inline: true },
        { name: '💬 Comments', value: `${s.comments ?? 0} (${s.uniqueChatters ?? 0} people)`, inline: true },
        { name: '💰 Super Chat', value: `${rev}\n${s.superChats?.count ?? 0} chat(s)`, inline: true },
        { name: '⭐ Members', value: String(s.members?.new ?? 0), inline: true },
      )
      .setFooter({ text: `live-id:${s.id}` })
      .setTimestamp(new Date(s.endedAt || Date.now()));
  }

  /** Create or update the Discord message that holds this live's numbers (JSON attached). */
  async save(summary, messageId) {
    if (!this.storage) return null;
    const payload = {
      embeds: [this.#embed(summary)],
      files: [{ attachment: Buffer.from(JSON.stringify(summary, null, 1)), name: `live-${summary.id}.json` }],
    };
    try {
      if (messageId) {
        const msg = await this.storage.messages.fetch(messageId);
        await msg.edit({ ...payload, attachments: [] });
        return msg.id;
      }
    } catch {
      /* message gone → post a new one */
    }
    try {
      const msg = await this.storage.send(payload);
      return msg.id;
    } catch (e) {
      console.warn(`[live] cannot write to storage: ${e.message}`);
      return null;
    }
  }

  /** Read previous lives back (so numbers survive restarts / re-deploys). */
  async loadHistory() {
    if (!this.storage) return [];
    const out = [];
    try {
      const msgs = await this.storage.messages.fetch({ limit: 100 });
      for (const m of msgs.values()) {
        if (m.author.id !== this.client.user.id) continue;
        const att = [...m.attachments.values()].find((a) => /^live-.+\.json$/i.test(a.name || ''));
        if (!att) continue;
        try {
          const res = await fetch(att.url, { signal: AbortSignal.timeout(10_000) });
          const j = await res.json();
          if (j?.id) out.push({ ...j, _messageId: m.id });
        } catch {
          /* skip unreadable */
        }
      }
    } catch (e) {
      console.warn(`[live] cannot read storage history: ${e.message}`);
    }
    return out.sort((a, b) => a.startedAt - b.startedAt);
  }
}
