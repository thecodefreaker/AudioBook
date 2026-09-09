
import { api } from '../services/api.js';
import { state } from '../store.js';
import { $, $$, show, hide, toggle, setText, setHTML, addClass, removeClass } from '../utils/dom.js';
import { formatTime, formatNumber, timeAgo, formatDateTime, formatSize } from '../utils/formatters.js';
import { escapeHtml } from '../utils/html.js';
import { showToast, removeToast } from '../components/toast.js';
import { CATALOG, languageDef, languageName, styleName, voiceName, sourceBadge, versionLabel, audioBadges, stageLabel, SCRIPT_SOURCE_META, loadCatalog } from '../components/catalog.js';
import { socketService } from '../services/socket.js';
import { getSetting, getConversionSettings, setSetting, setConversionSettings, getLastRead } from '../services/settings.js';
import { addLogEntry } from '../components/logConsole.js';
import { renderChapters, updateChapterRowProgress } from '../components/chapterList.js';

import * as Main from '../main.js';
import { initConfigPanel, loadModels, syncNarrationControls, effectiveSettingsFor, settingsKey } from '../ui/configPanel.js';
import { openVersionsModal, deleteAudioVersion, openScriptEditor, runScriptCheck, openQuickConvertModal, resetChapterOverride, clearChapterOverrides, initChapterControls } from '../chapters/chapterActions.js';
import { initRealtimeHandlers, updateChapterProgress, markChapterComplete, markChapterError, updateOverallProgress, onJobComplete, refreshReaderChapter } from '../generation/realtime.js';
import { renderQuota, initQueuePanel, renderQueuePanel } from '../ui/queuePanel.js';

import { startSingleChapterGeneration, startAudioFromExistingScript, startTranslateOnly, startGeneration, startBatchTranslateOnly, cancelChapterConversion, clearGenerationsForJob, cancelAllJobs, setupProgressTracking, checkInterruptedJobs, resumeInterruptedJob, syncQueueSnapshot, syncQuotaSnapshot } from '../generation/generationJobs.js';
import { initReaderUi, previewChapter } from '../reader/readerUi.js';
import { initPlayer, stopPlayback, playAudioAtIndex, togglePlay } from '../audio/player.js';
import { initUpload, setUploadStep, handleUpload, onBookParsing, onBookParsed, onBookError, resetUpload, UPLOAD_STEPS, isUploading } from '../workspace/upload.js';
import { loadLibrary, renderLibrary } from '../workspace/library.js';
import { initConnectionIndicator, decideLandingView, initHomeView, initShell, initNavigation, switchView, applyWorkspaceMode } from '../workspace/layout.js';

