
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
import { renderChapters, updateChapterRowProgress, updateCounts } from '../components/chapterList.js';

import * as Main from '../main.js';
import { resetGenerateButton } from '../main.js';
import { initConfigPanel, loadModels, syncNarrationControls, effectiveSettingsFor, settingsKey } from '../ui/configPanel.js';
import { openVersionsModal, deleteAudioVersion, openScriptEditor, runScriptCheck, openQuickConvertModal, resetChapterOverride, clearChapterOverrides, initChapterControls } from '../chapters/chapterActions.js';
import { renderBookOverview, renderListenPane, initListenPane, setHeaderBook, refreshAudiobookPanel, buildAudiobook, hasActiveGenerations, loadAudioFilesForBook, loadResults } from '../workspace/bookView.js';
import { renderQuota, initQueuePanel, renderQueuePanel } from '../ui/queuePanel.js';

import { startSingleChapterGeneration, startAudioFromExistingScript, startTranslateOnly, startGeneration, startBatchTranslateOnly, cancelChapterConversion, clearGenerationsForJob, cancelAllJobs, setupProgressTracking, checkInterruptedJobs, resumeInterruptedJob, syncQueueSnapshot, syncQuotaSnapshot } from '../generation/generationJobs.js';
import { initReaderUi, previewChapter, renderReaderBody } from '../reader/readerUi.js';
import { initPlayer, stopPlayback, playAudioAtIndex, togglePlay } from '../audio/player.js';
import { initUpload, setUploadStep, handleUpload, onBookParsing, onBookParsed, onBookError, resetUpload, UPLOAD_STEPS, isUploading } from '../workspace/upload.js';
import { loadLibrary, renderLibrary } from '../workspace/library.js';
import { initConnectionIndicator, decideLandingView, initHomeView, initShell, initNavigation, switchView, applyWorkspaceMode } from '../workspace/layout.js';

