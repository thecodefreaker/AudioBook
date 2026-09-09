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
import { renderHome } from '../components/home.js';

import * as Main from '../main.js';
import { initConfigPanel, loadModels, syncNarrationControls, effectiveSettingsFor, settingsKey } from '../ui/configPanel.js';
import { openVersionsModal, deleteAudioVersion, openScriptEditor, runScriptCheck, openQuickConvertModal, resetChapterOverride, clearChapterOverrides, initChapterControls } from '../chapters/chapterActions.js';
import { initRealtimeHandlers, updateChapterProgress, markChapterComplete, markChapterError, updateOverallProgress, onJobComplete, refreshReaderChapter } from '../generation/realtime.js';
import { renderBookOverview, renderListenPane, initListenPane, setHeaderBook, refreshAudiobookPanel, buildAudiobook, hasActiveGenerations, loadAudioFilesForBook, loadResults } from '../workspace/bookView.js';

import { startSingleChapterGeneration, startAudioFromExistingScript, startTranslateOnly, startGeneration, startBatchTranslateOnly, cancelChapterConversion, clearGenerationsForJob, cancelAllJobs, setupProgressTracking, checkInterruptedJobs, resumeInterruptedJob, syncQueueSnapshot, syncQuotaSnapshot } from '../generation/generationJobs.js';
import { initReaderUi, previewChapter } from '../reader/readerUi.js';
import { initPlayer, stopPlayback, playAudioAtIndex, togglePlay } from '../audio/player.js';
import { initUpload, setUploadStep, handleUpload, onBookParsing, onBookParsed, onBookError, resetUpload, UPLOAD_STEPS, isUploading } from '../workspace/upload.js';
import { loadLibrary, renderLibrary } from '../workspace/library.js';
import { initConnectionIndicator, decideLandingView, initHomeView, initShell, initNavigation, switchView, applyWorkspaceMode } from '../workspace/layout.js';

// --- EXPORTED ---
export function renderQuota(quota, meta = {}) {
  const el = $('#groq-quota-display');
  if (!el || !quota) return;

  if (!quota.tokensLimit && !quota.requestsLimit) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';

  const pct = quota.tokensLimit > 0
    ? Math.max(0, Math.min(100, Math.round((quota.tokensRemaining / quota.tokensLimit) * 100)))
    : 100;

  const state = quota.blocked ? 'blocked' : quota.waiting > 0 ? 'throttled' : pct <= 15 ? 'low' : 'ok';
  const tone = { blocked: 'error', throttled: 'warning', low: 'warning', ok: 'ok' }[state];

  const lines = [];
  lines.push(
    `<div class="quota-row">
       <span class="quota-dot quota-${tone}"></span>
       <strong>${quota.tokensRemaining.toLocaleString()}</strong>
       <span class="quota-dim">/ ${quota.tokensLimit.toLocaleString()} tokens per minute</span>
     </div>
     <div class="quota-bar"><div class="quota-bar-fill quota-${tone}" style="width:${pct}%"></div></div>`
  );

  // Say plainly whether these numbers are real or a placeholder. A guessed
  // limit that looks authoritative is worse than no number at all.
  if (!quota.authoritative) {
    lines.push('<div class="quota-dim">Estimated — will be confirmed by Groq on the first request.</div>');
  }

  if (quota.model) lines.push(`<div class="quota-dim">Model: ${escapeHtml(quota.model)}</div>`);

  if (Number.isFinite(quota.dailyRequestsRemaining) && Number.isFinite(quota.dailyRequestsLimit)) {
    lines.push(
      `<div class="quota-dim">Today: ${quota.dailyRequestsRemaining.toLocaleString()} / ` +
      `${quota.dailyRequestsLimit.toLocaleString()} requests left</div>`
    );
  }

  if (meta.headline) {
    lines.push(`<div class="quota-notice quota-${tone}">${escapeHtml(meta.headline)}</div>`);
    if (meta.detail) lines.push(`<div class="quota-dim">${escapeHtml(meta.detail)}</div>`);
  } else if (quota.waiting > 0) {
    lines.push(`<div class="quota-notice quota-warning">${quota.waiting} request(s) queued, waiting for quota.</div>`);
  }

  // Per-model breakdown. Limits are per model, so a single aggregate number
  // cannot answer "which model is using how much" — the question you actually
  // ask when deciding what to run next.
  const models = (quota.all || []).filter((m) => m.metrics?.requests > 0);
  if (models.length) {
    lines.push('<details class="quota-models"><summary>Per-model usage</summary>');
    for (const m of models) {
      const tpmPct = m.tpm.limit ? Math.round((m.tpm.remaining / m.tpm.limit) * 100) : 100;
      // TPD is the limit that silently ends long runs, so show it when known.
      const daily = m.tpd.authoritative && m.tpd.limit
        ? ` · day ${Math.round(m.tpd.remaining).toLocaleString()}/${m.tpd.limit.toLocaleString()}`
        : '';
      lines.push(
        `<div class="quota-model-row">
           <span class="quota-model-name">${escapeHtml(m.model)}</span>
           <span class="quota-dim">${m.metrics.requests} req · min ${tpmPct}%${daily}</span>
         </div>`
      );
    }
    lines.push('</details>');
  }

  el.innerHTML = lines.join('');
  el.dataset.state = state;
}

