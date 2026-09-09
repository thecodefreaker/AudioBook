import { api } from '../services/api.js';
import { state } from '../store.js';
import { $, $$, setText, show, hide, addClass, removeClass, setHTML } from '../utils/dom.js';
import { formatTime, formatNumber, timeAgo } from '../utils/formatters.js';
import { escapeHtml } from '../utils/html.js';
import { showToast, removeToast } from '../components/toast.js';
import { renderChapters } from '../components/chapterList.js';
import { addLogEntry } from '../components/logConsole.js';
import { socketService } from '../services/socket.js';
import { getSetting, getConversionSettings, getBatchMode, setBatchMode, setBookPreset } from '../services/settings.js';
import { CATALOG, languageDef, languageName, voiceName, styleName } from '../components/catalog.js';
import { syncNarrationControls, settingsKey } from '../ui/configPanel.js';
import { renderQueuePanel, renderQuota } from '../ui/queuePanel.js';

import { effectiveSettingsFor, loadAudioFilesForBook, renderBookOverview, refreshAudiobookPanel, resetGenerateButton, queueSyncInFlight, setQueueSyncInFlight } from '../main.js';

// Extracted code below
export async function startSingleChapterGeneration(chapterIdx, overrideOptions = {}) {
  // Resolved through the three-level model (chapter override > book preset >
  // global), so a chapter converted from the row button uses exactly what the
  // summary above the chapter list advertises.
  const saved = effectiveSettingsFor(chapterIdx);
  const language = overrideOptions.language || saved.language;
  const voiceId = overrideOptions.voiceId || saved.voiceId;
  const groqApiKey = $('#groq-api-key')?.value || '';
  const groqModel = overrideOptions.groqModel !== undefined
    ? overrideOptions.groqModel
    : ($('#groq-model-select')?.value || '');

  if (!language || !voiceId) {
    showToast('Pick a language and voice before converting.', 'warning');
    return;
  }

  delete state.chapterErrors[chapterIdx];
  state.activeGenerations[chapterIdx] = { percent: 0, message: 'Starting…' };
  renderChapters();

  // Explicit, never inferred: the backend must be told exactly which text to speak.
  const scriptSource = overrideOptions.scriptSource || saved.scriptSource || 'ai';
  const translationStyle = scriptSource === 'ai'
    ? (overrideOptions.translationStyle || saved.translationStyle)
    : undefined;

  // "Generate audio from THIS script" pins the exact script row. Without the
  // pin the server would re-resolve "the AI script for this chapter", which
  // silently becomes a *newer* translation the moment one is made — so the
  // audio would not be of the text the user reviewed. `action: 'audio'` and a
  // scriptId always travel together, and the server rejects one without the
  // other rather than guessing.
  const action = overrideOptions.action || 'both';
  const scriptId = overrideOptions.scriptId || null;

  if (action === 'audio' && !scriptId) {
    delete state.activeGenerations[chapterIdx];
    renderChapters();
    showToast('No script chosen — open the chapter and pick the script to speak.', 'error');
    return;
  }

  try {
    const result = await api.generateAudio(state.currentBookId, {
      selectedChapters: [chapterIdx],
      language,
      voiceId,
      groqApiKey,
      groqModel,
      translationStyle,
      scriptSource,
      customPrompt: overrideOptions.customPrompt || undefined,
      action,
      ...(scriptId ? { scriptId } : {}),
    });

    if (!result?.jobId) {
      throw new Error(result?.message || 'The server did not start a job.');
    }

    show('#section-progress');
    setupProgressTracking(result.jobId, [chapterIdx]);
    showToast(`Started converting Chapter ${chapterIdx + 1}`, 'info');
  } catch (err) {
    // The row must not be left showing "Converting" for a job that never
    // started, so the optimistic state is rolled back.
    delete state.activeGenerations[chapterIdx];
    // No stage: the job was refused before the pipeline ran, so naming one
    // would be a guess.
    state.chapterErrors[chapterIdx] = { message: err.message, stage: null, jobId: null, retryable: true };
    renderChapters();
    showToast('Failed: ' + err.message, 'error');
  }
}

