const YTDlpWrap = require('yt-dlp-wrap').default;
const ytdlp = new YTDlpWrap('tools/yt-dlp.exe');

const TEST_URL = 'https://www.youtube.com/watch?v=jR3rWCBeO6M';

const CLIENTS = [
  'tv_embedded',
  'web_embedded',
  'android_music',
  'mweb',
  'ios,android',
  'android_creator,web_creator',
];

(async () => {
  console.log(`Testing yt-dlp player clients for: ${TEST_URL}\n`);
  for (const client of CLIENTS) {
    try {
      console.log(`Trying: player_client=${client}...`);
      const output = await ytdlp.execPromise([
        TEST_URL,
        '--no-playlist',
        '-f', 'ba/b',
        '--extractor-args', `youtube:player_client=${client}`,
        '--get-url',
        '--no-warnings',
        '--socket-timeout', '10',
      ]);
      const url = (output || '').trim().split(/\s+/)[0];
      if (url && url.startsWith('http')) {
        console.log(`✅ ${client} => SUCCESS: ${url.slice(0, 80)}...\n`);
      } else {
        console.log(`⚠️  ${client} => Got empty URL\n`);
      }
    } catch (e) {
      const msg = e.message || String(e);
      console.log(`❌ ${client} => ${msg.includes('Sign in') ? 'BOT DETECTION' : msg.slice(0, 80)}\n`);
    }
  }
})();
