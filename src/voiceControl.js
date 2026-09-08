// ============================================================================
// voiceControl.js
// ---------------------------------------------------------------------------
// Voice channel management utilities — deafen, mute, unmute, undeafen,
// disconnect, and move members between voice channels.
//
// All functions return { ok: boolean, message: string } for easy embed
// responses via the shared embed helper.
// ============================================================================

const { PermissionFlagsBits } = require('discord.js');

/**
 * Check that the bot has permission to moderate voice in this guild.
 */
function botCanModerateVoice(guild) {
  return guild.members.me?.permissions.has(PermissionFlagsBits.MuteMembers | PermissionFlagsBits.DeafenMembers);
}

/**
 * Check that the invoking member is in a voice channel.
 */
function requireVoiceChannel(member) {
  return member?.voice?.channel || null;
}

/**
 * Deafen one or all members in the caller's voice channel.
 * @param {GuildMember} moderator - The member issuing the command.
 * @param {string} [targetId] - Optional: specific user ID to deafen. If omitted, deafens everyone.
 */
async function deafen(moderator, targetId) {
  const channel = requireVoiceChannel(moderator);
  if (!channel) return { ok: false, message: 'You must be in a voice channel to use this.' };
  if (!botCanModerateVoice(moderator.guild)) return { ok: false, message: 'I need **Mute Members** and **Deafen Members** permissions.' };

  if (targetId) {
    const target = channel.members.get(targetId);
    if (!target) return { ok: false, message: 'That user is not in your voice channel.' };
    if (target.id === moderator.guild.ownerId) return { ok: false, message: 'Cannot deafen the server owner.' };
    try {
      await target.voice.setDeaf(true, `Deafened by ${moderator.user.tag}`);
      return { ok: true, message: `Deafened **${target.user.tag}**.` };
    } catch {
      return { ok: false, message: `Failed to deafen **${target.user.tag}**. Check role hierarchy.` };
    }
  }

  // Deafen everyone in the channel
  let count = 0;
  for (const [, member] of channel.members) {
    if (member.id === moderator.guild.ownerId || member.id === moderator.guild.members.me.id) continue;
    try {
      await member.voice.setDeaf(true, `Deafened by ${moderator.user.tag}`);
      count++;
    } catch { /* skip members we can't affect */ }
  }
  return { ok: true, message: `Deafened **${count}** member(s) in **${channel.name}**.` };
}

/**
 * Undeafen one or all members in the caller's voice channel.
 */
async function undeafen(moderator, targetId) {
  const channel = requireVoiceChannel(moderator);
  if (!channel) return { ok: false, message: 'You must be in a voice channel to use this.' };
  if (!botCanModerateVoice(moderator.guild)) return { ok: false, message: 'I need **Mute Members** and **Deafen Members** permissions.' };

  if (targetId) {
    const target = channel.members.get(targetId);
    if (!target) return { ok: false, message: 'That user is not in your voice channel.' };
    try {
      await target.voice.setDeaf(false, `Undeafened by ${moderator.user.tag}`);
      return { ok: true, message: `Undeafened **${target.user.tag}**.` };
    } catch {
      return { ok: false, message: `Failed to undeafen **${target.user.tag}**. Check role hierarchy.` };
    }
  }

  let count = 0;
  for (const [, member] of channel.members) {
    if (member.id === moderator.guild.members.me.id) continue;
    try {
      await member.voice.setDeaf(false, `Undeafened by ${moderator.user.tag}`);
      count++;
    } catch { /* skip */ }
  }
  return { ok: true, message: `Undeafened **${count}** member(s) in **${channel.name}**.` };
}

/**
 * Server-mute one or all members in the caller's voice channel.
 */
async function mute(moderator, targetId) {
  const channel = requireVoiceChannel(moderator);
  if (!channel) return { ok: false, message: 'You must be in a voice channel to use this.' };
  if (!botCanModerateVoice(moderator.guild)) return { ok: false, message: 'I need **Mute Members** permission.' };

  if (targetId) {
    const target = channel.members.get(targetId);
    if (!target) return { ok: false, message: 'That user is not in your voice channel.' };
    if (target.id === moderator.guild.ownerId) return { ok: false, message: 'Cannot mute the server owner.' };
    try {
      await target.voice.setMute(true, `Muted by ${moderator.user.tag}`);
      return { ok: true, message: `Muted **${target.user.tag}**.` };
    } catch {
      return { ok: false, message: `Failed to mute **${target.user.tag}**. Check role hierarchy.` };
    }
  }

  let count = 0;
  for (const [, member] of channel.members) {
    if (member.id === moderator.guild.ownerId || member.id === moderator.guild.members.me.id) continue;
    try {
      await member.voice.setMute(true, `Muted by ${moderator.user.tag}`);
      count++;
    } catch { /* skip */ }
  }
  return { ok: true, message: `Muted **${count}** member(s) in **${channel.name}**.` };
}

