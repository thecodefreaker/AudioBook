import { api } from '../services/api.js';
import { state } from '../store.js';
import { $, setText, hide, show } from '../utils/dom.js';
import { escapeHtml } from '../utils/html.js';
import { formatDateTime, formatNumber } from '../utils/formatters.js';
import { showToast } from '../components/toast.js';
import { addLogEntry } from '../components/logConsole.js';
import { startSingleChapterGeneration, startTranslateOnly } from '../generation/generationJobs.js';
import { CATALOG, languageName, styleName, voiceName } from '../components/catalog.js';
import { ReaderSync, renderSentences } from '../services/readerSync.js';
import { setSetting } from '../services/settings.js';
import { openQuickConvertModal } from '../chapters/chapterActions.js';
import { suggestLanguageAndVoice, detectScript, scriptLabel } from '../utils/scriptDetect.js';
import { effectiveSettingsFor } from '../ui/configPanel.js';

// Dependencies that stay in main for now but are passed in or imported
import { 
  renderBookOverview, 
  renderListenPane, 
  chapterOverrides, 
  openScriptEditor
} from '../main.js';

let readerSync = null;
let readAloudUtterance = null;

function updateReadAloudButton(active = false) {
  const button = $('#btn-reader-read-aloud');
  if (!button) return;
  button.textContent = active ? 'Stop reading' : 'Read aloud';
  button.setAttribute('aria-pressed', String(active));
  button.setAttribute('aria-label', active ? 'Stop reading aloud' : 'Read original chapter aloud');
  button.classList.toggle('active', active);
}

export function stopReadAloud() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
  readAloudUtterance = null;
  updateReadAloudButton(false);
}