export async function startAudioFromExistingScript(chapterIdx, options = {}) {
  const source = options.scriptSource || 'ai';
  try {
    const { scripts = [] } = await api.getChapterScripts(state.currentBookId, chapterIdx);
    // Newest first, so "generate audio" means the script the reader is showing.
    const match = scripts
      .filter((s) => s.source === source)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

    if (!match) {
      showToast(
        source === 'custom'
          ? 'No saved script for this chapter yet — paste one first.'
          : 'No AI script for this chapter yet — translate the text first.',
        'warning'
      );
      return;
    }

    await startSingleChapterGeneration(chapterIdx, {
      ...options,
      action: 'audio',
      scriptId: match.id,
    });
  } catch (err) {
    showToast('Could not find a script to speak: ' + err.message, 'error');
  }
}

export async function startTranslateOnly(chapterIdx, overrideOptions = {}) {
  const saved = effectiveSettingsFor(chapterIdx);
  const override = overrideOptions;
  const language = override.language || saved.language;

  if (!language) {
    showToast('Pick a language before translating.', 'warning');
    return;
  }
  // Translating "into English" from an English book is a no-op that would
  // spend tokens producing the text you already have.
  if (language === 'en') {
    showToast('The book is already in English — there is nothing to translate.', 'info');
    return;
  }

  const translationStyle = override.translationStyle || saved.translationStyle;
  const groqApiKey = $('#groq-api-key')?.value || '';
  const groqModel = override.groqModel !== undefined
    ? override.groqModel
    : ($('#groq-model-select')?.value || '');

  try {
    setText('#listen-status', 'Translating…');
    const result = await api.translateOnly(state.currentBookId, {
      selectedChapters: [chapterIdx],
      language,
      translationStyle,
      scriptSource: override.scriptSource || 'ai',
      customPrompt: override.customPrompt || null,
      // Voice is irrelevant to a text-only run, but the route validates it
      // against the language, so send the one that matches.
      voiceId: override.voiceId || saved.voiceId,
      groqApiKey,
      groqModel,
    });

    state.activeGenerations[chapterIdx] = { percent: 0, message: 'Translating…' };
    renderChapters();
    show('#section-progress');
    setupProgressTracking(result.jobId, [chapterIdx]);
    showToast(`Translating Chapter ${chapterIdx + 1} — text only, no audio.`, 'info');
  } catch (err) {
    delete state.activeGenerations[chapterIdx];
    showToast('Could not translate: ' + err.message, 'error');
  }
}

