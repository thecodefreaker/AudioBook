/**
 * Application state.
 *
 * Extracted from `main.js` so components can share state without being defined
 * in the same 2,000-line file. Deliberately a plain object plus a subscribe
 * hook rather than a reactive framework — the app already renders explicitly,
 * and pretending otherwise would mean rewriting every render function.
 */

import { getSetting, migrateLegacySettings } from './services/settings.js';

// Preferences are read at module load, so the legacy keys must already have
// been folded in by then.
migrateLegacySettings();

const listeners = new Set();

export const state = {
  currentView: 'create',
  currentBookId: null,
  currentBookMeta: null,  // { title, author, coverImage } for the open book
  chapters: [],
  selectedChapters: new Set(),
  audioFiles: [],
  audiobook: null,        // Whole-book merge status
  // The library, held once so Home, the landing decision and the grid all read
  // the same list instead of each fetching it.
  libraryBooks: [],
  // Conversions in flight, keyed by book: { [bookId]: { percent, label } }.
  // Generation outlives the workspace it was started from, so Home has to be
  // able to report on a job in a book that is not currently open.
  activeBookJobs: {},
  // Authoritative backend queue snapshot. Unlike activeGenerations, this
  // survives navigation and can represent jobs for books that are not open.
  queueSnapshot: { paused: false, concurrency: 1, running: [], pending: [], active: [], recent: [] },
  currentAudioIndex: -1,
  isPlaying: false,
  activeGenerations: {},  // { chapterIdx: { percent, message, jobId } }
  // The job each chapter belongs to, so a row's Stop button can cancel just
  // that chapter instead of every job for the book.
  chapterJobs: {},        // { chapterIdx: jobId }
  vttCues: [],            // Parsed VTT cues: [{ start, end, text }]
  captionsEnabled: getSetting('captionsEnabled') !== false, // Subtitle/caption toggle
  currentAlignment: null, // Sentence↔time map for the playing audio
  followMode: false,      // Auto-scroll the reader to the spoken line (opt-in)
  readerChapterIdx: null,
  readerViewMode: 'original', // 'original' | 'ai' | 'edit'
  // Which audio version the listening pane is acting on. Held across renders
  // so a progress tick cannot move Download and Regenerate onto a different
  // version than the one the user chose.
  listenVersionId: null,
  currentChapterData: null,
  // Reader preferences come from the settings store rather than raw
  // localStorage, so there is one place that decides how they are persisted.
  readerFontSize: getSetting('readerFontSize'),
  readerFontFamily: getSetting('readerFontFamily'),
  readerLineHeight: getSetting('readerLineHeight'),
  readerTheme: getSetting('readerTheme'),
  readerPromptManagerEnabled: getSetting('readerPromptManagerEnabled'),
  readerPromptManagerText: getSetting('readerPromptManagerText'),
  readerFullscreen: false,
  // { chapterIdx: { message, stage, jobId, retryable } }. Stage is what lets a
  // row say "Translation failed" rather than "Failed", and jobId is what lets
  // Retry reuse the settings that failed instead of today's defaults.
  chapterErrors: {},
  // Per-chapter narration exceptions — level 3 of the settings model
  // (chapter override > book preset > global default).
  //
  // Held here rather than privately in main.js so the chapter list can show an
  // "Override" chip on the row. An exception nobody can see from outside the
  // dialog that created it is exactly the invisible state this redesign is
  // meant to remove.
  //
  // Session-scoped on purpose: it is cleared when the open book changes and is
  // never written to localStorage, so a one-off choice cannot quietly apply
  // weeks later.
  chapterOverrides: {},   // { chapterIdx: { language, voiceId, translationStyle, scriptSource } }
  activeVersionsModalChapterIdx: null,
  seActiveChapterIdx: null, // Script Editor active chapter
  qcActiveChapterIdx: null, // Quick Convert active chapter
  qcPinnedScriptId: null,   // Quick Convert pinned script ID
};

/** Subscribe to state changes announced via `emit()`. Returns an unsubscribe fn. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Announce that some part of state changed, so interested views can redraw. */
export function emit(topic, payload) {
  for (const fn of listeners) {
    try {
      fn(topic, payload);
    } catch (err) {
      // A broken listener must never take down the code that changed state.
      console.error('State listener failed', topic, err);
    }
  }
}
