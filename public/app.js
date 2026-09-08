// ============================================================================
// D4C Embed Builder — simple template-based editor
// Click template → edit text directly in preview → paste channel ID → send
// ============================================================================

let dashboardKey = '';

// DOM references
const loginOverlay = document.getElementById('login-overlay');
const loginKeyInput = document.getElementById('login-key');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');
const appEl = document.getElementById('app');
const logoutBtn = document.getElementById('logout-btn');
const channelIdInput = document.getElementById('channel-id');
const validateChannelBtn = document.getElementById('validate-channel-btn');
const channelStatus = document.getElementById('channel-status');
const sendBtn = document.getElementById('send-btn');
const sendStatus = document.getElementById('send-status');

// Preview DOM (editable via contenteditable)
const previewTitle = document.getElementById('preview-title');
const previewDescription = document.getElementById('preview-description');
const previewFields = document.getElementById('preview-fields');

// Template definitions
const templates = {
  announcement: {
    title: '📢 Announcement',
    description: 'Important news for all members!',
    fields: [
      { name: '📋 Details', value: 'What is being announced\nWhy it matters\nWho is affected' },
      { name: '⏰ Timeline', value: 'When this takes effect\nDuration (if applicable)' },
      { name: '❓ Questions?', value: 'Reach out to staff\nCheck #faq for details' }
    ]
  },
  event: {
    title: '🎉 Upcoming Event',
    description: 'Join us for an exciting event!',
    fields: [
      { name: '📅 Event Details', value: 'Event name and type\nDate and time (with timezone)\nLocation / Voice channel' },
      { name: '🎮 Activities', value: 'What we will do\nSpecial guests or hosts\nPrizes or rewards' },
      { name: '✅ How to Join', value: 'React below to get notified\nBe online 10 minutes early\nHave fun!' }
    ]
  },
  giveaway: {
    title: '🎁 Giveaway!',
    description: 'Win amazing prizes by entering below!',
    fields: [
      { name: '🏆 Prize', value: 'What you can win\nValue of the prize\nNumber of winners' },
      { name: '📝 How to Enter', value: 'React with 🎉 to this message\nBe a member of the server\nNo requirements!' },
      { name: '📋 Rules', value: 'Must be in server to claim\nWinner announced in 7 days\nNo alt accounts allowed' }
    ]
  },
  welcome: {
    title: '👋 Welcome to the Server!',
    description: 'We are glad to have you here!',
    fields: [
      { name: '📜 Server Info', value: 'Server name and purpose\nMember count\nFounded date' },
      { name: '📏 Rules', value: 'Be respectful to everyone\nNo spam or self-promote\nFollow Discord ToS' },
      { name: '🎭 Get Roles', value: 'Visit #roles channel\nPick your interests\nGet pinged for events' }
    ]
  },
  changelog: {
    title: '📝 Changelog',
    description: 'What is new in this update!',
    fields: [
      { name: '✨ New Features', value: 'Feature 1 description\nFeature 2 description\nFeature 3 description' },
      { name: '🔧 Improvements', value: 'Improvement 1\nImprovement 2' },
      { name: '🐛 Bug Fixes', value: 'Fixed issue 1\nFixed issue 2\nFixed issue 3' }
    ]
  },
  rules: {
    title: '📜 Server Rules',
    description: 'Please follow these rules at all times!',
    fields: [
      { name: '1️⃣ Be Respectful', value: 'No harassment or hate speech\nTreat others how you want to be treated\nRespect different opinions' },
      { name: '2️⃣ No Spam', value: 'No excessive messages\nNo unwanted DMs to members\nSelf-promo only in designated channels' },
      { name: '3️⃣ Content Guidelines', value: 'No NSFW content\nKeep conversations in correct channels\nNo piracy or illegal content' },
      { name: '⚠️ Punishments', value: '1st offense: Warning\n2nd offense: Mute (1 hour)\n3rd offense: Ban' }
    ]
  }
};

// Toast helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// API helper
async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-dashboard-key': dashboardKey,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

