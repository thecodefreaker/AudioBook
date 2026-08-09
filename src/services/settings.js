/**
 * User settings.
 *
 * Every persisted preference in the app funnels through this module. That
 * matters more than it looks: settings were previously read and written with
 * ad-hoc `localStorage.getItem` calls scattered across `main.js`, so each key
 * had its own default, its own parsing, and no single place to change where it
 * is stored.
 *
 * The decision recorded in `docs/11_DESIGN_AUDIT_AND_RECOMMENDATIONS.md` §Q4
 * is that settings must eventually live on the server, so a phone and a laptop
 * agree on playback speed and last-read position. This module is the seam that
 * makes that swap cheap: `read()`/`write()` are the only two functions that
 * know about `localStorage`, so pointing them at `/api/settings` later touches
 * no calling code.
 *
 * It is deliberately synchronous today. Making it async now would infect every
 * caller with promises to support a backend that does not exist yet.
 */

const KEY = 'audiobook_settings_v1';

/**
 * Defaults are the real specification of what a setting means, so they live
 * here rather than being repeated at each call site.
 */
const DEFAULTS = {
  // --- Playback ---------------------------------------------------------
  // 1× is the only defensible default: it is the speed the narration was
  // generated at, so anything else changes what the user hears before they
  // have asked for it.
  playbackRate: 1,
  // Speed that suits a brisk narrator rarely suits a slow one, so a global
  // default alone forces a re-adjustment on every book. { [bookId]: rate }
  playbackRateByBook: {},
  preservePitch: true,
  // Tone shaping, same two-tier model as speed: a global default plus an
  // optional per-book override. Previously the pitch slider wrote straight to
  // a Web Audio node and was never stored, so it silently reset on every
  // track change.
  playbackPitch: 1,
  playbackPitchByBook: {},

  // --- Workflow ---------------------------------------------------------
  // Off by default. Auto-opening is a convenience that becomes an obstacle the
  // first time you wanted a *different* book, and the cost of guessing wrong
  // is higher than the second it saves when right.
  autoOpenLast: false,
  // A 1000-chapter book must not be queued in one action: a job that fails at
  // chapter 800 is painful to resume, and the API cost is real.
  batchSize: 20,
  // Pagination, not virtualisation: it is simpler, keyboard-friendly, and
  // gives a stable "where am I" that an infinite scroller cannot.
  chaptersPerPage: 50,

  // --- Reader (previously separate localStorage keys) --------------------
  readerFontSize: 16,
  readerFontFamily: 'serif',
  readerLineHeight: '1.7',
  readerTheme: 'dark',

  // --- Conversion -------------------------------------------------------
  // The narration settings are offered in more than one place (the sidebar
  // card, the selection bar, and the per-chapter Convert dialog). They were
  // previously read straight off whichever <select> happened to be nearest,
  // so the dialog could silently convert with a different voice than the one
  // the summary line showed. These four keys are now the single source of
  // truth; every surface reads and writes them, so a change made anywhere is
  // immediately visible everywhere.
  //
  // `null` means "not chosen yet" — the catalog's per-language default is
  // used instead, which is why this cannot simply default to a voice id: the
  // valid voices depend on the language.
  convLanguage: null,
  convVoiceId: null,
  convStyle: null,
  convScriptSource: 'ai',

  // --- Per-book conversion preferences -----------------------------------
  // Settings resolve in three levels: chapter override > book preset > global
  // default. Only the first two are stored here; the chapter override is
  // session-scoped and lives in main.js, because an exception you set for one
  // chapter should not quietly outlive the session that motivated it.
  //
  // { [bookId]: { language, voiceId, translationStyle, scriptSource } }
  bookPresets: {},
  // Which books have agreed that a row's quick action may fire without asking.
  // Absent means "ask" — a first conversion should never be a surprise.
  // { [bookId]: true }
  bookQuickAction: {},
  // How a batch should behave when the selection has mixed effective settings:
  // 'perChapter' keeps each chapter's own settings, 'uniform' applies one set
  // to everything for that batch. Absent means "ask each time".
  // { [bookId]: 'perChapter' | 'uniform' }
  bookBatchMode: {},

  // { [bookId]: chapterIndex }
  lastReadChapter: {},
};

let cache = null;

function read() {
  if (cache) return cache;
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    // Corrupt settings must never prevent the app from starting; falling back
    // to defaults is always recoverable, a boot failure is not.
    stored = {};
  }
  cache = { ...DEFAULTS, ...stored };
  return cache;
}

function write(next) {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private browsing and full quotas both throw here. The setting still
    // applies for this session, which is better than crashing the caller.
  }
}

/** Read one setting, falling back to its default. */
export function getSetting(key) {
  const all = read();
  return all[key] !== undefined ? all[key] : DEFAULTS[key];
}

/** Persist one setting. */
export function setSetting(key, value) {
  const all = { ...read(), [key]: value };
  write(all);
  return value;
}

/** Every setting, as a plain object. */
export function allSettings() {
  return { ...read() };
}

// ---------------------------------------------------------------------------
// Playback speed
// ---------------------------------------------------------------------------

