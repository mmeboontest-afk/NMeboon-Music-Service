import 'dotenv/config';

const num = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : d);

export const config = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID || null,

  // Category that holds the "song channels" (each channel = one playlist/genre)
  categoryId: process.env.CATEGORY_ID || '1558578154820604014',
  // The one voice channel the bot lives in
  voiceChannelId: process.env.VOICE_CHANNEL_ID || '1486496068295331932',

  port: num(process.env.PORT, 3000),
  trustProxy: process.env.TRUST_PROXY === 'true' || process.env.RENDER === 'true',
  // Where stats.json lives. On Render, point this at a persistent disk (e.g. /var/data)
  dataDir: process.env.DATA_DIR || 'data',

  // Library
  maxMessagesPerChannel: num(process.env.MAX_MESSAGES_PER_CHANNEL, 5000),
  rescanMinutes: num(process.env.RESCAN_MINUTES, 10),
  newTrackDays: num(process.env.NEW_TRACK_DAYS, 7),

  // Queue / abuse protection
  queueMax: num(process.env.QUEUE_MAX, 30),
  rateLimitCount: num(process.env.RATE_LIMIT_COUNT, 4),
  rateLimitWindowSec: num(process.env.RATE_LIMIT_WINDOW_SEC, 30),

  // Presence (English only)
  presenceStatus: process.env.PRESENCE_STATUS || 'dnd', // dnd = Do Not Disturb
  idleActivity: process.env.IDLE_ACTIVITY || 'Nodistub Cat Cafe | Request on web',
};
