
import { api } from '../services/api.js';
import { state } from '../store.js';
import { $, $$, show, hide, toggle, setText, setHTML, addClass, removeClass } from '../utils/dom.js';
import { formatTime, formatNumber, timeAgo, formatDateTime, formatSize } from '../utils/formatters.js';
import { escapeHtml } from '../utils/html.js';
import { showToast, removeToast } from '../components/toast.js';
import { CATALOG, languageDef, languageName, styleName, voiceName, sourceBadge, versionLabel, audioBadges, stageLabel, SCRIPT_SOURCE_META, loadCatalog } from '../components/catalog.js';
import { socketService } from '../services/socket.js';
import { getSetting, getConversionSettings, setSetting, setConversionSettings } from '../services/settings.js';
import { addLogEntry } from '../components/logConsole.js';
import { renderChapters, updateChapterRowProgress } from '../components/chapterList.js';

import * as Main from '../main.js';
import { selectedNewestAudio } from '../main.js';
import { openVersionsModal, deleteAudioVersion, openScriptEditor, runScriptCheck, openQuickConvertModal, resetChapterOverride, clearChapterOverrides, initChapterControls } from '../chapters/chapterActions.js';
import { initRealtimeHandlers, updateChapterProgress, markChapterComplete, markChapterError, updateOverallProgress, onJobComplete, refreshReaderChapter } from '../generation/realtime.js';
import { renderBookOverview, renderListenPane, initListenPane, setHeaderBook, refreshAudiobookPanel, buildAudiobook, hasActiveGenerations, loadAudioFilesForBook, loadResults } from '../workspace/bookView.js';
import { renderQuota, initQueuePanel, renderQueuePanel } from '../ui/queuePanel.js';

import { startSingleChapterGeneration, startAudioFromExistingScript, startTranslateOnly, startGeneration, startBatchTranslateOnly, cancelChapterConversion, clearGenerationsForJob, cancelAllJobs, setupProgressTracking, checkInterruptedJobs, resumeInterruptedJob, syncQueueSnapshot, syncQuotaSnapshot } from '../generation/generationJobs.js';
import { initReaderUi, previewChapter } from '../reader/readerUi.js';
import { initPlayer, stopPlayback, playAudioAtIndex, togglePlay } from '../audio/player.js';
import { initUpload, setUploadStep, handleUpload, onBookParsing, onBookParsed, onBookError, resetUpload, UPLOAD_STEPS, isUploading } from '../workspace/upload.js';
import { loadLibrary, renderLibrary } from '../workspace/library.js';
import { initConnectionIndicator, decideLandingView, initHomeView, initShell, initNavigation, switchView, applyWorkspaceMode } from '../workspace/layout.js';