export async function startGeneration() {
  if (state.selectedChapters.size === 0) {
    showToast('Please select at least one chapter', 'warning');
    return;
  }

  // Batch cap.
  //
  // Selecting all 1000 chapters and converting them in one job is the fastest
  // route to a painful failure: if it dies at chapter 800 there is nothing
  // useful to resume from, and the API cost has already been spent. Converting
  // in capped batches keeps every failure cheap and recoverable.
  const ordered = Array.from(state.selectedChapters).sort((a, b) => a - b);
  const cap = Math.max(1, getSetting('batchSize') || 20);
  // The cap is applied here but EXPLAINED in the batch dialog, so a large mixed
  // selection produces one interruption instead of a confirm() followed by a
  // dialog asking a different question.
  const capped = ordered.length > cap;
  const chapters = capped ? ordered.slice(0, cap) : ordered;

  // Narration settings come from the shared store, not from whatever the
  // sidebar <select> currently holds. Reading the DOM meant that if the
  // sidebar had not been opened yet the selects were still empty, so the
  // request went out with language:"" and voiceId:"" and the server rejected
  // it — which is why "Convert selected" appeared to do nothing.
  const { language, voiceId } = getConversionSettings(CATALOG, state.currentBookId);

  if (!language || !voiceId) {
    showToast('Pick a language and voice before converting.', 'warning');
    return;
  }

  // A batch used to be ONE job with ONE set of settings, so a per-chapter
  // exception could not be honoured — the user was warned and their choice was
  // discarded, leaving "convert them one at a time" as the only way to keep it.
  //
  // Each POST /convert is independent, so the selection is grouped by its
  // *effective* settings and one job is sent per group. When the groups
  // disagree the user is asked which behaviour they want rather than having
  // one silently chosen for them.
  const plan = await resolveBatchPlan(chapters, {
    defaultAction: 'both',
    cappedFrom: capped ? ordered.length : 0,
  });
  if (!plan) return; // backed out of the conflict dialog

  const groupList = plan.groups;

  // A uniform batch that was asked to translate only must not also spend TTS
  // time, so the action chosen in the dialog is honoured here.
  if (plan.action === 'script') {
    await runTranslateGroups(groupList);
    return;
  }

  const groqApiKey = $('#groq-api-key')?.value || '';
  const groqModel = $('#groq-model-select')?.value || '';
  const btn = $('#sel-generate');

  // A pinned script belongs to exactly one chapter, so a group that carries a
  // scriptId across several chapters is incoherent. Refusing is the only safe
  // answer: dropping the pin would speak a script the user never chose, and
  // splitting it would invent pins that do not exist.
  const badPin = groupList.find((g) => g.settings.scriptId && g.chapters.length > 1);
  if (badPin) {
    showToast(
      'A specific script belongs to one chapter, so it cannot be used for a batch. ' +
      'Open that chapter to generate audio from it.',
      'error'
    );
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Starting...';
  }

  try {
    // Sent in parallel: they are independent jobs, and the server queue
    // serialises the actual work anyway.
    const results = await Promise.all(groupList.map((g) =>
      api.generateAudio(state.currentBookId, {
        selectedChapters: g.chapters,
        language: g.settings.language,
        voiceId: g.settings.voiceId,
        translationStyle: g.settings.translationStyle,
        scriptSource: g.settings.scriptSource,
        customPrompt: g.settings.customPrompt,
        // Forwarded explicitly rather than spread, so a stray field on the
        // settings object can never become part of the request body.
        action: g.settings.action || 'both',
        ...(g.settings.scriptId ? { scriptId: g.settings.scriptId } : {}),
        groqApiKey,
        groqModel,
      }).then(
        (result) => ({ ok: !!result?.jobId, result, group: g }),
        (err) => ({ ok: false, error: err, group: g })
      )
    ));

    const started = results.filter((r) => r.ok);
    // A job id is the only proof the backend actually queued work. Claiming
    // success without it is what produced a toast for a conversion that never
    // started.
    if (!started.length) {
      const first = results[0];
      throw new Error(first?.error?.message || first?.result?.message || 'The server did not start a job.');
    }

    show('#section-progress');
    show('#btn-cancel-all');

    const queued = started.flatMap((r) => r.group.chapters);
    started.forEach((r, i) => setupProgressTracking(r.result.jobId, r.group.chapters, { append: i > 0 }));

    // Mark every chapter in the batch as queued.
    //
    // Only the chapter the server happened to be working on had any state, so
    // the rest kept their idle "Convert" button and the batch looked like it
    // had converted a single chapter. The queue is real work that has been
    // accepted, so the rows must say so from the moment it is queued.
    queued.forEach((idx, position) => {
      delete state.chapterErrors[idx];
      state.activeGenerations[idx] = {
        percent: 0,
        message: position === 0 ? 'Starting…' : `Queued · ${position} ahead`,
      };
    });
    renderChapters();

    // Partial failure is reported honestly rather than as a clean success.
    const failedGroups = results.filter((r) => !r.ok);
    if (failedGroups.length) {
      showToast(
        `Started ${queued.length} chapter${queued.length === 1 ? '' : 's'}, but ${failedGroups.length} ` +
        `group${failedGroups.length === 1 ? '' : 's'} failed to start: ${failedGroups[0].error?.message || 'unknown error'}`,
        'warning'
      );
    } else {
      showToast(
        `Converting ${queued.length} chapter${queued.length === 1 ? '' : 's'}` +
        `${groupList.length > 1 ? ` in ${groupList.length} jobs` : ''}…`,
        'success'
      );
    }
  } catch (err) {
    // The optimistic queued state must not outlive a job that never started.
    chapters.forEach((idx) => delete state.activeGenerations[idx]);
    renderChapters();
    showToast('Generation failed: ' + err.message, 'error');
    resetGenerateButton();
  }
}

export async function startBatchTranslateOnly() {
  const selected = Array.from(state.selectedChapters).sort((a, b) => a - b);
  if (!selected.length) {
    showToast('Select some chapters first.', 'warning');
    return;
  }

  const cap = Math.max(1, getSetting('batchSize') || 20);
  const capped = selected.length > cap;
  const chapters = selected.slice(0, cap);

  const plan = await resolveBatchPlan(chapters, {
    defaultAction: 'script',
    cappedFrom: capped ? selected.length : 0,
  });
  if (!plan) return;

  // Translating "into English" from an English book spends tokens reproducing
  // text the book already contains, so those chapters are dropped rather than
  // sent.
  const groupList = plan.groups
    .map((g) => ({ ...g }))
    .filter((g) => g.settings.language && g.settings.language !== 'en');

  if (!groupList.length) {
    showToast('Nothing to translate — pick a language other than English first.', 'info');
    return;
  }

  await runTranslateGroups(groupList);
}