export function toggleReadAloud() {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    showToast('Read aloud is not supported in this browser.', 'info');
    return;
  }
  if (window.speechSynthesis.speaking || readAloudUtterance) {
    stopReadAloud();
    return;
  }

  const text = state.currentChapterData?.textContent?.trim();
  if (!text) {
    showToast('This chapter has no original text to read aloud.', 'info');
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.onend = () => {
    if (readAloudUtterance === utterance) stopReadAloud();
  };
  utterance.onerror = () => {
    if (readAloudUtterance === utterance) stopReadAloud();
  };
  readAloudUtterance = utterance;
  updateReadAloudButton(true);
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export async function previewChapter(index, initialMode = null, pinnedScriptId = null, syncAudio = false) {
  try {
    stopReadAloud();
    const data = await api.getChapterContent(state.currentBookId, index);
    
    if (pinnedScriptId) {
      try {
        const full = await api.getScript(state.currentBookId, pinnedScriptId);
        if (full?.script) {
          const s = full.script;
          if (s.source === 'custom') {
            data.customContent = s.content;
            data.customScript = s;
            state.readerViewMode = 'edit';
          } else if (s.source === 'antigravity') {
            data.antigravityContent = s.content;
            data.antigravityScript = s;
            state.readerViewMode = 'antigravity';
          } else {
            data.aiContent = s.content;
            data.aiScript = s;
            state.readerViewMode = 'ai';
          }
        }
      } catch (err) {
        addLogEntry({ level: 'error', message: `Could not load pinned script: ${err.message}` });
      }
    }

    state.readerChapterIdx = index;
    state.currentChapterData = data;
    state.listenVersionId = null;
    state.inlineEditingScript = false;

    if (state.currentBookId) {
      renderBookOverview();
    }
    
    if (initialMode) {
      state.readerViewMode = initialMode;
    } else if (!pinnedScriptId) {
      const playing = state.audioFiles?.[state.currentAudioIndex];
      const chId = data.id;
      if (playing && (playing.chapterIndex === index || playing.chapterId === chId)) {
        state.readerViewMode = playing.scriptSource === 'custom' ? 'edit'
          : playing.scriptSource === 'antigravity' ? 'antigravity'
          : playing.scriptSource === 'ai' ? 'ai'
          : 'original';
      } else {
        const chAudio = (state.audioFiles || []).find(a => !a.isMerged && (a.chapterIndex === index || a.chapterId === chId));
        if (chAudio) {
          state.readerViewMode = chAudio.scriptSource === 'custom' ? 'edit'
            : chAudio.scriptSource === 'antigravity' ? 'antigravity'
            : chAudio.scriptSource === 'ai' ? 'ai'
            : 'original';
        } else if (data.hasAiScript || data.aiContent) {
          state.readerViewMode = 'ai';
        } else if (data.hasCustomScript || data.customContent) {
          state.readerViewMode = 'edit';
        } else {
          state.readerViewMode = 'original';
        }
      }
    }

    setText('#modal-chapter-title', data.title);
    
    const v = state.chapters || [];
    const currIdx = v.findIndex(c => c.chapterIndex === index);
    if ($('#btn-reader-prev')) $('#btn-reader-prev').disabled = currIdx <= 0;
    if ($('#btn-reader-next')) $('#btn-reader-next').disabled = currIdx === -1 || currIdx >= v.length - 1;

    const jumper = $('#reader-chapter-jumper');
    if (jumper) {
      jumper.innerHTML = v.map(c => {
        const hasAudio = state.audioFiles && state.audioFiles.some(a => a.chapterId === c.id && !a.isMerged);
        const icon = hasAudio ? ' 🔊' : '';
        return `<option value="${c.chapterIndex}" ${c.chapterIndex === index ? 'selected' : ''}>${escapeHtml(c.title || `Chapter ${c.chapterIndex + 1}`)}${icon}</option>`;
      }).join('');
    }
    
    const readTimeMin = Math.max(1, Math.round(data.wordCount / 200));
    setText('#modal-chapter-meta', `${formatNumber(data.wordCount)} words · ${formatNumber(data.charCount)} characters · ~${readTimeMin} min read`);
    
    // Auto-fetch alignment if this chapter's audio is currently loaded or playing
    const playing = state.audioFiles?.[state.currentAudioIndex];
    if (playing && (playing.chapterIndex === index || playing.chapterId === data.id)) {
      if (!state.currentAlignment || state.currentAudioId !== playing.id) {
        state.currentAudioId = playing.id;
        api.getAlignment(playing.id).then(({ alignment }) => {
          state.currentAlignment = alignment;
          attachReaderSync();
        }).catch(() => {});
      }
    }

    renderReaderBody();
    applyReaderSettings();
    renderListenPane();
    renderReaderSidebarChapters();
    show('#chapter-modal');
    
    // Attempt to sync the player if there's audio available for this new chapter
    if (syncAudio && state.audioFiles && state.chapters) {
      const ch = state.chapters.find(c => c.chapterIndex === index);
      if (ch) {
        const audioIdx = state.audioFiles.findIndex(a => a.chapterId === ch.id && !a.isMerged);
        if (audioIdx !== -1 && state.currentAudioIndex !== audioIdx) {
          window.dispatchEvent(new CustomEvent('reader:chapter:changed', { 
            detail: { audioIdx, autoPlay: !!state.isPlaying } 
          }));
        }
      }
    }
  } catch (err) {
    showToast('Failed to load chapter: ' + err.message, 'error');
  }
}

export function renderScriptToolbar(script, whatItIs, allScripts = []) {
  if (!script) return '';
  const when = script.createdAt ? formatDateTime(script.createdAt) : '';
  const bits = [languageName(script.language), script.style ? styleName(script.style) : '', when]
    .filter(Boolean).join(' · ');

  const availableScripts = (allScripts && allScripts.length > 0) ? allScripts : [script];
  let versionSelectHtml = '';
  if (availableScripts.length > 1) {
    versionSelectHtml = `
      <div style="display: inline-flex; align-items: center; gap: 6px; margin-left: 10px;">
        <span style="font-size: 0.8rem; opacity: 0.8; font-weight: 500;">Version:</span>
        <select class="script-version-select select-sm" style="font-size: 0.82rem; padding: 3px 8px; border-radius: 4px; border: 1px solid var(--border-color, #ccc); background: var(--bg-card, #fff); color: var(--text-color, #111); font-weight: 600; cursor: pointer;">
          ${availableScripts.map((s, idx) => {
            const sWhen = s.createdAt ? formatDateTime(s.createdAt) : '';
            const sSourceLabel = s.source === 'custom' ? 'Custom' : s.source === 'antigravity' ? 'Antigravity' : 'AI';
            const sLabel = `V${availableScripts.length - idx} (${sSourceLabel}${s.style ? ` · ${styleName(s.style)}` : ''})${sWhen ? ` · ${sWhen}` : ''}`;
            const isSelected = s.id === script.id ? 'selected' : '';
            return `<option value="${escapeHtml(s.id)}" ${isSelected}>${escapeHtml(sLabel)}</option>`;
          }).join('')}
        </select>
      </div>
    `;
  }

  return `
    <div class="script-toolbar">
      <div class="script-toolbar-meta">
        <strong>${script.source === 'custom' ? 'My script' : script.source === 'antigravity' ? 'Antigravity CLI Script' : 'AI script'}</strong>
        ${bits ? `<span>${escapeHtml(bits)}</span>` : ''}
        ${versionSelectHtml}
      </div>
      <button class="btn btn-primary btn-sm script-speak-btn" data-script-id="${escapeHtml(script.id)}">
        Narrate this script
      </button>
      <div class="script-toolbar-note">Speaks ${escapeHtml(whatItIs)} exactly — the AI will not run again.</div>
      ${script.customPrompt ? `<div class="script-toolbar-prompt" style="margin-top: 8px; font-size: 0.85rem; padding: 8px; background: rgba(0,0,0,0.05); border-radius: 4px; color: var(--text-muted); width: 100%;"><strong>Prompt:</strong> ${escapeHtml(script.customPrompt)}</div>` : ''}
    </div>`;
}

export function attachScriptToolbar(body, chapterIdx, script) {
  if (!script) return;
  body.querySelector('.script-speak-btn')?.addEventListener('click', () => {
    startSingleChapterGeneration(chapterIdx, {
      ...(chapterOverrides[chapterIdx] || {}),
      action: 'audio',
      scriptId: script.id,
      scriptSource: script.source === 'custom' ? 'custom' : 'ai',
    });
  });

  body.querySelector('.script-version-select')?.addEventListener('change', (e) => {
    const selectedScriptId = e.target.value;
    if (selectedScriptId) {
      previewChapter(chapterIdx, null, selectedScriptId);
    }
  });
}

export function renderInlineScriptEditor(body, data) {
  const customScript = (data.scripts || []).find(s => s.source === 'custom');
  const hasExisting = !!(customScript && data.customContent?.trim());
  const initialContent = data.customContent || '';

  body.innerHTML = `
    <div class="inline-se-container">
      <div class="inline-se-header">
        <div class="inline-se-title-group">
          <h4 class="inline-se-title">${hasExisting ? 'Edit Custom Script' : 'Create Custom Script'}</h4>
          <p class="inline-se-desc">Your pasted text is narrated word-for-word by the selected neural voice without AI rewriting.</p>
        </div>
        <div class="inline-se-tools">
          <button class="btn btn-secondary btn-sm" data-action="paste">📋 Paste</button>
          <button class="btn btn-secondary btn-sm" data-action="copy-orig">📄 Copy Original</button>
        </div>
      </div>

      <textarea class="inline-se-textarea" spellcheck="false"
        placeholder="Paste your Hindi (देवनागरी), Roman Hinglish, or English script here...">${escapeHtml(initialContent)}</textarea>

      <div class="inline-se-bar">
        <div class="inline-se-meta">
          <span class="inline-se-badge">Detecting…</span>
          <span class="inline-se-counts">0 words · 0 chars</span>
        </div>
        <div class="inline-se-voice-row">
          <label class="inline-se-label">Language:</label>
          <select class="inline-se-select se-lang">
            <option value="hi">Hindi / Hinglish</option>
            <option value="en">English</option>
          </select>

          <label class="inline-se-label">Voice:</label>
          <select class="inline-se-select se-voice"></select>
        </div>
      </div>
      <div class="inline-se-note"></div>

      <div class="inline-se-actions">
        ${hasExisting ? `<button class="btn btn-secondary btn-sm" data-action="cancel">Cancel</button>` : ''}
        ${hasExisting ? `<button class="btn btn-ghost btn-sm" data-action="delete" style="color: var(--color-danger, #ef4444);">Delete Script</button>` : ''}
        <div style="flex:1"></div>
        <button class="btn btn-secondary" data-action="save">Save Script</button>
        ${hasExisting ? `<button class="btn btn-secondary" data-action="save-new">Save as New Version</button>` : ''}
        <button class="btn btn-primary" data-action="save-narrate">Save &amp; Narrate</button>
      </div>
    </div>
  `;

  const textarea = body.querySelector('.inline-se-textarea');
  const badge = body.querySelector('.inline-se-badge');
  const counts = body.querySelector('.inline-se-counts');
  const langSelect = body.querySelector('.inline-se-select.se-lang');
  const voiceSelect = body.querySelector('.inline-se-select.se-voice');
  const note = body.querySelector('.inline-se-note');

  let currentVoiceId = (chapterOverrides[data.chapterIndex]?.voiceId) || effectiveSettingsFor(data.chapterIndex).voiceId;

  function populateVoices(langCode, preferredVoice = null) {
    const langDef = CATALOG.languages.find(l => l.code === langCode);
    const voices = langDef?.voices || [];
    voiceSelect.innerHTML = voices.map(v => 
      `<option value="${v.id}" ${v.id === preferredVoice ? 'selected' : ''}>${v.name} (${v.gender || 'Neural'})</option>`
    ).join('');
    if (!voices.some(v => v.id === preferredVoice) && voices.length > 0) {
      voiceSelect.value = voices[0].id;
    }
  }

  function runDetection(userInteractedLang = false) {
    const text = textarea.value;
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
    const charCount = text.length;
    counts.textContent = `${formatNumber(wordCount)} words · ${formatNumber(charCount)} chars`;

    const detection = suggestLanguageAndVoice(text, voiceSelect.value || currentVoiceId, CATALOG.languages);
    badge.textContent = detection.label;

    if (!userInteractedLang) {
      langSelect.value = detection.language;
      populateVoices(detection.language, detection.voiceId);
    }
    
    if (detection.note) {
      note.textContent = detection.note;
      note.className = 'inline-se-note' + (detection.kind === 'roman_hinglish' ? ' warn' : '');
    } else {
      note.textContent = '';
      note.className = 'inline-se-note';
    }
  }

  langSelect.addEventListener('change', () => {
    populateVoices(langSelect.value);
    runDetection(true);
  });

  textarea.addEventListener('input', () => {
    runDetection(false);
  });

  body.querySelector('[data-action="paste"]')?.addEventListener('click', async () => {
    try {
      const clip = await navigator.clipboard.readText();
      if (clip?.trim()) {
        textarea.value = clip;
        runDetection(false);
        showToast('Pasted from clipboard.', 'success');
      }
    } catch {
      showToast('Press Ctrl+V to paste your script.', 'info');
      textarea.focus();
    }
  });

  body.querySelector('[data-action="copy-orig"]')?.addEventListener('click', async () => {
    if (data.textContent) {
      try {
        await navigator.clipboard.writeText(data.textContent);
        showToast('Original chapter text copied.', 'success');
      } catch {
        showToast('Failed to copy text.', 'error');
      }
    }
  });

  body.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
    state.inlineEditingScript = false;
    renderReaderBody();
  });

  body.querySelector('[data-action="delete"]')?.addEventListener('click', async () => {
    if (!confirm('Delete your custom script for this chapter?')) return;
    try {
      if (customScript) await api.deleteScript(state.currentBookId, customScript.id);
      const ch = state.chapters.find(c => c.chapterIndex === data.chapterIndex);
      if (ch) ch.hasCustomScript = false;
      data.customContent = '';
      if (data.scripts) {
        data.scripts = data.scripts.filter(s => s.id !== customScript?.id);
      }
      state.inlineEditingScript = false;
      showToast('Custom script deleted.', 'info');
      renderReaderBody();
    } catch (err) {
      showToast('Could not delete script: ' + err.message, 'error');
    }
  });

  const saveScript = async (asNewVersion = false) => {
    const text = textarea.value.trim();
    if (!text) {
      showToast('Script is empty. Paste some text first.', 'warning');
      return false;
    }
    const chosenLang = langSelect.value;
    try {
      const res = await api.saveCustomScript(state.currentBookId, data.chapterIndex, text, chosenLang, asNewVersion);
      if (res?.script) {
        data.customScript = res.script;
        data.customContent = res.script.content || text;
      }
      const ch = state.chapters.find(c => c.chapterIndex === data.chapterIndex);
      if (ch) ch.hasCustomScript = true;
      const { scripts = [] } = await api.getChapterScripts(state.currentBookId, data.chapterIndex);
      data.scripts = scripts;
      return true;
    } catch (err) {
      showToast('Could not save script: ' + err.message, 'error');
      return false;
    }
  };

  body.querySelector('[data-action="save"]')?.addEventListener('click', async () => {
    const ok = await saveScript(true);
    if (ok) {
      state.inlineEditingScript = false;
      showToast('Script saved as new version.', 'success');
      renderReaderBody();
    }
  });

  body.querySelector('[data-action="save-new"]')?.addEventListener('click', async () => {
    const ok = await saveScript(true);
    if (ok) {
      state.inlineEditingScript = false;
      showToast('Saved as new script version.', 'success');
      renderReaderBody();
    }
  });

  body.querySelector('[data-action="save-narrate"]')?.addEventListener('click', async () => {
    const ok = await saveScript(false);
    if (!ok) return;
    state.inlineEditingScript = false;
    const chosenLang = langSelect.value;
    const chosenVoice = voiceSelect.value;
    showToast('Script saved — starting narration.', 'info');
    startSingleChapterGeneration(data.chapterIndex, {
      scriptSource: 'custom',
      language: chosenLang,
      voiceId: chosenVoice,
      action: 'both',
    });
    renderReaderBody();
  });

  // Initial populate and run
  populateVoices(langSelect.value, currentVoiceId);
  runDetection(false);
  textarea.focus();
}