// --- EXPORTED ---
export function initConfigPanel() {
  const langSelect = $('#language-select');
  const voiceSelect = $('#voice-select');
  const styleSelect = $('#translation-style-select');

  /**
   * The preset chip.
   *
   * The old panel asked for language, voice, style and a model up front —
   * four technical decisions made before the user had heard anything. Now the
   * settings collapse into one readable line, so what is about to happen is
   * always visible without a form being permanently open. Naming it is what
   * makes collapsing it safe: a hidden default would be a silent one.
   */
  function updatePresetSummary() {
    const parts = [languageName(langSelect.value), voiceName(voiceSelect.value)].filter(Boolean);
    const lang = languageDef(langSelect.value);
    if (lang?.requiresAi && styleSelect?.value) parts.push(styleName(styleSelect.value));
    setText('#preset-summary', parts.length ? parts.join(' · ') : 'Choose a voice');
  }

  $('#btn-toggle-narration')?.addEventListener('click', (e) => {
    const fields = $('#narration-fields');
    const open = fields.classList.toggle('hidden') === false;
    e.currentTarget.setAttribute('aria-expanded', String(open));
    e.currentTarget.textContent = open ? 'Done' : 'Change';
  });

  function updateVoices() {
    const lang = languageDef(langSelect.value);
    const langVoices = lang?.voices || [];

    voiceSelect.innerHTML = langVoices.map((v) =>
      `<option value="${v.id}">${v.name} (${v.gender}, ${v.accent})${v.note ? ` — ${v.note}` : ''}</option>`
    ).join('');
    if (lang?.defaultVoice) voiceSelect.value = lang.defaultVoice;

    // Styles are per-language: English needs no retelling, so the whole AI
    // section is irrelevant there.
    if (styleSelect && lang) {
      const allowed = CATALOG.styles.filter((s) => lang.styles.includes(s.id));
      styleSelect.innerHTML = allowed.map((s) =>
        `<option value="${s.id}"${s.id === lang.defaultStyle ? ' selected' : ''}>${s.name}${s.description ? ` — ${s.description}` : ''}</option>`
      ).join('');
    }

    if (lang?.requiresAi) show('#groq-config');
    else hide('#groq-config');

    updatePresetSummary();
  }

  langSelect.addEventListener('change', () => {
    // Language constrains voice and style, so it is persisted first and the
    // dependent fields are rebuilt before they are persisted in turn.
    setConversionSettings({ language: langSelect.value });
    updateVoices();
    setConversionSettings({
      voiceId: voiceSelect.value,
      translationStyle: styleSelect?.value || undefined,
    });
  });
  voiceSelect.addEventListener('change', () => {
    setConversionSettings({ voiceId: voiceSelect.value });
    updatePresetSummary();
  });
  styleSelect?.addEventListener('change', () => {
    setConversionSettings({ translationStyle: styleSelect.value });
    updatePresetSummary();
  });

  loadCatalog().then(() => {
    // Rebuild the language list from the server so a new backend language
    // shows up without touching the HTML.
    if (CATALOG.languages.length) {
      langSelect.innerHTML = CATALOG.languages.map((l) =>
        `<option value="${l.code}">${l.name}${l.requiresAi ? ' (AI retelling)' : ' (no AI needed)'}</option>`
      ).join('');
    }
    // Restore the saved preset so the sidebar agrees with every other surface
    // on load, instead of silently resetting to the catalog defaults.
    const saved = getConversionSettings(CATALOG);
    langSelect.value = saved.language;
    updateVoices();
    if (saved.voiceId) voiceSelect.value = saved.voiceId;
    if (saved.translationStyle && styleSelect) styleSelect.value = saved.translationStyle;
    updatePresetSummary();
    loadModels();
  }).catch((err) => {
    // Without the catalog every dropdown is empty, so this must be loud
    // rather than an unexplained blank UI.
    addLogEntry({ level: 'error', message: `Could not load languages/voices: ${err.message}` });
    showToast('Could not load languages and voices from the server.', 'error');
  });

  // Bulk conversion lives only in the selection bar now. The sidebar button
  // that used to sit here ran this same function on this same selection, so
  // the app appeared to offer two different bulk conversions.
  $('#sel-generate')?.addEventListener('click', startGeneration);

  // Text only: same selection, same settings, but stops after the script so
  // the retelling can be judged before any TTS time is spent on it.
  $('#sel-translate')?.addEventListener('click', startBatchTranslateOnly);
  $('#sel-clear')?.addEventListener('click', () => {
    state.selectedChapters.clear();
    renderChapters();
  });

  // "Change voice" is not a separate pipeline — it is a conversion with a
  // different voice — so it focuses the voice picker rather than inventing a
  // second way to produce audio that could drift from the first.
  $('#sel-voice')?.addEventListener('click', () => {
    $('#shell-sidebar')?.classList.add('open');
    // The narration form is collapsed by default, so focusing a field inside
    // it without opening it first would put focus somewhere invisible.
    const fields = $('#narration-fields');
    if (fields?.classList.contains('hidden')) $('#btn-toggle-narration')?.click();
    const sel = $('#voice-select');
    sel?.focus();
    sel?.scrollIntoView({ block: 'center' });
    showToast('Pick a voice, then press Convert.', 'info');
  });

  // Export downloads each selected chapter's newest audio. Browsers throttle
  // rapid programmatic downloads, so they are spaced out.
  $('#sel-export')?.addEventListener('click', () => {
    const files = selectedNewestAudio();
    if (!files.length) { showToast('None of the selected chapters have audio yet.', 'warning'); return; }
    files.forEach((a, i) => setTimeout(() => {
      const link = document.createElement('a');
      link.href = api.getDownloadUrl(a.id);
      link.download = '';
      link.click();
    }, i * 300));
    showToast(`Downloading ${files.length} file${files.length === 1 ? '' : 's'}…`, 'success');
  });

  $('#sel-delete')?.addEventListener('click', async () => {
    const files = selectedNewestAudio();
    if (!files.length) { showToast('None of the selected chapters have audio yet.', 'warning'); return; }
    if (!confirm(`Delete the newest audio for ${files.length} chapter(s)? This cannot be undone.`)) return;
    try {
      await Promise.all(files.map((a) => api.deleteAudio(a.id)));
      await loadAudioFilesForBook();
      renderChapters();
      renderBookOverview();
      showToast(`Deleted ${files.length} audio file(s).`, 'success');
    } catch (err) {
      showToast('Delete failed: ' + err.message, 'error');
    }
  });

  // Cancel All button
  $('#btn-cancel-all').addEventListener('click', async () => {
    if (!state.currentBookId) return;
    if (!confirm('Cancel all running conversions? Chapters already completed will be kept.')) return;

    try {
      const result = await api.cancelJobs(state.currentBookId);
      showToast(`${result.message}`, 'info');
    } catch (err) {
      showToast('Cancel failed: ' + err.message, 'error');
    }
  });
}

