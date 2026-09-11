// ============================================================================
// autoEmoji.js
// ---------------------------------------------------------------------------
// Shared auto-emoji engine used by BOTH the Discord `!ann` command and the
// web dashboard so every announcement line gets a matching emoji automatically.
//
//   pickEmoji(line, index) → best keyword emoji (fallback rotates)
//   emojiLine(line, index) → emoji + line, but never double-decorates a line
//                            that already starts with a symbol/emoji.
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
  const lower = String(line).toLowerCase();
  for (const { keys, emoji } of KEYWORD_EMOJIS) {
    if (keys.some((k) => lower.includes(k))) return emoji;
  }
  return FALLBACK_EMOJIS[(index ?? 0) % FALLBACK_EMOJIS.length];
}

// A line already "decorated" when it starts with any non-word symbol/emoji.
const DECORATED_RE = /^[^\p{L}\p{N}\s]/u;

function emojiLine(line, index) {
  const text = String(line).trim();
  if (!text) return text;
  if (DECORATED_RE.test(text)) return text; // already has an emoji / bullet
  return `${pickEmoji(text, index)} ${text}`;
}

module.exports = { pickEmoji, emojiLine, KEYWORD_EMOJIS, FALLBACK_EMOJIS };