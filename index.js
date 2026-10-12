import { Client, GatewayIntentBits, Partials, Events, ActivityType } from 'discord.js';
import { config } from './config.js';
import { Library } from './library.js';
import { MusicPlayer } from './player.js';
import { Stats } from './stats.js';
import { startWeb } from './web.js';
import { YouTube } from './youtube.js';
import { LiveMedia } from './livemedia.js';
import { LiveHub } from './livehub.js';

if (!config.token) {
  console.error('Missing DISCORD_TOKEN. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    // Needed to see file attachments in messages (enable "Message Content Intent" in the Developer Portal)
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel],
});

const stats = new Stats();
const library = new Library(client);
const player = new MusicPlayer(client, library, stats);
const liveMedia = new LiveMedia(client);
const yt = new YouTube({ apiKey: config.ytApiKey, minPollMs: config.ytMinPollMs, statsSec: config.ytStatsSec });
const hub = new LiveHub({ yt, media: liveMedia, library });

/* ------------------------------ presence ------------------------------ */

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function updatePresence() {
  if (!client.isReady()) return;
  const np = player.nowPlaying;
  const name = np
    ? truncate(`${np.track.title}`, 120)
    : player.listeners === 0
      ? 'Nodistub Cat Cafe | Waiting for listeners'
      : config.idleActivity;
  client.user.setPresence({
    status: config.presenceStatus, // "dnd" = Do Not Disturb
    activities: [{ name, type: ActivityType.Listening }],
  });
}

let lastPresenceKey = '';
player.on('update', () => {
  const key = `${player.nowPlaying?.track.id ?? ''}|${player.listeners === 0}`;
  if (key === lastPresenceKey) return;
  lastPresenceKey = key;
  updatePresence();
});

/* ------------------------------ room rules ------------------------------ */
// Music room: listen only. No speaking, no screen share / camera, no soundboard.
async function ensureRoomRules() {
  try {
    const channel = await client.channels.fetch(config.voiceChannelId);
    await channel.permissionOverwrites.edit(client.user.id, {
      ViewChannel: true,
      Connect: true,
      Speak: true,
    });
    await channel.permissionOverwrites.edit(channel.guild.roles.everyone, {
      Speak: false,
      Stream: false,
      UseVAD: false,
      UseSoundboard: false,
      UseExternalSounds: false,
    });
    console.log('[rules] music room set to listen-only');
  } catch (e) {
    console.warn(
      `[rules] could not update channel permissions (${e.message}). ` +
        'Give the bot "Manage Channels" or set the room to listen-only manually.',
    );
  }
}

/* ------------------------------ events ------------------------------ */

client.once(Events.ClientReady, async () => {
  console.log(`[bot] logged in as ${client.user.tag}`);
  lastPresenceKey = 'init';
  updatePresence();

  await ensureRoomRules();
  await library.scan();
  liveMedia.scan().then(() => hub.restore()).catch((e) => console.warn('[live] startup scan failed:', e.message));
  setInterval(() => liveMedia.scan().catch(() => {}), 15 * 60_000);
  setInterval(() => library.scan(), config.rescanMinutes * 60_000);

  try {
    await player.start();
  } catch (e) {
    console.error('[voice] could not join the music room:', e.message);
  }
  updatePresence();
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  // The bot got moved or kicked: go straight back
  if (newState.id === client.user.id && newState.channelId !== config.voiceChannelId) {
    setTimeout(() => player.join().catch(() => {}), 2000);
  }

  const inMusicRoom = newState.channelId === config.voiceChannelId;
  if (inMusicRoom && !newState.member?.user.bot && (newState.streaming || newState.selfVideo)) {
    newState.disconnect('Screen share / camera is not allowed in the music room').catch(() => {});
  }

  if (oldState.channelId === config.voiceChannelId || newState.channelId === config.voiceChannelId) {
    player.refreshListeners();
  }
});

client.on(Events.MessageCreate, (message) => {
  if (message.attachments.size) { library.addMessage(message, { live: true }); liveMedia.addMessage(message); }
});

client.on(Events.MessageDelete, (message) => { library.removeMessage(message.id); liveMedia.removeMessage(message.id); });

client.on(Events.MessageUpdate, async (_old, message) => {
  try {
    const full = message.partial ? await message.fetch() : message;
    if (!library.inCategory(full.channel)) return;
    library.removeMessage(full.id);
    library.addMessage(full);
  } catch {
    /* message vanished */
  }
});

for (const ev of [Events.ChannelCreate, Events.ChannelDelete, Events.ChannelUpdate]) {
  client.on(ev, (...args) => {
    const ch = args[args.length - 1];
    if (ch?.parentId === config.categoryId || args[0]?.parentId === config.categoryId) library.scheduleScan();
  });
}

client.on(Events.Error, (e) => console.error('[client]', e.message));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e?.message ?? e));

// Open the website right away so Render sees the port even while the bot is still logging in
startWeb({ library, player, stats, live: { hub, media: liveMedia } });

client.login(config.token).catch((e) => {
  console.error('[login failed]', e.message);
  if (/disallowed intents/i.test(e.message)) {
    console.error(
      'Fix: Discord Developer Portal -> your app -> Bot -> turn ON "Message Content Intent", Save, then redeploy.',
    );
  }
  process.exit(1);
});