// --- EXPORTED ---
export function initRealtimeHandlers() {
  const bind = (event, fn) => socketService.onKeyed('progress', event, fn);

  bind('queue:state', () => syncQueueSnapshot());

  // Server-pushed quota. Replaces the 5-second poll so a throttle is visible
  // the instant it happens rather than up to 5 seconds later.
  bind('quota', (data) => {
    renderQuota(data.quota, data);
    if (data.state === 'daily_low') {
      showToast(data.headline, 'warning');
    }
  });

  bind('chapter:progress', (data) => {
    if (data.bookId !== state.currentBookId) return;
    updateChapterProgress(data);
  });

  bind('chapter:complete', (data) => {
    if (data.bookId !== state.currentBookId) return;
    markChapterComplete(data);
  });

  bind('chapter:error', (data) => {
    if (data.bookId !== state.currentBookId) return;
    markChapterError(data);
  });

  bind('chapter:custom_script', async (data) => {
    if (data.bookId !== state.currentBookId) return;
    try {
      const res = await api.getChapters(state.currentBookId);
      if (res && res.chapters) {
        state.chapters = res.chapters;
        renderChapters();
        renderBookOverview();
      }
    } catch (e) {
      console.warn('Failed to refresh chapters on custom_script:', e);
    }
  });

  bind('chapter:updated', async (data) => {
    if (data.bookId !== state.currentBookId) return;
    try {
      const res = await api.getChapters(state.currentBookId);
      if (res && res.chapters) {
        state.chapters = res.chapters;
        renderChapters();
        renderBookOverview();
      }
    } catch (e) {
      console.warn('Failed to refresh chapters on updated:', e);
    }
  });

  bind('job:progress', (data) => {
    updateOverallProgress(data);
  });

  bind('job:complete', (data) => {
    onJobComplete(data);
  });

  bind('job:error', (data) => {
    showToast('Generation failed: ' + data.error, 'error');
    // Only THIS job's chapters stop — other queued/running jobs are untouched.
    clearGenerationsForJob(data?.jobId);
    renderChapters();
    if (!hasActiveGenerations()) resetGenerateButton();
  });

  bind('job:cancelled', (data) => {
    const kept = data?.completed ?? 0;
    showToast(
      kept ? `Stopped. ${kept} finished chapter${kept === 1 ? '' : 's'} kept.` : 'Audiobook creation stopped.',
      'info'
    );
    // Rows were left spinning after a cancel because only the toast was
    // handled — the in-flight state was never cleared. Scoped to this job so a
    // batch cancel of one job does not blank the rows of the others.
    clearGenerationsForJob(data?.jobId);
    renderChapters();
    if (!hasActiveGenerations()) resetGenerateButton();
  });

  // The SERVER decides what is stopping. Driving this from an event rather
  // than from the click handler means every open tab agrees, and a reload
  // recovers the state from the queue snapshot instead of losing it.
  bind('chapter:stopping', (data) => {
    if (data.bookId !== state.currentBookId) return;
    const gen = state.activeGenerations[data.chapterIdx];
    if (!gen) return;
    gen.stopping = true;
    gen.message = 'Stopping…';

    // If the stop does not land within the server's own grace window,
    // re-enable the button rather than leaving the user with no recourse.
    clearTimeout(gen.stoppingTimer);
    gen.stoppingTimer = setTimeout(() => {
      const still = state.activeGenerations[data.chapterIdx];
      if (still?.stopping) {
        still.stopping = false;
        still.message = 'Still stopping — press Stop again to force it.';
        renderChapters();
      }
    }, (data.graceMs || 15000) + 1000);
    renderChapters();
  });

  bind('job:stopping', (data) => {
    if (data.bookId !== state.currentBookId) return;
    // Same scoping rule as job:cancelled — do not paint "Stopping…" over
    // chapters that belong to a different job which is still running happily.
    for (const [idx, gen] of Object.entries(state.activeGenerations)) {
      if (data.jobId && state.chapterJobs?.[idx] && state.chapterJobs[idx] !== data.jobId) continue;
      gen.stopping = true;
      gen.message = 'Stopping…';
    }
    renderChapters();
  });

  bind('job:stop-timeout', (data) => {
    if (data.bookId !== state.currentBookId) return;
    showToast('A step is not responding to cancellation. Abandoning it.', 'warning');
  });

  // A single cancelled chapter inside a still-running job. Without this the
  // row kept its progress bar for work the server had already skipped.
  bind('chapter:cancelled', (data) => {
    if (data.bookId !== state.currentBookId) return;
    // Cancel the "still stopping" escalation — the stop landed, so the timer
    // must not fire later and re-render a row that no longer exists.
    clearTimeout(state.activeGenerations[data.chapterIdx]?.stoppingTimer);
    delete state.activeGenerations[data.chapterIdx];
    delete state.chapterJobs[data.chapterIdx];
    renderChapters();
  });

  bind('log', (data) => {
    addLogEntry(data);
  });
}