// --- EXPORTED ---
export function renderBookOverview() {
  const panel = $('#book-overview');
  if (!panel) return;

  const chapters = state.chapters || [];
  if (!state.currentBookId || !chapters.length) { addClass(panel, 'hidden'); return; }
  removeClass(panel, 'hidden');

  const meta = state.currentBookMeta || {};
  setText('#book-overview-title', meta.title || 'Untitled book');
  setText('#book-overview-author', meta.author || 'Unknown author');
  setText('#workspace-book-title', meta.title || 'Untitled book');
  setText('#workspace-book-author', `${meta.author || 'Unknown author'} · ${chapters.length.toLocaleString()} chapters`);

  const cover = $('#book-overview-cover');
  if (cover) {
    const initial = (meta.title || '?').trim().charAt(0).toUpperCase();
    cover.innerHTML = meta.coverImage
      ? `<img src="${escapeHtml(meta.coverImage)}" alt="" />`
      : `<span class="library-cover-fallback" aria-hidden="true">${escapeHtml(initial)}</span>`;
  }

  const workspaceBar = $('.workspace-bar');
  if (workspaceBar) {
    if (meta.coverImage) {
      workspaceBar.style.setProperty('--header-cover', `url("${escapeHtml(meta.coverImage)}")`);
    } else {
      workspaceBar.style.removeProperty('--header-cover');
    }
  }

  const words = chapters.reduce((n, c) => n + (c.wordCount || 0), 0);
  const withAudio = chapters.filter(
    (c) => (state.audioFiles || []).some((a) => a.chapterId === c.id && !a.isMerged)
  ).length;
  const pct = chapters.length ? Math.round((withAudio / chapters.length) * 100) : 0;

  setText('#stat-chapters', formatNumber(chapters.length));
  setText('#stat-words', formatNumber(words));
  // 150 words per minute matches server/utils/textChunker.js.
  setText('#stat-length', words ? formatTime((words / 150) * 60) : '—');
  setText('#stat-progress', `${pct}%`);

  // The ring is drawn with stroke-dashoffset so one number drives both the
  // arc and the label, and they cannot disagree.
  const ring = $('#book-ring-fill');
  if (ring) {
    const CIRC = 2 * Math.PI * 19;
    ring.style.strokeDasharray = String(CIRC);
    ring.style.strokeDashoffset = String(CIRC * (1 - pct / 100));
    ring.classList.toggle('ok', pct === 100);
  }
  $('#book-ring')?.setAttribute('aria-label', `${pct}% of chapters have narrated audio`);

  const bar = $('#book-overview-bar');
  if (bar) {
    bar.style.width = pct + '%';
    bar.classList.toggle('ok', pct === 100);
  }

  // "Where was I" is the first question on returning to a book, so the last
  // chapter opened is surfaced rather than left for the user to remember.
  const resume = $('#book-resume');
  if (resume) {
    const last = getLastRead(state.currentBookId);
    const ch = last != null ? chapters.find((c) => c.chapterIndex === last) : null;
    resume.hidden = !ch;
    if (ch) resume.textContent = `Last read: ${ch.title || `Chapter ${ch.chapterIndex + 1}`}`;
  }
}

