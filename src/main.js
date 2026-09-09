import { api } from './services/api.js';
import { socketService } from './services/socket.js';
import { ReaderSync, renderSentences } from './services/readerSync.js';
import { $, $$, show, hide, toggle, setText, setHTML, addClass, removeClass } from './utils/dom.js';
import { formatTime, formatNumber, timeAgo, formatDateTime, formatSize } from './utils/formatters.js';
import { escapeHtml } from './utils/html.js';
import { state } from './store.js';
import { showToast, removeToast } from './components/toast.js';
import {
  initLogConsole, initCrashReporting, addLogEntry, loadPersistedLogs, renderLogs,
  showLogsForChapter,
} from './components/logConsole.js';
import {
  CATALOG, loadCatalog, languageDef, languageName, styleName, voiceName,
  sourceBadge, versionLabel, audioBadges, stageLabel, SCRIPT_SOURCE_META,
} from './components/catalog.js';
import { initChapterList, renderChapters, updateChapterRowProgress, resetChapterPage, startProgressTicker, visibleChapters } from './components/chapterList.js';
import {
  getSetting, setSetting, migrateLegacySettings,
  getConversionSettings, setConversionSettings,
  SPEED_PRESETS, clampSpeed, speedForBook, rememberSpeed, makeSpeedDefault,
  clampPitch, pitchForBook, rememberPitch, makePitchDefault,
  getLastRead, setLastRead,
  getBookPreset, setBookPreset, clearBookPreset,
  getQuickActionAllowed, setQuickActionAllowed,
  getBatchMode, setBatchMode,
} from './services/settings.js';
import { renderHome, initHome } from './components/home.js';
import { initReaderUi, previewChapter, renderReaderBody, applyReaderSettings, toggleReadAloud } from './reader/readerUi.js';
import { initPlayer, stopPlayback, playAudioAtIndex, togglePlay, updateSpeedDefaultNote } from './audio/player.js';
import { parseVtt, startSubtitleSync } from './audio/subtitles.js';
import { initUpload, setUploadStep, handleUpload, onBookParsing, onBookParsed, onBookError, resetUpload, UPLOAD_STEPS, isUploading } from './workspace/upload.js';
import { loadLibrary, renderLibrary } from './workspace/library.js';
import { initConnectionIndicator, decideLandingView, initHomeView, initShell, initNavigation, switchView, applyWorkspaceMode } from './workspace/layout.js';
import { startSingleChapterGeneration, startAudioFromExistingScript, startTranslateOnly, startGeneration, startBatchTranslateOnly, cancelChapterConversion, clearGenerationsForJob, cancelAllJobs, setupProgressTracking, checkInterruptedJobs, resumeInterruptedJob, syncQueueSnapshot, syncQuotaSnapshot } from './generation/generationJobs.js';

import { initConfigPanel, loadModels, syncNarrationControls, effectiveSettingsFor, settingsKey } from './ui/configPanel.js';
import { openVersionsModal, deleteAudioVersion, openScriptEditor, runScriptCheck, openQuickConvertModal, resetChapterOverride, clearChapterOverrides, initChapterControls, seAiContent } from './chapters/chapterActions.js';
import { initRealtimeHandlers, updateChapterProgress, markChapterComplete, markChapterError, updateOverallProgress, onJobComplete, refreshReaderChapter } from './generation/realtime.js';
import { renderBookOverview, renderListenPane, initListenPane, setHeaderBook, refreshAudiobookPanel, buildAudiobook, hasActiveGenerations, loadAudioFilesForBook, loadResults } from './workspace/bookView.js';
import { renderQuota, initQueuePanel, renderQueuePanel } from './ui/queuePanel.js';
import { initBridgeModal } from './ui/bridgeModal.js';

export { initConfigPanel, loadModels, syncNarrationControls, effectiveSettingsFor, settingsKey };
export { openVersionsModal, deleteAudioVersion, openScriptEditor, runScriptCheck, openQuickConvertModal, resetChapterOverride, clearChapterOverrides, initChapterControls };
export { initRealtimeHandlers, updateChapterProgress, markChapterComplete, markChapterError, updateOverallProgress, onJobComplete, refreshReaderChapter };
export { renderBookOverview, renderListenPane, initListenPane, setHeaderBook, refreshAudiobookPanel, buildAudiobook, hasActiveGenerations, loadAudioFilesForBook, loadResults };
export { renderQuota, initQueuePanel, renderQueuePanel };


/** Owns reader↔audio synchronisation; created lazily when a chapter opens. */
let readerSync = null;

