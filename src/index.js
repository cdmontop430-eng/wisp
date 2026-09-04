require('dotenv').config();

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, GatewayIntentBits, MessageFlags, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
const { handleAnnouncement } = require('./commands/ann');
const music = require('./musicPlayer');
const recorder = require('./recorder');
const ownerAccess = require('./ownerAccess');
const broadcast = require('./broadcast');

const webServer = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok', discord: client?.isReady?.() ? 'ready' : 'connecting' }));
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/plain' });
  response.end('D4C Discord bot is running.');
});
webServer.listen(Number(process.env.PORT) || 10000, '0.0.0.0', () => {
  console.log(`Health server listening on port ${webServer.address().port}`);
});

const pidFile = path.resolve('data', 'bot.pid');
fs.mkdirSync(path.dirname(pidFile), { recursive: true });
if (fs.existsSync(pidFile)) {
  const previousPid = Number(fs.readFileSync(pidFile, 'utf8'));
  if (previousPid && previousPid !== process.pid) {
    try {
      process.kill(previousPid, 0);
      throw new Error(`Another bot process is already running (PID ${previousPid}). Stop it before starting another instance.`);
    } catch (error) {
      if (error.message.startsWith('Another bot process')) throw error;
    }
  }
}
fs.writeFileSync(pidFile, String(process.pid));
const releasePidFile = () => {
  if (fs.existsSync(pidFile) && Number(fs.readFileSync(pidFile, 'utf8')) === process.pid) fs.unlinkSync(pidFile);
};
process.on('exit', releasePidFile);

function musicControls() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('d4c_pause').setLabel('Pause').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('d4c_resume').setLabel('Resume').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('d4c_skip').setLabel('Next').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('d4c_loop').setLabel('Loop').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('d4c_stop').setLabel('Stop').setStyle(ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('d4c_queue').setLabel('Refresh queue').setStyle(ButtonStyle.Secondary)
    )
  ];
}

function musicEmbed(guildId) {
  const state = music.status(guildId);
  const current = state?.current;
  const upcoming = state?.tracks?.slice(0, 5) ?? [];
  const status = state?.paused ? 'PAUSED' : current ? 'PLAYING NOW' : 'IDLE';
  const queueText = upcoming.length
    ? upcoming.map((track, index) => `${index + 1}. [${track.title}](${track.url})`).join('\n')
    : 'Queue is empty. Use `!play <YouTube URL>` to add a song.';
  const embed = new EmbedBuilder()
    .setColor(state?.paused ? 0xf59e0b : 0xe11d48)
    .setTitle('D4C RADIO  /  MUSIC PLAYER')
    .setDescription(`**${status}**\n${current ? `[${current.title}](${current.url})` : 'Nothing is playing right now.'}`)
    .addFields(
      { name: 'UP NEXT', value: queueText },
      { name: 'PLAYER', value: `Volume **${state?.volume ?? 100}%**  |  Loop **${state?.loop ? 'ON' : 'OFF'}**  |  ${upcoming.length} queued`, inline: false }
    )
    .setFooter({ text: 'D4C • Use !music anytime to reopen this panel' });
  if (current?.thumbnail) embed.setThumbnail(current.thumbnail);
  return embed;
}

const rawToken = process.env.DISCORD_TOKEN || process.env.TOKEN || process.env.TOKEN1 || process.env.TOKENS;
if (!rawToken) {
  throw new Error('DISCORD_TOKEN is missing. Copy .env.example to .env and add your bot token.');
}
const token = rawToken.trim().replace(/^["']|["']$/g, '');
console.log(`Token loaded (length: ${token.length}, prefix: ${token.substring(0, 12)}...)`);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ]
});

client.once('clientReady', (readyClient) => {
  console.log(`D4C online as ${readyClient.user.tag}`);
});