/**
 * Unmute one or all members in the caller's voice channel.
 */
async function unmute(moderator, targetId) {
  const channel = requireVoiceChannel(moderator);
  if (!channel) return { ok: false, message: 'You must be in a voice channel to use this.' };
  if (!botCanModerateVoice(moderator.guild)) return { ok: false, message: 'I need **Mute Members** permission.' };

  if (targetId) {
    const target = channel.members.get(targetId);
    if (!target) return { ok: false, message: 'That user is not in your voice channel.' };
    try {
      await target.voice.setMute(false, `Unmuted by ${moderator.user.tag}`);
      return { ok: true, message: `Unmuted **${target.user.tag}**.` };
    } catch {
      return { ok: false, message: `Failed to unmute **${target.user.tag}**. Check role hierarchy.` };
    }
  }

  let count = 0;
  for (const [, member] of channel.members) {
    if (member.id === moderator.guild.members.me.id) continue;
    try {
      await member.voice.setMute(false, `Unmuted by ${moderator.user.tag}`);
      count++;
    } catch { /* skip */ }
  }
  return { ok: true, message: `Unmuted **${count}** member(s) in **${channel.name}**.` };
}

/**
 * Disconnect a specific member from voice (or all members if no target).
 */
async function disconnect(moderator, targetId) {
  const channel = requireVoiceChannel(moderator);
  if (!channel) return { ok: false, message: 'You must be in a voice channel to use this.' };
  if (!moderator.guild.members.me?.permissions.has(PermissionFlagsBits.MoveMembers)) {
    return { ok: false, message: 'I need **Move Members** permission.' };
  }

  if (targetId) {
    const target = channel.members.get(targetId);
    if (!target) return { ok: false, message: 'That user is not in your voice channel.' };
    if (target.id === moderator.guild.ownerId) return { ok: false, message: 'Cannot disconnect the server owner.' };
    try {
      await target.voice.disconnect(`Disconnected by ${moderator.user.tag}`);
      return { ok: true, message: `Disconnected **${target.user.tag}** from voice.` };
    } catch {
      return { ok: false, message: `Failed to disconnect **${target.user.tag}**. Check role hierarchy.` };
    }
  }

  let count = 0;
  for (const [, member] of channel.members) {
    if (member.id === moderator.guild.ownerId || member.id === moderator.guild.members.me.id) continue;
    try {
      await member.voice.disconnect(`Disconnected by ${moderator.user.tag}`);
      count++;
    } catch { /* skip */ }
  }
  return { ok: true, message: `Disconnected **${count}** member(s) from **${channel.name}**.` };
}

/**
 * Move a member (or all members) to another voice channel.
 * @param {GuildMember} moderator
 * @param {string} targetChannelId - The destination voice channel ID.
 * @param {string} [targetUserId] - Optional: specific user to move. If omitted, moves everyone.
 */
async function move(moderator, targetChannelId, targetUserId) {
  const sourceChannel = requireVoiceChannel(moderator);
  if (!sourceChannel) return { ok: false, message: 'You must be in a voice channel to use this.' };
  if (!moderator.guild.members.me?.permissions.has(PermissionFlagsBits.MoveMembers)) {
    return { ok: false, message: 'I need **Move Members** permission.' };
  }

  const destChannel = moderator.guild.channels.cache.get(targetChannelId);
  if (!destChannel || !destChannel.isVoiceBased()) {
    return { ok: false, message: 'Destination channel not found or is not a voice channel.' };
  }

  if (targetUserId) {
    const target = sourceChannel.members.get(targetUserId);
    if (!target) return { ok: false, message: 'That user is not in your voice channel.' };
    try {
      await target.voice.setChannel(destChannel.id, `Moved by ${moderator.user.tag}`);
      return { ok: true, message: `Moved **${target.user.tag}** to **${destChannel.name}**.` };
    } catch {
      return { ok: false, message: `Failed to move **${target.user.tag}**. Check permissions/hierarchy.` };
    }
  }

  let count = 0;
  for (const [, member] of sourceChannel.members) {
    if (member.id === moderator.guild.members.me.id) continue;
    try {
      await member.voice.setChannel(destChannel.id, `Moved by ${moderator.user.tag}`);
      count++;
    } catch { /* skip */ }
  }
  return { ok: true, message: `Moved **${count}** member(s) to **${destChannel.name}**.` };
}

module.exports = { deafen, undeafen, mute, unmute, disconnect, move };
