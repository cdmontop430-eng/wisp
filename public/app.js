/* ============================================================================
   D4C Embed Builder — frontend logic (part 1: setup, login, channel, sections)
   ========================================================================== */

// ----- Dashboard key stored in memory only (never persisted to disk) -----
let dashboardKey = '';

// ----- DOM references -----
const loginOverlay = document.getElementById('login-overlay');
const loginKeyInput = document.getElementById('login-key');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');
const appEl = document.getElementById('app');
const logoutBtn = document.getElementById('logout-btn');

const channelIdInput = document.getElementById('channel-id');
const validateChannelBtn = document.getElementById('validate-channel-btn');
const channelStatus = document.getElementById('channel-status');

const embedTitleInput = document.getElementById('embed-title');
const embedDescriptionInput = document.getElementById('embed-description');

const sectionsContainer = document.getElementById('sections-container');
const addSectionBtn = document.getElementById('add-section-btn');

const sendBtn = document.getElementById('send-btn');
const sendStatus = document.getElementById('send-status');

// Preview DOM
const previewTitle = document.getElementById('preview-title');
const previewDescription = document.getElementById('preview-description');
const previewFields = document.getElementById('preview-fields');
const previewImageWrapper = document.getElementById('preview-image-wrapper');
const previewImage = document.getElementById('preview-image');

// ----- Template definitions -----
const templates = {
  announcement: {
    title: '📢 Announcement',
    description: 'Important news for all members!',
    sections: [
      { heading: '📋 Details', lines: ['What is being announced', 'Why it matters', 'Who is affected'] },
      { heading: '⏰ Timeline', lines: ['When this takes effect', 'Duration (if applicable)'] },
      { heading: '❓ Questions?', lines: ['Reach out to staff', 'Check #faq for details'] }
    ]
  },
  event: {
    title: '🎉 Upcoming Event',
    description: 'Join us for an exciting event!',
    sections: [
      { heading: '📅 Event Details', lines: ['Event name and type', 'Date and time (with timezone)', 'Location / Voice channel'] },
      { heading: '🎮 Activities', lines: ['What we will do', 'Special guests or hosts', 'Prizes or rewards'] },
      { heading: '✅ How to Join', lines: ['React below to get notified', 'Be online 10 minutes early', 'Have fun!'] }
    ]
  },
  giveaway: {
    title: '🎁 Giveaway!',
    description: 'Win amazing prizes by entering below!',
    sections: [
      { heading: '🏆 Prize', lines: ['What you can win', 'Value of the prize', 'Number of winners'] },
      { heading: '📝 How to Enter', lines: ['React with 🎉 to this message', 'Be a member of the server', 'No requirements!'] },
      { heading: '📋 Rules', lines: ['Must be in server to claim', 'Winner announced in 7 days', 'No alt accounts allowed'] }
    ]
  },
  welcome: {
    title: '👋 Welcome to the Server!',
    description: 'We are glad to have you here!',
    sections: [
      { heading: '📜 Server Info', lines: ['Server name and purpose', 'Member count', 'Founded date'] },
      { heading: '📏 Rules', lines: ['Be respectful to everyone', 'No spam or self-promote', 'Follow Discord ToS'] },
      { heading: '🎭 Get Roles', lines: ['Visit #roles channel', 'Pick your interests', 'Get pinged for events'] }
    ]
  },
  changelog: {
    title: '📝 Changelog',
    description: 'What is new in this update!',
    sections: [
      { heading: '✨ New Features', lines: ['Feature 1 description', 'Feature 2 description', 'Feature 3 description'] },
      { heading: '🔧 Improvements', lines: ['Improvement 1', 'Improvement 2'] },
      { heading: '🐛 Bug Fixes', lines: ['Fixed issue 1', 'Fixed issue 2', 'Fixed issue 3'] }
    ]
  },
  rules: {
    title: '📜 Server Rules',
    description: 'Please follow these rules at all times!',
    sections: [
      { heading: '1️⃣ Be Respectful', lines: ['No harassment or hate speech', 'Treat others how you want to be treated', 'Respect different opinions'] },
      { heading: '2️⃣ No Spam', lines: ['No excessive messages', 'No unwanted DMs to members', 'Self-promo only in designated channels'] },
      { heading: '3️⃣ Content Guidelines', lines: ['No NSFW content', 'Keep conversations in correct channels', 'No piracy or illegal content'] },
      { heading: '⚠️ Punishments', lines: ['1st offense: Warning', '2nd offense: Mute (1 hour)', '3rd offense: Ban'] }
    ]
  }
};