export function renderReaderBody() {
  const data = state.currentChapterData;
  if (!data) return;

  const body = $('#modal-chapter-body');
  const btnOrig = $('#reader-tab-original');
  const btnAi = $('#reader-tab-ai');
  const btnEdit = $('#reader-tab-edit');
  const btnAnti = $('#reader-tab-antigravity');

  const modes = { original: btnOrig, ai: btnAi, edit: btnEdit, antigravity: btnAnti };
  for (const [mode, btn] of Object.entries(modes)) {
    btn?.setAttribute('aria-selected', String(state.readerViewMode === mode));
  }

  if (state.readerViewMode === 'edit') {
    const customScripts = (data.scripts || []).filter(s => s.source === 'custom');
    const customScript = data.customScript || customScripts[0] || (data.scripts || []).find(s => s.source === 'custom');
    const customText = customScript?.content || data.customContent || '';

    if (!customScript || !customText.trim() || state.inlineEditingScript) {
      renderInlineScriptEditor(body, data);
    } else {
      body.innerHTML = renderScriptToolbar(customScript, 'my custom script', data.scripts)
        + renderSentences(customText, { escape: escapeHtml });

      attachScriptToolbar(body, data.chapterIndex, customScript);

      const meta = body.querySelector('.script-toolbar-meta');
      if (meta) {
        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-secondary btn-sm inline-se-start-edit';
        editBtn.style.marginLeft = '8px';
        editBtn.textContent = '✏️ Edit / Add Version';
        editBtn.addEventListener('click', () => {
          state.inlineEditingScript = true;
          renderReaderBody();
        });
        meta.appendChild(editBtn);
      }
    }
    attachReaderSync();
    return;
  }

  if (state.readerViewMode === 'ai') {
    const aiText = data.aiContent || '';
    if (aiText.trim()) {
      body.innerHTML = renderScriptToolbar(data.aiScript, 'the AI retelling above', data.scripts)
        + renderSentences(aiText, { escape: escapeHtml });
      attachScriptToolbar(body, data.chapterIndex, data.aiScript);
    } else {
      body.innerHTML = `
        <div class="empty">
          <div class="empty-icon">AI script</div>
          <div class="empty-title">No AI script yet</div>
          <p class="empty-text">
            Generate the AI retelling to review. This produces
            <strong>text only</strong> — no audio is generated, so you can judge
            it first and generate audio afterwards if you like it.
          </p>
          <div class="row">
            <button class="btn btn-secondary open-edit-script-btn">Paste my script</button>
            <button class="btn btn-primary reader-translate-btn" data-chapter-index="${data.chapterIndex}">
              Preview AI retelling
            </button>
          </div>
        </div>
      `;

      body.querySelector('.open-edit-script-btn')?.addEventListener('click', () => {
        state.readerViewMode = 'edit';
        state.inlineEditingScript = true;
        renderReaderBody();
      });

      body.querySelector('.reader-translate-btn')?.addEventListener('click', () => {
        startTranslateOnly(data.chapterIndex);
      });
    }
  } else if (state.readerViewMode === 'antigravity') {
    const antiText = data.antigravityContent || '';
    
    // UI block for regenerating / generating via Antigravity
    const convertUi = `
      <div class="antigravity-convert-ui" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--border-color);">
        <h4 style="margin: 0 0 10px 0; font-size: 14px;">Antigravity Engine</h4>
        <label style="display: block; margin-bottom: 5px; font-weight: 500; font-size: 12px; color: var(--text-muted);">Custom CLI Prompt (optional)</label>
        <textarea class="form-control ag-custom-prompt-input" rows="3" placeholder="If left blank, the style's default Hinglish prompt is used." style="width: 100%; margin-bottom: 10px; resize: vertical;">${escapeHtml(data.antigravityScript?.customPrompt || '')}</textarea>
        <div style="display: flex; gap: 10px; margin-top: 10px;">
          <button class="btn btn-primary ag-convert-btn" style="flex: 1;">
            ${antiText.trim() ? 'Regenerate Script Only' : 'Convert Script Only'}
          </button>
          <button class="btn btn-success ag-convert-audio-btn" style="flex: 1;">
            ${antiText.trim() ? 'Regenerate & Narrate' : 'Convert & Narrate'}
          </button>
        </div>
      </div>
    `;

    if (antiText.trim()) {
      body.innerHTML = renderScriptToolbar(data.antigravityScript, 'the Antigravity CLI script above', data.scripts)
        + renderSentences(antiText, { escape: escapeHtml })
        + convertUi;
      attachScriptToolbar(body, data.chapterIndex, data.antigravityScript);
    } else {
      body.innerHTML = `
        <div class="empty">
          <div class="empty-icon">🚀</div>
          <div class="empty-title">No Antigravity script yet</div>
          <p class="empty-text">
            Generate the script using the high-performance local Antigravity CLI engine.
          </p>
          ${convertUi}
        </div>
      `;
    }
    
    body.querySelector('.ag-convert-btn')?.addEventListener('click', () => {
      const customPrompt = body.querySelector('.ag-custom-prompt-input').value.trim();
      startTranslateOnly(data.chapterIndex, { scriptSource: 'antigravity', customPrompt });
    });
    
    body.querySelector('.ag-convert-audio-btn')?.addEventListener('click', () => {
      const customPrompt = body.querySelector('.ag-custom-prompt-input').value.trim();
      import('../generation/generationJobs.js').then(({ startSingleChapterGeneration }) => {
        startSingleChapterGeneration(data.chapterIndex, { action: 'both', scriptSource: 'antigravity', customPrompt });
      });
    });
  } else {
    const paragraphs = (data.textContent || '');
    body.innerHTML = renderSentences(paragraphs, { escape: escapeHtml });
  }

  attachReaderSync();
}

