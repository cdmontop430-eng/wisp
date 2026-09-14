const { buildPlainMessages } = require('../src/dashboard');

const data = {
  title: 'DARK - RULES & REGULATIONS',
  description: 'Welcome to DARK! Please follow these rules.',
  sections: [
    { heading: '⚠️ Consequences', lines: ['🚨 First offense: warning', '🎉 Second offense: mute', '🔔 Third offense: ban'], imageUrl: null, videoUrl: null },
    { heading: '✅ Completed Tasks', lines: ['Task one done', 'Task two done'], imageUrl: null, videoUrl: null },
    { heading: '🎯 Action Required', lines: ['🆘 What members need to do', '🔥 Deadlines'], imageUrl: null, videoUrl: null },
    { heading: '📜 General Rules', lines: ['Be respectful', 'No NSFW content'], imageUrl: null, videoUrl: null },
  ]
};

const msgs = buildPlainMessages(data);
const raw = msgs.join('\n');
const lines = raw.split('\n');

// Compute visual width: emoji in U+1F000-U+1FFFF = 2, FE0F/ZWJ = 0, all else = 1
function visualWidth(line) {
  let w = 0;
  const chars = [...line]; // spread handles surrogate pairs
  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i].codePointAt(0);
    if (cp === 0xFE0F || cp === 0xFE0E || cp === 0x200D || cp === 0x20E3) {
      w += 0; // zero-width
    } else if ((cp >= 0x1F000 && cp <= 0x1FFFF)) {
      w += 2; // pure emoji
    } else {
      w += 1; // everything else (box chars, spaces, legacy symbols) = 1
    }
  }
  return w;
}

let allOk = true;
for (const line of lines) {
  if (!line.startsWith('│') && !line.startsWith('║') && !line.startsWith('└') &&
      !line.startsWith('╚') && !line.startsWith('┌') && !line.startsWith('╔') &&
      !line.startsWith('├') && !line.startsWith('╠')) continue;
  if (line.startsWith('```')) continue;
  
  const vw = visualWidth(line);
  const ok = vw === 38;
  if (!ok) {
    allOk = false;
    console.log(`WRONG(${vw}) ${line}`);
  } else {
    console.log(`OK(${vw}) ${line.slice(0,50)}`);
  }
}
if (allOk) console.log('\n✅ All lines are exactly 38 columns wide!');
else console.log('\n❌ Some lines are misaligned!');