export async function runTranslateGroups(groupList) {
  const chapters = groupList.flatMap((g) => g.chapters);
  const btn = $('#sel-translate');
  if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }

  const groqApiKey = $('#groq-api-key')?.value || '';
  const groqModel = $('#groq-model-select')?.value || '';

  try {
    const results = await Promise.all(groupList.map((g) =>
      api.translateOnly(state.currentBookId, {
        selectedChapters: g.chapters,
        language: g.settings.language,
        translationStyle: g.settings.translationStyle,
        customPrompt: g.settings.customPrompt,
        voiceId: g.settings.voiceId,
        // A text-only run always produces the AI script; "my script" and
        // "original text" are sources that already exist and need no job.
        scriptSource: 'ai',
        groqApiKey,
        groqModel,
      }).then(
        (result) => ({ ok: !!result?.jobId, result, group: g }),
        (err) => ({ ok: false, error: err, group: g })
      )
    ));

    const started = results.filter((r) => r.ok);
    if (!started.length) {
      const first = results[0];
      throw new Error(first?.error?.message || 'The server did not start a job.');
    }

    show('#section-progress');
    show('#btn-cancel-all');
    started.forEach((r, i) => setupProgressTracking(r.result.jobId, r.group.chapters, { append: i > 0 }));

    const queued = started.flatMap((r) => r.group.chapters);
    queued.forEach((idx, position) => {
      delete state.chapterErrors[idx];
      state.activeGenerations[idx] = {
        percent: 0,
        message: position === 0 ? 'Translating…' : `Queued · ${position} ahead`,
      };
    });
    renderChapters();

    showToast(
      `Translating ${queued.length} chapter${queued.length === 1 ? '' : 's'} — text only, no audio.`,
      'success'
    );
  } catch (err) {
    chapters.forEach((idx) => delete state.activeGenerations[idx]);
    renderChapters();
    showToast('Could not translate: ' + err.message, 'error');
    resetGenerateButton();
  }
}