// ----- Toast helper -----
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

// ----- API helper — always sends the dashboard key header -----
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

// ----- Login flow -----
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
  document.querySelector('[data-template="announcement"]').classList.add('active');
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

// ----- Template selector -----
document.querySelectorAll('.template-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const templateName = btn.dataset.template;
    loadTemplate(templateName);
    // Highlight active template
    document.querySelectorAll('.template-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

/**
 * Load a template into the builder.
 * Clears existing sections and populates with the template's structure.
 */
function loadTemplate(templateName) {
  const template = templates[templateName];
  if (!template) return;

  // Set title and description
  embedTitleInput.value = template.title;
  embedDescriptionInput.value = template.description;

  // Clear existing sections
  sectionsContainer.innerHTML = '';
  sectionCounter = 0;

  // Add template sections
  template.sections.forEach((sectionData) => {
    addSection();
    const lastSection = sectionsContainer.lastElementChild;
    lastSection.querySelector('.section-heading').value = sectionData.heading;
    const linesContainer = lastSection.querySelector('.section-lines');
    linesContainer.innerHTML = '';
    sectionData.lines.forEach((lineText) => {
      addLine(lastSection);
      const lastLine = linesContainer.lastElementChild;
      lastLine.querySelector('.line-input').value = lineText;
    });
  });

  updatePreview();
  showToast(`Loaded "${templateName}" template`, 'info');
}

// ----- Channel validation -----
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

// ----- Section management -----
let sectionCounter = 0;

function addSection() {
  sectionCounter++;
  const index = sectionCounter;
  const sectionEl = document.createElement('div');
  sectionEl.className = 'section-block';
  sectionEl.dataset.index = index;
  sectionEl.innerHTML = `
    <div class="section-block-header">
      <span class="section-index">Section ${sectionsContainer.children.length + 1}</span>
      <button class="btn btn-danger btn-sm remove-section-btn" title="Remove section">✕</button>
    </div>
    <div class="section-field">
      <label>Heading</label>
      <input type="text" class="section-heading" placeholder="Section heading" maxlength="256" />
    </div>
    <div class="section-field">
      <label>Content Lines</label>
      <div class="section-lines"></div>
      <button class="add-line-btn">+ Add line</button>
    </div>
    <div class="section-field">
      <label>Image URL <span class="muted">(optional)</span></label>
      <input type="text" class="section-image" placeholder="https://example.com/image.png" />
    </div>
    <div class="section-field">
      <label>Video / GIF URL <span class="muted">(optional)</span></label>
      <input type="text" class="section-video" placeholder="https://example.com/video.mp4" />
    </div>
  `;
  sectionsContainer.appendChild(sectionEl);

  const removeBtn = sectionEl.querySelector('.remove-section-btn');
  removeBtn.addEventListener('click', () => {
    sectionEl.remove();
    renumberSections();
    updatePreview();
  });

  const addLineBtn = sectionEl.querySelector('.add-line-btn');
  addLineBtn.addEventListener('click', () => addLine(sectionEl));

  sectionEl.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', updatePreview);
  });

  addLine(sectionEl);
  renumberSections();
  updatePreview();
}