export function updateChapterProgress(data) {
  const waiting = data.phase === 'waiting_quota' || data.phase === 'backoff' || data.phase === 'retrying';
  const prev = state.activeGenerations[data.chapterIdx] || {};
  const isNew = !state.activeGenerations[data.chapterIdx] || !prev.updatedAt;

  state.activeGenerations[data.chapterIdx] = {
    ...prev,
    percent: data.percent,
    // Once the user has asked this chapter to stop, server progress must not
    // overwrite the message and make it look like work resumed normally. The
    // spread above already preserves `stopping` and `stoppingTimer`.
    message: prev.stopping ? 'Stopping…' : data.message,
    stage: data.stage || prev.stage,
    phase: data.phase,
    chunkCurrent: data.chunkCurrent ?? prev.chunkCurrent,
    chunkTotal: data.chunkTotal ?? prev.chunkTotal,
    model: data.model || prev.model,
    waiting,
    // Absolute instant so the ticker can count down without further events.
    resumesAt: waiting && data.waitMs ? Date.now() + data.waitMs : null,
    // Proof-of-life. Rendered as "last update Ns ago" so a quiet backend is
    // visibly quiet-but-alive rather than ambiguously dead.
    updatedAt: Date.now(),
  };
  const gen = state.activeGenerations[data.chapterIdx];

  if (isNew) {
    updateCounts();
  }

  show('#section-progress');
  let item = $(`#ch-progress-${data.chapterIdx}`);
  if (!item) {
    const progressList = $('#chapter-progress-list');
    if (progressList) {
      const ch = state.chapters?.find((c) => c.chapterIndex === data.chapterIdx);
      const title = ch?.title || `Chapter ${data.chapterIdx + 1}`;
      const markup = `
        <div class="chapter-progress-item" id="ch-progress-${data.chapterIdx}" style="flex-direction: column; align-items: flex-start; padding: 10px 12px; gap: 6px;">
          <div style="display: flex; align-items: center; width: 100%; gap: 10px;">
            <div class="status-icon processing"><span class="spinner" style="width:16px;height:16px;border-width:2px"></span></div>
            <span class="chapter-progress-title">${escapeHtml(title)}</span>
            <div class="mini-progress"><div class="mini-progress-bar" style="width:0%"></div></div>
            <span class="chapter-progress-status">Processing...</span>
          </div>
          <div id="ch-live-log-${data.chapterIdx}" style="font-family: monospace; font-size: 11px; color: #a7f3d0; background: rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.05); padding: 4px 8px; border-radius: 4px; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: none;"></div>
        </div>`;
      progressList.insertAdjacentHTML('beforeend', markup);
      item = $(`#ch-progress-${data.chapterIdx}`);
    }
  }

  if (item) {
    const bar = item.querySelector('.mini-progress-bar');
    const status = item.querySelector('.chapter-progress-status');
    const icon = item.querySelector('.status-icon');
    if (bar) {
      bar.style.width = data.percent + '%';
      bar.classList.toggle('is-waiting', waiting);
    }
    if (status) status.textContent = data.message || `${data.percent}%`;
    if (icon) {
      icon.className = `status-icon ${waiting ? 'waiting' : 'processing'}`;
      icon.innerHTML = waiting
        ? '<span class="pulse-dot" title="Waiting on the Groq rate limit"></span>'
        : '<span class="spinner" style="width:16px;height:16px;border-width:2px"></span>';
    }

    const liveLog = item.querySelector(`#ch-live-log-${data.chapterIdx}`);
    if (liveLog && data.message) {
      liveLog.style.display = 'block';
      liveLog.textContent = `${waiting ? '⏳' : '⚡'} [${new Date().toLocaleTimeString()}] ${data.message}`;
    }
  }

  // Patch the row in place. Progress events arrive several times a second, and
  // re-rendering the whole list on each one would rebuild every row — which is
  // what made long books stutter and dropped any open version dropdown.
  updateChapterRowProgress(data.chapterIdx, data.percent, data.message, gen);
}

export function markChapterComplete(data) {
  delete state.activeGenerations[data.chapterIdx];
  // The chapter is no longer part of a running job, so Stop must not later
  // target a job it has already left.
  delete state.chapterJobs[data.chapterIdx];
  updateCounts();

  const item = $(`#ch-progress-${data.chapterIdx}`);
  if (item) {
    const bar = item.querySelector('.mini-progress-bar');
    const status = item.querySelector('.chapter-progress-status');
    const icon = item.querySelector('.status-icon');
    if (bar) { bar.style.width = '100%'; bar.classList.add('success'); }
    if (status) status.textContent = 'Done';
    if (icon) { icon.className = 'status-icon done'; icon.textContent = '✅'; }
  }

  // Reload the audio list so the row gains its Play button and badges.
  // This used to sit inside `if (inlineStatus)`, so if that element was
  // missing the new audio was never fetched and the chapter stayed looking
  // unconverted until a manual refresh.
  loadAudioFilesForBook()
    .then(() => renderChapters())
    .catch((err) => addLogEntry({ level: 'error', message: `Could not refresh audio list: ${err.message}` }));

  // A text-only run produced a script and no audio, so the thing to refresh is
  // the reader — otherwise the AI tab keeps showing its empty state even though
  // the translation it asked for has just arrived.
  if (data.scriptOnly) {
    showToast(`Chapter ${data.chapterIdx + 1} AI retelling is ready — text only.`, 'success');
    if (state.readerChapterIdx === data.chapterIdx && !$('#chapter-modal')?.classList.contains('hidden')) {
      refreshReaderChapter(data.chapterIdx, 'ai');
    }
  }
}