// Login flow
loginBtn.addEventListener('click', () => {
  const key = loginKeyInput.value.trim();
  if (!key) {
    loginError.textContent = 'Please enter a dashboard key.';
    return;
  }
  dashboardKey = key;
  loginError.textContent = '';
  loginOverlay.classList.add('hidden');
  appEl.classList.remove('hidden');
  loadTemplate('announcement');
});

loginKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loginBtn.click();
});

logoutBtn.addEventListener('click', () => {
  dashboardKey = '';
  appEl.classList.add('hidden');
  loginOverlay.classList.remove('hidden');
  loginKeyInput.value = '';
});

// Template selector
document.querySelectorAll('.template-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.template-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    loadTemplate(btn.dataset.template);
  });
});

// Load template into editable preview
function loadTemplate(name) {
  const template = templates[name];
  if (!template) return;

  previewTitle.textContent = template.title;
  previewDescription.textContent = template.description;

  previewFields.innerHTML = '';
  template.fields.forEach((field) => {
    const fieldEl = document.createElement('div');
    fieldEl.className = 'embed-field';
    fieldEl.innerHTML = `
      <div class="embed-field-name" contenteditable="true">${field.name}</div>
      <div class="embed-field-value" contenteditable="true">${field.value}</div>
    `;
    previewFields.appendChild(fieldEl);
  });

  showToast(`Loaded "${name}" template — click any text to edit`, 'info');
}

// Channel validation
validateChannelBtn.addEventListener('click', async () => {
  const channelId = channelIdInput.value.trim();
  if (!/^\d{17,20}$/.test(channelId)) {
    channelStatus.textContent = 'Invalid ID format';
    channelStatus.className = 'channel-status invalid';
    showToast('Channel ID must be 17-20 digits.', 'error');
    return;
  }
  channelStatus.textContent = 'Checking...';
  channelStatus.className = 'channel-status muted';
  const { ok, data } = await apiFetch('/api/validate-channel', {
    method: 'POST',
    body: JSON.stringify({ channelId }),
  });
  if (ok && data.ok) {
    channelStatus.textContent = `${data.guildName} → ${data.channelName}`;
    channelStatus.className = 'channel-status valid';
  } else {
    channelStatus.textContent = data.message || 'Not found';
    channelStatus.className = 'channel-status invalid';
    showToast(data.message || 'Channel not found.', 'error');
  }
});

// Send to Discord
sendBtn.addEventListener('click', async () => {
  const channelId = channelIdInput.value.trim();
  if (!/^\d{17,20}$/.test(channelId)) {
    showToast('Enter a valid Channel ID first.', 'error');
    return;
  }

  // Build sections from the editable preview
  const sections = [];
  const fieldElements = previewFields.querySelectorAll('.embed-field');
  fieldElements.forEach((fieldEl) => {
    const name = fieldEl.querySelector('.embed-field-name').textContent.trim();
    const value = fieldEl.querySelector('.embed-field-value').textContent.trim();
    if (name || value) {
      sections.push({
        heading: name,
        lines: value.split('\n').filter((l) => l.trim()),
      });
    }
  });

  if (sections.length === 0) {
    showToast('Add at least one section.', 'error');
    return;
  }

  const title = previewTitle.textContent.trim();
  const description = previewDescription.textContent.trim();

  const payload = {
    channelId,
    title,
    description,
    sections,
  };

  sendBtn.disabled = true;
  sendStatus.textContent = 'Sending...';

  try {
    const { ok, data } = await apiFetch('/api/send-embed', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (ok && data.ok) {
      showToast('Embed sent successfully!', 'success');
      sendStatus.textContent = 'Sent ✓';
    } else {
      showToast(data.message || 'Failed to send embed.', 'error');
      sendStatus.textContent = 'Failed';
    }
  } catch (err) {
    showToast('Network error — is the bot running?', 'error');
    sendStatus.textContent = 'Error';
  } finally {
    sendBtn.disabled = false;
    setTimeout(() => { sendStatus.textContent = ''; }, 4000);
  }
});