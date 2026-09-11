const { MessageFlags, EmbedBuilder } = require('discord.js');
const recentAnnouncements = new Map();

// ============================================================================
// AUTO-EMOJI ENGINE
// Every pasted line automatically gets an emoji picked from its keywords,
// falling back to a rotating set so the announcement always looks alive.
// ============================================================================
const KEYWORD_EMOJIS = [
  { keys: ['urgent', 'important', 'notice', 'warning', 'alert', 'asap', 'attention'], emoji: '🚨' },
  { keys: ['event', 'session', 'meeting', 'meetup', 'live', 'stream', 'tournament'], emoji: '📅' },
  { keys: ['update', 'changelog', 'patch', 'new', 'release', 'launch', 'feature'], emoji: '🚀' },
  { keys: ['giveaway', 'prize', 'winners', 'winner', 'reward', 'raffle', 'win'], emoji: '🎁' },
  { keys: ['welcome', 'hello', 'joined', 'new member', 'arrival'], emoji: '👋' },
  { keys: ['rule', 'rules', 'guideline', 'policy', 'must'], emoji: '📜' },
  { keys: ['maintenance', 'downtime', 'down', 'issue', 'bug', 'fix', 'repair'], emoji: '🔧' },
  { keys: ['help', 'request', 'question', 'support', 'faq', 'need'], emoji: '🆘' },
  { keys: ['congrats', 'congratulations', 'achievement', 'mvp', 'thanks', 'thank', 'gg'], emoji: '🏆' },
  { keys: ['vote', 'poll', 'voting', 'choose'], emoji: '📊' },
  { keys: ['music', 'song', 'audio', 'gaming', 'game', 'server', 'community'], emoji: '🎧' },
  { keys: ['announcement', 'announce', 'news', 'headline', 'mega'], emoji: '📢' },
];
const FALLBACK_EMOJIS = ['⭐', '⚡', '💡', '🔥', '🌟', '🎯', '📌', '✨', '🎉', '🔔'];

function pickEmoji(line, index) {
  const lower = line.toLowerCase();
  for (const { keys, emoji } of KEYWORD_EMOJIS) {
    if (keys.some((k) => lower.includes(k))) return emoji;
  }
  return FALLBACK_EMOJIS[index % FALLBACK_EMOJIS.length];
}

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
    for (const line of lines) {
      // explicit image marker:  image: <url> | img = <url> | picture: <url>
      const marker = line.match(/^(?:image|img|picture|pic)\s*[:=]\s*(https?:\/\/\S+)$/i);
      if (marker) {
        imageUrl = marker[1]; // explicit marker overrides attachment
        continue;
      }
      cleaned.push(line);
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
  return chunk.map((line, i) => `${pickEmoji(line, startIndex + i)} ${line}`).join('\n\n');
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

  // 1) Build the big professional announcement embeds
  const chunks = chunkBody(bodyLines);
  const embedCount = Math.max(chunks.length, 1);
  let emojiOffset = 0;
  for (let i = 0; i < embedCount; i++) {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2) // Discord blurple — matches the dashboard style
      .setTitle(i === 0 ? `📢 ${title}` : `📢 ${title} (continued)`)
      .setDescription(
        chunks[i] && chunks[i].length > 0
          ? buildDescription(chunks[i], emojiOffset)
          : '—'
      )
      .setFooter({ text: 'D4C • Official Announcement' })
      .setTimestamp();

    if (i === 0 && imageUrl) {
      embed.setImage({ url: imageUrl });
    }

    await message.channel.send({
      embeds: [embed],
      flags: MessageFlags.SuppressEmbeds,
      allowedMentions: { parse: [] },
    });
    emojiOffset += chunks[i] ? chunks[i].length : 0;
  }

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