/** The preset rungs offered in the player. */
export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * Below 0.25× artefacts dominate and above 4× speech stops being
 * intelligible, so a custom value outside this range is not a preference —
 * it is a broken player.
 */
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;

export function clampSpeed(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(n * 100) / 100));
}

/**
 * The speed to use for a book: its own override if one was set, otherwise the
 * global default.
 */
export function speedForBook(bookId) {
  const s = read();
  const perBook = s.playbackRateByBook || {};
  if (bookId != null && perBook[bookId] != null) return clampSpeed(perBook[bookId]);
  return clampSpeed(s.playbackRate);
}

/**
 * Remember a speed. Setting it while a book is open is treated as "this book
 * reads better at this speed" rather than a global change, because that is
 * almost always what the user meant — the global default is changed
 * explicitly in settings.
 */
export function rememberSpeed(bookId, rate) {
  const value = clampSpeed(rate);
  if (bookId == null) return setSetting('playbackRate', value);
  const perBook = { ...(read().playbackRateByBook || {}), [bookId]: value };
  setSetting('playbackRateByBook', perBook);
  return value;
}

/**
 * Promote the current speed to the global default ("Make default" in the
 * player). The per-book override is deliberately cleared at the same time:
 * leaving it behind would mean the book you were listening to when you set
 * the default is the one book that ignores it.
 */
