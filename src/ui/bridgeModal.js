/**
 * ChatGPT Web Automation Bridge Modal UI.
 *
 * Provides setup instructions, 1-click Tampermonkey installation,
 * script code copying, and real-time status of the ChatGPT reteller bridge.
 */
import { showToast } from '../components/toast.js';

let modalEl = null;
let statusTimer = null;

export function initBridgeModal() {
  modalEl = document.getElementById('chatgpt-bridge-modal');
  if (!modalEl) return;

  // Toggle button in header
  const openBtn = document.getElementById('btn-chatgpt-bridge-toggle');
  openBtn?.addEventListener('click', openBridgeModal);

  // Toggle button in Reader Studio Controls
  const readerBridgeBtn = document.getElementById('btn-reader-chatgpt-bridge');
  readerBridgeBtn?.addEventListener('click', openBridgeModal);

  // Workspace ChatGPT Bridge button
  const workspaceBridgeBtn = document.getElementById('workspace-chatgpt-bridge');
  workspaceBridgeBtn?.addEventListener('click', openBridgeModal);

  // Close buttons
  const closeBtn = document.getElementById('chatgpt-bridge-close');
  closeBtn?.addEventListener('click', closeBridgeModal);

  modalEl.addEventListener('click', (e) => {
    if (e.target === modalEl) closeBridgeModal();
  });

  // 1-Click Install Button
  const installBtn = document.getElementById('bridge-install-btn');
  installBtn?.addEventListener('click', () => {
    window.open(`/api/bridge/userscript.user.js?v=${Date.now()}`, '_blank');
    showToast('Opening userscript installer in new tab...', 'info');
  });

  // Copy Code Button
  const copyBtn = document.getElementById('bridge-copy-btn');
  copyBtn?.addEventListener('click', async () => {
    try {
      copyBtn.textContent = 'Copying...';
      const res = await fetch(`/api/bridge/userscript.user.js?v=${Date.now()}`);
      if (!res.ok) throw new Error('Failed to download script from server');
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied!';
      showToast('Userscript copied to clipboard! Paste into Tampermonkey.', 'success');
      setTimeout(() => {
        copyBtn.textContent = '📋 Copy Script Code';
      }, 2500);
    } catch (err) {
      copyBtn.textContent = 'Failed';
      showToast('Could not copy script: ' + err.message, 'error');
      setTimeout(() => {
        copyBtn.textContent = '📋 Copy Script Code';
      }, 2500);
    }
  });

  // Open ChatGPT Button
  const openChatGptBtn = document.getElementById('bridge-open-chatgpt-btn');
  openChatGptBtn?.addEventListener('click', () => {
    window.open('https://chatgpt.com', '_blank');
  });

  // Book selection change
  const bookSelect = document.getElementById('bridge-book-select');
  bookSelect?.addEventListener('change', () => {
    refreshBridgeStats();
  });
}

export async function openBridgeModal() {
  if (!modalEl) return;
  modalEl.classList.remove('hidden');
  await refreshBridgeStats();

  // Poll status every 5 seconds while modal is open
  if (statusTimer) clearInterval(statusTimer);
  statusTimer = setInterval(refreshBridgeStats, 5000);
}

export function closeBridgeModal() {
  if (!modalEl) return;
  modalEl.classList.add('hidden');
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
}

async function refreshBridgeStats() {
  try {
    const res = await fetch('/api/bridge/status');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.ok || !data.books) return;

    const bookSelect = document.getElementById('bridge-book-select');
    if (bookSelect) {
      const currentVal = bookSelect.value;
      bookSelect.innerHTML = data.books
        .map(
          (b) =>
            `<option value="${b.id}" ${b.id === currentVal ? 'selected' : ''}>${b.title} (${b.scriptedChapters}/${b.totalChapters} scripted)</option>`
        )
        .join('');

      const selectedBook =
        data.books.find((b) => b.id === (bookSelect.value || currentVal)) || data.books[0];

      if (selectedBook) {
        const statsEl = document.getElementById('bridge-book-stats');
        if (statsEl) {
          const percent =
            selectedBook.totalChapters > 0
              ? Math.round((selectedBook.scriptedChapters / selectedBook.totalChapters) * 100)
              : 0;

          statsEl.innerHTML = `
            <div style="display:flex; justify-content:space-between; margin-bottom:6px; font-size:13px;">
              <span><strong>${selectedBook.title}</strong></span>
              <span style="color:var(--text-2);">${selectedBook.scriptedChapters} of ${selectedBook.totalChapters} chapters scripted (${percent}%)</span>
            </div>
            <div style="height:8px; background:var(--surface-3, #2a2e39); border-radius:4px; overflow:hidden;">
              <div style="width:${percent}%; height:100%; background:linear-gradient(90deg, #10b981, #059669); transition:width 0.3s ease;"></div>
            </div>
            <div style="margin-top:8px; font-size:12px; color:var(--text-3); display:flex; justify-content:space-between;">
              <span>Audio generated: ${selectedBook.audioChapters} chapter(s)</span>
              <span>Remaining to retell: <strong>${selectedBook.unscriptedChapters}</strong></span>
            </div>
          `;
        }
      }
    }
  } catch (err) {
    console.warn('[BridgeModal] Failed to refresh stats:', err);
  }
}
