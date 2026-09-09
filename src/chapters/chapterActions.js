
import { api } from '../services/api.js';
import { state } from '../store.js';
import { $, $$, show, hide, toggle, setText, setHTML, addClass, removeClass } from '../utils/dom.js';
import { formatTime, formatNumber, timeAgo, formatDateTime, formatSize } from '../utils/formatters.js';
import { escapeHtml } from '../utils/html.js';
import { showToast, removeToast } from '../components/toast.js';
import { CATALOG, languageDef, languageName, styleName, voiceName, sourceBadge, versionLabel, audioBadges, stageLabel, SCRIPT_SOURCE_META, loadCatalog } from '../components/catalog.js';
import { socketService } from '../services/socket.js';
import { getSetting, getConversionSettings, setSetting, setConversionSettings, getQuickActionAllowed } from '../services/settings.js';
import { addLogEntry, showLogsForChapter } from '../components/logConsole.js';
import { renderChapters, updateChapterRowProgress, initChapterList } from '../components/chapterList.js';

import * as Main from '../main.js';
import { retryChapter, chapterOverrides } from '../main.js';
import { initConfigPanel, loadModels, syncNarrationControls, effectiveSettingsFor, settingsKey } from '../ui/configPanel.js';
import { initRealtimeHandlers, updateChapterProgress, markChapterComplete, markChapterError, updateOverallProgress, onJobComplete, refreshReaderChapter } from '../generation/realtime.js';
import { renderBookOverview, renderListenPane, initListenPane, setHeaderBook, refreshAudiobookPanel, buildAudiobook, hasActiveGenerations, loadAudioFilesForBook, loadResults } from '../workspace/bookView.js';
import { renderQuota, initQueuePanel, renderQueuePanel } from '../ui/queuePanel.js';

import { startSingleChapterGeneration, startAudioFromExistingScript, startTranslateOnly, startGeneration, startBatchTranslateOnly, cancelChapterConversion, clearGenerationsForJob, cancelAllJobs, setupProgressTracking, checkInterruptedJobs, resumeInterruptedJob, syncQueueSnapshot, syncQuotaSnapshot } from '../generation/generationJobs.js';
import { suggestLanguageAndVoice } from '../utils/scriptDetect.js';
import { initReaderUi, previewChapter } from '../reader/readerUi.js';
import { initPlayer, stopPlayback, playAudioAtIndex, togglePlay } from '../audio/player.js';
import { initUpload, setUploadStep, handleUpload, onBookParsing, onBookParsed, onBookError, resetUpload, UPLOAD_STEPS, isUploading } from '../workspace/upload.js';
import { loadLibrary, renderLibrary } from '../workspace/library.js';
import { initConnectionIndicator, decideLandingView, initHomeView, initShell, initNavigation, switchView, applyWorkspaceMode } from '../workspace/layout.js';