let cachedModelsResponse = null;

function renderModelStatus(selectedId, modelsData) {
  const statusEl = $('#groq-model-status');
  if (!statusEl) return;

  const { models = [], bestModel = '', bestModelReason = '' } = modelsData || {};
  const best = models.find((m) => m.id === bestModel) || models.find((m) => m.available && m.tier === 'recommended') || null;

  if (!selectedId) {
    // Auto mode
    const bestName = best?.name || best?.id || 'Best Available';
    const ctxK = best?.contextWindow ? `${Math.round(best.contextWindow / 1000)}k ctx` : '';
    const reason = bestModelReason || best?.statusReason || 'Auto-selects the highest quality live model with full Devanagari support.';
    statusEl.className = 'model-status-box status-recommended';
    statusEl.innerHTML = `
      <div class="model-status-header">
        <span class="model-status-title">Auto-Select (Recommended)</span>
        <span class="model-status-badge badge-live">● Live Active</span>
      </div>
      <div class="model-status-desc">
        <strong>Target:</strong> ${escapeHtml(bestName)} ${ctxK ? `(${escapeHtml(ctxK)})` : ''}
      </div>
      <div class="model-status-desc" style="margin-top: 4px; color: var(--text-3);">
        ${escapeHtml(reason)}
      </div>
    `;
    return;
  }

  const model = models.find((m) => m.id === selectedId);
  if (!model) {
    // Custom/unrecognized model
    statusEl.className = 'model-status-box status-warning';
    statusEl.innerHTML = `
      <div class="model-status-header">
        <span class="model-status-title">Custom / Unknown Model</span>
        <span class="model-status-badge badge-warn">Unverified</span>
      </div>
      <div class="model-status-desc">
        <code>${escapeHtml(selectedId)}</code> is not in the live verified list.
      </div>
      <div class="model-status-desc" style="margin-top: 4px; color: var(--text-3);">
        If this model is unavailable at conversion time, the engine will automatically fall back to ${escapeHtml(best?.name || 'best available')}.
      </div>
    `;
    return;
  }

  if (model.available && model.status === 'recommended') {
    const ctxK = Math.round(model.contextWindow / 1000) + 'k ctx';
    statusEl.className = 'model-status-box status-recommended';
    statusEl.innerHTML = `
      <div class="model-status-header">
        <span class="model-status-title">${escapeHtml(model.name || model.id)}</span>
        <span class="model-status-badge badge-live">● Available</span>
      </div>
      <div class="model-status-desc">
        ${escapeHtml(model.statusReason || 'Verified live and optimal for story retellings.')}
      </div>
      <div class="model-status-desc" style="margin-top: 4px; color: var(--text-3);">
        Provider: ${escapeHtml(model.provider || 'Groq')} · Window: ${escapeHtml(ctxK)} · Multi-key quota ready
      </div>
    `;
  } else if (model.available && model.status === 'ineligible') {
    statusEl.className = 'model-status-box status-danger';
    statusEl.innerHTML = `
      <div class="model-status-header">
        <span class="model-status-title" style="color: var(--danger-text);">⚠️ Ineligible for Retelling</span>
        <span class="model-status-badge badge-danger">Not Suitable</span>
      </div>
      <div class="model-status-desc" style="color: var(--danger-text);">
        <strong>${escapeHtml(model.name || model.id)}:</strong> ${escapeHtml(model.statusReason)}
      </div>
      <div class="model-status-desc" style="margin-top: 4px; color: var(--text-3);">
        The engine will automatically divert requests to <strong>${escapeHtml(best?.name || bestModel)}</strong> so conversion does not fail.
      </div>
      <div class="model-status-fallback-action">
        <button type="button" class="btn-switch-model">Switch to Recommended</button>
      </div>
    `;
    const fixBtn = statusEl.querySelector('.btn-switch-model');
    if (fixBtn) {
      fixBtn.onclick = async () => {
        const select = $('#groq-model-select');
        if (select) select.value = '';
        await api.updateSettings({ groqModel: '' });
        renderModelStatus('', modelsData);
        showToast(`Switched to Auto (${best?.name || 'Best available'})`, 'success');
      };
    }
  } else if (!model.available) {
    statusEl.className = 'model-status-box status-warning';
    statusEl.innerHTML = `
      <div class="model-status-header">
        <span class="model-status-title" style="color: var(--warn-text);">⚠️ Model Unavailable</span>
        <span class="model-status-badge badge-warn">No Tier Access</span>
      </div>
      <div class="model-status-desc" style="color: var(--warn-text);">
        <strong>${escapeHtml(model.name || model.id)}</strong> is unavailable: ${escapeHtml(model.statusReason || 'Not accessible on current API keys.')}
      </div>
      <div class="model-status-desc" style="margin-top: 4px; color: var(--text-3);">
        Safe Fallback Active: Groq requests will automatically use <strong>${escapeHtml(best?.name || bestModel)}</strong> so jobs succeed seamlessly.
      </div>
      <div class="model-status-fallback-action">
        <button type="button" class="btn-switch-model">Use ${escapeHtml(best?.name || 'Best Model')}</button>
      </div>
    `;
    const fixBtn = statusEl.querySelector('.btn-switch-model');
    if (fixBtn) {
      fixBtn.onclick = async () => {
        const select = $('#groq-model-select');
        if (select) select.value = '';
        await api.updateSettings({ groqModel: '' });
        renderModelStatus('', modelsData);
        showToast(`Switched to Auto (${best?.name || 'Best available'})`, 'success');
      };
    }
  } else {
    // Other available model
    const ctxK = Math.round(model.contextWindow / 1000) + 'k ctx';
    statusEl.className = 'model-status-box';
    statusEl.innerHTML = `
      <div class="model-status-header">
        <span class="model-status-title">${escapeHtml(model.name || model.id)}</span>
        <span class="model-status-badge badge-live">● Available</span>
      </div>
      <div class="model-status-desc">
        ${escapeHtml(model.statusReason || 'Live on Groq API.')}
      </div>
      <div class="model-status-desc" style="margin-top: 4px; color: var(--text-3);">
        Provider: ${escapeHtml(model.provider || 'Groq')} · Window: ${escapeHtml(ctxK)}
      </div>
    `;
  }
}