export function renderListenPane() {
  const pane = $('#listen-pane');
  if (!pane || state.readerChapterIdx == null) return;

  const ch = state.chapters.find((c) => c.chapterIndex === state.readerChapterIdx);
  // Every version, newest first — the pane manages this chapter's audio, so it
  // must be able to name all of it, not just the most recent.
  const versions = ch
    ? (state.audioFiles || []).filter((a) => a.chapterId === ch.id && !a.isMerged)
    : [];

  // Which version is selected survives re-renders (progress ticks re-render
  // constantly), so choosing V2 and pressing play cannot silently act on V3.
  let selectedId = state.listenVersionId;
  if (!versions.some((v) => v.id === selectedId)) {
    // Prefer whatever is actually loaded in the player; otherwise the newest.
    const playing = state.audioFiles?.[state.currentAudioIndex];
    selectedId = versions.some((v) => v.id === playing?.id) ? playing.id : versions[0]?.id || null;
    state.listenVersionId = selectedId;
  }
  const audio = versions.find((v) => v.id === selectedId) || null;
  const audioIdx = audio ? state.audioFiles.indexOf(audio) : -1;

  const meta = $('#listen-meta');
  const playBtn = $('#listen-play');
  const actions = $('#listen-actions');
  const versionsBox = $('#listen-versions');
  const versionActions = $('#listen-version-actions');

  // The narration settings that the actions below will use. They were only
  // visible inside a dialog before, so pressing a convert button meant
  // trusting an invisible default.
  const saved = effectiveSettingsFor(state.readerChapterIdx);
  const summaryParts = [languageName(saved.language), voiceName(saved.voiceId)].filter(Boolean);
  if (saved.language && saved.language !== 'en' && saved.translationStyle) {
    summaryParts.push(styleName(saved.translationStyle));
  }
  const hasOverride = !!state.chapterOverrides[state.readerChapterIdx];
  setText('#listen-settings', summaryParts.length
    ? `${summaryParts.join(' · ')}${hasOverride ? ' · this chapter only' : ''}`
    : 'No voice chosen yet');

  if (actions) {
    actions.hidden = false;
    actions.dataset.ch = String(state.readerChapterIdx);
  }

  if (!audio) {
    setText('#listen-status', 'No audio for this chapter yet.');
    if (meta) meta.hidden = true;
    if (playBtn) playBtn.hidden = true;
    if (versionsBox) versionsBox.hidden = true;
    if (versionActions) versionActions.hidden = true;

    // An empty pane should say what the buttons below it will do, rather than
    // leaving the user to infer it from three similar labels.
    const data = state.currentChapterData;
    const hasAi = !!data?.aiContent?.trim();
    const hasCustom = !!data?.customContent?.trim();
    const note = $('#listen-empty-note');
    if (note) {
      note.hidden = false;
      note.textContent = hasCustom
         ? 'You have a saved script for this chapter — "Create audiobook" will narrate it.'
        : hasAi
          ? 'An AI script is ready. Open the AI script tab to generate audio from it.'
           : 'Nothing has been retold yet. Start with "Preview AI retelling" to review it first.';
    }

    const genBtn = $('#listen-generate');
    if (genBtn) genBtn.textContent = hasAi || hasCustom ? 'Create audiobook' : 'Retell + narrate';
    return;
  }

  $('#listen-empty-note')?.setAttribute('hidden', '');

  // --- Version picker ------------------------------------------------------
  if (versionsBox) {
    versionsBox.hidden = versions.length < 2;
    if (versions.length > 1) {
      const select = $('#listen-version-select');
      select.innerHTML = versions.map((a, i) => {
        const when = formatDateTime(a.createdAt);
        const dur = a.durationSeconds ? ` · ${formatTime(a.durationSeconds)}` : '';
        return `<option value="${a.id}">V${versions.length - i}${when ? ` · ${when}` : ''} · ${escapeHtml(versionLabel(a))}${dur}</option>`;
      }).join('');
      select.value = audio.id;
    }
  }

  const isCurrent = state.currentAudioIndex === audioIdx;
  setText('#listen-status', isCurrent
    ? (state.isPlaying ? 'Playing this chapter' : 'Loaded — paused')
    : 'Ready to play');

  if (meta) meta.hidden = false;
  // Which script produced this audio is the fact that distinguishes two
  // otherwise identical-looking versions, so it is stated first.
  const srcMeta = SCRIPT_SOURCE_META[audio.scriptSource];
  setText('#listen-source', srcMeta ? `${srcMeta.icon} ${srcMeta.label}` : '—');
  $('#listen-source')?.setAttribute('title', srcMeta?.title || '');
  setText('#listen-voice', voiceName(audio.voiceId) || '—');
  setText('#listen-duration', audio.durationSeconds ? formatTime(audio.durationSeconds) : '—');
  setText('#listen-version', versionLabel(audio));

  if (playBtn) {
    playBtn.hidden = false;
    playBtn.dataset.audioIndex = String(audioIdx);
    playBtn.innerHTML = isCurrent && state.isPlaying
      ? `<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause`
      : `<svg viewBox="0 0 24 24" fill="currentColor" width="13" height="13"><polygon points="5 3 19 12 5 21 5 3"/></svg> Play this chapter`;
  }
  
  const quickPlayBtn = $('#btn-reader-quick-play');
  if (quickPlayBtn) {
    quickPlayBtn.style.display = 'flex';
    quickPlayBtn.dataset.audioIndex = String(audioIdx);
    quickPlayBtn.innerHTML = isCurrent && state.isPlaying
      ? `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg><span class="mobile-hide-text">Pause</span>`
      : `<svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><polygon points="5 3 19 12 5 21 5 3"/></svg><span class="mobile-hide-text">Play</span>`;
  }

  if (versionActions) versionActions.hidden = false;

  // Already has audio, so the audio action is a re-run rather than a first run.
  const genBtn = $('#listen-generate');
  if (genBtn) genBtn.textContent = 'Regenerate audio';
}