// --- EXPORTED ---
export function openVersionsModal(chapterIndex, sortOrder = 'desc') {
  const ch = state.chapters.find(c => c.chapterIndex === chapterIndex);
  if (!ch) return;

  state.activeVersionsModalChapterIdx = chapterIndex;
  
  let chAudioFiles = state.audioFiles ? state.audioFiles.filter(a => a.chapterId === ch.id && !a.isMerged) : [];

  if (sortOrder === 'asc') {
    chAudioFiles = [...chAudioFiles].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  } else {
    chAudioFiles = [...chAudioFiles].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  setText('#versions-modal-title', `Audio Versions: ${ch.title || `Chapter ${chapterIndex + 1}`}`);
  setText('#versions-modal-subtitle', `${chAudioFiles.length} coexisting audio versions stored for this chapter`);

  const body = $('#versions-modal-body');
  if (chAudioFiles.length === 0) {
    body.innerHTML = `<p style="text-align:center; color:var(--text-tertiary); padding: 20px;">No audio versions available.</p>`;
  } else {
    body.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 10px;">
        ${chAudioFiles.map((a, idx) => {
          const isHi = a.language === 'hi';
          const langBadge = isHi ? `<span style="background:rgba(168,85,247,0.15); color:var(--accent-primary); border:1px solid rgba(168,85,247,0.3); padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600;">Hinglish</span>`
                                 : `<span style="background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.3); padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600;">English</span>`;
          const vName = a.voiceId ? a.voiceId.split('-').slice(-1)[0].replace('Neural', '') : 'Voice';
          let sTag = '';
          if (isHi || a.translationStyle === 'custom') {
             sTag = ` (${styleName(a.translationStyle)})`;
          }
          const timeFormatted = formatDateTime(a.createdAt) || a.createdAt;
          const globalIndex = state.audioFiles.indexOf(a);

          const fileName = a.filePath ? a.filePath.split('/').pop() : '';
          const audioUrl = `/data/audio/${state.currentBookId}/chapters/${fileName}`;

          return `
            <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-tertiary); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 12px 14px; flex-wrap: wrap; gap: 10px;">
              <div style="display: flex; flex-direction: column; gap: 4px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-weight: 700; font-size: 13px; color: var(--text-primary);">Version ${chAudioFiles.length - idx}</span>
                  ${langBadge}
                  ${sourceBadge(a)}
                   <span style="font-size: 11px; color: var(--text-secondary);">${vName}${sTag}</span>
                   ${a.model ? `<span style="font-size: 10px; color: var(--text-tertiary); background: var(--bg-elevated); padding: 1px 6px; border-radius: 4px;">${a.model}</span>` : ''}
                </div>
                <div style="font-size: 11px; color: var(--text-tertiary); display: flex; gap: 12px; flex-wrap: wrap;">
                   <span>Converted: <strong>${timeFormatted}</strong></span>
                   <span>Duration: <strong>${formatTime(a.durationSeconds)}</strong></span>
                   <span>Size: <strong>${formatSize(a.fileSizeBytes)}</strong></span>
                </div>
              </div>

              <div style="display: flex; gap: 8px; align-items: center;">
                <button class="btn-play-version-modal" data-audio-index="${globalIndex}" style="background: var(--accent-primary); color: white; border: none; padding: 6px 14px; border-radius: var(--radius-sm); font-size: 12px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                  <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><polygon points="5 3 19 12 5 21 5 3"/></svg> Play
                </button>
                <a href="${audioUrl}" download style="background: var(--bg-elevated); color: var(--text-primary); border: 1px solid var(--border-medium); padding: 5px 10px; border-radius: var(--radius-sm); font-size: 12px; text-decoration: none; display: flex; align-items: center; gap: 4px;" title="Download MP3">
                  📥 MP3
                </a>
                <button class="btn-delete-version-modal" data-audio-id="${a.id}" style="background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); padding: 5px 10px; border-radius: var(--radius-sm); font-size: 12px; cursor: pointer; font-weight: 600;" title="Delete this version">
                  Delete
                </button>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    body.querySelectorAll('.btn-play-version-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.audioIndex, 10);
        if (!isNaN(idx)) {
          playAudioAtIndex(idx);
          hide('#versions-modal');
        }
      });
    });

    body.querySelectorAll('.btn-delete-version-modal').forEach(btn => {
      btn.addEventListener('click', async () => {
        const aId = btn.dataset.audioId;
        if (confirm('Delete this audio version permanently?')) {
          try {
            await api.deleteAudioFile(aId);
            showToast('Audio version deleted', 'info');
            await loadAudioFilesForBook();
            renderChapters();
            openVersionsModal(chapterIndex, $('#versions-sort-select')?.value || 'desc');
          } catch (err) {
            showToast('Failed to delete audio version: ' + err.message, 'error');
          }
        }
      });
    });
  }

  show('#versions-modal');
}

export async function deleteAudioVersion(audioIndex) {
  const audio = state.audioFiles[audioIndex];
  if (!audio) return;
  if (!confirm('Delete this audio version permanently?')) return;

  try {
    await api.deleteAudioFile(audio.id);
    showToast('Audio version deleted', 'info');
    await loadAudioFilesForBook();
    renderChapters();
  } catch (err) {
    showToast('Failed to delete audio: ' + err.message, 'error');
  }
}

export let seAiContent = '';

export function populateSeVoices(langCode, preferredVoice = null) {
  const voiceSelect = $('#se-voice');
  if (!voiceSelect) return;
  const langDef = CATALOG.languages.find(l => l.code === langCode);
  const voices = langDef?.voices || [];
  voiceSelect.innerHTML = voices.map(v => 
    `<option value="${v.id}" ${v.id === preferredVoice ? 'selected' : ''}>${v.name} (${v.gender || 'Neural'})</option>`
  ).join('');
  if (!voices.some(v => v.id === preferredVoice) && voices.length > 0) {
    voiceSelect.value = voices[0].id;
  }
}

export async function openScriptEditor(chapterIdx) {
  state.seActiveChapterIdx = chapterIdx;
  seAiContent = '';
  const ch = state.chapters.find(c => c.chapterIndex === chapterIdx);
  if (!ch) return;

  setText('#se-title', `My Script: ${ch.title || `Chapter ${chapterIdx + 1}`}`);
  const box = $('#se-text');
  box.value = '';
  setText('#se-status', 'Loading…');
  // The hint may have been replaced by the clipboard fallback message on a
  // previous open; it should not persist as a warning for a session where
  // pasting worked.
  setText('#se-shortcut-hint', 'Ctrl+S to save · Esc to close');
  $('#se-copy-ai').style.display = 'none';

  const defaultSettings = effectiveSettingsFor(chapterIdx);
  const langSelect = $('#se-language');
  if (langSelect) {
    langSelect.value = defaultSettings.language || 'hi';
    populateSeVoices(langSelect.value, defaultSettings.voiceId);
  }

  show('#script-editor-modal');
  // Opening this means intending to type or paste, so the caret starts here.
  box.focus();

  try {
    const data = await api.getChapterContent(state.currentBookId, chapterIdx);
    if (data.aiContent) {
      seAiContent = data.aiContent;
      $('#se-copy-ai').style.display = '';
    }
    const custom = (data.scripts || []).find(s => s.source === 'custom');
    if (custom) {
      const full = await api.getScript(state.currentBookId, custom.id);
      box.value = full.script?.content || '';
    }
  } catch (err) {
    addLogEntry({ level: 'error', message: `Could not load script: ${err.message}` });
  }
  runScriptCheck();
}

export async function runScriptCheck(userPickedLang = false) {
  const text = $('#se-text').value;
  const el = $('#se-status');
  if (!text.trim()) {
    el.className = 'se-status';
    el.textContent = 'Empty — paste text to enable "My saved script" in the Convert dialog.';
    return;
  }

  const detection = suggestLanguageAndVoice(text, $('#se-voice')?.value, CATALOG.languages);
  if (!userPickedLang && $('#se-language')) {
    $('#se-language').value = detection.language;
    populateSeVoices(detection.language, detection.voiceId);
  }

  try {
    const r = await api.checkScript(state.currentBookId, text, $('#se-language')?.value || 'hi');
    el.className = `se-status ${r.ok ? 'ok' : (r.severity === 'error' ? 'err' : 'warn')}`;
    el.textContent = `${detection.label} · ${r.wordCount} words · ${r.charCount} chars` + (r.note ? ` — ${r.note}` : '');
  } catch (err) {
    el.className = 'se-status err';
    el.textContent = `Check failed: ${err.message}`;
  }
}

export function openQuickConvertModal(chapterIdx, options = {}) {
  state.qcActiveChapterIdx = chapterIdx;
  const ch = state.chapters.find(c => c.chapterIndex === chapterIdx);
  if (!ch) return;

  // "Regenerate this version": the dialog is seeded from the audio row and
  // pinned to the exact script that produced it, so pressing Start remakes
  // THAT version rather than making a new one from today's settings.
  const fromAudio = options.fromAudio || null;
  state.qcPinnedScriptId = fromAudio?.scriptId || null;

  const existing = (state.audioFiles || []).filter(a => a.chapterId === ch.id && !a.isMerged).length;
  const hasOverride = !!chapterOverrides[chapterIdx];
  // A first run has no agreed defaults yet, so the dialog explains itself
  // differently and offers the "don't ask again" contract.
  const isFirstRun = !!options.firstRun;

  setText('#qc-modal-title', fromAudio
    ? `Regenerate: ${ch.title || `Chapter ${chapterIdx + 1}`}`
    : `Create audiobook: ${ch.title || `Chapter ${chapterIdx + 1}`}`);
  setText('#qc-scope', hasOverride
    ? 'Applies to: this chapter — using chapter override'
    : 'Applies to: this chapter');
  $('#qc-scope')?.classList.toggle('is-override', hasOverride);

  setText('#qc-modal-subtitle', fromAudio
    // The pin is the whole point of this entry point, so it is the first thing
    // the dialog says.
    ? 'Uses the exact script this version was made from. Change the source below to use a different script.'
    : isFirstRun
     ? 'First audiobook chapter for this book — check the retelling and narration settings, then start.'
    : hasOverride
      // An exception is invisible state, so the dialog has to say it exists —
      // otherwise this chapter quietly disagrees with the sidebar forever.
      ? 'This chapter has its own settings, shown below. The book defaults are unchanged.'
      : existing
         ? `${existing} version${existing > 1 ? 's' : ''} already saved. This adds another — nothing is overwritten.`
         : 'Every audiobook run creates a new narrated version. Nothing is overwritten.');

  // Offering "don't ask again" after it has already been granted would imply
  // it had been forgotten.
  const quickRow = $('#qc-quick-row');
  const quickBox = $('#qc-quick-action');
  const alreadyQuick = getQuickActionAllowed(state.currentBookId);
  if (quickRow) quickRow.hidden = alreadyQuick;
  if (quickBox) quickBox.checked = false;

    // The action defaults to whatever the caller intended, so "Preview retelling"
  // in the reader opens this dialog already set to text-only.
  const wantAction = options.action || 'both';
  const actionInput = $('#qc-action-group')?.querySelector(`input[value="${wantAction}"]`);
  if (actionInput) actionInput.checked = true;

  const langSelect = $('#qc-language');
  const voiceSelect = $('#qc-voice');
  const styleSelect = $('#qc-style');
  const styleRow = $('#qc-style-row');
  const customRow = $('#qc-source-custom');
  const customRadio = customRow?.querySelector('input');

  // Languages come from the backend catalog, so a language added server-side
  // shows up here automatically and can never drift out of sync.
  langSelect.innerHTML = CATALOG.languages
    .map(l => `<option value="${l.code}">${l.label || l.name}</option>`).join('');

  // Seed from this chapter's override if it has one, otherwise from the shared
  // defaults. Previously only the language was carried over and the voice and
  // style were reset to the catalog defaults, so the dialog could convert with
  // a different voice than the sidebar summary advertised.
  //
  // A regenerate seeds from the AUDIO instead: "make this again" means the
  // settings that produced it, not the settings that happen to be current.
  const override = chapterOverrides[chapterIdx];
  const saved = fromAudio
    ? {
        language: fromAudio.language,
        voiceId: fromAudio.voiceId,
        translationStyle: fromAudio.translationStyle,
        scriptSource: fromAudio.scriptSource || 'ai',
      }
    : { ...getConversionSettings(CATALOG, state.currentBookId), ...(override || {}) };
  langSelect.value = saved.language;

  // Reset the scope checkbox every time: leaving it ticked from a previous
  // chapter would silently change the defaults the next time round.
  const makeDefault = $('#qc-make-default');
  if (makeDefault) makeDefault.checked = false;

  // "My saved script" is only selectable when a script actually exists for
  // THIS chapter — answering "which script would it use?" unambiguously.
  const hasScript = !!ch.hasCustomScript;
  customRow.classList.toggle('disabled', !hasScript);
  customRadio.disabled = !hasScript;
  setText('#qc-custom-badge', hasScript ? 'Ready' : 'None saved');
  $('#qc-custom-badge').className = `qc-source-badge ${hasScript ? 'ok' : 'muted'}`;
  setText('#qc-custom-note', hasScript
    ? 'Spoken exactly as pasted — no AI, no edits.'
    : 'Nothing saved yet for this chapter. Paste one below to enable this.');

  const hasAi = !!ch.hasAiScript;
  const aiExistingLabel = $('#qc-source-ai-existing');
  if (aiExistingLabel) {
    aiExistingLabel.style.display = hasAi ? '' : 'none';
  }

  // Seed the script source too, so an override that says "original English"
  // is still selected when the dialog is reopened.
  const wantSource = saved.scriptSource || (hasAi ? 'ai-existing' : 'ai');
  const sourceInput = $('#qc-source-group').querySelector(`input[value="${wantSource}"]`);
  if (sourceInput && !sourceInput.disabled) sourceInput.checked = true;

  if (!hasScript && customRadio.checked) {
    $('#qc-source-group').querySelector(`input[value="${hasAi ? 'ai-existing' : 'ai'}"]`).checked = true;
  }

  function currentSource() {
    return $('#qc-source-group').querySelector('input[name="qc-source"]:checked')?.value || 'ai';
  }

  function currentAction() {
    return $('#qc-action-group')?.querySelector('input[name="qc-action"]:checked')?.value || 'both';
  }

  function refresh() {
    const lang = languageDef(langSelect.value);
    const source = currentSource();
    // `saved` already merges this chapter's override over the shared defaults,
    // so the dialog keeps showing the exception being edited.
    const stored = saved;

    const voices = lang?.voices || [];
    voiceSelect.innerHTML = voices
      .map(v => `<option value="${v.id}">${v.name} (${v.gender}, ${v.accent})</option>`).join('');
    // Keep the shared voice when it is valid for this language; only fall back
    // to the catalog default when it is not.
    if (stored.voiceId && voices.some(v => v.id === stored.voiceId)) {
      voiceSelect.value = stored.voiceId;
    } else if (lang?.defaultVoice) {
      voiceSelect.value = lang.defaultVoice;
    }

    const allowed = CATALOG.styles.filter(s => (lang?.styles || []).includes(s.id));
    styleSelect.innerHTML = allowed
      .map(s => `<option value="${s.id}">${s.name}</option>`)
      .join('');
    const wantStyle = stored.translationStyle || lang?.defaultStyle;
    if (wantStyle && allowed.some(s => s.id === wantStyle)) {
      styleSelect.value = wantStyle;
    }

    // Style only exists to steer the AI. Hiding it for other sources stops the
    // dialog from implying a setting that will be ignored.
    const action = currentAction();
    const showStyle = !!lang?.requiresAi && source === 'ai' && allowed.length > 0 && action !== 'audio';
    styleRow.style.display = showStyle ? '' : 'none';
    $('#qc-voice-label').textContent = `${showStyle ? '5' : '4'}. AI Voice`;

    const promptRow = $('#qc-antigravity-prompt-row');
    if (promptRow) {
      promptRow.style.display = source === 'antigravity' ? '' : 'none';
    }

    // A text-only run never reaches TTS, so offering a voice for it would be
    // offering a setting that cannot affect the result.
    const voiceRow = voiceSelect.closest('div') || voiceSelect.parentElement;
    const showVoice = action !== 'script';
    voiceSelect.style.display = showVoice ? '' : 'none';
    $('#qc-voice-label').style.display = showVoice ? '' : 'none';

    const parts = [];
    if (source === 'ai') parts.push(`AI retelling in <b>${lang?.label || lang?.name || langSelect.value}</b>`);
    if (source === 'antigravity') parts.push(`Antigravity CLI retelling in <b>${lang?.label || lang?.name || langSelect.value}</b>`);
    if (source === 'ai-existing') parts.push(`Existing AI script in <b>${lang?.label || lang?.name || langSelect.value}</b>`);
    if (source === 'custom') parts.push('Your <b>saved script</b>, spoken verbatim');
    if (source === 'original') parts.push('The <b>original book text</b>, untranslated');
    if (showStyle) parts.push(`style <b>${styleSelect.selectedOptions[0]?.textContent || '—'}</b>`);
    if (showVoice) parts.push(`voice <b>${voiceSelect.selectedOptions[0]?.textContent || '—'}</b>`);

    // Whether audio will be produced is the most consequential fact here — it
    // is the difference between seconds and minutes, and between free and paid.
    const outcome = action === 'script'
      ? '<b>Text only</b> — no audio will be generated'
      : action === 'audio'
        ? (state.qcPinnedScriptId
          ? '<b>Audio only</b> — from the exact script this version used'
          : '<b>Audio only</b> — from the existing script')
        : (source === 'ai-existing' ? '<b>Audio only</b> — $0 API Cost' : '<b>Text + audio</b>');

    $('#qc-summary').innerHTML =
      `Will produce: ${outcome}<br><span class="qc-summary-detail">${parts.join(' · ')}</span>`;

    // The button should say what pressing it does.
    const startBtn = $('#btn-qc-start');
    if (startBtn) {
      startBtn.textContent = action === 'script' ? 'Preview retelling'
        : action === 'audio' ? 'Narrate existing script'
        : 'Create audiobook';
    }
  }

  langSelect.onchange = refresh;
  styleSelect.onchange = refresh;
  voiceSelect.onchange = refresh;
  // Changing the source abandons the pin: it names a script of the OLD source,
  // so keeping it would speak that text while the dialog advertises the new
  // one. Losing the pin is the honest outcome of changing your mind.
  $('#qc-source-group').onchange = () => { state.qcPinnedScriptId = null; refresh(); };
  $('#qc-action-group').onchange = refresh;
  $('#qc-edit-script').onclick = () => {
    chapterOverrides[chapterIdx] = {
      ...(chapterOverrides[chapterIdx] || {}),
      language: langSelect.value,
      voiceId: voiceSelect.value,
      translationStyle: styleSelect.value,
      scriptSource: 'custom',
    };
    syncNarrationControls();
    hide('#quick-convert-modal');
    openScriptEditor(chapterIdx);
  };

  refresh();
  show('#quick-convert-modal');
}

export function resetChapterOverride(chapterIdx) {
  if (!chapterOverrides[chapterIdx]) return;
  delete chapterOverrides[chapterIdx];
  // The override count in the summary, the row chip and the batch grouping are
  // all derived from this map, so they must all be recomputed together.
  syncNarrationControls();
  renderChapters();
  if (state.readerChapterIdx === chapterIdx) renderListenPane();
  showToast(`Chapter ${chapterIdx + 1} now uses this book's default settings.`, 'success');
}

export function clearChapterOverrides() {
  for (const key of Object.keys(chapterOverrides)) delete chapterOverrides[key];
}

export function initChapterControls() {
  initChapterList({
    onPlay: (audioIndex) => { if (!isNaN(audioIndex)) playAudioAtIndex(audioIndex); },
    // The quick action fires straight away ONLY once this book has agreed to
    // it. Until then the first press opens the dialog, because a conversion
    // spends API tokens and TTS time on settings the user has not yet seen —
    // and "it just started doing something expensive" is the worst possible
    // first impression. After the agreement, the gear is still the way to
    // deviate, and per-chapter overrides never write back to the defaults.
    onConvert: (chapterIdx) => {
      if (!getQuickActionAllowed(state.currentBookId)) {
        openQuickConvertModal(chapterIdx, { firstRun: true });
        return;
      }
      startSingleChapterGeneration(chapterIdx, chapterOverrides[chapterIdx] || {});
    },
    onConvertOptions: (chapterIdx) => openQuickConvertModal(chapterIdx),
    onResetOverride: (chapterIdx) => resetChapterOverride(chapterIdx),
    // Recovery from a failed row. Retry reuses the settings that failed, so
    // it is a true retry rather than a fresh conversion with today's defaults.
    onRetry: (chapterIdx) => retryChapter(chapterIdx),
    onUseMyScript: (chapterIdx) => openScriptEditor(chapterIdx),
    onViewLogs: (chapterIdx) => showLogsForChapter(chapterIdx),
    onPreview: (chapterIdx) => previewChapter(chapterIdx),
    onVersions: (chapterIdx) => openVersionsModal(chapterIdx),
    onCancel: (chapterIdx) => cancelChapterConversion(chapterIdx),
    onDeleteAudio: (chapterIdx, audioIndex) => deleteAudioVersion(audioIndex),
    // The audiobook panel is a function of which chapters have audio, so it is
    // refreshed with the list rather than from every call site that changes it.
    onRendered: () => refreshAudiobookPanel(),
  });

  $('#se-language')?.addEventListener('change', () => {
    populateSeVoices($('#se-language').value);
    runScriptCheck(true);
  });
}