function renderModelDrawer(modelsData) {
  const listEl = $('#groq-all-models-list');
  if (!listEl) return;

  const { models = [], bestModel = '' } = modelsData || {};
  if (!models.length) {
    listEl.innerHTML = '<div class="model-status-desc">No models loaded. Click "Check Live" above.</div>';
    return;
  }

  listEl.innerHTML = models.map((m) => {
    const isBest = m.id === bestModel;
    const ctxK = Math.round((m.contextWindow || 0) / 1000) + 'k ctx';
    let statusClass = 'is-available';
    let badgeHtml = `<span class="model-status-badge badge-live">${escapeHtml(m.badge || 'Available')}</span>`;
    let actionHtml = '';

    if (!m.available) {
      statusClass = 'is-unavailable';
      badgeHtml = `<span class="model-status-badge badge-warn">Unavailable on Key</span>`;
    } else if (m.status === 'ineligible') {
      statusClass = 'is-ineligible';
      badgeHtml = `<span class="model-status-badge badge-muted">${escapeHtml(m.badge || 'Ineligible')}</span>`;
    } else {
      actionHtml = `
        <div class="model-drawer-actions">
          <button type="button" class="btn-select-model-item" data-model-id="${escapeHtml(m.id)}">
            ${isBest ? '⭐ Choose (Best)' : 'Choose'}
          </button>
        </div>
      `;
    }

    return `
      <div class="model-drawer-item ${statusClass}">
        <div class="model-drawer-item-head">
          <span class="model-drawer-item-name">${escapeHtml(m.name || m.id)}</span>
          ${badgeHtml}
        </div>
        <div class="model-drawer-item-meta">
          ID: <code>${escapeHtml(m.id)}</code> · ${escapeHtml(m.provider || 'Groq')} · ${escapeHtml(ctxK)}
        </div>
        <div class="model-drawer-item-reason">
          ${escapeHtml(m.statusReason || '')}
        </div>
        ${actionHtml}
      </div>
    `;
  }).join('');

  // Wire Choose buttons in drawer
  listEl.querySelectorAll('.btn-select-model-item').forEach((btn) => {
    btn.onclick = async () => {
      const modelId = btn.dataset.modelId;
      const select = $('#groq-model-select');
      if (select) {
        select.value = modelId;
        await api.updateSettings({ groqModel: modelId });
        renderModelStatus(modelId, modelsData);
        $('#groq-all-models-drawer')?.classList.add('hidden');
        showToast(`Selected ${modelId}`, 'success');
      }
    };
  });
}