// ============================================
// APP STATE — see src/store.js
// ============================================

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  // Before anything reads a preference, move the loose localStorage keys into
  // the single settings store, so existing users keep their font size, theme
  // and last-read position.
  migrateLegacySettings();
  initCrashReporting();
  socketService.connect();
  // Registered once, before any conversion can start. Previously these were
  // bound inside setupProgressTracking(), i.e. once per job, which stacked
  // duplicate handlers and fired the success toast once per past conversion.
  initRealtimeHandlers();
  initQueuePanel();
  initUpload();
  initNavigation();
  initChapterControls();
  initConfigPanel();
  initPlayer();
  initLogConsole();
  initModal();
  initBridgeModal();
  initListenPane();
  initHomeView();
  initShell();
  initReaderUi();
  document.querySelector('#groq-config-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
  });
  // Render once up front so the workspace shows its empty state instead of a
  // blank area until a book is opened.
  renderChapters();
  // The landing view depends on whether there is anything to come back to, so
  // it can only be decided once the library has loaded.
  loadLibrary().then(decideLandingView);
  syncQueueSnapshot();
  syncQuotaSnapshot();
  // Keeps countdowns and "last update Ns ago" truthful between socket events.
  startProgressTicker();
  initConnectionIndicator();
  window.setInterval(syncQueueSnapshot, 5000);
  window.setInterval(syncQuotaSnapshot, 5000);
});

/**
 * Show connection health in the header.
 *
 * Every "is it broken?" moment starts with not knowing whether the browser is
 * still talking to the server. A silent socket drop looked exactly like a
 * hung job, because progress simply stopped arriving with no explanation.
 */


/**
 * Choose the view to land on.
 *
 * Three states, not two: a first-time user needs the pitch, a returning user
 * needs their shelf, and someone who opted into auto-open needs their book.
 * Showing the hero to all three was the bug.
 */


/** Home's actions all route through existing app functions — no second path. */


/**
 * Shell-level controls: the mobile sidebar and "New book".
 */


// ============================================
// NAVIGATION
// ============================================




/**
 * Make the shell reflect whether a book is open.
 *
 * Uploading is how you *start*; it is not part of working on a book you have
 * already opened. The drop zone used to sit permanently in the sidebar, which
 * meant the most prominent control on screen was one the user had already
 * finished with, while the controls they actually needed sat below it.
 *
 * Upload now has a single home — the header's "New book" — and the sidebar
 * carries only what applies to the book that is actually open.
 */


// ============================================
// UPLOAD
// ============================================


/**
 * Narrated upload stages.
 *
 * Steps before the current one are marked done, the current one is active.
 * Naming the stage the app is in ("Extracting chapters") is the difference
 * between a user waiting patiently and a user assuming it has hung.
 */









/**
 * The book overview — cover, title and the numbers that describe the book.
 *
 * Every figure here is derived from data we already hold, so it stays true
 * without extra requests. Estimated length uses the same 150wpm assumption the
 * server's chunker uses, so the two never disagree on screen.
 */


/**
 * The reader's listening pane.
 *
 * Deliberately has no <audio> of its own: it drives the docked player. Two
 * audio elements would mean two things playing at once and a sync engine that
 * cannot tell which is authoritative.
 */




/**
 * The open book is the context for every other region, so it is shown in the
 * header rather than in a panel that can scroll out of view. Passing no title
 * clears it, which is what "New book" needs.
 */






// ============================================
// CHAPTERS
// ============================================
/**
 * Rendering, filtering, sorting and selection now live in
 * `components/chapterList.js`. main.js only supplies the app-level actions a
 * row can trigger, which keeps that module free of API and player knowledge —
 * and is what let the per-row listeners (re-attached on every render, so a
 * click fired N times after N conversions) become one delegated handler.
 */


/**
 * Delete one audio version. `audioIndex` is whichever version the row's picker
 * is showing, so what gets deleted is always what the user is looking at —
 * previously the row deleted the newest version regardless of the choice.
 */


/**
 * Stop ONE chapter.
 *
 * The row's Stop button used to call cancelAllJobs(), so stopping a single
 * chapter silently killed every other conversion for the book — which is why
 * "stop" appeared not to work: the chapter you clicked kept going to the end
 * of its current step while everything else vanished.
 */


/**
 * Drop every pending "still stopping" escalation.
 *
 * `state.activeGenerations = {}` discards the objects but NOT their timers, so
 * a 15s callback could still fire against a row that had been cleared and
 * resurrect a stale "Stopping…" entry. Always clear the timers first.
 */


/**
 * Clear the in-flight UI state belonging to ONE job.
 *
 * `job:cancelled` / `job:error` used to blank `activeGenerations` and
 * `chapterJobs` wholesale. With more than one job in the queue that is a
 * regression: cancelling job #1 made chapters owned by jobs #2 and #3 render as
 * idle while the server was still working on them, and their later
 * `chapter:complete` events landed on rows that no longer had any state.
 *
 * `state.chapterJobs` already records which job owns each chapter, so use it.
 * If the jobId is unknown (e.g. after a reload, where the map is empty) fall
 * back to the old clear-everything behaviour — losing state is better than
 * leaving rows spinning forever on work that has definitely stopped.
 *
 * @returns {number} how many chapter rows were cleared.
 */