export function resolveBatchPlan(chapters, { defaultAction = 'both', cappedFrom = 0 } = {}) {
  const groupBy = (settingsFor) => {
    const groups = new Map();
    for (const idx of chapters) {
      const settings = settingsFor(idx);
      const key = settingsKey(settings);
      if (!groups.has(key)) groups.set(key, { settings, chapters: [] });
      groups.get(key).chapters.push(idx);
    }
    return [...groups.values()];
  };

  const perChapterGroups = groupBy(effectiveSettingsFor);

  // One group means every chapter already agrees; there is no conflict to
  // resolve and no decision worth interrupting for — unless the selection was
  // capped, which the user must still be told about before work starts.
  if (perChapterGroups.length <= 1 && !cappedFrom) {
    return Promise.resolve({ mode: 'perChapter', groups: perChapterGroups, action: defaultAction });
  }

  const remembered = getBatchMode(state.currentBookId);

  return new Promise((resolve) => {
    const modal = $('#batch-conflict-modal');
    const modeGroup = $('#bc-mode-group');
    const fields = $('#bc-uniform-fields');
    const langSelect = $('#bc-language');
    const voiceSelect = $('#bc-voice');
    const styleSelect = $('#bc-style');
    const sourceSelect = $('#bc-source');
    const actionSelect = $('#bc-action');
    const rememberBox = $('#bc-remember');
    const saveDefaultBox = $('#bc-save-default');

    const base = getConversionSettings(CATALOG, state.currentBookId);
    langSelect.innerHTML = CATALOG.languages
      .map((l) => `<option value="${l.code}">${l.label || l.name}</option>`).join('');
    langSelect.value = base.language;
    sourceSelect.value = base.scriptSource || 'ai';
    actionSelect.value = defaultAction;
    if (rememberBox) rememberBox.checked = !!remembered;
    if (saveDefaultBox) saveDefaultBox.checked = false;

    // Pre-select whatever this book already decided, so the remembered answer
    // is shown rather than silently applied behind a closed dialog.
    const wanted = remembered || 'perChapter';
    modeGroup.querySelector(`input[value="${wanted}"]`).checked = true;

    // A cap with no settings conflict is not a choice, it is a notice — so the
    // mode question is hidden and only the cap is explained. Showing "how do
    // you want to continue?" for chapters that all agree would be asking a
    // question with one answer.
    const hasConflict = perChapterGroups.length > 1;
    modeGroup.hidden = !hasConflict;
    $('#bc-remember').closest('.qc-default-row').hidden = !hasConflict;

    setText('#bc-title', hasConflict
      ? 'These chapters use different settings'
      : 'Converting in batches');

    const capNote = cappedFrom
      ? `You selected ${cappedFrom} chapters — roughly ${((cappedFrom * 90) / 3600).toFixed(1)} hours. ` +
        `To keep failures cheap to recover from, this converts the first ${chapters.length} ` +
        `(chapters ${chapters[0] + 1}–${chapters[chapters.length - 1] + 1}). Run it again for the rest.`
      : '';
    setText('#bc-subtitle', hasConflict
      ? (capNote ? `${capNote} Choose how to continue.` : 'Choose how to continue.')
      : capNote);

    const currentMode = () =>
      modeGroup.querySelector('input[name="bc-mode"]:checked')?.value || 'perChapter';

    const uniformSettings = () => ({
      language: langSelect.value,
      voiceId: voiceSelect.value,
      translationStyle: sourceSelect.value === 'ai' ? styleSelect.value : undefined,
      scriptSource: sourceSelect.value,
    });

    function refreshUniformFields() {
      const lang = languageDef(langSelect.value);
      const voices = lang?.voices || [];
      voiceSelect.innerHTML = voices
        .map((v) => `<option value="${v.id}">${v.name} (${v.gender}, ${v.accent})</option>`).join('');
      if (base.voiceId && voices.some((v) => v.id === base.voiceId)) voiceSelect.value = base.voiceId;
      else if (lang?.defaultVoice) voiceSelect.value = lang.defaultVoice;

      const allowed = CATALOG.styles.filter((s) => (lang?.styles || []).includes(s.id));
      styleSelect.innerHTML = allowed.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
      const wantStyle = base.translationStyle || lang?.defaultStyle;
      if (wantStyle && allowed.some((s) => s.id === wantStyle)) styleSelect.value = wantStyle;

      // Style steers the AI only; offering it for a verbatim script would
      // advertise a setting that cannot change the result.
      const showStyle = !!lang?.requiresAi && sourceSelect.value === 'ai'
        && allowed.length > 0 && actionSelect.value !== 'audio';
      styleSelect.style.display = showStyle ? '' : 'none';
      $('#bc-style-label').style.display = showStyle ? '' : 'none';

      const showVoice = actionSelect.value !== 'script';
      voiceSelect.style.display = showVoice ? '' : 'none';
      $('#bc-voice-label').style.display = showVoice ? '' : 'none';
    }

    function describe(g) {
      const bits = [languageName(g.settings.language), voiceName(g.settings.voiceId)].filter(Boolean);
      if (g.settings.scriptSource !== 'ai') {
        bits.push(g.settings.scriptSource === 'custom' ? 'my script' : 'original text');
      } else if (g.settings.translationStyle) {
        bits.push(styleName(g.settings.translationStyle));
      }
      const nums = g.chapters.slice(0, 8).map((i) => i + 1).join(', ');
      const more = g.chapters.length > 8 ? `, +${g.chapters.length - 8} more` : '';
      return `<div>• Chapters ${nums}${more} — <b>${bits.join(' · ')}</b></div>`;
    }

    function refresh() {
      const mode = currentMode();
      fields.hidden = mode !== 'uniform';
      if (mode === 'uniform') refreshUniformFields();

      const groups = mode === 'uniform'
        ? [{ settings: uniformSettings(), chapters: [...chapters] }]
        : perChapterGroups;

      // The count of jobs is the fact that makes the two options concretely
      // different, so it is stated before the button is pressed, not after.
      setHTML('#bc-groups',
        `<div><b>${groups.length} job${groups.length === 1 ? '' : 's'}</b> for ` +
        `${chapters.length} chapter${chapters.length === 1 ? '' : 's'}:</div>` +
        groups.map(describe).join(''));

      setText('#bc-safety', mode === 'uniform'
        ? 'Chapter settings are kept — they are ignored for this batch only.'
        : 'Every chapter keeps its own settings.');

      $('#btn-bc-start').textContent = `Start ${groups.length} job${groups.length === 1 ? '' : 's'}`;
    }

    const finish = (value) => {
      hide('#batch-conflict-modal');
      modeGroup.onchange = null;
      modal.onclick = null;
      resolve(value);
    };

    modeGroup.onchange = refresh;
    langSelect.onchange = refresh;
    voiceSelect.onchange = refresh;
    styleSelect.onchange = refresh;
    sourceSelect.onchange = refresh;
    actionSelect.onchange = refresh;
    $('#bc-close').onclick = () => finish(null);
    modal.onclick = (e) => { if (e.target === modal) finish(null); };

    $('#btn-bc-start').onclick = () => {
      const mode = currentMode();
      if (rememberBox?.checked) setBatchMode(state.currentBookId, mode);
      else setBatchMode(state.currentBookId, null);

      if (mode === 'uniform') {
        const settings = uniformSettings();
        // Saving as the book default is opt-in and never touches the chapter
        // overrides: they stay on disk and win again on the next single run.
        if (saveDefaultBox?.checked) {
          setBookPreset(state.currentBookId, settings);
          syncNarrationControls();
        }
        finish({
          mode,
          groups: [{ settings, chapters: [...chapters] }],
          action: actionSelect.value,
        });
      } else {
        finish({ mode, groups: perChapterGroups, action: defaultAction });
      }
    };

    refresh();
    show('#batch-conflict-modal');
  });
}

