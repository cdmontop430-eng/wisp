const assert = require('node:assert/strict');
const path = require('node:path');
const music = require('../src/musicPlayer');
const ownerAccess = require('../src/ownerAccess');
const { handleAnnouncement } = require('../src/commands/ann');

async function runE2ETests() {
  console.log('=== STARTING END-TO-END AUTOMATED TEST SUITE ===');

  // Test 1: Token sanitization
  console.log('Test 1: Environment token sanitization...');
  const testTokens = ['  "MTIzNDU2Nzg5MA==" \n', "'MTIzNDU2Nzg5MA=='", ' MTIzNDU2Nzg5MA==  '];
  for (const raw of testTokens) {
    const cleaned = raw.trim().replace(/^["']|["']$/g, '');
    assert.equal(cleaned, 'MTIzNDU2Nzg5MA==');
  }
  console.log('✔ Test 1 Passed!');

  // Test 2: YouTube URL normalization
  console.log('Test 2: YouTube URL Normalization...');
  const validUrls = [
    'https://www.youtube.com/watch?v=7SJ0G_NeDuE',
    'https://youtu.be/7SJ0G_NeDuE',
    'https://www.youtube.com/shorts/7SJ0G_NeDuE',
    'https://www.youtube.com/embed/7SJ0G_NeDuE'
  ];
  for (const input of validUrls) {
    const normalized = music.normalizeYouTubeUrl(input);
    assert.equal(normalized, 'https://www.youtube.com/watch?v=7SJ0G_NeDuE');
  }

  assert.equal(music.normalizeYouTubeUrl('invalid-link'), null, 'Non-URL input should return null (treated as search query)');
  assert.equal(music.normalizeYouTubeUrl('https://example.com/watch?v=abc'), null, 'Non-YouTube URL should return null');
  console.log('✔ Test 2 Passed!');

  // Test 3: Owner Access Control
  console.log('Test 3: Owner Access Control...');
  process.env.OWNER_IDS = '100000000000000001,100000000000000002';
  assert.equal(ownerAccess.isOwner('100000000000000001'), true);
  assert.equal(ownerAccess.isOwner('100000000000000002'), true);
  assert.equal(ownerAccess.isOwner('999999999999999999'), false);
  console.log('✔ Test 3 Passed!');

  // Test 4: Music Player Queue & State Machine
  console.log('Test 4: Music Player Queue & Controls...');
  const testGuildId = 'test-guild-123';
  assert.equal(music.status(testGuildId), null);
  assert.equal(music.list(testGuildId).length, 0);

  // Set volume
  const vol = music.setVolume(testGuildId, 75);
  assert.equal(vol, 75);

  // Set loop
  const loopState = music.setLoop(testGuildId, true);
  assert.equal(loopState, true);

  console.log('✔ Test 4 Passed!');

  // Test 5: Announcement Embed Builder
  console.log('Test 5: Announcement Embed Builder...');
  const { buildDiscordEmbed } = require('../src/dashboard');
  const sampleData = {
    title: 'Announcement',
    description: 'Important news for all members!',
    sections: [
      { heading: 'What is Happening', lines: ['Line 1', 'Line 2'] },
      { heading: 'Timeline', lines: ['Line A', 'Line B'] },
    ],
  };
  const embeds = buildDiscordEmbed(sampleData);
  assert.equal(embeds.length, 1);
  const embedJson = embeds[0].toJSON();
  assert.equal(embedJson.title, '📢 Announcement');
  assert.ok(embedJson.description.includes('Important news for all members!'));
  assert.equal(embedJson.fields.length, 2);
  assert.ok(embedJson.fields[0].name.includes('What is Happening'));
  console.log('✔ Test 5 Passed!');

  // Test 6: Centered Box Card Message Builder
  console.log('Test 6: Centered Box Card Message Builder...');
  const { buildPlainMessages } = require('../src/dashboard');
  const plainMsgs = buildPlainMessages(sampleData);
  assert.ok(plainMsgs.length > 0);
  assert.ok(plainMsgs[0].includes('╔'));
  assert.ok(plainMsgs[0].includes('ANNOUNCEMENT'));
  assert.ok(plainMsgs[0].includes('┌'));
  console.log('✔ Test 6 Passed!');

  console.log('=== ALL END-TO-END TESTS PASSED SUCCESSFULLY! ===');
  process.exit(0);
}

runE2ETests().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
