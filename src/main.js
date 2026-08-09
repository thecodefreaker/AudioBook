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
import { initChapterList, renderChapters, updateChapterRowProgress, resetChapterPage } from './components/chapterList.js';
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
  initUpload();
  initNavigation();
  initChapterControls();
  initConfigPanel();
  initPlayer();
  initLogConsole();
  initModal();
  initListenPane();
  initHomeView();
  initShell();
  // Render once up front so the workspace shows its empty state instead of a
  // blank area until a book is opened.
  renderChapters();
  // The landing view depends on whether there is anything to come back to, so
  // it can only be decided once the library has loaded.
  loadLibrary().then(decideLandingView);
});

/**
 * Choose the view to land on.
 *
 * Three states, not two: a first-time user needs the pitch, a returning user
 * needs their shelf, and someone who opted into auto-open needs their book.
 * Showing the hero to all three was the bug.
 */
async function decideLandingView() {
  const books = state.libraryBooks || [];
  if (!books.length) {
    switchView('create');   // hero — the only case it is right for
    return;
  }

  if (getSetting('autoOpenLast')) {
    const recent = [...books].sort(
      (a, b) => new Date(b.lastOpenedAt || b.createdAt || 0) - new Date(a.lastOpenedAt || a.createdAt || 0)
    )[0];
    if (recent) {
      await loadBookFromLibrary(recent.id);
      return;
    }
  }
  switchView('home');
}

/** Home's actions all route through existing app functions — no second path. */
function initHomeView() {
  initHome({
    onUpload: () => $('#file-input')?.click(),
    onOpen: (id) => loadBookFromLibrary(id),
    onResume: async (id) => {
      await loadBookFromLibrary(id);
      // "Resume" promises to put you back where you were, so it opens the
      // chapter rather than just the book.
      const idx = getLastRead(id);
      if (idx != null) previewChapter(idx);
    },
    onSeeAll: () => switchView('library'),
  });
}

/**
 * Shell-level controls: the mobile sidebar and "New book".
 */
function initShell() {
  const sidebar = $('#shell-sidebar');
  const toggle = $('#sidebar-toggle');
  const scrim = $('#sidebar-scrim');

  const setSidebar = (open) => {
    sidebar?.classList.toggle('open', open);
    toggle?.setAttribute('aria-expanded', String(open));
    if (scrim) {
      scrim.hidden = false;
      scrim.classList.toggle('show', open);
    }
  };

  toggle?.addEventListener('click', () => setSidebar(!sidebar.classList.contains('open')));
  scrim?.addEventListener('click', () => setSidebar(false));

  // Escape closes whatever is on top, in the order a user expects.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = $$('.modal-overlay:not(.hidden)');
    if (open.length) {
      const top = open[open.length - 1];
      // Prefer the dialog's own close button so its cleanup (clearing reader
      // state, resetting editors) runs. Hiding the element directly would
      // leave that state stale behind a closed dialog.
      const closer = top.querySelector('.modal-close');
      if (closer) closer.click(); else addClass(top, 'hidden');
      return;
    }
    if (!$('#console-panel')?.classList.contains('hidden')) {
      $('#console-close')?.click();
      return;
    }
    if (sidebar?.classList.contains('open')) setSidebar(false);
  });

  // --- Modal focus management -------------------------------------------
  // Focus must enter the dialog when it opens and return to the trigger when
  // it closes, otherwise keyboard users are left tabbing the page behind an
  // overlay they cannot see.
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const restoreFocusTo = new WeakMap();

  $$('.modal-overlay').forEach((overlay) => {
    new MutationObserver(() => {
      const isOpen = !overlay.classList.contains('hidden');
      if (isOpen) {
        restoreFocusTo.set(overlay, document.activeElement);
        const first = overlay.querySelector(FOCUSABLE);
        // Defer so the element is laid out (and focusable) before we ask.
        requestAnimationFrame(() => first?.focus());
      } else {
        const prev = restoreFocusTo.get(overlay);
        if (prev && document.contains(prev)) prev.focus();
        restoreFocusTo.delete(overlay);
      }
    }).observe(overlay, { attributes: true, attributeFilter: ['class'] });

    // Trap Tab inside the top-most dialog.
    overlay.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const items = [...overlay.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });
  });

  // The single upload entry point. The hero button and the library's empty
  // state both call the same handler, so three surfaces cannot drift apart.
  //
  // It opens the file picker directly: an intermediate modal whose only
  // content is a button that opens the *real* picker is a wasted click.
  $('#btn-new-book')?.addEventListener('click', () => $('#file-input')?.click());
  $('#welcome-upload')?.addEventListener('click', () => $('#file-input')?.click());
  $('#library-upload')?.addEventListener('click', () => $('#file-input')?.click());
  $('#welcome-library')?.addEventListener('click', () => switchView('library'));

  /**
   * Close the open book without deleting anything.
   *
   * Separate from "New book", which used to do both — so wanting to upload a
   * second book silently evicted the one you were reading.
   */
  $('#btn-close-book')?.addEventListener('click', () => {
    // Every per-book map has to be cleared together. `chapterJobs` and the
    // per-chapter setting overrides were left behind, so chapter 3 of the next
    // book inherited the previous book's job id (making Stop target a job that
    // no longer existed) and its settings exception.
    state.currentBookId = null;
    state.currentBookMeta = null;
    state.chapters = [];
    state.audioFiles = [];
    state.selectedChapters = new Set();
    state.chapterErrors = {};
    state.activeGenerations = {};
    state.chapterJobs = {};
    clearChapterOverrides();

    // Audio from a book that is no longer open must not keep playing.
    stopPlayback();

    resetUpload();
    setHeaderBook(null);
    hide('#section-progress');
    renderChapters();
    renderBookOverview();
    // Somewhere to land: the shelf if there is one, the hero if there is not.
    switchView((state.libraryBooks || []).length ? 'home' : 'create');
  });
}

// ============================================
// NAVIGATION
// ============================================
function initNavigation() {
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      switchView(view);
    });
  });

  // Filtering re-renders from state already in memory rather than re-fetching,
  // so typing feels instant even with a large shelf.
  $('#library-search')?.addEventListener('input', renderLibrary);
  $('#library-sort')?.addEventListener('change', renderLibrary);
}

function switchView(view) {
  state.currentView = view;
  // The tabs are a real tablist, so selection is expressed with aria-selected
  // (which the CSS styles from) rather than a class screen readers cannot see.
  $$('.nav-btn').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === view)));
  $$('.view').forEach(v => removeClass(v, 'active'));
  $(`#view-${view}`)?.classList.add('active');
  if (view === 'library') loadLibrary();
  if (view === 'home') renderHome(state.libraryBooks || [], state.activeBookJobs || {});
  applyWorkspaceMode();
}

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
function applyWorkspaceMode() {
  const hasBook = !!state.currentBookId && (state.chapters || []).length > 0;
  const app = $('#app');
  if (app) app.classList.toggle('has-book', hasBook);

  // The welcome hero replaces the chapter workspace until there is a book to
  // show, so a new user is never met with empty toolbars and a blank list.
  const welcome = $('#welcome');
  const workspace = $('#workspace');
  if (welcome) welcome.classList.toggle('hidden', hasBook);
  if (workspace) workspace.classList.toggle('hidden', !hasBook);

  // The sidebar describes the book you are working on, so it belongs to the
  // workspace and nowhere else. Keying it on "is a book open" alone was the
  // bug behind the empty left rail: with a book loaded, Home and Library still
  // rendered a 348px column of chapter/voice controls beside a shelf that has
  // nothing to do with them — half the screen spent on chrome for a view you
  // are not looking at.
  const sidebar = $('#shell-sidebar');
  const wantsSidebar = hasBook && state.currentView === 'create';
  if (sidebar) sidebar.classList.toggle('is-empty', !wantsSidebar);

  // "Home" only makes sense once there is a shelf to come home to.
  const homeTab = $('#nav-home');
  if (homeTab) homeTab.hidden = !(state.libraryBooks || []).length;
}

// ============================================
// UPLOAD
// ============================================
function initUpload() {
  const input = $('#file-input');

  input.addEventListener('change', () => {
    if (input.files[0]) handleUpload(input.files[0]);
    // Reset, or choosing the same file twice in a row fires no change event
    // and the upload silently does nothing.
    input.value = '';
  });

  // Dropping anywhere is far more forgiving than aiming at a 200px target, and
  // it is what makes a dedicated drop zone unnecessary in the first place.
  const body = document.body;
  body.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    addClass(body, 'file-hover');
  });
  body.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) removeClass(body, 'file-hover');
  });
  body.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    removeClass(body, 'file-hover');
    const file = e.dataTransfer.files[0];
    if (!file.name.toLowerCase().endsWith('.epub')) {
      showToast('Please drop a valid .epub file', 'error');
      return;
    }
    // Dropping a book while one is open would silently discard the current
    // workspace, so it is confirmed rather than assumed.
    if (state.currentBookId && !confirm('Open this EPUB instead of the current book?')) return;
    handleUpload(file);
  });
}

/**
 * Narrated upload stages.
 *
 * Steps before the current one are marked done, the current one is active.
 * Naming the stage the app is in ("Extracting chapters") is the difference
 * between a user waiting patiently and a user assuming it has hung.
 */
const UPLOAD_STEPS = ['upload', 'extract', 'build', 'ready'];
function setUploadStep(step) {
  const at = UPLOAD_STEPS.indexOf(step);
  if (at < 0) return;
  $$('#upload-steps .upload-step').forEach((el) => {
    const i = UPLOAD_STEPS.indexOf(el.dataset.step);
    el.classList.toggle('is-done', i < at);
    el.classList.toggle('is-active', i === at);
  });
}