/** True while any chapter anywhere is still mid-generation. */







/**
 * Single source of truth for the book's chapter audio.
 *
 * This was previously inlined in five places, two of which forgot to filter
 * out the merged whole-book file — so it could appear as if it were a chapter.
 */


/**
 * Complete-audiobook panel.
 *
 * Two problems are fixed structurally here. The old "Download Complete
 * Audiobook" button was wired to nothing, and the merged file it implied
 * usually didn't exist. And it used to live in its own permanent sidebar card
 * with no book name on it, offering to build something that could not exist
 * yet — a control that is always visible but only sometimes meaningful trains
 * people to ignore it.
 *
 * It now belongs to the book card, names the book, and when it cannot be used
 * it says *why* rather than sitting there disabled and unexplained.
 */






/**
 * The bar above a script in the reader: what this script is, and the one
 * action you are most likely to want next.
 *
 * The button exists here rather than only in the listening pane because the
 * script on screen is the thing being judged — "generate audio from THIS" is
 * only unambiguous while you are looking at it.
 */


/**
 * Wire the toolbar's button to a job pinned to this exact script id.
 *
 * Pinning is the whole point: without it the server re-resolves "the AI script
 * for this chapter", so making a newer translation later would change what a
 * repeat of this action produces, and the audio would no longer be of the text
 * that was reviewed.
 */




/**
 * Wire the reader to the currently playing audio.
 *
 * Sync is only claimed when the text on screen IS the text that was spoken.
 * Reading the English original while Hindi audio plays has no honest mapping,
 * so we say so instead of highlighting the wrong sentence.
 */







let seCheckTimer = null;

/**
 * Custom script editor.
 *
 * The contract the user asked for: whatever is pasted here is used *verbatim*
 * as the TTS input — no re-translation, no cleanup. Devanagari and Hinglish
 * are both valid; the backend detects which and tells us what will be spoken,
 * so there is no guessing.
 */






/**
 * The script id a "regenerate this version" run is pinned to.
 *
 * Cleared whenever the source is changed in the dialog: once the user picks a
 * different source the pin describes a script they are no longer asking for,
 * and keeping it would speak the old text under a new label.
 */


/**
 * Per-chapter setting overrides: { [chapterIdx]: { language, voiceId, ... } }.
 *
 * The rule you asked for, made explicit: the sidebar card owns the DEFAULTS,
 * and the per-chapter dialog owns EXCEPTIONS. Choosing a different voice for
 * chapter 7 must not silently re-point every other chapter, so an override is
 * remembered against that chapter alone and never written back to settings.
 *
 * Deliberately session-scoped rather than persisted: an exception you set
 * once and forgot would otherwise keep applying weeks later, which is exactly
 * the invisible-state problem the shared defaults were meant to remove.
 *
 * Lives on `state` so the chapter list can render an "Override" chip without
 * importing anything from `main.js`; this alias keeps the existing call sites
 * readable.
 */
export const chapterOverrides = state.chapterOverrides;

/** Forget every per-chapter exception — used when the open book changes. */


/**
 * Drop one chapter's exception, putting it back on the book default.
 *
 * Only the session override is removed: the book preset and the global
 * defaults are untouched, so "reset" cannot become an accidental way to lose
 * settings that other chapters also rely on.
 */


/**
 * Push the shared narration settings into the sidebar controls.
 *
 * Called after any other surface changes them, so "change it in one place and
 * it changes everywhere" holds in both directions rather than only when the
 * sidebar happens to be the origin.
 */


/**
 * Effective settings for one chapter: chapter override > book preset > global.
 *
 * The three levels used to be resolved ad hoc at each call site, which is how
 * the batch path and the row button could disagree about what "the settings"
 * were. This is now the only definition.
 */


/**
 * Two settings objects agree only if every field that changes output agrees.
 *
 * `scriptId` is part of the identity, not an afterthought: a job pinned to one
 * exact script is not interchangeable with one that will re-resolve "the AI
 * script for this chapter", even when every other field matches. Merging them
 * would let a batch speak a newer translation than the one that was reviewed.
 */


/**
 * The Convert dialog is the single, uniform entry point for every conversion —
 * first run, re-convert and "new version" all open it. It never starts a job
 * from stale/implicit settings, because the old "new version" button did
 * exactly that and produced audio nobody asked for.
 */