export function initListenPane() {
  $('#listen-play')?.addEventListener('click', (e) => {
    const idx = parseInt(e.currentTarget.dataset.audioIndex, 10);
    if (Number.isNaN(idx)) return;
    if (state.currentAudioIndex === idx) togglePlay();
    else playAudioAtIndex(idx);
    renderListenPane();
  });
  
  $('#btn-reader-quick-play')?.addEventListener('click', (e) => {
    const idx = parseInt(e.currentTarget.dataset.audioIndex, 10);
    if (Number.isNaN(idx)) return;
    if (state.currentAudioIndex === idx) togglePlay();
    else playAudioAtIndex(idx);
    renderListenPane();
  });

  const paneChapter = () => parseInt($('#listen-actions')?.dataset.ch ?? '', 10);

  /** The audio version the pane is currently acting on. */
  const selectedVersion = () =>
    (state.audioFiles || []).find((a) => a.id === state.listenVersionId) || null;

  // Choosing a version loads THAT audio, not the newest. The reader also
  // follows it to the matching script tab, because reading the AI retelling
  // while a custom-script version plays has no honest sentence mapping.
  $('#listen-version-select')?.addEventListener('change', (e) => {
    state.listenVersionId = e.target.value;
    const audio = selectedVersion();
    if (!audio) return;

    const idx = state.audioFiles.indexOf(audio);
    // Only reload the player if this version is not already the loaded one —
    // re-loading would restart playback the user did not ask to restart.
    if (state.currentAudioIndex !== idx) playAudioAtIndex(idx);

    // Never rewrites a script; only changes which one is being read.
    const tab = audio.scriptSource === 'custom' ? 'edit'
      : audio.scriptSource === 'original' ? 'original'
      : 'ai';
    previewChapter(audio.chapterIndex, tab, audio.scriptId);
  });

  // Downloads the SELECTED version, never the merged audiobook and never
  // "whichever is newest".
  $('#listen-download')?.addEventListener('click', () => {
    const audio = selectedVersion();
    if (!audio) return;
    const a = document.createElement('a');
    a.href = audio.downloadUrl;
    a.download = '';
    document.body.appendChild(a);
    a.click();
    a.remove();
  });

  // Regenerate = "make this again". It opens the dialog pinned to the exact
  // script this version was made from, so a newer AI translation cannot
  // silently replace the text that was reviewed.
  $('#listen-regenerate')?.addEventListener('click', () => {
    const idx = paneChapter();
    const audio = selectedVersion();
    if (Number.isNaN(idx) || !audio) return;
    openQuickConvertModal(idx, {
      action: 'audio',
      fromAudio: audio,
    });
  });

  // Three separate, named actions where there was one button called "Convert".
  $('#listen-translate')?.addEventListener('click', () => {
    const idx = paneChapter();
    if (!Number.isNaN(idx)) startTranslateOnly(idx);
  });

  $('#listen-generate')?.addEventListener('click', () => {
    const idx = paneChapter();
    if (!Number.isNaN(idx)) startSingleChapterGeneration(idx, state.chapterOverrides[idx] || {});
  });

  $('#listen-settings-edit')?.addEventListener('click', () => {
    const idx = paneChapter();
    if (!Number.isNaN(idx)) openQuickConvertModal(idx);
  });

  // On a narrow window the panes stack, and the listening pane collapses so
  // the text still gets the full height.
  $('#btn-listen-collapse')?.addEventListener('click', (e) => {
    // On mobile/tablet screens, the listen pane is a full slide-over modal.
    // Clicking the collapse button should close the modal completely.
    if (window.innerWidth <= 1024) {
      $('#listen-pane')?.classList.remove('open');
      $('#listen-pane-scrim')?.classList.remove('show');
      return;
    }

    const pane = $('#listen-pane');
    const collapsed = pane.classList.toggle('collapsed');
    e.currentTarget.setAttribute('aria-expanded', String(!collapsed));
    e.currentTarget.textContent = collapsed ? '⟨' : '⟩';
  });
}

export function setHeaderBook(title, chapterCount) {
  const wrap = $('#header-book');
  if (!wrap) return;
  if (!title) { addClass(wrap, 'hidden'); return; }
  setText('#header-book-title', title);
  setText('#header-book-chapters', `${chapterCount} chapters`);
  removeClass(wrap, 'hidden');
}