export function makeSpeedDefault(bookId, rate) {
  const value = clampSpeed(rate);
  setSetting('playbackRate', value);
  if (bookId != null) {
    const perBook = { ...(read().playbackRateByBook || {}) };
    delete perBook[bookId];
    setSetting('playbackRateByBook', perBook);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Playback pitch / tone
// ---------------------------------------------------------------------------

/**
 * Pitch is a tone shaping value, not a musical pitch: 1 is untouched, below 1
 * is deeper, above 1 is lighter. It mirrors speed exactly — a global default
 * plus an optional per-book override — because the reasoning is identical: a
 * tone that suits one narrator rarely suits the next, and having to re-set it
 * on every chapter is the bug this replaces.
 */
export const PITCH_MIN = 0.5;
export const PITCH_MAX = 2;

export function clampPitch(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(PITCH_MAX, Math.max(PITCH_MIN, Math.round(n * 100) / 100));
}

export function pitchForBook(bookId) {
  const s = read();
  const perBook = s.playbackPitchByBook || {};
  if (bookId != null && perBook[bookId] != null) return clampPitch(perBook[bookId]);
  return clampPitch(s.playbackPitch);
}

export function rememberPitch(bookId, pitch) {
  const value = clampPitch(pitch);
  if (bookId == null) return setSetting('playbackPitch', value);
  const perBook = { ...(read().playbackPitchByBook || {}), [bookId]: value };
  setSetting('playbackPitchByBook', perBook);
  return value;
}

export function makePitchDefault(bookId, pitch) {
  const value = clampPitch(pitch);
  setSetting('playbackPitch', value);
  if (bookId != null) {
    const perBook = { ...(read().playbackPitchByBook || {}) };
    delete perBook[bookId];
    setSetting('playbackPitchByBook', perBook);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Last-read position
// ---------------------------------------------------------------------------

export function getLastRead(bookId) {
  const map = read().lastReadChapter || {};
  return map[bookId];
}

export function setLastRead(bookId, chapterIndex) {
  if (bookId == null) return;
  const map = { ...(read().lastReadChapter || {}), [bookId]: chapterIndex };
  setSetting('lastReadChapter', map);
}

// ---------------------------------------------------------------------------
// One-time migration from the loose keys used before this module existed
// ---------------------------------------------------------------------------

/**
 * Users who already have preferences must not silently lose them the first
 * time they load a build containing this module.
 */
export function migrateLegacySettings() {
  if (localStorage.getItem(KEY)) return; // already migrated

  const legacy = {};
  const num = (k) => {
    const v = parseInt(localStorage.getItem(k) || '', 10);
    return Number.isFinite(v) ? v : undefined;
  };

  const fontSize = num('reader_font_size');
  if (fontSize !== undefined) legacy.readerFontSize = fontSize;

  const map = {
    reader_font_family: 'readerFontFamily',
    reader_line_height: 'readerLineHeight',
    reader_theme: 'readerTheme',
  };
  for (const [from, to] of Object.entries(map)) {
    const v = localStorage.getItem(from);
    if (v) legacy[to] = v;
  }

  try {
    const lastRead = JSON.parse(localStorage.getItem('last_read_chapter') || '{}');
    if (lastRead && typeof lastRead === 'object') legacy.lastReadChapter = lastRead;
  } catch { /* ignore unparseable legacy value */ }

  if (Object.keys(legacy).length) write({ ...DEFAULTS, ...legacy });
}

// ---------------------------------------------------------------------------
// Conversion settings
// ---------------------------------------------------------------------------

/**
 * The narration settings, resolved against the catalog.
 *
 * A stored voice is only meaningful for the language it belongs to, so a
 * stored value is discarded when it is not valid for the current language
 * rather than being sent to the server to be rejected. That is why this takes
 * the catalog as an argument instead of importing it: settings must not depend
 * on the catalog module, which loads asynchronously from the server.
 *
 * @param {{languages:Array, styles:Array}} catalog
 * @returns {{language:string, voiceId:string, translationStyle:string|undefined, scriptSource:string, requiresAi:boolean}}
 */
export function getConversionSettings(catalog, bookId = null) {
  const s = read();
  const languages = catalog?.languages || [];

  // Level 2: a book preset overlays the global default. Resolving it here
  // rather than at each call site is what keeps "effective settings" a single
  // definition — every surface asks this function and gets the same answer.
  const preset = (bookId != null && s.bookPresets?.[bookId]) || {};

  // Language: stored value if the catalog still has it, else the first one.
  let language = preset.language || s.convLanguage;
  if (!language || !languages.some((l) => l.code === language)) {
    language = languages[0]?.code || 'en';
  }
  const lang = languages.find((l) => l.code === language);

  // Voice: only keep the stored voice if it belongs to THIS language.
  const voices = lang?.voices || [];
  let voiceId = preset.voiceId || s.convVoiceId;
  if (!voiceId || !voices.some((v) => v.id === voiceId)) {
    voiceId = lang?.defaultVoice || voices[0]?.id || '';
  }

  // Style only exists to steer the AI, so it is undefined when no AI runs —
  // sending one anyway would imply a setting the backend ignores.
  const allowedStyles = (catalog?.styles || []).filter((st) => (lang?.styles || []).includes(st.id));
  let translationStyle = preset.translationStyle || s.convStyle;
  if (!translationStyle || !allowedStyles.some((st) => st.id === translationStyle)) {
    translationStyle = lang?.defaultStyle || allowedStyles[0]?.id;
  }

  const rawSource = preset.scriptSource || s.convScriptSource;
  const scriptSource = ['ai', 'custom', 'original'].includes(rawSource) ? rawSource : 'ai';

  const requiresAi = !!lang?.requiresAi && scriptSource === 'ai';

  return {
    language,
    voiceId,
    translationStyle: requiresAi ? translationStyle : undefined,
    scriptSource,
    requiresAi,
  };
}

/**
 * Persist narration settings. Accepts a partial patch so a surface that only
 * exposes the voice does not have to know about the others.
 */
export function setConversionSettings(patch = {}) {
  const map = {
    language: 'convLanguage',
    voiceId: 'convVoiceId',
    translationStyle: 'convStyle',
    scriptSource: 'convScriptSource',
  };
  const next = { ...read() };
  for (const [from, to] of Object.entries(map)) {
    if (patch[from] !== undefined) next[to] = patch[from];
  }
  write(next);
  return next;
}

// ---------------------------------------------------------------------------
// Per-book conversion preferences (level 2 of three)
// ---------------------------------------------------------------------------

/** The raw stored preset for a book, or an empty object. */
export function getBookPreset(bookId) {
  if (bookId == null) return {};
  return { ...(read().bookPresets?.[bookId] || {}) };
}

/**
 * Save this book's default narration settings.
 *
 * Deliberately scoped to the book rather than the app: a voice chosen for a
 * Hindi novel is rarely the right default for the next book, and a global
 * write would make every book inherit a choice made about one.
 */
export function setBookPreset(bookId, patch = {}) {
  if (bookId == null) return {};
  const presets = { ...(read().bookPresets || {}) };
  const merged = { ...(presets[bookId] || {}) };
  for (const key of ['language', 'voiceId', 'translationStyle', 'scriptSource']) {
    if (patch[key] !== undefined) merged[key] = patch[key];
  }
  presets[bookId] = merged;
  setSetting('bookPresets', presets);
  return merged;
}

export function clearBookPreset(bookId) {
  if (bookId == null) return;
  const presets = { ...(read().bookPresets || {}) };
  delete presets[bookId];
  setSetting('bookPresets', presets);
}

/**
 * Whether a row's quick action may start a conversion without opening the
 * dialog first. Absent means "ask": the first conversion in a book should
 * never be a surprise, because it spends API tokens and TTS time on settings
 * the user has not yet seen.
 */
export function getQuickActionAllowed(bookId) {
  if (bookId == null) return false;
  return !!read().bookQuickAction?.[bookId];
}

export function setQuickActionAllowed(bookId, allowed) {
  if (bookId == null) return;
  const map = { ...(read().bookQuickAction || {}) };
  if (allowed) map[bookId] = true;
  else delete map[bookId];
  setSetting('bookQuickAction', map);
}

/**
 * Remembered answer to "this selection has mixed settings — what now?".
 * Returns 'perChapter' | 'uniform' | null, where null means ask.
 */
export function getBatchMode(bookId) {
  if (bookId == null) return null;
  const mode = read().bookBatchMode?.[bookId];
  return mode === 'perChapter' || mode === 'uniform' ? mode : null;
}

export function setBatchMode(bookId, mode) {
  if (bookId == null) return;
  const map = { ...(read().bookBatchMode || {}) };
  if (mode === 'perChapter' || mode === 'uniform') map[bookId] = mode;
  else delete map[bookId];
  setSetting('bookBatchMode', map);
}