client.on('shardError', (error) => console.error('Discord WebSocket shard error:', error));
client.on('debug', (info) => {
  if (info.includes('Connect') || info.includes('Heartbeat') || info.includes('40') || info.includes('token') || info.includes('WS')) {
    console.log('[Discord Debug]', info);
  }
});
client.on('error', (error) => console.error('Discord client error:', error));
process.on('unhandledRejection', (error) => console.error('Unhandled promise rejection:', error));

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild || !message.content.startsWith('!')) return;

  const [command, ...args] = message.content.trim().split(/\s+/);
  const content = args.join(' ').trim();
  const commandName = command.toLowerCase();

  try {
    if (commandName === '!addowner') {
      const result = await ownerAccess.addOwner(message, content);
      await message.reply(result.message);
      return;
    }

    if (commandName === '!removeowner') {
      const result = ownerAccess.removeOwner(message, content);
      await message.reply(result.message);
      return;
    }

    if (commandName === '!owners') {
      if (!ownerAccess.canManageOwners(message)) {
        await message.reply('Only a verified owner or server Administrator can view owners.');
        return;
      }
      await message.reply(`Verified owners: ${ownerAccess.ownerIds().map((id) => `<@${id}>`).join(', ') || 'None configured.'}`);
      return;
    }

    if (commandName === '!ann') {
      if (!ownerAccess.isOwner(message.author.id)) return;
      await handleAnnouncement(message, content);
      return;
    }

    if (!ownerAccess.isOwner(message.author.id)) {
      await message.reply('This bot is owner-only. Ask a server Administrator to verify you with `!addowner <your Discord user ID>`.');
      return;
    }

    if (commandName === '!sendall') {
      const progressMessage = await message.reply('DM broadcast started. Sending to server members...');
      const result = await broadcast.sendToAllMembers(message, content, async ({ sent, failed, total }) => {
        await progressMessage.edit(`DM broadcast in progress... Sent: ${sent}/${total} | Failed: ${failed}`);
      });
      await progressMessage.edit(result.message);
      return;
    }

    if (['!join', '!connect'].includes(commandName)) {
      await message.reply(await music.connect(message));
      return;
    }

    if (['!leave', '!disconnect'].includes(commandName)) {
      await message.reply(music.leave(message.guild.id) ? 'Disconnected and cleared the music queue.' : 'The bot is not connected.');
      return;
    }

    if (['!play', '!search'].includes(commandName)) {
      if (!content) {
        const guideEmbed = new EmbedBuilder()
          .setColor(0xe11d48)
          .setTitle('🎵 D4C Interactive Music Search & Player')
          .setDescription('Type `!play <song name>` or `!play <YouTube URL>` to play music!\n\n**Examples:**\n• `!play master vaathi coming`\n• `!play https://www.youtube.com/watch?v=7SJ0G_NeDuE`\n\nWhen you search by song name, a dropdown selection menu will appear so you can pick your exact track!');
        await message.reply({ embeds: [guideEmbed] });
        return;
      }

      const isUrl = /^https?:\/\//i.test(content.trim());
      if (isUrl) {
        const resultMsg = await music.addTrack(message, content.trim());
        if (typeof resultMsg === 'string' && resultMsg.startsWith('Join a voice channel')) {
          await message.reply(resultMsg);
          return;
        }
        await message.reply({ embeds: [musicEmbed(message.guild.id)], components: musicControls() });
        return;
      }

      const searchStatusMsg = await message.reply(`🔍 Searching YouTube for: **${content}**...`);
      let results = [];
      try {
        results = await music.search(content);
      } catch (searchError) {
        console.error(`[search] YouTube search error: ${searchError.message}`);
      }

      if (!results || results.length === 0) {
        await searchStatusMsg.edit(`❌ No songs found on YouTube for: "${content}". Please try another search term or paste a direct YouTube URL.`);
        return;
      }

      const topResults = results.slice(0, 5);
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('d4c_select_song')
        .setPlaceholder('🎵 Select a song from search results...')
        .addOptions(
          topResults.map((track, idx) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(`${idx + 1}. ${track.title.slice(0, 95)}`)
              .setDescription(track.duration ? `Duration: ${track.duration}` : 'YouTube Video')
              .setValue(track.url)
          )
        );

      const menuRow = new ActionRowBuilder().addComponents(selectMenu);
      const searchEmbed = new EmbedBuilder()
        .setColor(0x3b82f6)
        .setTitle(`🔍 YouTube Search Results for: "${content}"`)
        .setDescription(
          topResults.map((r, i) => `**${i + 1}.** [${r.title}](${r.url}) (${r.duration || 'Video'})`).join('\n') +
          '\n\n👇 **Select your song from the dropdown menu below to play:**'
        );

      await searchStatusMsg.edit({
        content: null,
        embeds: [searchEmbed],
        components: [menuRow]
      });
      return;
    }

    if (['!music', '!panel', '!player'].includes(commandName)) {
      await message.reply({ embeds: [musicEmbed(message.guild.id)], components: musicControls() });
      return;
    }

    if (commandName === '!skip') {
      await message.reply(music.skip(message.guild.id) ? 'Skipped.' : 'Nothing is playing.');
      return;
    }

    if (commandName === '!pause') {
      await message.reply(music.pause(message.guild.id) ? 'Paused.' : 'Nothing is playing.');
      return;
    }

    if (commandName === '!resume') {
      await message.reply(music.resume(message.guild.id) ? 'Resumed.' : 'Nothing is paused.');
      return;
    }

    if (commandName === '!now') {
      await message.reply({ embeds: [musicEmbed(message.guild.id)], components: musicControls() });
      return;
    }

    if (commandName === '!loop') {
      const enabled = !['off', 'false', '0'].includes(content.toLowerCase());
      await message.reply(`Loop ${music.setLoop(message.guild.id, enabled) ? 'enabled' : 'disabled'}.`);
      return;
    }

    if (commandName === '!volume') {
      const value = Number(content);
      if (!Number.isFinite(value) || value < 0 || value > 200) return message.reply('Usage: `!volume <0-200>`');
      await message.reply(`Volume set to ${music.setVolume(message.guild.id, value)}%.`);
      return;
    }

    if (commandName === '!247') {
      await message.reply('The bot stays online while its hosting process is running. Use PM2, Docker, Railway, Render, or a VPS for 24/7 uptime.');
      return;
    }

    if (commandName === '!stop') {
      await message.reply(music.stop(message.guild.id) ? 'Audio stopped. Voice channel stays connected.' : 'Nothing is playing.');
      return;
    }

    if (commandName === '!queue') {
      const tracks = music.list(message.guild.id);
      await message.reply(tracks.length ? tracks.map((track, index) => `${index + 1}. ${track.title}`).join('\n') : 'The queue is empty.');
      return;
    }

    if (commandName === '!record') {
      const result = recorder.startRecording(message);
      await message.reply(result.message);
      return;
    }

    if (commandName === '!stoprecord') {
      const filePath = recorder.stopRecording(message.guild.id);
      await message.reply(filePath ? `Recording saved: \`${filePath}\`` : 'There is no active recording.');
      return;
    }

    if (commandName === '!help') {
      await message.reply({ embeds: [new EmbedBuilder().setColor(0xe11d48).setTitle('D4C command center').setDescription('`!music` opens the live player panel.\n\nOwner: `!addowner <ID>` | `!removeowner <ID>` | `!owners` | `!sendall <message>`\n\nVoice: `!join` / `!connect` | `!leave` / `!disconnect`\n\nMusic: `!ann <content>` | `!play <song/URL>` | `!search <song>` | `!queue` | `!now` | `!pause` | `!resume` | `!skip` | `!stop` | `!loop on/off` | `!volume 0-200` | `!record` | `!stoprecord` | `!247`')], components: musicControls() });
    }
  } catch (error) {
    console.error(`[${commandName}] ${error.message}`);
    await message.reply(`Could not complete that command: ${error.message}`).catch(() => {});
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.customId?.startsWith('d4c_')) return;
  if (!ownerAccess.isOwner(interaction.user.id)) {
    await interaction.reply({ content: 'This bot is owner-only.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'd4c_select_song') {
    const selectedUrl = interaction.values[0];
    await interaction.deferUpdate();
    const resultMsg = await music.addTrack(interaction, selectedUrl);
    if (typeof resultMsg === 'string' && resultMsg.startsWith('Join a voice channel')) {
      await interaction.followUp({ content: resultMsg, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.editReply({
      content: null,
      embeds: [musicEmbed(interaction.guildId)],
      components: musicControls()
    });
    return;
  }

  if (interaction.isButton()) {
    const actions = {
      d4c_pause: () => music.pause(interaction.guildId),
      d4c_resume: () => music.resume(interaction.guildId),
      d4c_skip: () => music.skip(interaction.guildId),
      d4c_stop: () => music.stop(interaction.guildId),
      d4c_loop: () => music.setLoop(interaction.guildId, !(music.status(interaction.guildId)?.loop ?? false)),
      d4c_queue: () => true
    };
    if (!actions[interaction.customId]) return;
    actions[interaction.customId]();
    await interaction.update({ embeds: [musicEmbed(interaction.guildId)], components: musicControls() });
  }
});

console.log('Connecting to Discord...');
const loginTimeout = setTimeout(() => {
  console.error('Discord login timed out after 30 seconds. Check the token and Wispbyte network/Gateway access.');
  process.exit(1);
}, 30000);

client.login(token)
  .then(() => clearTimeout(loginTimeout))
  .catch((error) => {
    clearTimeout(loginTimeout);
    console.error('Discord startup failed:', error.message);
    process.exit(1);
  });