function addLine(sectionEl) {
  const linesContainer = sectionEl.querySelector('.section-lines');
  const lineRow = document.createElement('div');
  lineRow.className = 'line-row';
  lineRow.innerHTML = `
    <input type="text" class="line-input" placeholder="Line of text" maxlength="1024" />
    <button class="btn btn-danger btn-sm remove-line-btn" title="Remove line">✕</button>
  `;
  linesContainer.appendChild(lineRow);

  const removeBtn = lineRow.querySelector('.remove-line-btn');
  removeBtn.addEventListener('click', () => {
    lineRow.remove();
    updatePreview();
  });

  lineRow.querySelector('.line-input').addEventListener('input', updatePreview);
}

function renumberSections() {
  const blocks = sectionsContainer.querySelectorAll('.section-block');
  blocks.forEach((block, i) => {
    block.querySelector('.section-index').textContent = `Section ${i + 1}`;
  });
}

addSectionBtn.addEventListener('click', addSection);

// ----- Live preview -----
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function updatePreview() {
  const title = embedTitleInput.value.trim() || 'Your Title Here';
  previewTitle.textContent = title;

  const desc = embedDescriptionInput.value.trim();
  previewDescription.textContent = desc || '';
  previewDescription.style.display = desc ? 'block' : 'none';

  previewFields.innerHTML = '';
  const blocks = sectionsContainer.querySelectorAll('.section-block');
  blocks.forEach((block) => {
    const heading = block.querySelector('.section-heading').value.trim() || 'Section';
    const lineInputs = block.querySelectorAll('.line-input');
    const lines = [];
    lineInputs.forEach((input) => {
      const val = input.value.trim();
      if (val) lines.push(val);
    });
    const videoUrl = block.querySelector('.section-video').value.trim();

    const parts = [];
    if (videoUrl) parts.push(`▶ [Video](${videoUrl})`);
    if (lines.length > 0) parts.push(lines.join('\n'));
    if (parts.length === 0) return;

    const fieldEl = document.createElement('div');
    fieldEl.className = 'embed-field';
    fieldEl.innerHTML = `
      <div class="embed-field-name">${escapeHtml(heading)}</div>
      <div class="embed-field-value">${escapeHtml(parts.join('\n'))}</div>
    `;
    previewFields.appendChild(fieldEl);
  });

  let imageUrl = '';
  for (const block of blocks) {
    imageUrl = block.querySelector('.section-image').value.trim();
    if (imageUrl) break;
  }
  if (imageUrl) {
    previewImage.src = imageUrl;
    previewImageWrapper.style.display = 'block';
  } else {
    previewImageWrapper.style.display = 'none';
  }
}

embedTitleInput.addEventListener('input', updatePreview);
embedDescriptionInput.addEventListener('input', updatePreview);

// ----- Send to Discord -----
sendBtn.addEventListener('click', async () => {
  const channelId = channelIdInput.value.trim();
  if (!/^\d{17,20}$/.test(channelId)) {
    showToast('Enter a valid Channel ID first.', 'error');
    return;
  }

  const sections = [];
  const blocks = sectionsContainer.querySelectorAll('.section-block');
  blocks.forEach((block) => {
    const heading = block.querySelector('.section-heading').value.trim();
    const lineInputs = block.querySelectorAll('.line-input');
    const lines = [];
    lineInputs.forEach((input) => {
      const val = input.value.trim();
      if (val) lines.push(val);
    });
    const imageUrl = block.querySelector('.section-image').value.trim();
    const videoUrl = block.querySelector('.section-video').value.trim();
    if (!heading && lines.length === 0) return;
    sections.push({ heading, lines, imageUrl, videoUrl });
  });

  if (sections.length === 0) {
    showToast('Add at least one section with content.', 'error');
    return;
  }

  const title = embedTitleInput.value.trim();
  if (!title) {
    showToast('Enter an embed title.', 'error');
    return;
  }

  const payload = {
    channelId,
    title,
    description: embedDescriptionInput.value.trim(),
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
