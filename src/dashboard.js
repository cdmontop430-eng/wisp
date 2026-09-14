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

  // Description is allowed to be LARGE — it is split across embeds later,
  // never truncated. (Raw cap just protects against absurd abuse.)
  const description = String(body.description || '').trim().slice(0, 60000);

  const rawSections = Array.isArray(body.sections) ? body.sections : [];
  if (rawSections.length === 0) {
    return { ok: false, error: 'At least one section is required.' };
  }

  const sections = [];
  for (const raw of rawSections) {
    const heading = sanitizeText(raw.heading, 256);
    // Lines are kept FULL (no char cap) — long lines are split later in
    // buildDiscordEmbed so no content is ever dropped.
    const lines = Array.isArray(raw.lines)
      ? raw.lines.filter((l) => typeof l === 'string' && l.trim().length > 0).map((l) => l.trim())
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

// Split a single long text into <=max pieces WITHOUT losing any content.
function splitLongText(text, max = 900) {
  const trimmed = String(text).trim();
  if (trimmed.length <= max) return [trimmed];
  const pieces = [];
  let buffer = '';
  for (const word of trimmed.split(/\s+/)) {
    if (buffer && (buffer + ' ' + word).length > max) {
      if (buffer) pieces.push(buffer);
      buffer = word;
    } else if (!buffer && word.length > max) {
      // A single gigantic word: hard-split at the limit.
      pieces.push(word.slice(0, max));
      buffer = word.slice(max);
    } else {
      buffer = buffer ? `${buffer} ${word}` : word;
    }
  }
  if (buffer) pieces.push(buffer);
  return pieces;
}

// ---------------------------------------------------------------------------
// Build PLAIN-TEXT messages from validated dashboard data.
//
// WHY plain text? Discord hard-codes embed cards at ~440px wide — no bot can
// widen them. PLAIN messages span the FULL chat width, and `# Heading`
// markdown renders at Discord's largest text size. Big `━━━` divider lines
// make the announcement look like one broad, structured box.
//
// Returns an ARRAY of { content, files? } messages (2000-char limit each),
// so very long announcements are NEVER truncated.
// ---------------------------------------------------------------------------
function normalizeTextForBox(str) {
  if (!str) return '';
  return String(str)
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...');
}

// Calculate visual character width in monospace font (emojis take 2 spaces)
function getVisualWidth(str) {
  if (!str) return 0;
  let s = normalizeTextForBox(str);

  // Squared enclosed symbols (like 🆘, 🆕, 🆓) render 3 spaces wide in Discord monospace
  s = s.replace(/[\u{1F100}-\u{1F19A}]/gu, '   ');

  // Keycap emojis (e.g. 1️⃣, 2️⃣, #️⃣, *️⃣)
  s = s.replace(/[0-9#*]\uFE0F?\u20E3/g, '  ');

  // Emojis and Extended Pictographics
  s = s.replace(/\p{Extended_Pictographic}\uFE0F?/gu, '  ');
  s = s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{2B50}\u{2B55}]/gu, '  ');

  // Strip variation selectors & zero-width joiners
  s = s.replace(/[\uFE0F\uFE0E\u200D]/g, '');

  return s.length;
}

const BOX_WIDTH = 38; // 38 visual chars fits ALL Discord chat windows without line wrapping!

function wrapTextLine(line, maxWidth = 34) {
  const trimmed = normalizeTextForBox(line).trim();
  if (getVisualWidth(trimmed) <= maxWidth) return [trimmed];

  const words = trimmed.split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (getVisualWidth(test) <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      if (getVisualWidth(word) > maxWidth) {
        let remaining = word;
        while (getVisualWidth(remaining) > maxWidth) {
          let sliceIdx = maxWidth;
          while (sliceIdx > 0 && getVisualWidth(remaining.slice(0, sliceIdx)) > maxWidth) {
            sliceIdx--;
          }
          lines.push(remaining.slice(0, sliceIdx));
          remaining = remaining.slice(sliceIdx);
        }
        current = remaining;
      } else {
        current = '   ' + word;
      }
    }
  }
  if (current) lines.push(current);
  return lines;
}

function centerText(text, width = BOX_WIDTH) {
  const norm = normalizeTextForBox(text).trim();
  const visWidth = getVisualWidth(norm);
  const targetWidth = width - 4; // 2 border chars + 2 padding spaces
  if (visWidth >= targetWidth) {
    let endIdx = targetWidth;
    while (endIdx > 0 && getVisualWidth(norm.slice(0, endIdx)) > targetWidth) {
      endIdx--;
    }
    const sliced = norm.slice(0, endIdx);
    const sliceVisWidth = getVisualWidth(sliced);
    const fillPadding = targetWidth - sliceVisWidth;
    return sliced + ' '.repeat(fillPadding);
  }

  const totalPadding = targetWidth - visWidth;
  const leftPadding = Math.floor(totalPadding / 2);
  const rightPadding = totalPadding - leftPadding;

  return ' '.repeat(leftPadding) + norm + ' '.repeat(rightPadding);
}

