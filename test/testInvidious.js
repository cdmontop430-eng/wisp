

const https = require('https');

const INSTANCES = [
  'invidious.fdn.fr',
  'yewtu.be',
  'inv.tux.pizza',
  'invidious.lunar.icu',
  'iv.datura.network',
  'invidious.nerdvpn.de',
  'invidious.privacydev.net',
  'vid.puffyan.us',
];

const VIDEO_ID = 'jR3rWCBeO6M';

function fetchJson(hostname, videoId) {
  return new Promise((resolve) => {
    const path = `/api/v1/videos/${videoId}?fields=title,adaptiveFormats`;
    const req = https.get({ hostname, path, timeout: 6000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({ ok: true, data });
        } catch {
          resolve({ ok: false, err: 'JSON parse failed: ' + body.slice(0, 80) });
        }
      });
    });
    req.on('error', e => resolve({ ok: false, err: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, err: 'TIMEOUT' }); });
  });
}

(async () => {
  console.log(`Testing Invidious API for video: ${VIDEO_ID}\n`);
  for (const host of INSTANCES) {
    const result = await fetchJson(host, VIDEO_ID);
    if (result.ok) {
      const audioFormats = (result.data.adaptiveFormats || [])
        .filter(f => f.type && f.type.startsWith('audio/'))
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      if (audioFormats.length > 0) {
        console.log(`✅ ${host}`);
        console.log(`   Title: ${result.data.title}`);
        console.log(`   Audio formats: ${audioFormats.length}`);
        console.log(`   Best: ${audioFormats[0].type} @ ${Math.round((audioFormats[0].bitrate || 0) / 1000)}kbps`);
        console.log(`   URL: ${audioFormats[0].url.slice(0, 100)}...\n`);
      } else {
        console.log(`⚠️  ${host} => responded but no audio formats`);
      }
    } else {
      console.log(`❌ ${host} => ${result.err}`);
    }
  }
})();
