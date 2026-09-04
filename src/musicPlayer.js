const { AudioPlayerStatus, NoSubscriberBehavior, VoiceConnectionStatus, createAudioPlayer, createAudioResource, demuxProbe, entersState, joinVoiceChannel } = require('@discordjs/voice');
const play = require('play-dl');
const path = require('node:path');
const https = require('node:https');
const fs = require('node:fs');
const YTDlpWrap = require('yt-dlp-wrap').default;

const queues = new Map();
const isWin = process.platform === 'win32';
const defaultYtDlpPath = process.env.YTDLP_PATH || path.resolve('tools', isWin ? 'yt-dlp.exe' : 'yt-dlp');
let ytdlp = new YTDlpWrap(defaultYtDlpPath);

async function ensureYtDlp() {
  if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) return;
  if (!fs.existsSync(defaultYtDlpPath)) {
    console.log(`[music] Downloading yt-dlp binary for ${process.platform} to ${defaultYtDlpPath}...`);
    fs.mkdirSync(path.dirname(defaultYtDlpPath), { recursive: true });
    const platformName = isWin ? 'win32' : (process.platform === 'darwin' ? 'mac' : 'linux');
    await YTDlpWrap.downloadFromGithub(defaultYtDlpPath, undefined, platformName);
    if (!isWin) {
      fs.chmodSync(defaultYtDlpPath, 0o755);
    }
    console.log(`[music] yt-dlp binary downloaded successfully.`);
  }
  ytdlp.setBinaryPath(defaultYtDlpPath);
}

function normalizeYouTubeUrl(input) {
  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error('Please provide a valid YouTube URL.');
  }

  const hostname = parsed.hostname.replace('www.', '');
  let videoId = parsed.searchParams.get('v');
  if (hostname === 'youtu.be') videoId = parsed.pathname.slice(1).split('/')[0];
  if (hostname === 'youtube.com' && parsed.pathname.startsWith('/shorts/')) videoId = parsed.pathname.split('/')[2];
  if (hostname === 'youtube.com' && parsed.pathname.startsWith('/embed/')) videoId = parsed.pathname.split('/')[2];
  if (!['youtube.com', 'youtu.be'].includes(hostname) || !/^[\w-]{11}$/.test(videoId || '')) {
    throw new Error('Please provide a valid YouTube video URL.');
  }
  return `https://www.youtube.com/watch?v=${videoId}`;
}

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
    const queue = { connection: null, player, tracks: [], current: null, playing: false, loop: false, volume: 1, lastError: null };
    player.on(AudioPlayerStatus.Idle, () => {
      onTrackEnd(guildId);
      playNext(guildId);
    });
    player.on('error', (error) => console.error(`[music:${guildId}] player error: ${error.message}`));
    queues.set(guildId, queue);
  }
  return queues.get(guildId);
}