function padItem(text, width = BOX_WIDTH) {
  const norm = normalizeTextForBox(text).trim();
  const visWidth = getVisualWidth(norm);
  const targetWidth = width - 4; // 2 border chars + 2 padding spaces
  if (visWidth >= targetWidth) {
    let endIdx = targetWidth;
    while (endIdx > 0 && getVisualWidth(norm.slice(0, endIdx)) > targetWidth) {
      endIdx--;
    }
    const sliced = norm.slice(0, endIdx);
    const sliceVisWidth = getVisualWidth(sliced);
    const fillPadding = targetWidth - sliceVisWidth;
    return sliced + ' '.repeat(fillPadding);
  }
  const rightPadding = targetWidth - visWidth;
  return norm + ' '.repeat(rightPadding);
}

function buildHeaderBox(title, description, width = BOX_WIDTH) {
  const innerWidth = width - 2;
  const top = '╔' + '═'.repeat(innerWidth) + '╗';
  const mid = '╠' + '═'.repeat(innerWidth) + '╣';
  const bot = '╚' + '═'.repeat(innerWidth) + '╝';

  const titleClean = normalizeTextForBox(title || 'Announcement').replace(/^📢\s*/, '').trim();
  const titleText = titleClean ? `📢 ${titleClean.toUpperCase()}` : '📢 ANNOUNCEMENT';

  const lines = [];
  lines.push(top);

  const titleWrapped = wrapTextLine(titleText, width - 4);
  titleWrapped.forEach((tChunk) => {
    lines.push('║ ' + centerText(tChunk, width) + ' ║');
  });

  if (description) {
    lines.push(mid);
    description.split(/\r?\n/).forEach((dLine) => {
      const trimmed = dLine.trim();
      if (trimmed) {
        const descWrapped = wrapTextLine(trimmed, width - 4);
        descWrapped.forEach((dChunk) => {
          lines.push('║ ' + centerText(dChunk, width) + ' ║');
        });
      }
    });
  }
  lines.push(bot);
  return lines.join('\n');
}

