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
  addSection();
  updatePreview();
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