async function handleUpload(file) {
  // Upload always happens on the hero, because that is where the progress
  // narration renders and it is the one screen that is never mid-task.
  switchView('create');
  hide('#welcome-actions');
  show('#upload-progress');
  setText('#upload-file-name', file.name);
  setText('#upload-status', 'Uploading…');
  removeClass('#upload-progress-bar', 'success');
  $('#upload-progress-bar').style.width = '0%';
  setUploadStep('upload');

  try {
    const result = await api.uploadBook(file, pct => {
      $('#upload-progress-bar').style.width = pct + '%';
      if (pct === 100) {
        setText('#upload-status', 'Reading EPUB…');
        setUploadStep('extract');
      }
    });

    state.currentBookId = result.bookId;
    socketService.subscribe(result.bookId);
    setText('#upload-status', 'Extracting chapters…');
    setUploadStep('extract');

    // Listen for parse events
    socketService.on('book:parsing', onBookParsing);
    socketService.on('book:parsed', onBookParsed);
    socketService.on('book:error', onBookError);

    showToast('EPUB uploaded successfully!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
    resetUpload();
  }
}

function onBookParsing(data) {
  if (data.bookId !== state.currentBookId) return;
  setText('#upload-status', data.message);
  $('#upload-progress-bar').style.width = data.percent + '%';
  // The parser reports 'complete' once the text is out; the workspace still
  // has to be built from it, so that is a separate visible stage.
  setUploadStep(data.phase === 'complete' ? 'build' : 'extract');
}

function onBookParsed(data) {
  if (data.bookId !== state.currentBookId) return;
  setUploadStep('build');
  setText('#upload-status', `✅ ${data.chapters.length} chapters found!`);
  $('#upload-progress-bar').style.width = '100%';
  addClass('#upload-progress-bar', 'success');

  state.chapters = data.chapters;
  state.selectedChapters = new Set(); // Unchecked by default to prevent accidental mass conversion
  state.currentBookMeta = data.metadata || null;

  renderChapters();
  renderBookOverview();
  setHeaderBook(data.metadata?.title, data.chapters.length);
  setText('#player-book-title', data.metadata.title);
  setUploadStep('ready');
  // The book now exists, so the shell swaps from welcome to workspace.
  applyWorkspaceMode();
}

/**
 * The book overview — cover, title and the numbers that describe the book.
 *
 * Every figure here is derived from data we already hold, so it stays true
 * without extra requests. Estimated length uses the same 150wpm assumption the
 * server's chunker uses, so the two never disagree on screen.
 */
function renderBookOverview() {
  const panel = $('#book-overview');
  if (!panel) return;

  const chapters = state.chapters || [];
  if (!state.currentBookId || !chapters.length) { addClass(panel, 'hidden'); return; }
  removeClass(panel, 'hidden');

  const meta = state.currentBookMeta || {};
  setText('#book-overview-title', meta.title || 'Untitled book');
  setText('#book-overview-author', meta.author || 'Unknown author');

  const cover = $('#book-overview-cover');
  if (cover) {
    const initial = (meta.title || '?').trim().charAt(0).toUpperCase();
    cover.innerHTML = meta.coverImage
      ? `<img src="${escapeHtml(meta.coverImage)}" alt="" />`
      : `<span class="library-cover-fallback" aria-hidden="true">${escapeHtml(initial)}</span>`;
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
  $('#book-ring')?.setAttribute('aria-label', `${pct}% of chapters converted`);

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

/**
 * The reader's listening pane.
 *
 * Deliberately has no <audio> of its own: it drives the docked player. Two
 * audio elements would mean two things playing at once and a sync engine that
 * cannot tell which is authoritative.
 */
function renderListenPane() {
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
  const hasOverride = !!chapterOverrides[state.readerChapterIdx];
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
        ? 'You have a saved script for this chapter — "Generate audio" will speak it.'
        : hasAi
          ? 'An AI script is ready. Open the AI script tab to generate audio from it.'
          : 'Nothing has been translated yet. Start with "Translate text only" to review it first.';
    }

    const genBtn = $('#listen-generate');
    if (genBtn) genBtn.textContent = hasAi || hasCustom ? 'Generate audio' : 'Translate + generate audio';
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

  if (versionActions) versionActions.hidden = false;

  // Already has audio, so the audio action is a re-run rather than a first run.
  const genBtn = $('#listen-generate');
  if (genBtn) genBtn.textContent = 'Regenerate audio';
}

function initListenPane() {
  $('#listen-play')?.addEventListener('click', (e) => {
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
    if (tab !== 'edit') {
      state.readerViewMode = tab;
      renderReaderBody();
    }
    renderListenPane();
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
    if (!Number.isNaN(idx)) startSingleChapterGeneration(idx, chapterOverrides[idx] || {});
  });

  $('#listen-settings-edit')?.addEventListener('click', () => {
    const idx = paneChapter();
    if (!Number.isNaN(idx)) openQuickConvertModal(idx);
  });

  // On a narrow window the panes stack, and the listening pane collapses so
  // the text still gets the full height.
  $('#btn-listen-collapse')?.addEventListener('click', (e) => {
    const pane = $('#listen-pane');
    const collapsed = pane.classList.toggle('collapsed');
    e.currentTarget.setAttribute('aria-expanded', String(!collapsed));
    e.currentTarget.textContent = collapsed ? '⟨' : '⟩';
  });
}

/**
 * The open book is the context for every other region, so it is shown in the
 * header rather than in a panel that can scroll out of view. Passing no title
 * clears it, which is what "New book" needs.
 */
function setHeaderBook(title, chapterCount) {
  const wrap = $('#header-book');
  if (!wrap) return;
  if (!title) { addClass(wrap, 'hidden'); return; }
  setText('#header-book-title', title);
  setText('#header-book-chapters', `${chapterCount} chapters`);
  removeClass(wrap, 'hidden');
}

function onBookError(data) {
  if (data.bookId !== state.currentBookId) return;
  showToast(`Parsing failed: ${data.error}`, 'error');
  resetUpload();
}

function resetUpload() {
  show('#welcome-actions');
  hide('#upload-progress');
  const input = $('#file-input');
  if (input) input.value = '';
}

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
function initChapterControls() {
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
}

/**
 * Delete one audio version. `audioIndex` is whichever version the row's picker
 * is showing, so what gets deleted is always what the user is looking at —
 * previously the row deleted the newest version regardless of the choice.
 */
async function deleteAudioVersion(audioIndex) {
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

/**
 * Stop ONE chapter.
 *
 * The row's Stop button used to call cancelAllJobs(), so stopping a single
 * chapter silently killed every other conversion for the book — which is why
 * "stop" appeared not to work: the chapter you clicked kept going to the end
 * of its current step while everything else vanished.
 */
async function cancelChapterConversion(chapterIdx) {
  const jobId = state.chapterJobs[chapterIdx];
  if (!state.currentBookId || !jobId) {
    // No job recorded (e.g. after a reload) — fall back to the book-wide stop
    // rather than doing nothing, but say so plainly.
    return cancelAllJobs();
  }
  try {
    await api.cancelChapter(state.currentBookId, jobId, chapterIdx);
    // The backend finishes the step in flight before it stops, so the row must
    // say that rather than appearing frozen on the old percentage.
    if (state.activeGenerations[chapterIdx]) {
      state.activeGenerations[chapterIdx].message = 'Stopping…';
      renderChapters();
    }
    showToast(`Chapter ${chapterIdx + 1} will stop after the current step.`, 'info');
  } catch (err) {
    showToast('Stop failed: ' + err.message, 'error');
  }
}

async function cancelAllJobs() {
  if (!state.currentBookId) return;
  if (!confirm('Cancel all running conversions? Chapters already completed will be kept.')) return;
  try {
    const result = await api.cancelJobs(state.currentBookId);
    showToast(result.message, 'info');
  } catch (err) {
    showToast('Cancel failed: ' + err.message, 'error');
  }
}


function openVersionsModal(chapterIndex, sortOrder = 'desc') {
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
          const langBadge = isHi ? `<span style="background:rgba(168,85,247,0.15); color:var(--accent-primary); border:1px solid rgba(168,85,247,0.3); padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600;">🌐 Hinglish</span>`
                                 : `<span style="background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.3); padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600;">🌐 English</span>`;
          const vName = a.voiceId ? a.voiceId.split('-').slice(-1)[0].replace('Neural', '') : 'Voice';
          let sTag = '';
          if (isHi || a.translationStyle === 'custom') {
            sTag = ` (${styleName(a.translationStyle)}${a.translationStyle === 'custom' ? ' ✍️' : ''})`;
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
                  <span style="font-size: 11px; color: var(--text-secondary);">🎤 ${vName}${sTag}</span>
                  ${a.model ? `<span style="font-size: 10px; color: var(--text-tertiary); background: var(--bg-elevated); padding: 1px 6px; border-radius: 4px;">🤖 ${a.model}</span>` : ''}
                </div>
                <div style="font-size: 11px; color: var(--text-tertiary); display: flex; gap: 12px; flex-wrap: wrap;">
                  <span>📅 Converted: <strong>${timeFormatted}</strong></span>
                  <span>⏱️ Duration: <strong>${formatTime(a.durationSeconds)}</strong></span>
                  <span>💾 Size: <strong>${formatSize(a.fileSizeBytes)}</strong></span>
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
                  🗑️ Delete
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

/**
 * Single source of truth for the book's chapter audio.
 *
 * This was previously inlined in five places, two of which forgot to filter
 * out the merged whole-book file — so it could appear as if it were a chapter.
 */
async function loadAudioFilesForBook() {
  if (!state.currentBookId) return [];
  const data = await api.getAudioFiles(state.currentBookId);
  state.audioFiles = (data.audioFiles || []).filter((a) => !a.isMerged);
  return state.audioFiles;
}

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
async function refreshAudiobookPanel() {
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

async function buildAudiobook() {
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

async function previewChapter(index, initialMode = null) {
  try {
    const data = await api.getChapterContent(state.currentBookId, index);
    state.readerChapterIdx = index;
    state.currentChapterData = data;
    // A version id belongs to the chapter it was chosen in, so opening a
    // different chapter must not leave the pane pointing at the old one.
    state.listenVersionId = null;

    // Remember where the user got to, per book, so returning to it can offer
    // to resume instead of starting from chapter one every time.
    if (state.currentBookId) {
      setLastRead(state.currentBookId, index);
      renderBookOverview();
    }
    
    // Auto-select view mode if not specified
    if (initialMode) {
      state.readerViewMode = initialMode;
    } else {
      state.readerViewMode = (data.aiContent && data.aiContent.trim()) ? 'ai' : 'original';
    }

    setText('#modal-chapter-title', data.title);
    
    // Estimate reading time (~200 words/min)
    const readTimeMin = Math.max(1, Math.round(data.wordCount / 200));
    setText('#modal-chapter-meta', `${formatNumber(data.wordCount)} words · ${formatNumber(data.charCount)} characters · ~${readTimeMin} min read`);
    
    renderReaderBody();
    applyReaderSettings();
    renderListenPane();
    show('#chapter-modal');
  } catch (err) {
    showToast('Failed to load chapter: ' + err.message, 'error');
  }
}

/**
 * The bar above a script in the reader: what this script is, and the one
 * action you are most likely to want next.
 *
 * The button exists here rather than only in the listening pane because the
 * script on screen is the thing being judged — "generate audio from THIS" is
 * only unambiguous while you are looking at it.
 */
function renderScriptToolbar(script, whatItIs) {
  if (!script) return '';
  const when = script.createdAt ? formatDateTime(script.createdAt) : '';
  const bits = [languageName(script.language), script.style ? styleName(script.style) : '', when]
    .filter(Boolean).join(' · ');

  return `
    <div class="script-toolbar">
      <div class="script-toolbar-meta">
        <strong>${script.source === 'custom' ? 'My script' : 'AI script'}</strong>
        ${bits ? `<span>${escapeHtml(bits)}</span>` : ''}
      </div>
      <button class="btn btn-primary btn-sm script-speak-btn" data-script-id="${escapeHtml(script.id)}">
        🔊 Generate audio from this script
      </button>
      <div class="script-toolbar-note">Speaks ${escapeHtml(whatItIs)} exactly — the AI will not run again.</div>
    </div>`;
}

/**
 * Wire the toolbar's button to a job pinned to this exact script id.
 *
 * Pinning is the whole point: without it the server re-resolves "the AI script
 * for this chapter", so making a newer translation later would change what a
 * repeat of this action produces, and the audio would no longer be of the text
 * that was reviewed.
 */
function attachScriptToolbar(body, chapterIdx, script) {
  if (!script) return;
  body.querySelector('.script-speak-btn')?.addEventListener('click', () => {
    startSingleChapterGeneration(chapterIdx, {
      ...(chapterOverrides[chapterIdx] || {}),
      action: 'audio',
      scriptId: script.id,
      scriptSource: script.source === 'custom' ? 'custom' : 'ai',
    });
  });
}

function renderReaderBody() {
  const data = state.currentChapterData;
  if (!data) return;

  const body = $('#modal-chapter-body');
  const btnOrig = $('#reader-tab-original');
  const btnAi = $('#reader-tab-ai');
  const btnEdit = $('#reader-tab-edit');

  // Selection is expressed with aria-selected, which the CSS styles from, so
  // the state is announced to screen readers instead of being a colour only
  // sighted users can perceive.
  const modes = { original: btnOrig, ai: btnAi, edit: btnEdit };
  for (const [mode, btn] of Object.entries(modes)) {
    btn?.setAttribute('aria-selected', String(state.readerViewMode === mode));
  }

  if (state.readerViewMode === 'edit') {
    // The Edit tab opens the script editor directly (see the tab handler), so
    // reaching this branch means the editor was dismissed. Fall back to the
    // original rather than rendering an empty pane.
    state.readerViewMode = 'original';
    renderReaderBody();
    return;
  }

  if (state.readerViewMode === 'ai') {
    // Read `aiContent`, never the blended `translatedContent`: the old field
    // preferred the user's own script, so this tab could show hand-written
    // text under the heading "AI script".
    const aiText = data.aiContent || '';
    if (aiText.trim()) {
      body.innerHTML = renderScriptToolbar(data.aiScript, 'the AI retelling above')
        + renderSentences(aiText, { escape: escapeHtml });
      attachScriptToolbar(body, data.chapterIndex, data.aiScript);
    } else {
      // The natural home for text-only translation: you are looking at the
      // empty AI tab precisely because you want it filled.
      body.innerHTML = `
        <div class="empty">
          <div class="empty-icon">🌐</div>
          <div class="empty-title">No AI script yet</div>
          <p class="empty-text">
            Translate this chapter to read the AI's retelling. This produces
            <strong>text only</strong> — no audio is generated, so you can judge
            it first and generate audio afterwards if you like it.
          </p>
          <div class="row">
            <button class="btn btn-secondary open-edit-script-btn">Paste my script</button>
            <button class="btn btn-primary reader-translate-btn" data-chapter-index="${data.chapterIndex}">
              Translate text only
            </button>
          </div>
        </div>
      `;

      body.querySelector('.open-edit-script-btn')?.addEventListener('click', () => {
        openScriptEditor(data.chapterIndex);
      });

      body.querySelector('.reader-translate-btn')?.addEventListener('click', () => {
        startTranslateOnly(data.chapterIndex);
      });
      return;
    }
  } else {
    const paragraphs = (data.textContent || '');
    body.innerHTML = renderSentences(paragraphs, { escape: escapeHtml });
  }

  // Sentence-level click-to-seek and highlighting, driven by the real
  // alignment map rather than a proportional guess.
  attachReaderSync();
}

/**
 * Wire the reader to the currently playing audio.
 *
 * Sync is only claimed when the text on screen IS the text that was spoken.
 * Reading the English original while Hindi audio plays has no honest mapping,
 * so we say so instead of highlighting the wrong sentence.
 */
function attachReaderSync() {
  const body = $('#modal-chapter-body');
  const audio = $('#audio-element');
  if (!body || !audio) return;

  const playing = state.audioFiles?.[state.currentAudioIndex];
  const sameChapter = playing && playing.chapterIndex === state.readerChapterIdx;

  // Which text is on screen, and is it what the voice actually read?
  // The audio row knows its own `scriptSource`, so this compares the tab to the
  // script that was actually spoken instead of inferring it from language
  // alone — which mis-fired whenever a custom script was in play.
  const viewingSpoken =
    state.readerViewMode === 'ai' ? playing?.scriptSource === 'ai'
    : state.readerViewMode === 'original' ? (playing?.scriptSource === 'original' || playing?.language === 'en')
    : false;

  const textMatchesAudio = !!(sameChapter && viewingSpoken);

  if (!readerSync) {
    readerSync = new ReaderSync({ audio, container: body });
  }
  readerSync.container = body;

  readerSync.load(state.currentAlignment, textMatchesAudio);
  updateSyncStatusUi();

  if (readerSync.syncable) readerSync.start();

  // Click (or Enter/Space) a sentence to jump the audio there.
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

function handleSentenceActivate(index) {
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

function updateSyncStatusUi() {
  const el = $('#reader-sync-status');
  if (!el || !readerSync) return;
  el.textContent = readerSync.statusText;
  el.className = `reader-sync-status ${readerSync.syncable ? (readerSync.approximate ? 'approx' : 'ok') : 'off'}`;

  const followBtn = $('#reader-follow-toggle');
  if (followBtn) followBtn.disabled = !readerSync.syncable;
}

let seActiveChapterIdx = null;
let seCheckTimer = null;

/**
 * Custom script editor.
 *
 * The contract the user asked for: whatever is pasted here is used *verbatim*
 * as the TTS input — no re-translation, no cleanup. Devanagari and Hinglish
 * are both valid; the backend detects which and tells us what will be spoken,
 * so there is no guessing.
 */
async function openScriptEditor(chapterIdx) {
  seActiveChapterIdx = chapterIdx;
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
  show('#script-editor-modal');
  // Opening this means intending to type or paste, so the caret starts here.
  box.focus();

  try {
    const data = await api.getChapterContent(state.currentBookId, chapterIdx);
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

async function runScriptCheck() {
  const text = $('#se-text').value;
  const el = $('#se-status');
  if (!text.trim()) {
    el.className = 'se-status';
    el.textContent = 'Empty — paste text to enable "My saved script" in the Convert dialog.';
    return;
  }
  try {
    const r = await api.checkScript(state.currentBookId, text, $('#qc-language')?.value || 'hi');
    el.className = `se-status ${r.ok ? 'ok' : (r.severity === 'error' ? 'err' : 'warn')}`;
    const kind = r.detected === 'devanagari' ? 'Hindi (देवनागरी)'
      : r.detected === 'latin' ? 'Hinglish (English letters)' : 'Mixed script';
    el.textContent = `${kind} · ${r.wordCount} words · ${r.charCount} chars` + (r.note ? ` — ${r.note}` : '');
  } catch (err) {
    el.className = 'se-status err';
    el.textContent = `Check failed: ${err.message}`;
  }
}

let qcActiveChapterIdx = null;

/**
 * The script id a "regenerate this version" run is pinned to.
 *
 * Cleared whenever the source is changed in the dialog: once the user picks a
 * different source the pin describes a script they are no longer asking for,
 * and keeping it would speak the old text under a new label.
 */
let qcPinnedScriptId = null;

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
const chapterOverrides = state.chapterOverrides;

/** Forget every per-chapter exception — used when the open book changes. */
function clearChapterOverrides() {
  for (const key of Object.keys(chapterOverrides)) delete chapterOverrides[key];
}

/**
 * Drop one chapter's exception, putting it back on the book default.
 *
 * Only the session override is removed: the book preset and the global
 * defaults are untouched, so "reset" cannot become an accidental way to lose
 * settings that other chapters also rely on.
 */
function resetChapterOverride(chapterIdx) {
  if (!chapterOverrides[chapterIdx]) return;
  delete chapterOverrides[chapterIdx];
  // The override count in the summary, the row chip and the batch grouping are
  // all derived from this map, so they must all be recomputed together.
  syncNarrationControls();
  renderChapters();
  if (state.readerChapterIdx === chapterIdx) renderListenPane();
  showToast(`Chapter ${chapterIdx + 1} now uses this book's default settings.`, 'success');
}

/**
 * Push the shared narration settings into the sidebar controls.
 *
 * Called after any other surface changes them, so "change it in one place and
 * it changes everywhere" holds in both directions rather than only when the
 * sidebar happens to be the origin.
 */
function syncNarrationControls() {
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
  const overrideCount = Object.keys(chapterOverrides).length;
  const summary = parts.length ? parts.join(' · ') : 'Choose a voice';
  setText('#preset-summary', overrideCount
    ? `${summary} · ${overrideCount} chapter${overrideCount === 1 ? '' : 's'} overridden`
    : summary);
}

/**
 * Effective settings for one chapter: chapter override > book preset > global.
 *
 * The three levels used to be resolved ad hoc at each call site, which is how
 * the batch path and the row button could disagree about what "the settings"
 * were. This is now the only definition.
 */
function effectiveSettingsFor(chapterIdx) {
  const base = getConversionSettings(CATALOG, state.currentBookId);
  const override = chapterOverrides[chapterIdx] || {};
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

/**
 * Two settings objects agree only if every field that changes output agrees.
 *
 * `scriptId` is part of the identity, not an afterthought: a job pinned to one
 * exact script is not interchangeable with one that will re-resolve "the AI
 * script for this chapter", even when every other field matches. Merging them
 * would let a batch speak a newer translation than the one that was reviewed.
 */
function settingsKey(s) {
  return [
    s.language, s.voiceId, s.translationStyle || '', s.scriptSource,
    s.action || 'both', s.scriptId || '',
  ].join('|');
}

/**
 * The Convert dialog is the single, uniform entry point for every conversion —
 * first run, re-convert and "new version" all open it. It never starts a job
 * from stale/implicit settings, because the old "new version" button did
 * exactly that and produced audio nobody asked for.
 */
function openQuickConvertModal(chapterIdx, options = {}) {
  qcActiveChapterIdx = chapterIdx;
  const ch = state.chapters.find(c => c.chapterIndex === chapterIdx);
  if (!ch) return;

  // "Regenerate this version": the dialog is seeded from the audio row and
  // pinned to the exact script that produced it, so pressing Start remakes
  // THAT version rather than making a new one from today's settings.
  const fromAudio = options.fromAudio || null;
  qcPinnedScriptId = fromAudio?.scriptId || null;

  const existing = (state.audioFiles || []).filter(a => a.chapterId === ch.id && !a.isMerged).length;
  const hasOverride = !!chapterOverrides[chapterIdx];
  // A first run has no agreed defaults yet, so the dialog explains itself
  // differently and offers the "don't ask again" contract.
  const isFirstRun = !!options.firstRun;

  setText('#qc-modal-title', fromAudio
    ? `Regenerate: ${ch.title || `Chapter ${chapterIdx + 1}`}`
    : `Convert: ${ch.title || `Chapter ${chapterIdx + 1}`}`);
  setText('#qc-scope', hasOverride
    ? 'Applies to: this chapter — using chapter override'
    : 'Applies to: this chapter');
  $('#qc-scope')?.classList.toggle('is-override', hasOverride);

  setText('#qc-modal-subtitle', fromAudio
    // The pin is the whole point of this entry point, so it is the first thing
    // the dialog says.
    ? 'Uses the exact script this version was made from. Change the source below to use a different script.'
    : isFirstRun
    ? 'First conversion for this book — check the settings below, then start.'
    : hasOverride
      // An exception is invisible state, so the dialog has to say it exists —
      // otherwise this chapter quietly disagrees with the sidebar forever.
      ? 'This chapter has its own settings, shown below. The book defaults are unchanged.'
      : existing
        ? `${existing} version${existing > 1 ? 's' : ''} already saved. This adds another — nothing is overwritten.`
        : 'Every conversion creates a new audio version. Nothing is overwritten.');

  // Offering "don't ask again" after it has already been granted would imply
  // it had been forgotten.
  const quickRow = $('#qc-quick-row');
  const quickBox = $('#qc-quick-action');
  const alreadyQuick = getQuickActionAllowed(state.currentBookId);
  if (quickRow) quickRow.hidden = alreadyQuick;
  if (quickBox) quickBox.checked = false;

  // The action defaults to whatever the caller intended, so "Translate text"
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

  // Seed the script source too, so an override that says "original English"
  // is still selected when the dialog is reopened.
  const wantSource = saved.scriptSource || 'ai';
  const sourceInput = $('#qc-source-group').querySelector(`input[value="${wantSource}"]`);
  if (sourceInput && !sourceInput.disabled) sourceInput.checked = true;

  if (!hasScript && customRadio.checked) {
    $('#qc-source-group').querySelector('input[value="ai"]').checked = true;
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

    // A text-only run never reaches TTS, so offering a voice for it would be
    // offering a setting that cannot affect the result.
    const voiceRow = voiceSelect.closest('div') || voiceSelect.parentElement;
    const showVoice = action !== 'script';
    voiceSelect.style.display = showVoice ? '' : 'none';
    $('#qc-voice-label').style.display = showVoice ? '' : 'none';

    const parts = [];
    if (source === 'ai') parts.push(`AI retelling in <b>${lang?.label || lang?.name || langSelect.value}</b>`);
    if (source === 'custom') parts.push('Your <b>saved script</b>, spoken verbatim');
    if (source === 'original') parts.push('The <b>original book text</b>, untranslated');
    if (showStyle) parts.push(`style <b>${styleSelect.selectedOptions[0]?.textContent || '—'}</b>`);
    if (showVoice) parts.push(`voice <b>${voiceSelect.selectedOptions[0]?.textContent || '—'}</b>`);

    // Whether audio will be produced is the most consequential fact here — it
    // is the difference between seconds and minutes, and between free and paid.
    const outcome = action === 'script'
      ? '<b>Text only</b> — no audio will be generated'
      : action === 'audio'
        ? (qcPinnedScriptId
          ? '<b>Audio only</b> — from the exact script this version used'
          : '<b>Audio only</b> — from the existing script')
        : '<b>Text + audio</b>';

    $('#qc-summary').innerHTML =
      `Will produce: ${outcome}<br><span class="qc-summary-detail">${parts.join(' · ')}</span>`;

    // The button should say what pressing it does.
    const startBtn = $('#btn-qc-start');
    if (startBtn) {
      startBtn.textContent = action === 'script' ? 'Translate text'
        : action === 'audio' ? 'Generate audio'
        : '🚀 Translate + generate audio';
    }
  }

  langSelect.onchange = refresh;
  styleSelect.onchange = refresh;
  voiceSelect.onchange = refresh;
  // Changing the source abandons the pin: it names a script of the OLD source,
  // so keeping it would speak that text while the dialog advertises the new
  // one. Losing the pin is the honest outcome of changing your mind.
  $('#qc-source-group').onchange = () => { qcPinnedScriptId = null; refresh(); };
  $('#qc-action-group').onchange = refresh;
  $('#qc-edit-script').onclick = () => {
    hide('#quick-convert-modal');
    openScriptEditor(chapterIdx);
  };

  refresh();
  show('#quick-convert-modal');
}

/**
 * Convert one chapter.
 *
 * The button element used to be passed in so its label could be mutated by
 * hand, with a detached dummy button created when the row could not be found.
 * The row is now a pure function of `state.activeGenerations`, so recording
 * the state and re-rendering is both simpler and always correct.
 */
async function startSingleChapterGeneration(chapterIdx, overrideOptions = {}) {
  // Resolved through the three-level model (chapter override > book preset >
  // global), so a chapter converted from the row button uses exactly what the
  // summary above the chapter list advertises.
  const saved = effectiveSettingsFor(chapterIdx);
  const language = overrideOptions.language || saved.language;
  const voiceId = overrideOptions.voiceId || saved.voiceId;
  const groqApiKey = $('#groq-api-key')?.value || '';
  const groqModel = $('#groq-model-select')?.value || '';

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

/**
 * Speak a script that already exists, pinned to its exact id.
 *
 * "Generate audio" (as opposed to "translate + generate") means *this* text,
 * not "whatever the AI produces for this chapter next time". The dialog only
 * names a source, so the id is looked up here and the run fails clearly when
 * there is nothing to speak — guessing would mean paying for a translation the
 * user explicitly declined by choosing audio-only.
 */
async function startAudioFromExistingScript(chapterIdx, options = {}) {
  const source = options.scriptSource || 'ai';
  try {
    const { scripts = [] } = await api.getChapterScripts(state.currentBookId, chapterIdx);
    // Newest first, so "generate audio" means the script the reader is showing.
    const match = scripts
      .filter((s) => (source === 'custom' ? s.source === 'custom'
        : source === 'original' ? s.source === 'original'
        : s.source === 'ai'))
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

/**
 * Translate one chapter WITHOUT generating audio.
 *
 * Translation used to be reachable only as a side effect of making audio, so
 * judging the AI's retelling meant paying for TTS on text you might reject.
 * This produces a script row and stops, which is also what makes an honest
 * AI-vs-yours comparison possible.
 */
async function startTranslateOnly(chapterIdx, overrideOptions = {}) {
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

  try {
    setText('#listen-status', 'Translating…');
    const result = await api.translateOnly(state.currentBookId, {
      selectedChapters: [chapterIdx],
      language,
      translationStyle,
      scriptSource: 'ai',
      // Voice is irrelevant to a text-only run, but the route validates it
      // against the language, so send the one that matches.
      voiceId: override.voiceId || saved.voiceId,
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

// ============================================
// CONFIG PANEL
// ============================================

/**
 * The language / voice / style catalog and all provenance badges now live in
 * `src/components/catalog.js`.
 */

/** Populate the model dropdown from the models the saved key can actually use. */
async function loadModels() {
  const select = $('#groq-model-select');
  if (!select) return;
  try {
    const { models, error } = await api.getModels();
    if (error || !models?.length) {
      select.innerHTML = '<option value="">Auto (best available)</option>';
      if (error) {
        select.title = error;
        addLogEntry({ level: 'warn', message: `Model list unavailable: ${error}` });
      }
      return;
    }
    select.innerHTML = '<option value="">Auto (best available)</option>' +
      models.map((m) =>
        `<option value="${m.id}">${m.id}${m.preferred ? ' — recommended' : ''}</option>`
      ).join('');
  } catch (err) {
    addLogEntry({ level: 'warn', message: `Could not fetch models: ${err.message}` });
  }
}

function initConfigPanel() {
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

/**
 * Ask how a mixed-settings batch should be run, and return the groups to send.
 *
 * Resolves to `null` when the user backs out, so callers can simply stop.
 * A selection whose chapters agree needs no question at all, and a book that
 * has already answered is not asked again — but the answer is always visible
 * and changeable from this same dialog.
 */
function resolveBatchPlan(chapters, { defaultAction = 'both', cappedFrom = 0 } = {}) {
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

/**
 * Retry one failed chapter.
 *
 * Prefers the server's retry route, because it reproduces the ORIGINAL job's
 * settings — including a text-only action and any pinned script. Starting a
 * fresh conversion instead would quietly apply today's defaults, so a retry of
 * a Hindi job could come back in English, and a retry of a translate-only job
 * would generate audio nobody asked for.
 */
async function retryChapter(chapterIdx) {
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
function selectedNewestAudio() {
  const out = [];
  for (const idx of state.selectedChapters) {
    const ch = state.chapters.find((c) => c.chapterIndex === idx);
    if (!ch) continue;
    const newest = (state.audioFiles || []).find((a) => a.chapterId === ch.id && !a.isMerged);
    if (newest) out.push(newest);
  }
  return out;
}

async function startGeneration() {
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

/**
 * Translate the selected chapters to text only.
 *
 * Shares the grouping logic's intent but is much simpler: a text-only run has
 * no voice and no TTS, so the only setting that can differ per chapter is the
 * language and style. Chapters already in English are dropped rather than
 * spending tokens reproducing text the book already contains.
 */
async function startBatchTranslateOnly() {
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

/**
 * Send one text-only job per settings group.
 *
 * Shared by the batch Translate button and by a uniform batch whose chosen
 * action was "translate text only", so the two paths cannot drift apart in
 * how they report partial failure or mark rows as queued.
 */
async function runTranslateGroups(groupList) {
  const chapters = groupList.flatMap((g) => g.chapters);
  const btn = $('#sel-translate');
  if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }

  try {
    const results = await Promise.all(groupList.map((g) =>
      api.translateOnly(state.currentBookId, {
        selectedChapters: g.chapters,
        language: g.settings.language,
        translationStyle: g.settings.translationStyle,
        voiceId: g.settings.voiceId,
        // A text-only run always produces the AI script; "my script" and
        // "original text" are sources that already exist and need no job.
        scriptSource: 'ai',
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

// ============================================
// PROGRESS TRACKING
// ============================================
function setupProgressTracking(jobId, chaptersArray = null, { append = false } = {}) {
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

/**
 * Wire the realtime event stream to the UI. Called once, from startup.
 *
 * Handlers are keyed so that even a double init cannot stack them.
 */
function initRealtimeHandlers() {
  const bind = (event, fn) => socketService.onKeyed('progress', event, fn);

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

  bind('job:progress', (data) => {
    updateOverallProgress(data);
  });

  bind('job:complete', (data) => {
    onJobComplete(data);
  });

  bind('job:error', (data) => {
    showToast('Generation failed: ' + data.error, 'error');
    // Nothing is running any more, so no row may keep claiming it is.
    state.activeGenerations = {};
    state.chapterJobs = {};
    renderChapters();
    resetGenerateButton();
  });

  bind('job:cancelled', (data) => {
    const kept = data?.completed ?? 0;
    showToast(
      kept ? `Stopped. ${kept} finished chapter${kept === 1 ? '' : 's'} kept.` : 'Conversion stopped.',
      'info'
    );
    // Rows were left spinning after a cancel because only the toast was
    // handled — the in-flight state was never cleared.
    state.activeGenerations = {};
    state.chapterJobs = {};
    renderChapters();
    resetGenerateButton();
  });

  // A single cancelled chapter inside a still-running job. Without this the
  // row kept its progress bar for work the server had already skipped.
  bind('chapter:cancelled', (data) => {
    if (data.bookId !== state.currentBookId) return;
    delete state.activeGenerations[data.chapterIdx];
    delete state.chapterJobs[data.chapterIdx];
    renderChapters();
  });

  bind('log', (data) => {
    addLogEntry(data);
  });
}

/** Restore the selection-bar buttons to their idle state after a job ends. */
function resetGenerateButton() {
  const btn = $('#sel-generate');
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="5 3 19 12 5 21 5 3"/></svg> Translate + generate audio`;
  }
  const translateBtn = $('#sel-translate');
  if (translateBtn) {
    translateBtn.disabled = false;
    translateBtn.textContent = 'Translate text';
  }
  hide('#btn-cancel-all');
}

function updateChapterProgress(data) {
  state.activeGenerations[data.chapterIdx] = { percent: data.percent, message: data.message };

  const item = $(`#ch-progress-${data.chapterIdx}`);
  if (item) {
    const bar = item.querySelector('.mini-progress-bar');
    const status = item.querySelector('.chapter-progress-status');
    const icon = item.querySelector('.status-icon');
    if (bar) bar.style.width = data.percent + '%';
    if (status) status.textContent = data.message || `${data.percent}%`;
    if (icon) { icon.className = 'status-icon processing'; icon.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px"></span>'; }

    const liveLog = item.querySelector(`#ch-live-log-${data.chapterIdx}`);
    if (liveLog && data.message) {
      liveLog.style.display = 'block';
      liveLog.textContent = `⚡ [${new Date().toLocaleTimeString()}] ${data.message}`;
    }
  }

  // Patch the row in place. Progress events arrive several times a second, and
  // re-rendering the whole list on each one would rebuild every row — which is
  // what made long books stutter and dropped any open version dropdown.
  updateChapterRowProgress(data.chapterIdx, data.percent, data.message);
}

function markChapterComplete(data) {
  delete state.activeGenerations[data.chapterIdx];
  // The chapter is no longer part of a running job, so Stop must not later
  // target a job it has already left.
  delete state.chapterJobs[data.chapterIdx];

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
    showToast(`Chapter ${data.chapterIdx + 1} translated — text only.`, 'success');
    if (state.readerChapterIdx === data.chapterIdx && !$('#chapter-modal')?.classList.contains('hidden')) {
      refreshReaderChapter(data.chapterIdx, 'ai');
    }
  }
}

/**
 * Re-fetch the open chapter and re-render, optionally switching tab. Used when
 * a background job changes what the reader should be showing.
 */
async function refreshReaderChapter(chapterIdx, viewMode) {
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

function markChapterError(data) {
  // Read the job id BEFORE the bookkeeping below discards it: it is what lets
  // Retry reuse the original job's settings rather than today's defaults.
  const jobId = data.jobId || state.chapterJobs[data.chapterIdx] || null;

  delete state.activeGenerations[data.chapterIdx];
  delete state.chapterJobs[data.chapterIdx];
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

function updateOverallProgress(data) {
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

function onJobComplete(data) {
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
      `${done} chapter${done === 1 ? '' : 's'} converted · ${failed} failed`);
    showToast(
      `${done} converted, ${failed} failed. The failed chapters show why on their row.`,
      'warning'
    );
  } else {
    addClass('#overall-progress-bar', 'success');
    setText('#progress-status-text', 'All chapters generated!');
    showToast(
      done === 1 ? 'Chapter converted.' : `${done} chapters converted.`,
      'success'
    );
  }

  if (state.currentBookId) delete state.activeBookJobs[state.currentBookId];

  // Rows must not stay stuck showing a spinner for a job that has ended —
  // a chapter that never emitted chapter:complete (skipped, cancelled) would
  // otherwise look like it is still converting forever.
  state.activeGenerations = {};
  state.chapterJobs = {};

  resetGenerateButton();

  loadResults();
  refreshAudiobookPanel();
}

/**
 * Refresh the chapter list once a job finishes so every converted chapter
 * shows its Play button.
 *
 * This used to also build a *second* chapter list into a separate container
 * that was permanently hidden — duplicated rendering work and a duplicate
 * source of truth for something the main list already shows.
 */
async function loadResults() {
  try {
    await loadAudioFilesForBook();
    renderChapters();
  } catch (err) {
    showToast('Failed to load audio: ' + err.message, 'error');
  }
}

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
function playbackOrder() {
  return (state.chapters || [])
    .slice()
    .sort((a, b) => a.chapterIndex - b.chapterIndex)
    .map((ch) => (state.audioFiles || []).find((a) => a.chapterId === ch.id && !a.isMerged))
    .filter(Boolean)
    .map((a) => state.audioFiles.indexOf(a));
}

/** Step through the listening order from whatever is playing now. */
function playAdjacent(step) {
  const order = playbackOrder();
  if (!order.length) return;
  const here = order.indexOf(state.currentAudioIndex);
  // If the playing item is not itself in the order (an older version chosen
  // from a version picker), stepping restarts from the ends rather than
  // doing nothing at all.
  const nextPos = here === -1 ? (step > 0 ? 0 : order.length - 1) : here + step;
  if (nextPos < 0 || nextPos >= order.length) return;
  playAudioAtIndex(order[nextPos]);
}

/**
 * Stop and unload the player.
 *
 * Closing a book left its audio playing over the library, with the transport
 * still pointing at tracks that were no longer listed — audible state that
 * contradicts what is on screen.
 */
function stopPlayback() {
  const audio = $('#audio-element');
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  state.currentAudioIndex = -1;
  state.isPlaying = false;
  state.vttCues = [];
  state.currentAlignment = null;
  addClass('#sticky-player', 'hidden');
  removeClass('#app', 'has-player');
  updatePlayButton();
}

function initPlayer() {
  const audio = $('#audio-element');
  const seekBar = $('#player-seek');

  $('#btn-play-pause').addEventListener('click', togglePlay);
  $('#btn-prev-chapter').addEventListener('click', () => playAdjacent(-1));
  $('#btn-next-chapter').addEventListener('click', () => playAdjacent(1));
  $('#player-chapter-select')?.addEventListener('change', (e) => {
    playAudioAtIndex(parseInt(e.target.value, 10));
  });

  initSpeedControl();
  initPitchControl();

  seekBar.addEventListener('input', () => {
    if (audio.duration) audio.currentTime = (seekBar.value / 100) * audio.duration;
  });

  audio.addEventListener('timeupdate', () => {
    if (audio.duration) {
      seekBar.value = (audio.currentTime / audio.duration) * 100;
      setText('#player-current-time', formatTime(audio.currentTime));
    }
  });

  audio.addEventListener('loadedmetadata', () => {
    setText('#player-duration', formatTime(audio.duration));
    // Assigning a new `src` resets playbackRate to 1 in several browsers, so
    // without this the speed silently snapped back to 1× on every chapter
    // change and had to be set again. Re-applied without persisting, since
    // loading a track is not the user expressing a preference.
    applySpeedForCurrentBook();
  });

  audio.addEventListener('ended', () => {
    // Continue in chapter order, not in "most recently converted" order.
    const order = playbackOrder();
    const here = order.indexOf(state.currentAudioIndex);
    if (here !== -1 && here < order.length - 1) {
      playAudioAtIndex(order[here + 1]);
    } else {
      state.isPlaying = false;
      updatePlayButton();
    }
  });

  audio.addEventListener('play', () => { state.isPlaying = true; updatePlayButton(); });
  audio.addEventListener('pause', () => { state.isPlaying = false; updatePlayButton(); });
}

/**
 * Playback speed.
 *
 * Speed is the control an audiobook listener touches most, and the old
 * five-option dropdown offered neither the slow rungs used for dense text nor
 * anything above 2×. It is now a menu of the full preset ladder plus a custom
 * value, and — the part that matters — the choice is remembered per book,
 * because a rate that suits a brisk narrator rarely suits a slow one.
 */
function initSpeedControl() {
  const audio = $('#audio-element');
  const trigger = $('#player-speed-trigger');
  const menu = $('#speed-menu');
  const presets = $('#speed-presets');
  const custom = $('#speed-custom-input');
  if (!trigger || !menu) return;

  presets.innerHTML = SPEED_PRESETS.map(
    (r) => `<button class="speed-preset" role="menuitemradio" data-rate="${r}">${r}×</button>`
  ).join('');

  const closeMenu = () => {
    addClass(menu, 'hidden');
    trigger.setAttribute('aria-expanded', 'false');
  };

  const apply = (rate, persist = true) => {
    const value = clampSpeed(rate);
    audio.playbackRate = value;
    // Without this, 2× sounds chipmunked and the feature is unusable at
    // exactly the setting people reach for most.
    audio.preservesPitch = true;
    audio.mozPreservesPitch = true;
    audio.webkitPreservesPitch = true;

    setText('#player-speed-label', `${value}×`);
    trigger.title = `Playback speed — ${value}×`;
    if (custom) custom.value = value;
    $$('.speed-preset').forEach((b) => {
      const on = parseFloat(b.dataset.rate) === value;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
    });

    if (persist) rememberSpeed(state.currentBookId, value);
  };

  trigger.addEventListener('click', () => {
    const open = menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !open);
    trigger.setAttribute('aria-expanded', String(open));
  });

  presets.addEventListener('click', (e) => {
    const btn = e.target.closest('.speed-preset');
    if (!btn) return;
    apply(parseFloat(btn.dataset.rate));
    closeMenu();
  });

  // Applied live rather than on commit, so the effect can be heard while the
  // number is being chosen — which is the only way to judge it.
  custom?.addEventListener('input', () => apply(custom.value));

  document.addEventListener('click', (e) => {
    if (!menu.classList.contains('hidden') && !e.target.closest('.speed-control')) closeMenu();
  });
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); trigger.focus(); } });

  // Restore without re-persisting, or simply opening a book would overwrite
  // the global default with itself.
  apply(speedForBook(state.currentBookId), false);
  applySpeedForCurrentBook = () => apply(speedForBook(state.currentBookId), false);

  // "Make default" — promotes whatever is set now to the app-wide default for
  // both speed and tone, and drops this book's override so the new default is
  // actually audible here too.
  $('#speed-make-default')?.addEventListener('click', () => {
    const rate = clampSpeed(audio.playbackRate);
    makeSpeedDefault(state.currentBookId, rate);
    makePitchDefault(state.currentBookId, currentPitch());
    showToast(`Default set: ${rate}× — new books will start here.`, 'success');
    updateSpeedDefaultNote();
  });

  updateSpeedDefaultNote();
}

/**
 * Tells the user whether the current speed is this book's own or the global
 * default, so "Make default" is never a guess about what it will change.
 */
function updateSpeedDefaultNote() {
  const note = $('#speed-default-note');
  if (!note) return;
  const global = getSetting('playbackRate') || 1;
  const here = speedForBook(state.currentBookId);
  note.textContent = here === global ? `Default is ${global}×` : `Default is ${global}× · this book ${here}×`;
}

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
function initPitchControl() {
  const audio = $('#audio-element');
  const slider = $('#player-pitch-slider');
  if (!slider || !audio) return;

  let audioCtx, source, filter;

  // The graph is built lazily: constructing an AudioContext before a user
  // gesture is blocked by browser autoplay policy, and creating a
  // MediaElementSource more than once for the same element throws.
  const ensureGraph = () => {
    if (audioCtx) return true;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      audioCtx = new AudioContext();
      source = audioCtx.createMediaElementSource(audio);
      filter = audioCtx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = 500; // human voice fundamental area
      filter.Q.value = 1.5;
      source.connect(filter);
      filter.connect(audioCtx.destination);
      return true;
    } catch {
      // Tone shaping is a nicety; losing it must never take the audio with it.
      audioCtx = null;
      return false;
    }
  };

  const apply = (value, persist = true) => {
    const pitch = clampPitch(value);
    slider.value = pitch;
    slider.title = `Tone — ${pitch === 1 ? 'neutral' : pitch < 1 ? 'deeper' : 'lighter'} (double-click to reset)`;
    // Neutral needs no graph at all, so an untouched player never pays the
    // cost of an AudioContext.
    if (pitch !== 1 || audioCtx) {
      if (ensureGraph()) filter.gain.value = (pitch - 1) * 20; // −10dB … +20dB
    }
    if (persist) rememberPitch(state.currentBookId, pitch);
  };

  slider.addEventListener('input', () => apply(slider.value));
  slider.addEventListener('dblclick', () => {
    apply(1);
    showToast('Tone reset to neutral.', 'info');
  });

  apply(pitchForBook(state.currentBookId), false);
  applyPitchForCurrentBook = () => apply(pitchForBook(state.currentBookId), false);
  currentPitch = () => clampPitch(slider.value);
}

/** Re-applies the saved tone when the open book changes. Set by initPitchControl. */
let applyPitchForCurrentBook = () => {};
let currentPitch = () => 1;

/** Re-applies the saved rate when the open book changes. Set by initSpeedControl. */
let applySpeedForCurrentBook = () => {};

function playAudioAtIndex(index) {
  if (index < 0 || index >= state.audioFiles.length) return;
  state.currentAudioIndex = index;
  const audioFile = state.audioFiles[index];
  const audio = $('#audio-element');

  audio.innerHTML = ''; // clear old tracks
  state.vttCues = [];
  state.currentAlignment = null;

  audio.src = api.getStreamUrl(audioFile.id);
  audio.play().catch(() => {});

  // The sentence↔time map is what makes real karaoke highlighting possible.
  // It is computed server-side from the word-level subtitles, against the text
  // that was actually spoken.
  api.getAlignment(audioFile.id)
    .then(({ alignment }) => {
      state.currentAlignment = alignment;
      // If the reader is open on this chapter, re-attach so it starts tracking.
      if (state.readerChapterIdx !== null) attachReaderSync();
    })
    .catch(() => { /* alignment is optional — playback still works */ });

  // Fetch and parse VTT for subtitle overlay + paragraph highlighting
  fetch(api.getVttUrl(audioFile.id))
    .then(r => r.ok ? r.text() : null)
    .then(vttText => {
      if (vttText) {
        state.vttCues = parseVtt(vttText);
        startSubtitleSync();
      }
    })
    .catch(() => { /* No VTT available — silently continue */ });

  const subtitleContainer = $('#subtitle-container');
  if (subtitleContainer) {
    subtitleContainer.style.display = 'block';
    subtitleContainer.textContent = '';
  }

  const ch = state.chapters.find(c => c.id === audioFile.chapterId);
  setText('#player-chapter-title', ch?.title || `Chapter ${index + 1}`);
  // The book title is already in the header, so this line is used for the
  // thing you cannot otherwise tell by ear: which version is playing.
  setText('#player-book-title', versionLabel(audioFile));

  // The player is docked, so it is revealed rather than repositioned. The
  // shell is told a player exists so the floating console bubble lifts above
  // it instead of hiding behind it.
  removeClass('#sticky-player', 'hidden');
  addClass('#app', 'has-player');

  // Mark the playing chapter in the list. This is a class rather than an
  // inline border colour so it stays consistent with selection and error
  // states — the inline version silently overwrote those.
  $$('.ch-row.playing').forEach((row) => removeClass(row, 'playing'));
  const row = $(`.ch-row[data-ch="${ch?.chapterIndex}"]`);
  if (row) addClass(row, 'playing');

  renderPlayerChapterList();
  updateTransportButtons();
}

/**
 * The player's jump-to-chapter list.
 *
 * Only chapters that actually have audio can be jumped to, so the list is
 * built from `audioFiles` rather than from every chapter in the book — an
 * option that cannot play is worse than no option at all.
 */
function renderPlayerChapterList() {
  const sel = $('#player-chapter-select');
  if (!sel) return;

  // Built from the listening order, so the list reads 1, 2, 3… like the book.
  // Listing raw `audioFiles` put it in "most recently converted" order and
  // repeated a chapter once per saved version, which made jumping a guess.
  const order = playbackOrder();
  sel.hidden = order.length < 2;   // pointless with one track
  if (sel.hidden) {    sel.innerHTML = ''; return; }

  sel.innerHTML = order.map((audioIdx) => {
    const a = state.audioFiles[audioIdx];
    const ch = state.chapters.find((c) => c.id === a.chapterId);
    const label = ch ? `${ch.chapterIndex + 1}. ${ch.title || 'Chapter'}` : 'Chapter';
    return `<option value="${audioIdx}" ${audioIdx === state.currentAudioIndex ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
}

/**
 * Grey out the transport buttons at the ends of the book.
 *
 * A control that looks available but does nothing costs the user a click to
 * discover it is the end — the button should say so before it is pressed.
 */
function updateTransportButtons() {
  const order = playbackOrder();
  const here = order.indexOf(state.currentAudioIndex);
  const prev = $('#btn-prev-chapter');
  const next = $('#btn-next-chapter');
  if (prev) prev.disabled = here <= 0;
  if (next) next.disabled = here === -1 || here >= order.length - 1;
}

/**
 * Parse a WebVTT string into an array of cue objects.
 */
function parseVtt(vttText) {
  const cues = [];
  const blocks = vttText.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
      if (match) {
        const start = parseInt(match[1])*3600 + parseInt(match[2])*60 + parseInt(match[3]) + parseInt(match[4])/1000;
        const end = parseInt(match[5])*3600 + parseInt(match[6])*60 + parseInt(match[7]) + parseInt(match[8])/1000;
        const text = lines.slice(i + 1).join(' ').trim();
        if (text) cues.push({ start, end, text });
        break;
      }
    }
  }
  return cues;
}

/**
 * Start a polling loop that syncs subtitles + paragraph highlighting with audio currentTime.
 * Works perfectly with seeking because it checks every frame.
 */
let subtitleAnimFrame = null;
function startSubtitleSync() {
  if (subtitleAnimFrame) cancelAnimationFrame(subtitleAnimFrame);
  
  const audio = $('#audio-element');
  const subtitleContainer = $('#subtitle-container');
  let lastCueText = '';
  let lastParaIdx = -1;
  
  function tick() {
    if (!audio.src) return;
    
    const t = audio.currentTime;
    
    // Find active cue
    let activeCue = null;
    let cueIdx = -1;
    for (let i = 0; i < state.vttCues.length; i++) {
      if (t >= state.vttCues[i].start && t <= state.vttCues[i].end) {
        activeCue = state.vttCues[i];
        cueIdx = i;
        break;
      }
    }
    
    // Update subtitle overlay
    if (activeCue && activeCue.text !== lastCueText) {
      lastCueText = activeCue.text;
      if (subtitleContainer) subtitleContainer.textContent = activeCue.text;
    } else if (!activeCue && lastCueText) {
      lastCueText = '';
      if (subtitleContainer) subtitleContainer.textContent = '';
    }

    // NOTE: reader highlighting is deliberately NOT done here any more.
    // It used to map cue index → paragraph index proportionally, which drifted
    // whenever paragraph lengths were uneven, and force-scrolled the page.
    // ReaderSync now handles it from the real sentence↔time alignment.

    subtitleAnimFrame = requestAnimationFrame(tick);
  }
  
  subtitleAnimFrame = requestAnimationFrame(tick);
}

function togglePlay() {
  const audio = $('#audio-element');
  if (audio.src) {
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  } else if (state.audioFiles.length > 0) {
    playAudioAtIndex(0);
  }
}

function updatePlayButton() {
  const playIcon = $('#btn-play-pause .icon-play');
  const pauseIcon = $('#btn-play-pause .icon-pause');
  if (state.isPlaying) { hide(playIcon); show(pauseIcon); }
  else { show(playIcon); hide(pauseIcon); }
  // The reader's listening pane mirrors the docked player, so it follows the
  // same state rather than tracking playback separately.
  if (state.readerChapterIdx != null) renderListenPane();
}

// ============================================
// LOG CONSOLE — see src/components/logConsole.js
// ============================================

// ============================================
// MODAL
// ============================================
function applyReaderSettings() {
  const container = $('#modal-content-container');
  const body = $('#modal-chapter-body');
  if (!body || !container) return;

  // Font size
  body.style.fontSize = `${state.readerFontSize}px`;
  setText('#reader-font-val', `${state.readerFontSize}px`);
  setSetting('readerFontSize', state.readerFontSize);

  // Line height
  body.style.lineHeight = state.readerLineHeight;
  const lineSelect = $('#reader-line-height-select');
  if (lineSelect) lineSelect.value = state.readerLineHeight;
  setSetting('readerLineHeight', state.readerLineHeight);

  // Font family
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

  // Theme
  container.classList.remove('reader-theme-sepia', 'reader-theme-light', 'reader-theme-oled', 'reader-theme-dark');
  if (state.readerTheme !== 'dark') {
    container.classList.add(`reader-theme-${state.readerTheme}`);
  }
  const themeSelect = $('#reader-theme-select');
  if (themeSelect) themeSelect.value = state.readerTheme;
  setSetting('readerTheme', state.readerTheme);

  // Fullscreen
  container.classList.toggle('fullscreen-reader', !!state.readerFullscreen);
  $('#btn-reader-fullscreen')?.setAttribute('aria-pressed', String(!!state.readerFullscreen));
}

function initModal() {
  function closeModal() {
    hide('#chapter-modal');
    state.readerChapterIdx = null;
    state.currentChapterData = null;
  }
  
  $('#modal-close').addEventListener('click', closeModal);
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
    if (qcActiveChapterIdx === null) return;
    const idx = qcActiveChapterIdx;
    const lang = $('#qc-language').value;
    const voice = $('#qc-voice').value;
    const style = $('#qc-style').value;
    const scriptSource = $('#qc-source-group')
      .querySelector('input[name="qc-source"]:checked')?.value || 'ai';
    const action = $('#qc-action-group')
      ?.querySelector('input[name="qc-action"]:checked')?.value || 'both';
    const makeDefault = $('#qc-make-default')?.checked;
    const allowQuick = $('#qc-quick-action')?.checked;

    hide('#quick-convert-modal');

    const options = {
      language: lang,
      voiceId: voice,
      // Style is meaningless unless the AI is actually writing the script.
      translationStyle: scriptSource === 'ai' ? style : undefined,
      scriptSource,
    };

    if (makeDefault) {
      // Level 2: promoted to THIS BOOK's default, not the app's. A voice
      // chosen for one book is rarely right for the next, and writing it
      // globally would make every future book inherit this decision.
      setBookPreset(state.currentBookId, options);
      delete chapterOverrides[idx]; // no longer an exception
      syncNarrationControls();
    } else if (!qcPinnedScriptId) {
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
      if (qcPinnedScriptId) {
        startSingleChapterGeneration(idx, { ...options, action: 'audio', scriptId: qcPinnedScriptId });
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

  /**
   * Save the editor's contents. Returns true only if it actually saved, so
   * callers can chain "…and then generate" without acting on a failure.
   */
  const seSave = async () => {
    if (seActiveChapterIdx === null) return false;
    const content = $('#se-text').value;
    if (!content.trim()) {
      showToast('Paste some text before saving.', 'error');
      return false;
    }
    try {
      await api.saveCustomScript(state.currentBookId, seActiveChapterIdx, content);
      const ch = state.chapters.find(c => c.chapterIndex === seActiveChapterIdx);
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
    const idx = seActiveChapterIdx;
    if (!(await seSave())) return;
    showToast('Script saved — generating audio from it.', 'success');
    seClose();
    // scriptSource is pinned to 'custom' so this cannot silently run the AI
    // over the text the user just wrote by hand.
    startSingleChapterGeneration(idx, { ...(chapterOverrides[idx] || {}), scriptSource: 'custom' });
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
    if (seActiveChapterIdx === null) return;
    if (!confirm('Delete your saved script for this chapter? Existing audio is kept.')) return;
    try {
      const data = await api.getChapterContent(state.currentBookId, seActiveChapterIdx);
      const custom = (data.scripts || []).find(s => s.source === 'custom');
      if (custom) await api.deleteScript(state.currentBookId, custom.id);
      const ch = state.chapters.find(c => c.chapterIndex === seActiveChapterIdx);
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

  $('#reader-tab-original')?.addEventListener('click', () => {
    state.readerViewMode = 'original';
    renderReaderBody();
  });

  $('#reader-tab-ai')?.addEventListener('click', () => {
    state.readerViewMode = 'ai';
    renderReaderBody();
  });

  // "My script" opens the editor itself rather than a card whose only purpose
  // is a button that opens the editor. The intent is unambiguous, so the
  // intermediate step was pure friction.
  $('#reader-tab-edit')?.addEventListener('click', () => {
    const idx = state.readerChapterIdx;
    if (idx == null || Number.isNaN(idx)) {
      state.readerViewMode = 'edit';
      renderReaderBody();
      return;
    }
    openScriptEditor(idx);
  });

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
async function loadLibrary() {
  try {
    const data = await api.getBooks();
    // Kept in state so Home and the landing decision can read the shelf
    // without each issuing its own request for the same list.
    state.libraryBooks = data.books || [];
    renderLibrary();
    applyWorkspaceMode();
    return state.libraryBooks;
  } catch (err) {
    console.error('Could not load library:', err);
    showToast('Library error: ' + err.message, 'error');
    return [];
  }
}

/**
 * Draw the library grid from `state.libraryBooks`, honouring the search box
 * and sort order.
 *
 * Separated from loading so typing in the search field re-filters instantly
 * instead of re-fetching the whole shelf on every keystroke.
 */
function renderLibrary() {
  const grid = $('#library-grid');
  const empty = $('#library-empty');
  const all = state.libraryBooks || [];

  const term = ($('#library-search')?.value || '').trim().toLowerCase();
  const sort = $('#library-sort')?.value || 'recent';

  const books = all.filter((b) =>
    !term ||
    (b.title || '').toLowerCase().includes(term) ||
    (b.author || '').toLowerCase().includes(term)
  );

  const progress = (b) => (b.totalChapters ? (b.chaptersWithAudio || 0) / b.totalChapters : 0);
  const time = (v) => new Date(v || 0).getTime();
  const sorters = {
    // Default. The book you want next is nearly always the one you had open
    // last, which is exactly what `last_opened_at` records — it was being
    // written and never read.
    recent: (a, b) => time(b.lastOpenedAt || b.createdAt) - time(a.lastOpenedAt || a.createdAt),
    added: (a, b) => time(b.createdAt) - time(a.createdAt),
    title: (a, b) => (a.title || '').localeCompare(b.title || ''),
    progress: (a, b) => progress(b) - progress(a),
  };
  books.sort(sorters[sort] || sorters.recent);

  // States what you are looking at, and says so honestly while a search is
  // narrowing the shelf — otherwise a filtered library is indistinguishable
  // from a small one.
  setText('#library-count', !all.length
    ? ''
    : term
      ? `${books.length} of ${all.length}`
      : `${all.length} ${all.length === 1 ? 'book' : 'books'}`);

  if (!books.length) {
    hide(grid);
    show(empty);
    // "No books yet" is wrong when the shelf is full and the search simply
    // missed — the two need different words and different actions.
    const searching = !!term && all.length > 0;
    setText('#library-empty .empty-title', searching ? 'No matches' : 'No books yet');
    setText('#library-empty .empty-text', searching
      ? `Nothing in your library matches “${term}”.`
      : 'Add an EPUB and it will appear here, ready to narrate.');
    const btn = $('#library-upload');
    if (btn) btn.hidden = searching;
    return;
  }

  show(grid); hide(empty);
  grid.innerHTML = books.map(book => {
      // "parsed" is an internal database state, not news. What you actually
      // want to know about a book in your library is how far through it you
      // are, so the card leads with conversion progress instead.
      const done = book.chaptersWithAudio || 0;
      const total = book.totalChapters || 0;
      const pct = total ? Math.round((done / total) * 100) : 0;
      const complete = total > 0 && done === total;

      const listened = book.totalDuration
        ? `${formatTime(book.totalDuration)} of audio`
        : 'No audio yet';

      // A shelf is scanned by cover, not by filename. Books without artwork
      // get a generated spine using the title's initial so the grid still
      // reads as a collection rather than a row of identical placeholders.
      const initial = escapeHtml((book.title || '?').trim().charAt(0).toUpperCase());
      const art = book.coverImage
        ? `<img class="library-cover-img" src="${escapeHtml(book.coverImage)}" alt="" loading="lazy" />`
        : `<span class="library-cover-fallback" aria-hidden="true">${initial}</span>`;

      return `
      <button class="library-card" data-book-id="${book.id}">
        <div class="library-cover">
          ${art}
          <span class="badge library-card-badge ${complete ? 'badge-ok' : done ? 'badge-accent' : ''}">
            ${complete ? 'Ready' : done ? `${pct}%` : 'New'}
          </span>
        </div>

        <div class="library-card-body">
          <div class="library-card-title">${escapeHtml(book.title)}</div>
          <div class="library-card-author">${escapeHtml(book.author || 'Unknown author')}</div>

          <div class="progress library-card-progress"><div class="progress-fill ${complete ? 'ok' : ''}" style="width:${pct}%"></div></div>

          <div class="library-card-meta">
            <span>${total} chapters · ${listened}</span>
            <span class="library-card-delete" role="button" tabindex="0" data-id="${book.id}" title="Delete book" aria-label="Delete ${escapeHtml(book.title)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </span>
          </div>
        </div>
      </button>
    `;
    }).join('') + `
      <button class="library-add" aria-label="Upload an EPUB">
        <span class="library-add-icon" aria-hidden="true">＋</span>
        <span class="library-add-label">Add a book</span>
        <span class="library-add-sub">EPUB</span>
      </button>`;

    // Class rather than id: the tile is rendered dynamically, so an id here
    // would be a reference to markup that does not exist in index.html.
    grid.querySelector('.library-add')?.addEventListener('click', () => {
      $('#file-input')?.click();
    });

    grid.querySelectorAll('.library-card-delete').forEach(btn => {
      const remove = async (e) => {
        // The delete control sits inside the card button, so the click must be
        // stopped from also opening the book it is deleting.
        e.stopPropagation();
        e.preventDefault();
        if (!confirm('Delete this book and all its audio? This cannot be undone.')) return;
        try {
          await api.deleteBook(btn.dataset.id);
          showToast('Book deleted', 'success');
          loadLibrary();
        } catch (err) { showToast(err.message, 'error'); }
      };
      btn.addEventListener('click', remove);
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') remove(e);
      });
    });

    grid.querySelectorAll('.library-card').forEach(card => {
      card.addEventListener('click', () => loadBookFromLibrary(card.dataset.bookId));
    });
}

async function loadBookFromLibrary(bookId) {
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
async function checkInterruptedJobs(bookId) {
  try {
    const { jobs = [] } = await api.getJobs(bookId);
    const interrupted = jobs.filter((j) => j.status === 'interrupted');
    if (!interrupted.length) return;

    // The chapters that never finished are the actionable part; the ones that
    // completed are already on disk and must not be redone.
    const outstanding = interrupted.flatMap((j) => {
      const done = new Set(j.completedChapters || []);
      return (j.selectedChapters || []).filter((idx) => !done.has(idx));
    });
    if (!outstanding.length) return;

    const job = interrupted[0];
    const toast = showToast(
      `A conversion was interrupted — ${outstanding.length} chapter${outstanding.length === 1 ? '' : 's'} ` +
      `did not finish.`,
      'warning',
      { persist: true, actionLabel: 'Resume', onClick: () => resumeInterruptedJob(job, outstanding) }
    );
    addLogEntry({
      level: 'warn',
      message: `Job ${job.id.slice(0, 8)} was interrupted by a restart — ${outstanding.length} chapter(s) outstanding.`,
    });
    return toast;
  } catch {
    // Recovery is a convenience; failing to check for it must never stop a
    // book from opening.
  }
}

/** Resume the unfinished chapters of an interrupted job, reusing its settings. */
async function resumeInterruptedJob(job, chapters) {
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

// ============================================
// TOASTS — see src/components/toast.js
// ============================================

// ============================================
// UTILS — see src/utils/html.js
// ============================================
// UTILS
// ============================================