async function playNext(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return;
  if (queue.tracks.length === 0) {
    queue.current = null;
    queue.playing = false;
    return;
  }

  const track = queue.tracks.shift();
  queue.current = track;
  try {
    await ensureYtDlp();
    let stream, type;
    try {
      const output = await ytdlp.execPromise([
        track.url,
        '--no-playlist',
        '-f', 'ba/b',
        '--get-url',
        '--no-warnings'
      ]);
      const directUrl = (output || '').trim().split(/\s+/)[0];
      if (!directUrl || !directUrl.startsWith('http')) {
        throw new Error(`Invalid audio URL returned by yt-dlp: "${directUrl}"`);
      }
      const audioStream = await new Promise((resolve, reject) => {
        const request = https.get(directUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode} from stream URL`));
          } else {
            resolve(res);
          }
        });
        request.on('error', reject);
      });
      const probe = await demuxProbe(audioStream);
      stream = probe.stream;
      type = probe.type;
    } catch (ytdlpError) {
      console.log(`[music:${guildId}] yt-dlp extraction failed (${ytdlpError?.message || ytdlpError}), falling back to play.stream...`);
      const playStream = await play.stream(track.url);
      stream = playStream.stream;
      type = playStream.type;
    }

    const resource = createAudioResource(stream, { inputType: type, inlineVolume: true });
    resource.volume.setVolume(queue.volume);
    queue.player.play(resource);
    queue.playing = true;
  } catch (error) {
    const errorMsg = error?.message || (typeof error === 'string' ? error : (error?.statusMessage || String(error))) || 'Unknown audio extraction error';
    console.error(`[music:${guildId}] unable to play ${track.url}:`, errorMsg);
    queue.lastError = errorMsg;
    queue.current = null;
    await playNext(guildId);
  }
}

function onTrackEnd(guildId) {
  const queue = queues.get(guildId);
  if (!queue || !queue.current) return;
  if (queue.loop) queue.tracks.unshift(queue.current);
  queue.current = null;
}

async function addTrack(context, url) {
  const member = context.member;
  const guild = context.guild;
  const voiceChannel = member?.voice?.channel;
  if (!voiceChannel) return 'Join a voice channel first.';

  const cleanUrl = normalizeYouTubeUrl(url);
  let title = 'YouTube Track';
  let thumbnail = null;

  try {
    const info = await play.video_info(cleanUrl);
    title = info.video_details?.title || title;
    thumbnail = info.video_details?.thumbnails?.[0]?.url || thumbnail;
  } catch (err) {
    console.log(`[music] play.video_info failed (${err.message}), using YouTube oEmbed fallback...`);
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(cleanUrl)}&format=json`;
      const oembedData = await new Promise((resolve, reject) => {
        https.get(oembedUrl, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
          });
        }).on('error', reject);
      });
      title = oembedData.title || title;
      thumbnail = oembedData.thumbnail_url || thumbnail;
    } catch (oembedErr) {
      console.error('[music] oEmbed fallback failed:', oembedErr.message);
    }
  }

  const queue = getQueue(guild.id);
  queue.tracks.push({
    title,
    url: cleanUrl,
    thumbnail
  });
  queue.connection ??= joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false
  });
  queue.connection.on('stateChange', (oldState, newState) => {
    console.log(`[voice:${guild.id}] ${oldState.status} -> ${newState.status}`);
  });
  queue.connection.on('debug', (debugMessage) => {
    console.log(`[voice:${guild.id}] ${debugMessage}`);
  });
  queue.connection.on('error', (error) => {
    if (error.code !== 'ABORT_ERR') console.error(`[voice:${guild.id}] connection error: ${error.message}`);
  });
  try {
    await entersState(queue.connection, VoiceConnectionStatus.Ready, 30_000);
  } catch (error) {
    const state = queue.connection.state.status;
    queue.connection.destroy();
    queue.connection = null;
    const reason = state === VoiceConnectionStatus.Destroyed
      ? 'Discord closed the voice session before it started. Use a normal voice channel (not a Stage channel), check the bot role and channel overrides, and ensure only one bot process is running.'
      : state === VoiceConnectionStatus.Signalling || state === VoiceConnectionStatus.Connecting
        ? 'Discord voice UDP handshake did not complete. Check the voice channel permissions, disable VPN/firewall blocking for Node.js, and try another voice channel.'
        : `Connection stopped in ${state} state.`;
    throw new Error(`Voice connection failed. ${reason}`);
  }
  queue.connection.subscribe(queue.player);
  if (!queue.playing) {
    await playNext(message.guild.id);
    if (!queue.playing) return `Could not play that URL. ${queue.lastError || 'Check that the YouTube video is public and playable.'}`;
  }
  return `Queued: **${info.video_details.title}**`;
}

async function connect(message) {
  const voiceChannel = message.member?.voice.channel;
  if (!voiceChannel) return 'Join a voice channel first.';
  const queue = getQueue(message.guild.id);
  if (queue.connection?.state.status === VoiceConnectionStatus.Ready) return `Already connected to **${voiceChannel.name}**.`;
  queue.connection ??= joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: true,
    selfMute: false
  });
  try {
    await entersState(queue.connection, VoiceConnectionStatus.Ready, 30_000);
    return `Connected to **${voiceChannel.name}**. Now use \`!play <YouTube URL>\`.`;
  } catch {
    queue.connection.destroy();
    queue.connection = null;
    return 'Voice connection failed. Use a normal Voice Channel and check Connect, Speak, and Use Voice Activity permissions.';
  }
}

function skip(guildId) {
  const queue = queues.get(guildId);
  if (!queue || (!queue.current && queue.tracks.length === 0)) return false;
  queue.current = null;
  queue.player.stop();
  return true;
}

function pause(guildId) {
  return queues.get(guildId)?.player.pause() ?? false;
}

function resume(guildId) {
  return queues.get(guildId)?.player.unpause() ?? false;
}

function setLoop(guildId, enabled) {
  const queue = getQueue(guildId);
  queue.loop = enabled;
  return queue.loop;
}

function setVolume(guildId, value) {
  const queue = getQueue(guildId);
  queue.volume = Math.max(0, Math.min(2, value / 100));
  return Math.round(queue.volume * 100);
}

function status(guildId) {
  const queue = queues.get(guildId);
  return queue ? {
    current: queue.current,
    tracks: queue.tracks,
    loop: queue.loop,
    volume: Math.round(queue.volume * 100),
    playing: queue.playing,
    paused: queue.player.state.status === AudioPlayerStatus.Paused
  } : null;
}

async function search(query) {
  const results = await play.search(query, { limit: 5, source: { youtube: 'video' } });
  return results.map((result) => ({ title: result.title, url: result.url, duration: result.durationRaw }));
}

function stop(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return false;
  queue.tracks = [];
  queue.current = null;
  queue.playing = false;
  queue.player.stop();
  return true;
}

function leave(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return false;
  queue.player.stop();
  queue.connection?.destroy();
  queue.current = null;
  queue.tracks = [];
  queue.playing = false;
  queues.delete(guildId);
  return true;
}

function list(guildId) {
  return queues.get(guildId)?.tracks ?? [];
}

module.exports = { addTrack, connect, normalizeYouTubeUrl, skip, pause, resume, setLoop, setVolume, status, search, onTrackEnd, stop, leave, list };