export async function cancelChapterConversion(chapterIdx) {
  const jobId = state.chapterJobs[chapterIdx];
  if (!state.currentBookId || !jobId) {
    // No job recorded (e.g. after a reload) — fall back to the book-wide stop
    // rather than doing nothing, but say so plainly.
    return cancelAllJobs();
  }
  try {
    await api.cancelChapter(state.currentBookId, jobId, chapterIdx);
    showToast(`Chapter ${chapterIdx + 1} is stopping…`, 'info');
    // NOTE: the row's "Stopping…" state is driven by the server's
    // `chapter:stopping` event, not set here. Setting it locally was the old
    // bug — a second tab never saw it, and a dropped event left the button
    // permanently dead with no way to retry.
  } catch (err) {
    showToast('Stop failed: ' + err.message, 'error');
  }
}

export function clearAllGenerationTimers() {
  for (const gen of Object.values(state.activeGenerations || {})) {
    clearTimeout(gen?.stoppingTimer);
  }
}

export function clearGenerationsForJob(jobId) {
  const owned = Object.entries(state.chapterJobs || {})
    .filter(([, id]) => id === jobId)
    .map(([idx]) => idx);

  if (!jobId || owned.length === 0) {
    clearAllGenerationTimers();
    state.activeGenerations = {};
    state.chapterJobs = {};
    return 0;
  }

  for (const idx of owned) {
    clearTimeout(state.activeGenerations?.[idx]?.stoppingTimer);
    delete state.activeGenerations[idx];
    delete state.chapterJobs[idx];
  }
  return owned.length;
}

export async function cancelAllJobs() {
  if (!state.currentBookId) return;
  if (!confirm('Cancel all running conversions? Chapters already completed will be kept.')) return;
  try {
    const result = await api.cancelJobs(state.currentBookId);
    showToast(result.message, 'info');
  } catch (err) {
    showToast('Cancel failed: ' + err.message, 'error');
  }
}