export function initQueuePanel() {
  const panel = $('#queue-job-list');
  if (!panel) return;
  panel.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-queue-cancel]');
    if (!button) return;
    button.disabled = true;
    try {
      await api.cancelJob(button.dataset.bookId, button.dataset.queueCancel, 'Cancelled from queue');
      await syncQueueSnapshot();
    } catch (err) {
      showToast(`Could not cancel job: ${err.message}`, 'error');
      button.disabled = false;
    }
  });
}

export function renderQueuePanel() {
  const panel = $('#queue-job-list');
  if (!panel) return;
  const snapshot = state.queueSnapshot || {};
  const jobs = (snapshot.active || []).filter((job) => ['queued', 'processing'].includes(job.status));
  state.activeBookJobs = Object.fromEntries(jobs.map((job) => [job.bookId, {
    percent: Math.round(job.progressPercent || 0),
    label: job.status === 'queued'
      ? `Queued${job.queue?.position > 0 ? ` · #${job.queue.position}` : ''}`
      : `${Math.round(job.progressPercent || 0)}%`,
  }]));
  if (state.currentView === 'home') renderHome(state.libraryBooks || [], state.activeBookJobs);
  
  if (state.currentBookId) {
    const currentBookJobs = jobs.filter(j => String(j.bookId) === String(state.currentBookId));
    const activeIdxs = new Set();
    let changed = false;

    for (const job of currentBookJobs) {
      if (!job.selectedChapters) continue;
      const isQueued = job.status === 'queued';
      const actionLabel = job.action === 'script' ? 'Retelling' : 'Creating audio';
      
      for (let i = 0; i < job.selectedChapters.length; i++) {
        const idx = job.selectedChapters[i];
        activeIdxs.add(idx);
        state.chapterJobs[idx] = job.id;
        
        if (!state.activeGenerations[idx]) {
          state.activeGenerations[idx] = {
            percent: isQueued ? 0 : (job.progressPercent || 0),
            message: isQueued ? `Queued · ${i} ahead` : `${actionLabel}…`
          };
          changed = true;
        }
      }
    }

    for (const idx of Object.keys(state.activeGenerations)) {
      if (!activeIdxs.has(Number(idx))) {
        const gen = state.activeGenerations[idx];
        // Do not prune jobs that are optimistically starting
        if (gen?.message === 'Starting…') continue;
        // Do not prune jobs that have received recent progress updates (e.g. within 15 seconds)
        if (gen?.updatedAt && (Date.now() - gen.updatedAt < 15000)) continue;
        
        delete state.activeGenerations[idx];
        delete state.chapterJobs[idx];
        changed = true;
      }
    }

    if (changed) renderChapters();
  }

  const hasActiveInFlight = Object.keys(state.activeGenerations || {}).length > 0;
  if (!jobs.length) {
    panel.innerHTML = '';
    if (state.currentBookId && !hasActiveInFlight) hide('#section-progress');
    return;
  }
  if (state.currentBookId && (hasActiveInFlight || jobs.some((job) => String(job.bookId) === String(state.currentBookId)))) {
    show('#section-progress');
  }

  panel.innerHTML = `
    <div class="queue-heading">
      <span>Queue · ${jobs.length} active job${jobs.length === 1 ? '' : 's'}</span>
      <span class="text-3">${snapshot.paused ? 'Paused' : `${snapshot.concurrency || 1} worker${snapshot.concurrency === 1 ? '' : 's'}`}</span>
    </div>
    ${jobs.map((job) => {
      const q = job.queue || {};
      const pct = Math.max(0, Math.min(100, Math.round(job.progressPercent || 0)));
      const queued = job.status === 'queued';
      const position = queued && q.position > 0 ? ` · position ${q.position}` : '';
      const chapters = (job.selectedChapters || []).length;
      return `
        <div class="queue-job-row">
          <div class="queue-job-main">
            <strong>${escapeHtml(job.bookTitle || 'Book')}</strong>
            <span class="text-3">${queued ? `Waiting${position}` : `Running · ${pct}%`}</span>
          </div>
          <div class="queue-job-sub text-3">${chapters} chapter${chapters === 1 ? '' : 's'} · ${escapeHtml(job.action || 'both')}</div>
          <div class="progress"><div class="progress-fill" style="width:${pct}%"></div></div>
          <button class="btn btn-ghost btn-sm" data-queue-cancel="${escapeHtml(job.id)}" data-book-id="${escapeHtml(job.bookId)}">Stop</button>
        </div>`;
    }).join('')}`;
}