/**
 * Convert one chapter.
 *
 * The button element used to be passed in so its label could be mutated by
 * hand, with a detached dummy button created when the row could not be found.
 * The row is now a pure function of `state.activeGenerations`, so recording
 * the state and re-rendering is both simpler and always correct.
 */


/**
 * Speak a script that already exists, pinned to its exact id.
 *
 * "Generate audio" (as opposed to "translate + generate") means *this* text,
 * not "whatever the AI produces for this chapter next time". The dialog only
 * names a source, so the id is looked up here and the run fails clearly when
 * there is nothing to speak — guessing would mean paying for a translation the
 * user explicitly declined by choosing audio-only.
 */


/**
 * Translate one chapter WITHOUT generating audio.
 *
 * Translation used to be reachable only as a side effect of making audio, so
 * judging the AI's retelling meant paying for TTS on text you might reject.
 * This produces a script row and stops, which is also what makes an honest
 * AI-vs-yours comparison possible.
 */


// ============================================
// CONFIG PANEL
// ============================================

/**
 * The language / voice / style catalog and all provenance badges now live in
 * `src/components/catalog.js`.
 */

/** Populate the model dropdown from the models the saved key can actually use. */




/**
 * Ask how a mixed-settings batch should be run, and return the groups to send.
 *
 * Resolves to `null` when the user backs out, so callers can simply stop.
 * A selection whose chapters agree needs no question at all, and a book that
 * has already answered is not asked again — but the answer is always visible
 * and changeable from this same dialog.
 */


/**
 * Retry one failed chapter.
 *
 * Prefers the server's retry route, because it reproduces the ORIGINAL job's
 * settings — including a text-only action and any pinned script. Starting a
 * fresh conversion instead would quietly apply today's defaults, so a retry of
 * a Hindi job could come back in English, and a retry of a translate-only job
 * would generate audio nobody asked for.
 */
// ---------------------------------------------------------------------------
// Retry / Resume
// ---------------------------------------------------------------------------
export async function retryChapter(chapterIdx) {
  const err = state.chapterErrors[chapterIdx];
  const jobId = typeof err === 'object' ? err.jobId : null;

  delete state.chapterErrors[chapterIdx];
  state.activeGenerations[chapterIdx] = { percent: 0, message: 'Retrying…' };
  renderChapters();

  try {
    if (jobId) {
      const result = await api.retryJob(state.currentBookId, jobId, [chapterIdx]);
      if (!result?.jobId) throw new Error(result?.message || 'The server did not start a retry.');
      show('#section-progress');
      setupProgressTracking(result.jobId, [chapterIdx]);
      showToast(`Retrying Chapter ${chapterIdx + 1} with the same settings.`, 'info');
      return;
    }
    // No job id — the failure happened before one was recorded, or the page
    // has been reloaded since. The chapter's effective settings are the
    // closest honest equivalent.
    delete state.activeGenerations[chapterIdx];
    await startSingleChapterGeneration(chapterIdx, chapterOverrides[chapterIdx] || {});
  } catch (e) {
    delete state.activeGenerations[chapterIdx];
    state.chapterErrors[chapterIdx] = { message: e.message, stage: null, jobId, retryable: true };
    renderChapters();
    showToast('Retry failed: ' + e.message, 'error');
  }
}

/**
 * Newest audio file for each selected chapter, skipping chapters that have
 * none. Used by the bulk Export and Delete actions.
 */
export function selectedNewestAudio() {
  const out = [];
  for (const idx of state.selectedChapters) {
    const ch = state.chapters.find((c) => c.chapterIndex === idx);
    if (!ch) continue;
    const newest = (state.audioFiles || []).find((a) => a.chapterId === ch.id && !a.isMerged);
    if (newest) out.push(newest);
  }
  return out;
}



/**
 * Translate the selected chapters to text only.
 *
 * Shares the grouping logic's intent but is much simpler: a text-only run has
 * no voice and no TTS, so the only setting that can differ per chapter is the
 * language and style. Chapters already in English are dropped rather than
 * spending tokens reproducing text the book already contains.
 */


/**
 * Send one text-only job per settings group.
 *
 * Shared by the batch Translate button and by a uniform batch whose chosen
 * action was "translate text only", so the two paths cannot drift apart in
 * how they report partial failure or mark rows as queued.
 */


// ============================================
// PROGRESS TRACKING
// ============================================


/**
 * Wire the realtime event stream to the UI. Called once, from startup.
 *
 * Handlers are keyed so that even a double init cannot stack them.
 */


/**
 * The queue endpoint is the source of truth for queued work. Socket events
 * wake this up immediately; the short poll also repairs missed events after a
 * reconnect or a tab being suspended by the browser.
 */
export let queueSyncInFlight = false;
export function setQueueSyncInFlight(val) { queueSyncInFlight = val; }