export function attachReaderSync() {
  const body = $('#modal-chapter-body');
  const audio = $('#audio-element');
  if (!body || !audio) return;

  const playing = state.audioFiles?.[state.currentAudioIndex];
  const sameChapter = playing && (playing.chapterIndex === state.readerChapterIdx || playing.chapterId === state.currentChapterData?.id);

  const viewingSpoken =
    state.readerViewMode === 'ai' ? (playing?.scriptSource === 'ai' || (!playing?.scriptSource && playing?.language !== 'en'))
    : state.readerViewMode === 'antigravity' ? (playing?.scriptSource === 'antigravity')
    : state.readerViewMode === 'edit' ? (playing?.scriptSource === 'custom')
    : state.readerViewMode === 'original' ? (playing?.scriptSource === 'original' || playing?.language === 'en')
    : false;

  const textMatchesAudio = !!(sameChapter && viewingSpoken);

  // Remove existing hint banner if present
  body.querySelector('.reader-sync-hint-banner')?.remove();

  // If this chapter's audio is playing, but the reader is showing a different text version, offer 1-click switch
  if (sameChapter && !viewingSpoken && playing && !state.inlineEditingScript) {
    const targetMode = playing.scriptSource === 'custom' ? 'edit'
      : playing.scriptSource === 'antigravity' ? 'antigravity'
      : playing.scriptSource === 'ai' ? 'ai'
      : 'original';
    const targetLabel = playing.scriptSource === 'custom' ? 'My Script'
      : playing.scriptSource === 'antigravity' ? 'Antigravity Script'
      : playing.scriptSource === 'ai' ? 'AI Script'
      : 'Original Text';
    const sourceLabel = playing.scriptSource === 'custom' ? 'My Script'
      : playing.scriptSource === 'antigravity' ? 'Antigravity'
      : playing.scriptSource === 'ai' ? 'AI Retelling'
      : 'Original';

    const banner = document.createElement('div');
    banner.className = 'reader-sync-hint-banner';
    banner.innerHTML = `
      <span>🎧 Playing <strong>${escapeHtml(sourceLabel)}</strong> audio (${escapeHtml(languageName(playing.language))} · ${escapeHtml(voiceName(playing.voiceId))})</span>
      <button class="btn btn-secondary btn-sm switch-to-audio-view-btn" data-target-mode="${targetMode}">
        Switch to ${escapeHtml(targetLabel)} to follow along
      </button>
    `;
    banner.querySelector('.switch-to-audio-view-btn')?.addEventListener('click', () => {
      state.readerViewMode = targetMode;
      state.inlineEditingScript = false;
      renderReaderBody();
    });
    body.insertBefore(banner, body.firstChild);
  }

  if (!readerSync) {
    readerSync = new ReaderSync({ audio, container: body });
  }
  readerSync.container = body;

  readerSync.load(state.currentAlignment, textMatchesAudio);
  updateSyncStatusUi();

  if (readerSync.syncable) readerSync.start();

  body.addEventListener('click', (e) => {
    const span = e.target.closest('.sentence');
    if (!span) return;
    handleSentenceActivate(Number(span.dataset.sentence));
  });

  body.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const span = e.target.closest('.sentence');
    if (!span) return;
    e.preventDefault();
    handleSentenceActivate(Number(span.dataset.sentence));
  });
}