export function markChapterError(data) {
  // Read the job id BEFORE the bookkeeping below discards it: it is what lets
  // Retry reuse the original job's settings rather than today's defaults.
  const jobId = data.jobId || state.chapterJobs[data.chapterIdx] || null;

  delete state.activeGenerations[data.chapterIdx];
  delete state.chapterJobs[data.chapterIdx];
  updateCounts();
  const errorMsg = data.error || 'Generation failed';
  // Stored as an object so the row can name the stage and offer the recovery
  // actions that apply to it. `message` is read by everything that used to
  // treat this as a plain string.
  state.chapterErrors[data.chapterIdx] = {
    message: errorMsg,
    stage: data.stage || null,
    jobId,
    retryable: data.retryable !== false,
  };

  addLogEntry({
    level: 'error',
    message: `❌ [Chapter ${data.chapterIdx + 1}] ${stageLabel(data.stage)}: ${errorMsg}`
  });

  renderChapters();
}

export function updateOverallProgress(data) {
  show('#section-progress');
  setText('#overall-percent', Math.round(data.overallPercent) + '%');
  $('#overall-progress-bar').style.width = data.overallPercent + '%';
  setText('#progress-status-text', `Processing chapter ${data.currentChapter + 1}...`);

  // Recorded against the book so Home can report a job that is still running
  // in a book the user has since navigated away from.
  if (state.currentBookId) {
    state.activeBookJobs[state.currentBookId] = {
      percent: Math.round(data.overallPercent),
      label: `Chapter ${data.currentChapter + 1} of ${data.totalChapters ?? '?'}`,
    };
  }
  
  if (data.etaSeconds !== undefined) {
    const mins = Math.floor(data.etaSeconds / 60);
    const secs = data.etaSeconds % 60;
    const etaStr = mins > 0 ? `${mins}m ${secs}s remaining` : `${secs}s remaining`;
    setText('#overall-eta', data.etaSeconds > 0 ? etaStr : 'Almost done...');
  }
}

export function onJobComplete(data) {
  setText('#overall-percent', '100%');
  setText('#overall-eta', 'Done');
  $('#overall-progress-bar').style.width = '100%';

  // The job reports how many chapters failed, so the UI must not claim total
  // success regardless. Announcing "generated successfully" over a run where
  // half the chapters errored teaches the user to distrust every message.
  const failed = data?.failed || 0;
  const done = data?.completed ?? 0;

  if (failed) {
    removeClass('#overall-progress-bar', 'success');
    setText('#progress-status-text',
      `${done} chapter${done === 1 ? '' : 's'} created · ${failed} failed`);
    showToast(
      `${done} created, ${failed} failed. The failed chapters show why on their row.`,
      'warning'
    );
  } else {
    addClass('#overall-progress-bar', 'success');
    setText('#progress-status-text', 'All chapters generated!');
    showToast(
      done === 1 ? 'Audiobook chapter created.' : `${done} audiobook chapters created.`,
      'success'
    );
  }

  if (state.currentBookId) delete state.activeBookJobs[state.currentBookId];

  // Rows must not stay stuck showing a spinner for a job that has ended —
  // a chapter that never emitted chapter:complete (skipped, cancelled) would
  // otherwise look like it is still converting forever.
  state.activeGenerations = {};
  state.chapterJobs = {};
  updateCounts();
  renderChapters();

  resetGenerateButton();

  loadResults();
  refreshAudiobookPanel();
}

export async function refreshReaderChapter(chapterIdx, viewMode) {
  try {
    const data = await api.getChapterContent(state.currentBookId, chapterIdx);
    state.currentChapterData = data;
    if (viewMode) state.readerViewMode = viewMode;
    renderReaderBody();
    renderListenPane();
  } catch (err) {
    addLogEntry({ level: 'warn', message: `Could not refresh the reader: ${err.message}` });
  }
}

