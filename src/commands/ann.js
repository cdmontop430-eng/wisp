const { MessageFlags, EmbedBuilder } = require('discord.js');
const { emojiLine } = require('../autoEmoji');
const recentAnnouncements = new Map();

// ============================================================================
// CONTENT PARSER
//   "!ann Title here
//    line two
//    line three"
// First line → big embed title. Remaining lines → emoji bullet paragraphs.
// Image detection:
//   • an attached image file on the command message, OR
//   • a line like "image: <url>" / "img= <url>", OR
//   • any direct image URL in the content
// ============================================================================
function parseContent(content, files) {
  let title = 'Announcement';
  let bodyLines = [];
  let imageUrl = null;

  // 1) attached image file takes priority
  const imageAttachment = files.find((f) => /\.(png|jpe?g|gif|webp)$/i.test(f.name));
  if (imageAttachment) imageUrl = imageAttachment.attachment;

  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length > 0) {
    const cleaned = [];
    let inFence = false;
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (line.length === 0 && !inFence) continue;
      // explicit image marker:  image: <url> | img = <url> | picture: <url>
      const marker = line.match(/^(?:image|img|picture|pic)\s*[:=]\s*(https?:\/\/\S+)$/i);
      if (marker && !inFence) {
        imageUrl = marker[1]; // explicit marker overrides attachment
        continue;
      }
      // Code fences (``` blocks) pass through verbatim — they render as neat
      // monospace boxes in Discord; emoji decoration would break them.
      if (line.startsWith('```')) {
        inFence = !inFence;
        cleaned.push(line);
        continue;
      }
      cleaned.push(inFence ? rawLine : line);
    }
    title = cleaned.shift();
    bodyLines = cleaned;
  }

  // 2) scan body lines for a direct image URL (e.g. https://x.com/a.png)
  if (!imageUrl) {
    const imgIndex = bodyLines.findIndex((l) => /^https?:\/\/\S+\.(png|jpe?g|gif|webp)([?#].*)?$/i.test(l));
    if (imgIndex !== -1) {
      imageUrl = bodyLines[imgIndex];
      bodyLines.splice(imgIndex, 1);
    }
  }

  if (!title) title = 'Announcement';
  return { title, bodyLines, imageUrl };
}

// Split emoji bullet lines into embed-safe chunks (4k description limit).
function chunkBody(bodyLines) {
  const chunks = [];
  let current = [];
  let currentLen = 0;
  for (const line of bodyLines) {
    const lineLen = line.length + 10; // emoji + spacing overhead
    if (current.length > 0 && currentLen + lineLen > 3600) {
      chunks.push(current);
      current = [];
      currentLen = 0;
    }
    current.push(line);
    currentLen += lineLen;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function buildDescription(chunk, startIndex) {
  // Fence-aware: lines inside ``` blocks are NOT decorated with emojis and
  // are joined tightly with single newlines so the monospace box renders
  // exactly as pasted. Normal lines keep the spaced bullet style.
  let emojiIndex = startIndex;
  let inFence = false;
  const parts = [];
  let fenceBuffer = [];

  const flushFence = () => {
    if (fenceBuffer.length > 0) {
      parts.push(fenceBuffer.join('\n'));
      fenceBuffer = [];
    }
  };

  for (const line of chunk) {
    const trimmed = String(line).trim();
    if (trimmed.startsWith('```')) {
      if (!inFence) flushFence(); // close any stray block before opening a new one
      inFence = !inFence;
      fenceBuffer.push(trimmed);
      if (!inFence) flushFence(); // fence closed → emit the whole box as one block
      continue;
    }
    if (inFence) {
      fenceBuffer.push(String(line)); // raw — keep spacing inside the box
      continue;
    }
    if (trimmed === '') continue;
    parts.push(emojiLine(line, emojiIndex++));
  }
  flushFence();
  return parts.join('\n\n');
}

function parseSections(bodyLines) {
  let description = '';
  const sections = [];
  let currentSection = null;
  let inFence = false;

  const isHeading = (line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) return false;
    if (/^\*{1,2}\S/.test(trimmed)) return true;
    if (/^#{1,3}\s/.test(trimmed)) return true;
    if (/^[🔒🛠️⚠️📢📌📋🌟💡🚀🎉💎💰🏆🎁📅📜📊❓🤝👋]/u.test(trimmed)) return true;
    if (/[.!?;:]$/.test(trimmed)) return false;
    return trimmed.length <= 50;
  };

  const cleanHeader = (line) => line.replace(/^#+\s*/, '').replace(/^\*+|\*+$/g, '').trim();

  for (const line of bodyLines) {
    const trimmed = String(line).trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      if (currentSection) {
        currentSection.lines.push(trimmed);
      } else {
        description = description ? `${description}\n${trimmed}` : trimmed;
      }
      continue;
    }
    if (inFence) {
      if (currentSection) {
        currentSection.lines.push(line);
      } else {
        description = description ? `${description}\n${line}` : line;
      }
      continue;
    }

    if (isHeading(trimmed)) {
      currentSection = { heading: cleanHeader(trimmed), lines: [] };
      sections.push(currentSection);
    } else if (currentSection) {
      currentSection.lines.push(line);
    } else {
      description = description ? `${description}\n${line}` : line;
    }
  }

  return { description, sections };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================
async function handleAnnouncement(message, content) {
  const files = [...(message.attachments?.values() ?? [])].map((attachment) => ({ attachment: attachment.url, name: attachment.name }));
  if (!content && files.length === 0) {
    return false;
  }

  const normalizedContent = content.replace(/\s+/g, ' ').trim().toLowerCase();
  const fingerprint = `${message.channel.id}:${normalizedContent}:${files.map((file) => file.attachment).sort().join(',')}`;
  const now = Date.now();
  const deduplicationWindow = Math.max(0, Number(process.env.ANNOUNCEMENT_DEDUP_MS) || 600000);
  const lastSent = recentAnnouncements.get(fingerprint) || 0;
  if (now - lastSent < deduplicationWindow) return false;
  recentAnnouncements.set(fingerprint, now);

  await message.delete().catch(() => {});

  const { title, bodyLines, imageUrl } = parseContent(content, files);
  const { description, sections } = parseSections(bodyLines);

  const embedTitle = title.startsWith('📢') ? title : `📢 ${title}`;
  const embed = new EmbedBuilder()
    .setColor(0x5865f2) // Discord blurple — matches the dashboard style
    .setTitle(embedTitle)
    .setFooter({ text: 'D4C • Official Announcement' })
    .setTimestamp();

  if (description) {
    embed.setDescription(description);
  }

  let emojiOffset = 0;
  if (sections.length > 0) {
    for (const sec of sections) {
      if (!sec.heading && sec.lines.length === 0) continue;
      const formattedLines = [];
      let inFence = false;
      for (const line of sec.lines) {
        const t = String(line).trim();
        if (t.startsWith('```')) {
          inFence = !inFence;
          formattedLines.push(t);
          continue;
        }
        if (inFence) {
          formattedLines.push(String(line));
          continue;
        }
        if (!t) continue;
        const decorated = emojiLine(t, emojiOffset++);
        formattedLines.push(`> ${decorated}`);
      }
      const rawHeading = sec.heading.match(/^[^\p{L}\p{N}\s]/u) ? sec.heading : emojiLine(sec.heading, emojiOffset++);
      embed.addFields({
        name: `─── ${rawHeading} ───`,
        value: formattedLines.join('\n') || '—',
        inline: false,
      });
    }
  } else if (bodyLines.length > 0 && !description) {
    const chunks = chunkBody(bodyLines);
    if (chunks[0]) {
      embed.setDescription(buildDescription(chunks[0], 0));
    }
  }

  if (imageUrl) {
    embed.setImage(imageUrl);
  }

  await message.channel.send({
    embeds: [embed],
    allowedMentions: { parse: [] },
  });

  // 2) Still forward non-image attachments exactly like before
  const remainingFiles = files.filter((f) => f.attachment !== imageUrl);
  const attachmentBatches = [];
  for (let index = 0; index < remainingFiles.length; index += 10) {
    attachmentBatches.push(remainingFiles.slice(index, index + 10));
  }
  for (const batch of attachmentBatches) {
    await message.channel.send({
      files: batch,
      flags: MessageFlags.SuppressEmbeds,
      allowedMentions: { parse: [] },
    });
  }

  return true;
}

module.exports = { handleAnnouncement };