export function setupProgressTracking(jobId, chaptersArray = null, { append = false } = {}) {
  const selectedArr = chaptersArray || Array.from(state.selectedChapters);
  const progressList = $('#chapter-progress-list');

  // The console is deliberately NOT opened here. Progress already appears in
  // the sidebar and on the row, and the bubble turns red by itself if anything
  // fails — so forcing a panel open over the content just to say "started" is
  // noise the user has to dismiss.

  // A selection with mixed settings starts several jobs, and each one calls
  // this. Replacing the list every time would leave only the last group
  // visible, so subsequent groups append instead.
  const markup = selectedArr.map(idx => {
    const ch = state.chapters.find(c => c.chapterIndex === idx);
    return `
      <div class="chapter-progress-item" id="ch-progress-${idx}" style="flex-direction: column; align-items: flex-start; padding: 10px 12px; gap: 6px;">
        <div style="display: flex; align-items: center; width: 100%; gap: 10px;">
          <div class="status-icon pending"><span class="spinner" style="width:16px;height:16px;border-width:2px;display:none"></span>⏳</div>
          <span class="chapter-progress-title">${escapeHtml(ch?.title || `Chapter ${idx + 1}`)}</span>
          <div class="mini-progress"><div class="mini-progress-bar" style="width:0%"></div></div>
          <span class="chapter-progress-status">Waiting...</span>
        </div>
        <div id="ch-live-log-${idx}" style="font-family: monospace; font-size: 11px; color: #a7f3d0; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.05); padding: 4px 8px; border-radius: 4px; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: none;"></div>
      </div>`;
  }).join('');

  if (append) progressList.insertAdjacentHTML('beforeend', markup);
  else progressList.innerHTML = markup;

  // Socket handlers are NOT registered here. They are registered exactly once
  // by initRealtimeHandlers() during startup. Binding them per job is what
  // produced duplicate toasts and repeated log lines: every conversion added
  // another copy of all nine handlers, so the third job fired each one three
  // times. Progress events already carry bookId/chapterIdx, so a single set of
  // handlers serves every job.
  state.activeJobId = jobId;
  // Remember which job owns each chapter, so a row's Stop button can cancel
  // precisely that chapter rather than every job for the book.
  for (const idx of selectedArr) state.chapterJobs[idx] = jobId;
}

export async function checkInterruptedJobs(bookId) {
  try {
    const { jobs = [] } = await api.getJobs(bookId);
    const interrupted = jobs.filter((j) => j.status === 'interrupted');
    if (!interrupted.length) return;

    // A server restart might interrupt multiple distinct jobs. We process them separately.
    let totalOutstanding = 0;
    const toResume = [];

    for (const job of interrupted) {
      const done = new Set(job.completedChapters || []);
      const outstanding = (job.selectedChapters || []).filter((idx) => !done.has(idx));
      if (outstanding.length) {
        totalOutstanding += outstanding.length;
        toResume.push({ job, outstanding });
      }
    }

    if (!toResume.length) return;

    const toast = showToast(
      `Server restart interrupted ${totalOutstanding} chapter(s). Resume where they left off?`,
      'warning',
      {
        persist: true,
        actionLabel: 'Resume All',
        onClick: async () => {
          for (const item of toResume) {
            await resumeInterruptedJob(item.job, item.outstanding);
          }
        }
      }
    );
    
    addLogEntry({
      level: 'warn',
      message: `${toResume.length} job(s) interrupted by restart — ${totalOutstanding} chapter(s) outstanding.`,
    });
    return toast;
  } catch {
    // Recovery is a convenience; failing to check for it must never stop a book from opening.
  }
}

export async function resumeInterruptedJob(job, chapters) {
  try {
    const result = await api.retryJob(state.currentBookId, job.id, chapters);
    if (!result?.jobId) throw new Error(result?.message || 'The server did not start a job.');
    show('#section-progress');
    setupProgressTracking(result.jobId, chapters);
    chapters.forEach((idx, position) => {
      delete state.chapterErrors[idx];
      state.activeGenerations[idx] = {
        percent: 0,
        message: position === 0 ? 'Resuming…' : `Queued · ${position} ahead`,
      };
    });
    renderChapters();
    showToast(`Resuming ${chapters.length} chapter${chapters.length === 1 ? '' : 's'}.`, 'success');
  } catch (err) {
    showToast('Could not resume: ' + err.message, 'error');
  }
}

export async function syncQueueSnapshot() {
  if (queueSyncInFlight) return;
  setQueueSyncInFlight(true);
  try {
    const snapshot = await api.getQueue();
    state.queueSnapshot = snapshot || state.queueSnapshot;
    renderQueuePanel();
  } catch (err) {
    console.error('Queue sync failed', err);
  } finally {
    setQueueSyncInFlight(false);
  }
}

export async function syncQuotaSnapshot() {
  if (socketService.isConnected?.()) return; // socket pushes are authoritative
  try {
    const { quota } = await api.getQuota();
    renderQuota(quota);
  } catch {
    // Quota display is supplemental; never let it break the page.
  }
}