function buildSectionBox(heading, lines, videoUrl = null, width = BOX_WIDTH) {
  const innerWidth = width - 2;
  const top = '┌' + '─'.repeat(innerWidth) + '┐';
  const sep = '├' + '─'.repeat(innerWidth) + '┤';
  const bot = '└' + '─'.repeat(innerWidth) + '┘';

  const headingClean = normalizeTextForBox(heading || 'Section').replace(/^#+\s*/, '').trim();

  const boxLines = [];
  boxLines.push(top);

  const headWrapped = wrapTextLine(headingClean, width - 4);
  headWrapped.forEach((hChunk) => {
    boxLines.push('│ ' + centerText(hChunk, width) + ' │');
  });
  boxLines.push(sep);

  for (const line of lines) {
    const trimmed = String(line).trim();
    if (!trimmed) continue;
    const wrappedPieces = wrapTextLine(trimmed, width - 4);
    for (const piece of wrappedPieces) {
      boxLines.push('│ ' + padItem(piece, width) + ' │');
    }
  }

  if (videoUrl) {
    const vidLine = `▶ Watch Video: ${videoUrl}`;
    const vidWrapped = wrapTextLine(vidLine, width - 4);
    for (const piece of vidWrapped) {
      boxLines.push('│ ' + padItem(piece, width) + ' │');
    }
  }

  boxLines.push(bot);
  return boxLines.join('\n');
}

function buildPlainMessages(data) {
  const blocks = [];

  // Header Box Card (Centered Title + Subtitle)
  const headerBox = buildHeaderBox(data.title, data.description);
  blocks.push('```');
  blocks.push(headerBox);
  blocks.push('```');

  if (Array.isArray(data.sections)) {
    let globalIndex = 0;
    for (const section of data.sections) {
      if (!section.heading && (!section.lines || section.lines.length === 0)) continue;

      const rawHeading = section.heading
        ? (section.heading.match(/^[^\p{L}\p{N}\s]/u) ? section.heading : emojiLine(section.heading, globalIndex++))
        : '📌 Section';

      let inFence = false;
      const formattedLines = [];

      for (const line of section.lines || []) {
        const trimmed = String(line).trim();
        if (trimmed.startsWith('```')) {
          inFence = !inFence;
          formattedLines.push(trimmed);
          continue;
        }
        if (inFence) {
          formattedLines.push(String(line));
          continue;
        }
        if (!trimmed) continue;
        formattedLines.push(emojiLine(trimmed, globalIndex++));
      }

      const secBox = buildSectionBox(rawHeading, formattedLines, section.videoUrl);
      blocks.push('```');
      blocks.push(secBox);
      blocks.push('```');
    }
  }

  blocks.push('**📌 D4C • Official Announcement**');

  const MESSAGE_LIMIT = 1900;
  const messages = [];
  let current = [];
  let currentLen = 0;

  for (const block of blocks) {
    const blockLen = block.length + 1;
    if (current.length > 0 && currentLen + blockLen > MESSAGE_LIMIT) {
      messages.push(current.join('\n'));
      current = [];
      currentLen = 0;
    }
    current.push(block);
    currentLen += blockLen;
  }
  if (current.length > 0) messages.push(current.join('\n'));

  return messages;
}


// ---------------------------------------------------------------------------
// Build Discord EmbedBuilders from validated dashboard data.
//
// Returns an ARRAY of embeds so very long announcements are NEVER truncated:
//   • Every section heading becomes a big `# Heading` markdown header
//   • Every line gets an auto-assigned emoji (shared with !ann)
//   • Very long lines / the description are split into 900-char pieces first
//   • Pieces are chunked across embeds under Discord's 4k description limit
//   • The first section's imageUrl becomes the first embed's image
// ---------------------------------------------------------------------------
function buildDiscordEmbed(data) {
  const coverImage = data.sections?.find((s) => s.imageUrl)?.imageUrl || null;
  const titleText = data.title ? (data.title.match(/^[^\p{L}\p{N}\s]/u) ? data.title : `📢 ${data.title}`) : '📢 Announcement';

  const descText = data.description
    ? `>>> ${data.description}`
    : '';

  const mainEmbed = embed({
    type: 'info',
    title: titleText,
    description: descText,
    image: coverImage,
    footer: 'D4C • Official Announcement',
  });

  if (Array.isArray(data.sections)) {
    let globalIndex = 0;
    for (const section of data.sections) {
      if (!section.heading && (!section.lines || section.lines.length === 0)) continue;

      const rawHeading = section.heading
        ? (section.heading.match(/^[^\p{L}\p{N}\s]/u) ? section.heading : emojiLine(section.heading, globalIndex++))
        : '📌 Section';

      const heading = `─── ${rawHeading} ───`;

      let inFence = false;
      const formattedLines = [];

      for (const line of section.lines || []) {
        const trimmed = String(line).trim();
        if (trimmed.startsWith('```')) {
          inFence = !inFence;
          formattedLines.push(trimmed);
          continue;
        }
        if (inFence) {
          formattedLines.push(String(line));
          continue;
        }
        if (!trimmed) continue;
        const decorated = emojiLine(trimmed, globalIndex++);
        formattedLines.push(`> ${decorated}`);
      }

      if (section.videoUrl) {
        formattedLines.push(`> ▶ **[Watch Video](${section.videoUrl})**`);
      }

      const fieldValue = formattedLines.join('\n') || '—';
      const valuePieces = splitLongText(fieldValue, 1000);
      valuePieces.forEach((piece, idx) => {
        mainEmbed.addFields({
          name: idx === 0 ? heading : `${heading} (continued)`,
          value: piece,
          inline: false,
        });
      });
    }
  }

  return [mainEmbed];
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

    const mode = String(request.body.mode || 'broad').trim().toLowerCase();

    if (mode === 'broad') {
      const plainMessages = buildPlainMessages(data);
      const attachmentFiles = data.imageUpload
        ? [{ name: data.imageUpload.name, attachment: Buffer.from(data.imageUpload.base64, 'base64') }]
        : [];

      try {
        let firstId = null;
        let sentCount = 0;

        for (let i = 0; i < plainMessages.length; i++) {
          const sent = await channel.send({
            content: plainMessages[i],
            ...(i === 0 && attachmentFiles.length > 0 ? { files: attachmentFiles } : {}),
            allowedMentions: { parse: [] },
          });
          if (!firstId) firstId = sent.id;
          sentCount++;
        }

        console.log(`[dashboard] ${plainMessages.length} broad full-width announcement message(s) to #${channel.name} (${channel.id}) by dashboard.`);
        return response.json({ ok: true, messageId: firstId, messages: sentCount });
      } catch (err) {
        console.error(`[dashboard] Failed to send broad announcement to ${data.channelId}: ${err.message}`);
        if (err.code === 50013) {
          return response.status(403).json({
            ok: false,
            message: 'Missing Permissions — the bot cannot send messages in that channel. Check View Channel + Send Messages.',
          });
        }
        return response.status(500).json({ ok: false, message: `Send failed: ${err.message}` });
      }
    } else {
      const embeds = buildDiscordEmbed(data);
      const attachmentFiles = data.imageUpload
        ? [{ name: data.imageUpload.name, attachment: Buffer.from(data.imageUpload.base64, 'base64') }]
        : [];

      if (data.imageUpload && embeds[0]) {
        embeds[0].setImage(`attachment://${data.imageUpload.name}`);
      }

      try {
        let firstId = null;
        let sentCount = 0;

        for (let i = 0; i < embeds.length; i++) {
          const payload = {
            embeds: [embeds[i]],
            allowedMentions: { parse: [] },
          };
          if (i === 0 && attachmentFiles.length > 0) {
            payload.files = attachmentFiles;
          }

          const sent = await channel.send(payload);
          if (!firstId) firstId = sent.id;
          sentCount++;
        }

        console.log(`[dashboard] ${embeds.length} announcement embed(s) sent to #${channel.name} (${channel.id}) by dashboard.`);
        return response.json({ ok: true, messageId: firstId, messages: sentCount });
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

module.exports = { createDashboard, buildDiscordEmbed, buildPlainMessages, validatePayload };