/**
 * Render the Groq quota chip.
 *
 * The old chip polled every 5s and printed a single "x / y TPM" number. That is
 * the least useful framing possible: it never said whether the number was real
 * or assumed, never said what would happen next, and during a throttle it just
 * appended "(Rate limited, waiting...)" with no end in sight. Now the chip is
 * pushed from the server on every meaningful transition and always answers
 * three questions: what is the state, why, and when does it change.
 */


/** Fallback poll — only used if the socket is down. */






/** Restore the selection-bar buttons to their idle state after a job ends. */
export function resetGenerateButton() {
  const btn = $('#sel-generate');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="5 3 19 12 5 21 5 3"/></svg> Create audiobook`;
  }
  const translateBtn = $('#sel-translate');
  if (translateBtn) {
    translateBtn.disabled = false;
    translateBtn.textContent = 'Preview retelling';
  }
  hide('#btn-cancel-all');
}





/**
 * Re-fetch the open chapter and re-render, optionally switching tab. Used when
 * a background job changes what the reader should be showing.
 */








/**
 * Refresh the chapter list once a job finishes so every converted chapter
 * shows its Play button.
 *
 * This used to also build a *second* chapter list into a separate container
 * that was permanently hidden — duplicated rendering work and a duplicate
 * source of truth for something the main list already shows.
 */


// ============================================
// AUDIO PLAYER
// ============================================
/**
 * The listening order: one entry per chapter that has audio, in chapter order,
 * each pointing at that chapter's newest version.
 *
 * `state.audioFiles` is sorted newest-FIRST by creation time, because that is
 * what the version pickers need. Treating it as a playlist — which "next" and
 * "previous" and autoplay all did — therefore walked the book in the order
 * things happened to be converted, and re-converting one chapter silently
 * moved it to the front. Listening order is a property of the book, not of
 * when you pressed Convert.
 */


/** Step through the listening order from whatever is playing now. */


/**
 * Stop and unload the player.
 *
 * Closing a book left its audio playing over the library, with the transport
 * still pointing at tracks that were no longer listed — audible state that
 * contradicts what is on screen.
 */




/**
 * Playback speed.
 *
 * Speed is the control an audiobook listener touches most, and the old
 * five-option dropdown offered neither the slow rungs used for dense text nor
 * anything above 2×. It is now a menu of the full preset ladder plus a custom
 * value, and — the part that matters — the choice is remembered per book,
 * because a rate that suits a brisk narrator rarely suits a slow one.
 */


/**
 * Tells the user whether the current speed is this book's own or the global
 * default, so "Make default" is never a guess about what it will change.
 */


/**
 * Tone control.
 *
 * A peaking EQ around the voice fundamental, not a real pitch shift — it makes
 * a narrator sound deeper or lighter without the artefacts of resampling.
 *
 * The value is now persisted per book (with a global default), because it
 * previously lived only on the Web Audio node: every chapter change rebuilt
 * the graph and silently snapped the tone back to neutral, so the control
 * could not be used for its actual purpose.
 */


/** Re-applies the saved tone when the open book changes. Set by initPitchControl. */
let applyPitchForCurrentBook = () => {};
let currentPitch = () => 1;

/** Re-applies the saved rate when the open book changes. Set by initSpeedControl. */
let applySpeedForCurrentBook = () => {};



/**
 * The player's jump-to-chapter list.
 *
 * Only chapters that actually have audio can be jumped to, so the list is
 * built from `audioFiles` rather than from every chapter in the book — an
 * option that cannot play is worse than no option at all.
 */


/**
 * Grey out the transport buttons at the ends of the book.
 *
 * A control that looks available but does nothing costs the user a click to
 * discover it is the end — the button should say so before it is pressed.
 */


/**
 * Parse a WebVTT string into an array of cue objects.
 */


/**
 * Start a polling loop that syncs subtitles + paragraph highlighting with audio currentTime.
 * Works perfectly with seeking because it checks every frame.
 */
let subtitleAnimFrame = null;






// ============================================
// LOG CONSOLE — see src/components/logConsole.js
// ============================================

// ============================================
// MODAL
// ============================================


export function initModal() {
  function closeModal() {
    hide('#chapter-modal');
    state.readerChapterIdx = null;
    state.currentChapterData = null;
  }
  
  $('#modal-close').addEventListener('click', closeModal);
  $('#btn-reader-prev')?.addEventListener('click', () => {
    if (state.readerChapterIdx !== null) {
      const v = visibleChapters();
      const i = v.findIndex(c => c.chapterIndex === state.readerChapterIdx);
      const syncAudio = $('#reader-sync-nav-toggle')?.checked ?? true;
      if (i > 0) previewChapter(v[i - 1].chapterIndex, 'original', null, syncAudio);
    }
  });
  $('#btn-reader-next')?.addEventListener('click', () => {
    if (state.readerChapterIdx !== null) {
      const v = visibleChapters();
      const i = v.findIndex(c => c.chapterIndex === state.readerChapterIdx);
      const syncAudio = $('#reader-sync-nav-toggle')?.checked ?? true;
      if (i >= 0 && i < v.length - 1) previewChapter(v[i + 1].chapterIndex, 'original', null, syncAudio);
    }
  });
  $('#chapter-modal').addEventListener('click', (e) => {
    if (e.target === $('#chapter-modal')) closeModal();
  });
  $('#versions-modal')?.addEventListener('click', (e) => {
    if (e.target === $('#versions-modal')) hide('#versions-modal');
  });
  $('#versions-modal-close')?.addEventListener('click', () => {
    hide('#versions-modal');
  });
  $('#versions-sort-select')?.addEventListener('change', (e) => {
    if (state.activeVersionsModalChapterIdx !== null) {
      openVersionsModal(state.activeVersionsModalChapterIdx, e.target.value);
    }
  });

  // Quick Convert Modal Listeners
  $('#qc-modal-close')?.addEventListener('click', () => hide('#quick-convert-modal'));
  $('#quick-convert-modal')?.addEventListener('click', (e) => {
    if (e.target === $('#quick-convert-modal')) hide('#quick-convert-modal');
  });
  $('#btn-qc-start')?.addEventListener('click', () => {
    if (state.qcActiveChapterIdx === null) return;
    const idx = state.qcActiveChapterIdx;
    const lang = $('#qc-language').value;
    const voice = $('#qc-voice').value;
    const style = $('#qc-style').value;
    const rawScriptSource = $('#qc-source-group')
      .querySelector('input[name="qc-source"]:checked')?.value || 'ai';
    const isAiExisting = rawScriptSource === 'ai-existing';
    const scriptSource = isAiExisting ? 'ai' : rawScriptSource;
    const action = $('#qc-action-group')
      ?.querySelector('input[name="qc-action"]:checked')?.value || 'both';
    const makeDefault = $('#qc-make-default')?.checked;
    const allowQuick = $('#qc-quick-action')?.checked;

    hide('#quick-convert-modal');

    const ch = state.chapters.find(c => c.chapterIndex === idx);

    const customPrompt = $('#qc-antigravity-prompt')?.value?.trim();

    const options = {
      language: lang,
      voiceId: voice,
      // Style is meaningless unless the AI is actually writing the script.
      translationStyle: scriptSource === 'ai' ? style : undefined,
      scriptSource,
      customPrompt: scriptSource === 'antigravity' ? customPrompt : undefined,
      groqModel: $('#groq-model-select')?.value || '',
    };

    if (isAiExisting && ch && ch.latestAiScriptId) {
      options.scriptId = ch.latestAiScriptId;
    }

    if (makeDefault) {
      // Level 2: promoted to THIS BOOK's default, not the app's. A voice
      // chosen for one book is rarely right for the next, and writing it
      // globally would make every future book inherit this decision.
      setBookPreset(state.currentBookId, options);
      delete chapterOverrides[idx]; // no longer an exception
      syncNarrationControls();
    } else if (!state.qcPinnedScriptId) {
      // The default case: remember this as an exception for THIS chapter only,
      // so pressing Convert on its row again reuses it while every other
      // chapter keeps the shared defaults.
      //
      // Skipped for a pinned regenerate: "make this old version again" is a
      // statement about one past run, not a decision about how this chapter
      // should convert from now on. Recording it would silently re-point every
      // future conversion at the settings of whichever version was regenerated.
      chapterOverrides[idx] = options;
      syncNarrationControls(); // the summary counts overrides
    }

    // Granting "don't ask again" needs settings to fall back on, so it implies
    // saving them as this book's default when nothing else has.
    if (allowQuick) {
      setQuickActionAllowed(state.currentBookId, true);
      if (!makeDefault) setBookPreset(state.currentBookId, options);
      syncNarrationControls();
    }

    renderChapters();

    if (action === 'script') startTranslateOnly(idx, options);
    else if (action === 'audio') {
      // A pin from "regenerate this version" is authoritative — it names the
      // exact script that produced the audio being remade. Without one, fall
      // back to resolving the newest script of the chosen source.
      if (state.qcPinnedScriptId) {
        startSingleChapterGeneration(idx, { ...options, action: 'audio', scriptId: state.qcPinnedScriptId });
      } else {
        startAudioFromExistingScript(idx, options);
      }
    }
    else startSingleChapterGeneration(idx, options);
  });

  $('#btn-build-audiobook')?.addEventListener('click', buildAudiobook);

  // Script Editor Listeners
  const seClose = () => hide('#script-editor-modal');
  $('#se-close')?.addEventListener('click', seClose);
  $('#se-cancel')?.addEventListener('click', seClose);
  $('#script-editor-modal')?.addEventListener('click', (e) => {
    if (e.target === $('#script-editor-modal')) seClose();
  });
  $('#se-text')?.addEventListener('input', () => {
    clearTimeout(seCheckTimer);
    seCheckTimer = setTimeout(runScriptCheck, 400);
  });
  $('#se-copy-ai')?.addEventListener('click', () => {
    const box = $('#se-text');
    box.value = seAiContent;
    runScriptCheck();
  });

  /**
   * Save the editor's contents. Returns true only if it actually saved, so
   * callers can chain "…and then generate" without acting on a failure.
   */
  const seSave = async () => {
    if (state.seActiveChapterIdx === null) return false;
    const content = $('#se-text').value;
    if (!content.trim()) {
      showToast('Paste some text before saving.', 'error');
      return false;
    }
    const language = $('#se-language')?.value || 'hi';
    try {
      await api.saveCustomScript(state.currentBookId, state.seActiveChapterIdx, content, language);
      const ch = state.chapters.find(c => c.chapterIndex === state.seActiveChapterIdx);
      if (ch) ch.hasCustomScript = true;
      return true;
    } catch (err) {
      showToast('Could not save script: ' + err.message, 'error');
      return false;
    }
  };

  // One-click paste. `readText()` is rejected outright by some browsers and
  // requires a permission prompt in others, so the failure path is not an
  // edge case — it tells the user the shortcut that always works rather than
  // leaving a dead button.
  $('#se-paste')?.addEventListener('click', async () => {
    const box = $('#se-text');
    try {
      const text = await navigator.clipboard.readText();
      if (!text?.trim()) {
        showToast('The clipboard is empty.', 'warning');
        return;
      }
      box.value = text;
      box.focus();
      runScriptCheck();
      showToast(`Pasted ${text.length.toLocaleString()} characters.`, 'success');
    } catch {
      box.focus();
      setText('#se-shortcut-hint', 'Press Ctrl+V to paste your script here.');
      showToast('Press Ctrl+V to paste your script here.', 'info');
    }
  });

  $('#se-copy-original')?.addEventListener('click', async () => {
    if (state.seActiveChapterIdx === null) return;
    const btn = $('#se-copy-original');
    const originalText = btn.textContent;
    btn.textContent = 'Copying...';
    try {
      const data = await api.getChapterContent(state.currentBookId, state.seActiveChapterIdx);
      if (data && data.textContent) {
        await navigator.clipboard.writeText(data.textContent);
        btn.textContent = 'Copied!';
        showToast('Original chapter text copied to clipboard.', 'success');
      } else {
        btn.textContent = 'No text';
        showToast('No original text found for this chapter.', 'warning');
      }
    } catch (err) {
      btn.textContent = 'Failed';
      showToast('Failed to copy text: ' + err.message, 'error');
    }
    setTimeout(() => {
      if (btn) btn.textContent = originalText;
    }, 2000);
  });

  $('#se-save')?.addEventListener('click', async () => {
    if (await seSave()) {
      showToast('Script saved. It will be spoken exactly as written.', 'success');
      seClose();
    }
  });

  // The whole point of pasting a script is to hear it. Doing it in one action
  // removes the save → close → find the row → Convert → pick "My script"
  // detour that stood between the paste and the audio.
  $('#se-save-generate')?.addEventListener('click', async () => {
    const idx = state.seActiveChapterIdx;
    if (!(await seSave())) return;
    const language = $('#se-language')?.value || 'hi';
    const voiceId = $('#se-voice')?.value || undefined;
    showToast('Script saved — generating audio from it.', 'success');
    seClose();
    // scriptSource is pinned to 'custom' so this cannot silently run the AI
    // over the text the user just wrote by hand.
    startSingleChapterGeneration(idx, {
      ...(chapterOverrides[idx] || {}),
      scriptSource: 'custom',
      language,
      voiceId,
      action: 'both',
    });
  });

  // Ctrl/Cmd+S saves without leaving the keyboard — the expected gesture in
  // anything that behaves like an editor.
  $('#se-text')?.addEventListener('keydown', async (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (await seSave()) showToast('Script saved.', 'success');
    }
  });

  $('#se-delete')?.addEventListener('click', async () => {
    if (state.seActiveChapterIdx === null) return;
    if (!confirm('Delete your saved script for this chapter? Existing audio is kept.')) return;
    try {
      const data = await api.getChapterContent(state.currentBookId, state.seActiveChapterIdx);
      const custom = (data.scripts || []).find(s => s.source === 'custom');
      if (custom) await api.deleteScript(state.currentBookId, custom.id);
      const ch = state.chapters.find(c => c.chapterIndex === state.seActiveChapterIdx);
      if (ch) ch.hasCustomScript = false;
      $('#se-text').value = '';
      showToast('Script deleted.', 'info');
      seClose();
    } catch (err) {
      showToast('Could not delete script: ' + err.message, 'error');
    }
  });

  // Escape is handled once, globally, in initShell(). It closes only the
  // top-most overlay - closing every modal at once meant dismissing the
  // convert dialog also threw away the reader underneath it.

  // Reader tabs, settings, and inline script editing are managed authoritatively by readerUi.js


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
    const manager = $('#reader-copy-prompt-manager');
    if (manager) {
      manager.style.display = e.target.checked ? 'block' : 'none';
    }
  });

  $('#btn-reader-read-aloud')?.addEventListener('click', toggleReadAloud);

  // Font Size Controls (+/-)
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

  // Font Family Selector
  $('#reader-font-select')?.addEventListener('change', (e) => {
    state.readerFontFamily = e.target.value;
    applyReaderSettings();
  });

  // Line Height Selector
  $('#reader-line-height-select')?.addEventListener('change', (e) => {
    state.readerLineHeight = e.target.value;
    applyReaderSettings();
  });

  // Theme Selector
  $('#reader-theme-select')?.addEventListener('change', (e) => {
    state.readerTheme = e.target.value;
    applyReaderSettings();
  });

  // Fullscreen Toggle
  $('#btn-reader-fullscreen')?.addEventListener('click', () => {
    state.readerFullscreen = !state.readerFullscreen;
    applyReaderSettings();
  });

  // Follow mode — off by default so scrolling back to re-read is never
  // interrupted. Turning it on immediately re-centres the current line.
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
}

// ============================================
// LIBRARY
// ============================================


/**
 * Draw the library grid from `state.libraryBooks`, honouring the search box
 * and sort order.
 *
 * Separated from loading so typing in the search field re-filters instantly
 * instead of re-fetching the whole shelf on every keystroke.
 */


export async function loadBookFromLibrary(bookId) {
  try {
    const data = await api.getBook(bookId);
    // Opening a different book must not inherit the previous book's per-chapter
    // state: job ids, in-flight rows, errors and setting exceptions are all
    // keyed by chapter index, which means nothing across books.
    const switchingBooks = state.currentBookId && state.currentBookId !== bookId;
    if (switchingBooks) {
      socketService.unsubscribe(state.currentBookId);
      stopPlayback();
    }
    state.currentBookId = bookId;
    state.currentBookMeta = data.book;
    state.chapters = data.chapters.map(ch => ({
      ...ch, chapterIndex: ch.chapterIndex, title: ch.title, wordCount: ch.wordCount
    }));
    state.selectedChapters = new Set(); // Unchecked by default to prevent accidental mass conversion
    state.chapterErrors = {};
    state.activeGenerations = {};
    state.chapterJobs = {};
    clearChapterOverrides();

    switchView('create');

    // Opening a book from the library is not an upload, so the upload UI is
    // reset rather than made to display a fake "100% — loaded from library"
    // progress bar. The header states which book is open.
    resetUpload();

    // Load existing audio before rendering so rows know which are ready.
    state.audioFiles = (data.audioFiles || []).filter(a => !a.isMerged);

    resetChapterPage();
    renderChapters();
    renderBookOverview();
    refreshAudiobookPanel();
    setHeaderBook(data.book.title, state.chapters.length);
    // Speed and tone are remembered per book, so switching books must
    // re-apply both — a 2× rate carried over from a fast narrator is jarring
    // on a slow one, and a deep tone set for one voice suits the next badly.
    applySpeedForCurrentBook();
    applyPitchForCurrentBook();
    updateSpeedDefaultNote();
    applyWorkspaceMode();
    socketService.subscribe(bookId);
    syncQueueSnapshot();
    loadPersistedLogs(bookId);
    checkInterruptedJobs(bookId);
  } catch (err) { showToast(err.message, 'error'); }
}

/**
 * Surface jobs that were cut short by a server restart.
 *
 * The backend already marks these `interrupted` on boot, but nothing showed
 * them, so a conversion that died half-way simply looked finished — the rows
 * went quiet and the missing chapters were indistinguishable from ones never
 * selected. Recovery is offered rather than performed: silently resuming would
 * spend API budget on work the user may no longer want.
 */


/** Resume the unfinished chapters of an interrupted job, reusing its settings. */


// ============================================
// TOASTS — see src/components/toast.js
// ============================================

// ============================================
// UTILS — see src/utils/html.js
// ============================================
// UTILS
// ============================================