export async function loadModels(options = {}) {
  const force = options?.force === true;
  const select = $('#groq-model-select');
  const keyInput = $('#groq-api-key');
  const refreshBtn = $('#btn-refresh-models');
  const toggleBtn = $('#btn-toggle-model-list');
  const closeBtn = $('#btn-close-model-drawer');
  const drawer = $('#groq-all-models-drawer');

  // Wire controls once
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.dataset.bound = 'true';
    refreshBtn.onclick = async () => {
      refreshBtn.classList.add('is-loading');
      try {
        await loadModels({ force: true });
        showToast('Checked Groq API for live available models', 'success');
      } catch (err) {
        showToast(`Failed to refresh models: ${err.message}`, 'error');
      } finally {
        refreshBtn.classList.remove('is-loading');
      }
    };
  }

  if (toggleBtn && drawer && !toggleBtn.dataset.bound) {
    toggleBtn.dataset.bound = 'true';
    toggleBtn.onclick = () => {
      drawer.classList.toggle('hidden');
    };
  }

  if (closeBtn && drawer && !closeBtn.dataset.bound) {
    closeBtn.dataset.bound = 'true';
    closeBtn.onclick = () => {
      drawer.classList.add('hidden');
    };
  }

  if (!select) return;

  try {
    const [modelsData, { settings }] = await Promise.all([
      api.getModels(force),
      api.getSettings()
    ]);
    cachedModelsResponse = modelsData;

    if (keyInput && settings) {
      if (settings.groqApiKeySet && !keyInput.value) {
        keyInput.placeholder = `Saved: ${settings.groqApiKeyPreview}`;
      }
      keyInput.onchange = async (e) => {
        await api.updateSettings({ groqApiKey: e.target.value.trim() });
        showToast('API key saved', 'success');
        loadModels({ force: true });
      };
    }

    const { models = [], bestModel = '', bestModelReason = '', error = null } = modelsData || {};

    if (error || !models.length) {
      select.innerHTML = '<option value="">Auto (best available)</option>';
      if (error) {
        select.title = error;
        addLogEntry({ level: 'warn', message: `Model list unavailable: ${error}` });
      }
      renderModelStatus('', modelsData);
      renderModelDrawer(modelsData);
      return;
    }

    const availableRecommended = models.filter((m) => m.available && m.tier === 'recommended');
    const availableOther = models.filter((m) => m.available && m.tier !== 'recommended' && m.status !== 'ineligible');
    const unavailable = models.filter((m) => !m.available);
    const ineligible = models.filter((m) => m.available && m.status === 'ineligible');

    const best = models.find((m) => m.id === bestModel) || availableRecommended[0] || null;
    const bestName = best ? (best.name || best.id) : 'Best Available';

    let optionsHtml = `<option value="">Auto (Best: ${escapeHtml(bestName)} — recommended)</option>`;

    if (availableRecommended.length) {
      optionsHtml += `<optgroup label="⭐ Recommended for Retelling (Live)">` +
        availableRecommended.map((m) => {
          const size = Math.round((m.contextWindow || 0) / 1000) + 'k ctx';
          const badge = m.badge ? ` — ${m.badge}` : '';
          return `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name || m.id)} (${size})${badge}</option>`;
        }).join('') +
        `</optgroup>`;
    }

    if (availableOther.length) {
      optionsHtml += `<optgroup label="⚡ Other Available Live Models">` +
        availableOther.map((m) => {
          const size = Math.round((m.contextWindow || 0) / 1000) + 'k ctx';
          return `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name || m.id)} (${size})</option>`;
        }).join('') +
        `</optgroup>`;
    }

    if (unavailable.length) {
      optionsHtml += `<optgroup label="⛔ Unavailable on Your API Key">` +
        unavailable.map((m) => {
          return `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name || m.id)} (Unavailable on key)</option>`;
        }).join('') +
        `</optgroup>`;
    }

    if (ineligible.length) {
      optionsHtml += `<optgroup label="⚠️ Ineligible (Audio / Tool / Moderation)">` +
        ineligible.map((m) => {
          return `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name || m.id)} (${escapeHtml(m.badge || 'Ineligible')})</option>`;
        }).join('') +
        `</optgroup>`;
    }

    select.innerHTML = optionsHtml;

    const modelExistsAndAvailable = models.some((m) => m.id === settings?.groqModel && m.available && m.status !== 'ineligible');
    if (modelExistsAndAvailable) {
      select.value = settings.groqModel;
    } else {
      select.value = '';
      if (settings?.groqModel) {
        api.updateSettings({ groqModel: '' });
      }
    }

    renderModelStatus(select.value, modelsData);
    renderModelDrawer(modelsData);

    select.onchange = async (e) => {
      const chosen = e.target.value;
      await api.updateSettings({ groqModel: chosen });
      renderModelStatus(chosen, modelsData);
      const chosenModel = models.find((m) => m.id === chosen);
      if (chosenModel && !chosenModel.available) {
        showToast(`Note: ${chosenModel.name || chosen} is unavailable on your key. Engine will auto-fallback to ${bestName}.`, 'warn');
      } else if (chosen) {
        showToast(`Selected AI model: ${chosenModel?.name || chosen}`, 'success');
      } else {
        showToast(`Selected Auto (best available: ${bestName})`, 'success');
      }
    };
  } catch (err) {
    addLogEntry({ level: 'warn', message: `Could not fetch models/settings: ${err.message}` });
  }
}