export function handleSentenceActivate(index) {
  if (Number.isNaN(index)) return;

  if (!readerSync?.syncable) {
    showToast(
      state.currentAlignment
        ? 'This view does not match the playing audio. Switch to the language you are listening to.'
        : 'Play this chapter’s audio first — then tapping a line will jump to it.',
      'info'
    );
    return;
  }

  if (readerSync.seekToSentence(index)) {
    const audio = $('#audio-element');
    if (audio?.paused) audio.play().catch(() => {});
  }
}

export function updateSyncStatusUi() {
  const el = $('#reader-sync-status');
  if (!el || !readerSync) return;
  el.textContent = readerSync.statusText;
  el.className = `reader-sync-status ${readerSync.syncable ? (readerSync.approximate ? 'approx' : 'ok') : 'off'}`;

  const followBtn = $('#reader-follow-toggle');
  if (followBtn) followBtn.disabled = !readerSync.syncable;
}

export function applyReaderSettings() {
  const container = $('#modal-content-container');
  const body = $('#modal-chapter-body');
  if (!body || !container) return;

  body.style.fontSize = `${state.readerFontSize}px`;
  setText('#reader-font-val', `${state.readerFontSize}px`);
  setSetting('readerFontSize', state.readerFontSize);

  body.style.lineHeight = state.readerLineHeight;
  const lineSelect = $('#reader-line-height-select');
  if (lineSelect) lineSelect.value = state.readerLineHeight;
  setSetting('readerLineHeight', state.readerLineHeight);

  if (state.readerFontFamily === 'serif') {
    body.style.fontFamily = "'Georgia', 'Cambria', 'Times New Roman', serif";
  } else if (state.readerFontFamily === 'mono') {
    body.style.fontFamily = "'Fira Code', 'Courier New', monospace";
  } else {
    body.style.fontFamily = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  }
  const fontSelect = $('#reader-font-select');
  if (fontSelect) fontSelect.value = state.readerFontFamily;
  setSetting('readerFontFamily', state.readerFontFamily);

  container.classList.remove('reader-theme-sepia', 'reader-theme-light', 'reader-theme-oled', 'reader-theme-dark');
  if (state.readerTheme !== 'dark') {
    container.classList.add(`reader-theme-${state.readerTheme}`);
  }
  const themeSelect = $('#reader-theme-select');
  if (themeSelect) themeSelect.value = state.readerTheme;
  setSetting('readerTheme', state.readerTheme);

  container.classList.toggle('fullscreen-reader', !!state.readerFullscreen);
  $('#btn-reader-fullscreen')?.setAttribute('aria-pressed', String(!!state.readerFullscreen));

  const promptToggle = $('#reader-copy-prompt-toggle');
  const promptManager = $('#reader-copy-prompt-manager');
  const promptInput = $('#reader-copy-prompt-input');
  
  if (promptToggle) promptToggle.checked = !!state.readerPromptManagerEnabled;
  if (promptManager) promptManager.style.display = state.readerPromptManagerEnabled ? 'block' : 'none';
  if (promptInput && state.readerPromptManagerText !== undefined) {
    promptInput.value = state.readerPromptManagerText;
  }
  
  setSetting('readerPromptManagerEnabled', !!state.readerPromptManagerEnabled);
  setSetting('readerPromptManagerText', state.readerPromptManagerText || '');
}

