// ============================================================================
// dashboard.js
// ---------------------------------------------------------------------------
// Express-based web dashboard for building and sending Discord embeds.
//
// Security:
//   Every /api/* route is guarded by requireDashboardAuth which checks the
//   x-dashboard-key header against DASHBOARD_KEY in .env. The real bot token
//   NEVER leaves the server — the frontend only ever talks to our own API.
//
// Routes:
//   GET  /                  → serves the static frontend (public/index.html)
//   GET  /health            → JSON health probe (kept for Render/Wispbyte)
//   POST /api/send-embed    → validates input, builds an embed, sends it
// ============================================================================

const path = require('node:path');
const express = require('express');

const { embed } = require('./embedHelper');
const { emojiLine } = require('./autoEmoji');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DASHBOARD_KEY = process.env.DASHBOARD_KEY || '';

// ---------------------------------------------------------------------------
// Auth middleware — rejects requests without a valid dashboard key.
// ---------------------------------------------------------------------------
function requireDashboardAuth(request, response, next) {
  if (!DASHBOARD_KEY) {
    return response.status(503).json({
      ok: false,
      message: 'Dashboard is disabled. Set DASHBOARD_KEY in .env to enable it.',
    });
  }
  const providedKey = request.headers['x-dashboard-key'] || '';
  if (providedKey !== DASHBOARD_KEY) {
    return response.status(401).json({ ok: false, message: 'Invalid or missing dashboard key.' });
  }
  next();
}

// ---------------------------------------------------------------------------
// Input validation helpers
// ---------------------------------------------------------------------------
function isValidSnowflake(id) {
  return typeof id === 'string' && /^\d{17,20}$/.test(id.trim());
}

function sanitizeText(text, max = 4096) {
  if (typeof text !== 'string') return '';
  return text.slice(0, max);
}

/**
 * Validates the payload from the frontend and returns { ok, data, error }.
 * Expected payload shape:
 *   { channelId, title, description?, sections: [{ heading, lines[], imageUrl?, videoUrl? }] }
 */
function validatePayload(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Request body must be a JSON object.' };
  }

  const channelId = String(body.channelId || '').trim();
  if (!isValidSnowflake(channelId)) {
    return { ok: false, error: 'Channel ID must be a valid Discord snowflake (17-20 digits).' };
  }

  const title = sanitizeText(body.title, 256);
  if (!title) {
    return { ok: false, error: 'Title is required (max 256 characters).' };
  }

  const description = sanitizeText(body.description || '', 4096);

  const rawSections = Array.isArray(body.sections) ? body.sections : [];
  if (rawSections.length === 0) {
    return { ok: false, error: 'At least one section is required.' };
  }
  if (rawSections.length > 25) {
    return { ok: false, error: 'Discord embeds support a maximum of 25 fields/sections.' };
  }

  const sections = [];
  for (const raw of rawSections) {
    const heading = sanitizeText(raw.heading, 256);
    const lines = Array.isArray(raw.lines)
      ? raw.lines.filter((l) => typeof l === 'string' && l.trim().length > 0).map((l) => sanitizeText(l, 1024))
      : [];
    if (!heading && lines.length === 0) continue;
    sections.push({
      heading: heading || 'Section',
      lines,
      imageUrl: sanitizeText(raw.imageUrl || '', 512) || null,
      videoUrl: sanitizeText(raw.videoUrl || '', 512) || null,
    });
  }

  if (sections.length === 0) {
    return { ok: false, error: 'All sections are empty. Add at least one heading or line.' };
  }

  // Optional uploaded image (file, not URL). Frontend sends base64 in JSON.
  let imageUpload = null;
  if (body.imageUpload && typeof body.imageUpload === 'object') {
    const rawBase = typeof body.imageUpload.base64 === 'string' ? body.imageUpload.base64 : '';
    const cleanBase = rawBase.replace(/^data:[^;]+;base64,/, '').trim();
    if (!/^[A-Za-z0-9+/=]+$/.test(cleanBase) || cleanBase.length < 20) {
      return { ok: false, error: 'Invalid uploaded image data.' };
    }
    const bytes = Buffer.from(cleanBase, 'base64');
    if (bytes.length > 8 * 1024 * 1024) {
      return { ok: false, error: 'Uploaded image is too large — max 8 MB.' };
    }
    imageUpload = {
      name: sanitizeText(String(body.imageUpload.name || 'image.jpg'), 255),
      base64: cleanBase,
      mime: sanitizeText(String(body.imageUpload.mime || 'image/png'), 128),
    };
  }

  return { ok: true, data: { channelId, title, description, sections, imageUpload } };
}