export function syncNarrationControls() {
  if (!CATALOG.languages?.length) return;
  const saved = getConversionSettings(CATALOG, state.currentBookId);
  const langSelect = $('#language-select');
  const voiceSelect = $('#voice-select');
  const styleSelect = $('#translation-style-select');
  if (!langSelect || !voiceSelect) return;

  if (langSelect.value !== saved.language) {
    langSelect.value = saved.language;
    // Rebuilding the dependent options is the language handler's job.
    langSelect.dispatchEvent(new Event('change'));
  }
  if (saved.voiceId) voiceSelect.value = saved.voiceId;
  if (saved.translationStyle && styleSelect) styleSelect.value = saved.translationStyle;

  const parts = [languageName(saved.language), voiceName(saved.voiceId)].filter(Boolean);
  const lang = languageDef(saved.language);
  if (lang?.requiresAi && saved.translationStyle) parts.push(styleName(saved.translationStyle));

  // The count of chapters disagreeing with the book default is the one fact
  // that makes an override visible from outside the chapter it belongs to.
  const overrideCount = Object.keys(state.chapterOverrides).length;
  const summary = parts.length ? parts.join(' · ') : 'Choose a voice';
  setText('#preset-summary', overrideCount
    ? `${summary} · ${overrideCount} chapter${overrideCount === 1 ? '' : 's'} overridden`
    : summary);
}

export function effectiveSettingsFor(chapterIdx) {
  const base = getConversionSettings(CATALOG, state.currentBookId);
  const override = state.chapterOverrides[chapterIdx] || {};
  return {
    language: override.language || base.language,
    voiceId: override.voiceId || base.voiceId,
    translationStyle: override.translationStyle || base.translationStyle,
    scriptSource: override.scriptSource || base.scriptSource || 'ai',
    // Deliberately absent: `action` and `scriptId`. A pin names one script for
    // one chapter and belongs to a single deliberate press of "generate audio
    // from this script"; letting it survive in the chapter's settings would
    // make every later conversion silently re-speak that one old script.
  };
}

export function settingsKey(s) {
  return [
    s.language, s.voiceId, s.translationStyle || '', s.scriptSource,
    s.action || 'both', s.scriptId || '',
  ].join('|');
}