export function initReaderUi() {
  function closeModal() {
    stopReadAloud();
    hide('#chapter-modal');
    state.readerChapterIdx = null;
    state.currentChapterData = null;
  }
  
  $('#modal-close')?.addEventListener('click', closeModal);
  $('#btn-reader-prev')?.addEventListener('click', () => {
    if (state.readerChapterIdx !== null) {
      const v = state.chapters;
      const i = v.findIndex(c => c.chapterIndex === state.readerChapterIdx);
      const syncAudio = $('#reader-sync-nav-toggle')?.checked ?? true;
      if (i > 0) previewChapter(v[i - 1].chapterIndex, 'original', null, syncAudio);
    }
  });
  $('#btn-reader-next')?.addEventListener('click', () => {
    if (state.readerChapterIdx !== null) {
      const v = state.chapters;
      const i = v.findIndex(c => c.chapterIndex === state.readerChapterIdx);
      const syncAudio = $('#reader-sync-nav-toggle')?.checked ?? true;
      if (i >= 0 && i < v.length - 1) previewChapter(v[i + 1].chapterIndex, 'original', null, syncAudio);
    }
  });
  $('#chapter-modal')?.addEventListener('click', (e) => {
    if (e.target === $('#chapter-modal')) closeModal();
  });
  $('#reader-chapter-jumper')?.addEventListener('change', (e) => {
    previewChapter(parseInt(e.target.value, 10));
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      const modal = $('#chapter-modal');
      if (modal && !modal.classList.contains('hidden')) {
        e.preventDefault();
        $('#reader-chapter-jumper')?.focus();
      }
    }
  });

  $('#btn-mobile-listen')?.addEventListener('click', () => {
    $('#listen-pane')?.classList.add('open');
    $('#listen-pane-scrim')?.classList.add('show');
  });

  $('#listen-pane-scrim')?.addEventListener('click', () => {
    $('#listen-pane')?.classList.remove('open');
    $('#listen-pane-scrim')?.classList.remove('show');
  });

  $('#reader-tab-original')?.addEventListener('click', () => {
    state.readerViewMode = 'original';
    state.inlineEditingScript = false;
    renderReaderBody();
  });

  $('#reader-tab-ai')?.addEventListener('click', () => {
    state.readerViewMode = 'ai';
    state.inlineEditingScript = false;
    renderReaderBody();
  });

  $('#reader-tab-antigravity')?.addEventListener('click', () => {
    state.readerViewMode = 'antigravity';
    state.inlineEditingScript = false;
    renderReaderBody();
  });

  $('#reader-tab-edit')?.addEventListener('click', async () => {
    state.readerViewMode = 'edit';
    state.inlineEditingScript = false;
    const data = state.currentChapterData;
    if (data) {
       const custom = (data.scripts || []).find(s => s.source === 'custom');
       if (custom && !data.customContent) {
          const body = $('#modal-chapter-body');
          if (body) body.innerHTML = '<div class="empty"><p>Loading custom script...</p></div>';
          try {
             const full = await api.getScript(state.currentBookId, custom.id);
             data.customContent = full.script?.content || '';
          } catch (err) {
             console.error(err);
             data.customContent = '';
          }
       }
    }
    renderReaderBody();
  });

  $('#btn-reader-copy')?.addEventListener('click', async () => {
    const data = state.currentChapterData;
    if (!data) return;
    const btn = $('#btn-reader-copy');
    const originalContent = btn.innerHTML;
    let textToCopy = '';
    
    if (state.readerViewMode === 'ai') {
      textToCopy = data.aiContent || '';
    } else {
      textToCopy = data.textContent || '';
    }
    
    const toggle = $('#reader-copy-prompt-toggle');
    const promptInput = $('#reader-copy-prompt-input');
    if (toggle?.checked && promptInput?.value.trim()) {
      textToCopy = promptInput.value.trim() + '\n\n' + textToCopy;
    }
    
    if (!textToCopy.trim()) {
      showToast('No text available to copy.', 'warning');
      return;
    }
    
    btn.innerHTML = 'Copied';
    try {
      await navigator.clipboard.writeText(textToCopy);
      showToast('Chapter text copied to clipboard.', 'success');
    } catch (err) {
      btn.innerHTML = 'Failed';
      showToast('Failed to copy text.', 'error');
    }
    setTimeout(() => {
      if (btn) btn.innerHTML = originalContent;
    }, 2000);
  });

  $('#reader-copy-prompt-toggle')?.addEventListener('change', (e) => {
    state.readerPromptManagerEnabled = e.target.checked;
    applyReaderSettings();
  });

  $('#reader-copy-prompt-input')?.addEventListener('input', (e) => {
    state.readerPromptManagerText = e.target.value;
    applyReaderSettings();
  });

  $('#btn-font-dec')?.addEventListener('click', () => {
    if (state.readerFontSize > 12) {
      state.readerFontSize -= 1;
      applyReaderSettings();
    }
  });
  
  $('#btn-font-inc')?.addEventListener('click', () => {
    if (state.readerFontSize < 28) {
      state.readerFontSize += 1;
      applyReaderSettings();
    }
  });

  $('#reader-font-select')?.addEventListener('change', (e) => {
    state.readerFontFamily = e.target.value;
    applyReaderSettings();
  });

  $('#reader-line-height-select')?.addEventListener('change', (e) => {
    state.readerLineHeight = e.target.value;
    applyReaderSettings();
  });

  $('#reader-theme-select')?.addEventListener('change', (e) => {
    state.readerTheme = e.target.value;
    applyReaderSettings();
  });

  $('#btn-reader-fullscreen')?.addEventListener('click', () => {
    state.readerFullscreen = !state.readerFullscreen;
    applyReaderSettings();
  });

  $('#reader-follow-toggle')?.addEventListener('click', (e) => {
    if (!readerSync?.syncable) {
      showToast('Play this chapter’s audio to enable follow mode.', 'info');
      return;
    }
    state.followMode = readerSync.setFollowMode(!readerSync.followMode);
    e.currentTarget.classList.toggle('active', state.followMode);
    e.currentTarget.setAttribute('aria-pressed', String(state.followMode));
    showToast(
      state.followMode
        ? 'Follow mode on — the spoken line stays centred.'
        : 'Follow mode off — scroll freely, highlighting continues.',
      'info'
    );
  });

  $('#btn-reader-toggle-chapters')?.addEventListener('click', () => {
    const open = !$('#reader-panes')?.classList.contains('has-chapter-sidebar');
    setChapterSidebar(open);
  });

  $('#btn-reader-close-sidebar')?.addEventListener('click', () => {
    setChapterSidebar(false);
  });

  $('#reader-sidebar-scrim')?.addEventListener('click', () => {
    setChapterSidebar(false);
  });

  // Settings/font toolbar toggle (mobile only — ⚙ button shows/hides it)
  const settingsToggle = $('#btn-reader-settings-toggle');
  const readerToolbar = $('#reader-toolbar');
  if (settingsToggle && readerToolbar) {
    // On desktop, always show the toolbar
    const mq = window.matchMedia('(max-width: 640px)');
    const applyToolbarVisibility = () => {
      if (!mq.matches) {
        // Desktop: toolbar always visible, remove collapse class
        readerToolbar.classList.remove('hidden-mobile');
        settingsToggle.style.display = 'none';
      } else {
        // Mobile: hidden by default; ⚙ button controls it
        settingsToggle.style.display = '';
      }
    };
    mq.addEventListener('change', applyToolbarVisibility);
    applyToolbarVisibility();

    settingsToggle.addEventListener('click', () => {
      const isHidden = readerToolbar.classList.toggle('hidden-mobile');
      settingsToggle.setAttribute('aria-expanded', String(!isHidden));
    });
  }

  $('#reader-sidebar-search')?.addEventListener('input', () => {
    renderReaderSidebarChapters();
  });

  $('#reader-sidebar-chapters-list')?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-chapter-idx]');
    if (!row) return;
    const idx = parseInt(row.dataset.chapterIdx, 10);
    if (!Number.isNaN(idx)) {
      if (window.innerWidth <= 1024) {
        setChapterSidebar(false);
      }
      previewChapter(idx);
    }
  });
}