// ---------------------------------------------------------------------------
// Build Discord EmbedBuilders from validated dashboard data.
//
// Returns an ARRAY of embeds so very long announcements are NEVER truncated:
//   • Every section heading becomes a big `## Heading` markdown header
//   • Every line gets an auto-assigned emoji (shared with !ann)
//   • Content is split across embeds when it exceeds Discord's 4k limit
//   • The first section's imageUrl becomes the first embed's image
// ---------------------------------------------------------------------------
function buildDiscordEmbed(data) {
  const coverImage = data.sections.find((s) => s.imageUrl)?.imageUrl || null;

  // Flat list of visual blocks: headings + emoji lines + video links.
  // `# heading` = Discord's LARGEST markdown heading (big fonts in the chat).
  const blocks = [];
  if (data.description) blocks.push(data.description);
  for (const section of data.sections) {
    blocks.push(`# ${section.heading}`);
    section.lines.forEach((line, i) => blocks.push(emojiLine(line, blocks.length + i)));
    if (section.videoUrl) blocks.push(`▶ [Watch Video](${section.videoUrl})`);
  }

  // Chunk blocks so each embed description stays under Discord's 4096 limit.
  const DESCRIPTION_LIMIT = 4000;
  const chunks = [];
  let current = [];
  let currentLen = 0;
  for (const block of blocks) {
    const blockLen = block.length + 1;
    if (current.length > 0 && currentLen + blockLen > DESCRIPTION_LIMIT) {
      chunks.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(block);
    currentLen += blockLen;
  }
  if (current.length > 0) chunks.push(current);

  if (chunks.length === 0) chunks.push([]);

  // One embed per chunk → full content always appears in the channel.
  return chunks.map((chunk, index) => {
    const announcementEmbed = embed({
      type: 'info',
      title: index === 0 ? `📢 ${data.title}` : undefined,
      description: chunk.join('\n') || '—',
      image: index === 0 ? coverImage : null,
      footer: 'D4C • Official Announcement',
    });

    // Discord requires a title on early embeds for clean continuation.
    if (index > 0) {
      announcementEmbed.setTitle(`📢 ${data.title} (continued)`);
    }
    return announcementEmbed;
  });
}

// ---------------------------------------------------------------------------
// Create and configure the Express app.
// @param {Client} discordClient  - The logged-in discord.js Client instance.
// @returns {Express}              - The configured Express application.
// ---------------------------------------------------------------------------
function createDashboard(discordClient) {
  const app = express();

  // Parse JSON bodies up to 16 MB (JSON refuses; embeds + base64 image uploads fit).
  app.use(express.json({ limit: '16mb' }));

  // Serve the static frontend from /public at the site root.
  const publicDir = path.resolve('public');
  app.use(express.static(publicDir));

  // Health probe (also useful for uptime monitors).
  app.get('/health', (request, response) => {
    response.json({
      ok: true,
      discord: discordClient?.isReady?.() ? 'ready' : 'connecting',
    });
  });

  // ----- Protected API routes below -----
  app.use('/api', requireDashboardAuth);

  /**
   * POST /api/send-embed
   * Body: { channelId, title, description?, sections[] }
   * Returns: { ok: true, messageId } | { ok: false, message }
   */
  app.post('/api/send-embed', async (request, response) => {
    const validation = validatePayload(request.body);
    if (!validation.ok) {
      return response.status(400).json({ ok: false, message: validation.error });
    }
    const data = validation.data;

    // Look up the target channel.
    let channel;
    try {
      channel = await discordClient.channels.fetch(data.channelId);
    } catch (err) {
      console.error(`[dashboard] Channel fetch failed for ${data.channelId}: ${err.message}`);
      return response.status(404).json({
        ok: false,
        message: 'Channel not found. Check the ID and make sure the bot is in that server.',
      });
    }

    if (!channel.isTextBased() || channel.isDMBased()) {
      return response.status(400).json({
        ok: false,
        message: 'Target must be a server text or announcement channel, not a DM or voice channel.',
      });
    }

    // Build and send the embed(s). Long content = multiple embeds, so the
    // FULL announcement always appears in the channel. An uploaded cover
    // image is attached (file format, not URL) to the first message.
    const discordEmbeds = buildDiscordEmbed(data);
    const attachmentFiles = data.imageUpload
      ? [{ name: data.imageUpload.name, attachment: Buffer.from(data.imageUpload.base64, 'base64') }]
      : [];
    try {
      let firstId = null;
      let sentCount = 0;
      for (const discordEmbed of discordEmbeds) {
        const sent = await channel.send({
          embeds: [discordEmbed],
          ...(sentCount === 0 && attachmentFiles.length > 0 ? { files: attachmentFiles } : {}),
        });
        if (!firstId) firstId = sent.id;
        sentCount++;
      }
      console.log(`[dashboard] ${sentCount} embed(s) sent to #${channel.name} (${channel.id}) by dashboard.`);
      return response.json({ ok: true, messageId: firstId, embeds: sentCount });
    } catch (err) {
      console.error(`[dashboard] Failed to send embed to ${data.channelId}: ${err.message}`);
      if (err.code === 50013) {
        return response.status(403).json({
          ok: false,
          message: 'Missing Permissions — the bot cannot send messages in that channel. Check View Channel + Send Messages + Embed Links.',
        });
      }
      return response.status(500).json({
        ok: false,
        message: `Send failed: ${err.message}`,
      });
    }
  });

  /**
   * POST /api/validate-channel
   * Lightweight endpoint for the frontend to check channel access early.
   * Body: { channelId } → returns channel name + guild name if reachable.
   */
  app.post('/api/validate-channel', async (request, response) => {
    const channelId = String(request.body?.channelId || '').trim();
    if (!isValidSnowflake(channelId)) {
      return response.status(400).json({ ok: false, message: 'Invalid channel ID format.' });
    }
    try {
      const channel = await discordClient.channels.fetch(channelId);
      if (!channel.isTextBased()) {
        return response.status(400).json({ ok: false, message: 'That channel is not a text channel.' });
      }
      return response.json({
        ok: true,
        channelName: `#${channel.name}`,
        guildName: channel.guild?.name ?? 'Unknown server',
      });
    } catch {
      return response.status(404).json({ ok: false, message: 'Channel not found or bot lacks access.' });
    }
  });

  return app;
}

module.exports = { createDashboard, buildDiscordEmbed, validatePayload };