export async function refreshAudiobookPanel() {
  const panel = $('#audiobook-panel');
  if (!panel || !state.currentBookId) return;

  const buildBtn = $('#btn-build-audiobook');
  const dlLink = $('#btn-download-all');
  const meta = $('#ab-meta');
  const title = $('#ab-title');

  // Chapters are joined in reading order, so say so — it is the first thing
  // anyone asks about a merge, and the answer is not guessable.
  if (title) title.textContent = 'Complete audiobook · in chapter order';

  try {
    const s = await api.getAudiobook(state.currentBookId);
    state.audiobook = s;

    const remaining = (s.totalChapters || 0) - (s.readyChapters || 0);
    const ready = `${s.readyChapters} of ${s.totalChapters} chapters have audio`;

    // Nothing converted: there is no meaningful action, so the whole block
    // steps aside instead of showing a dead button.
    panel.hidden = !s.readyChapters && !s.audiobook;
    if (panel.hidden) return;

    if (s.audiobook && !s.stale) {
      meta.textContent = `Ready · ${formatTime(s.audiobook.durationSeconds)} · ${formatSize(s.audiobook.fileSizeBytes)} · ${ready}`;
      dlLink.href = api.getDownloadUrl(s.audiobook.id);
      dlLink.hidden = false;
      buildBtn.hidden = !s.canBuild;
      setText('#btn-build-label', 'Rebuild');
    } else if (s.audiobook && s.stale) {
      // Chapters were re-converted after the merge, so the file is outdated.
      meta.textContent = `Out of date — new chapter audio exists since this was built · ${ready}`;
      dlLink.href = api.getDownloadUrl(s.audiobook.id);
      dlLink.hidden = false;
      buildBtn.hidden = false;
      setText('#btn-build-label', 'Rebuild with latest');
    } else if (s.canBuild) {
      meta.textContent = remaining > 0
        ? `${ready} — ${remaining} still to convert, and they will be skipped`
        : `All ${s.totalChapters} chapters ready`;
      dlLink.hidden = true;
      buildBtn.hidden = false;
      setText('#btn-build-label', remaining > 0 ? 'Build from what is ready' : 'Build audiobook');
    } else {
      meta.textContent = 'Convert some chapters first, then you can join them into one file.';
      dlLink.hidden = true;
      buildBtn.hidden = true;
    }
  } catch (err) {
    meta.textContent = `Could not check audiobook status: ${err.message}`;
    addLogEntry({ level: 'error', message: `Audiobook status failed: ${err.message}` });
  }
}

export async function buildAudiobook() {
  const btn = $('#btn-build-audiobook');
  const original = $('#btn-build-label').textContent;
  btn.disabled = true;
  setText('#btn-build-label', 'Joining chapters…');

  try {
    const r = await api.buildAudiobook(state.currentBookId);
    const skipped = r.skipped?.length
      ? ` (${r.skipped.length} chapter${r.skipped.length > 1 ? 's' : ''} skipped — no audio yet)`
      : '';
    showToast(`Audiobook ready · ${r.includedChapters} chapters${skipped}`, 'success');
    addLogEntry({ level: 'success', message: `Built complete audiobook from ${r.includedChapters} chapters${skipped}` });
    await loadAudioFilesForBook();
    await refreshAudiobookPanel();
  } catch (err) {
    showToast('Could not build audiobook: ' + err.message, 'error');
    addLogEntry({ level: 'error', message: `Audiobook build failed: ${err.message}` });
    setText('#btn-build-label', original);
  } finally {
    btn.disabled = false;
  }
}

export function hasActiveGenerations() {
  return Object.keys(state.activeGenerations || {}).length > 0;
}

export async function loadAudioFilesForBook() {
  if (!state.currentBookId) return [];
  const data = await api.getAudioFiles(state.currentBookId);
  state.audioFiles = (data.audioFiles || []).filter((a) => !a.isMerged);
  
  if (state.currentAudioId) {
    const newIdx = state.audioFiles.findIndex(a => a.id === state.currentAudioId);
    if (newIdx !== -1) {
      state.currentAudioIndex = newIdx;
    }
  }
  
  return state.audioFiles;
}

export async function loadResults() {
  try {
    await loadAudioFilesForBook();
    renderChapters();
  } catch (err) {
    showToast('Failed to load audio: ' + err.message, 'error');
  }
}