export function renderReaderSidebarChapters() {
  const list = $('#reader-sidebar-chapters-list');
  if (!list) return;

  const query = ($('#reader-sidebar-search')?.value || '').trim().toLowerCase();
  const currentIdx = state.readerChapterIdx;
  const chapters = (state.chapters || []).filter(c => {
    if (!query) return true;
    const title = (c.title || `Chapter ${c.chapterIndex + 1}`).toLowerCase();
    const num = String(c.chapterIndex + 1);
    return title.includes(query) || num.includes(query);
  });

  if (!chapters.length) {
    list.innerHTML = `<div style="padding: 16px 8px; font-size: 11px; text-align: center; color: var(--text-3);">No matching chapters</div>`;
    return;
  }

  list.innerHTML = chapters.map(c => {
    const hasAudio = state.audioFiles && state.audioFiles.some(a => a.chapterId === c.id && !a.isMerged);
    const active = c.chapterIndex === currentIdx;
    return `
      <button type="button" class="reader-sidebar-row${active ? ' active' : ''}" data-chapter-idx="${c.chapterIndex}">
        <span class="reader-sidebar-num">${c.chapterIndex + 1}</span>
        <span class="reader-sidebar-title">${escapeHtml(c.title || `Chapter ${c.chapterIndex + 1}`)}</span>
        ${hasAudio ? `<span class="reader-sidebar-meta">🔊</span>` : ''}
      </button>`;
  }).join('');

  const activeBtn = list.querySelector('.reader-sidebar-row.active');
  if (activeBtn) {
    activeBtn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

export function setChapterSidebar(open) {
  const panes = $('#reader-panes');
  if (!panes) return;
  panes.classList.toggle('has-chapter-sidebar', open);
  const scrim = $('#reader-sidebar-scrim');
  if (scrim) {
    scrim.classList.toggle('show', open);
  }
  $('#btn-reader-toggle-chapters')?.setAttribute('aria-expanded', String(open));
  if (open) {
    renderReaderSidebarChapters();
  }
}
