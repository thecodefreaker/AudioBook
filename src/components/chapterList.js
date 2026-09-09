/**
 * The chapter list.
 *
 * Two problems in the previous version are fixed structurally here:
 *
 *  1. **Listener stacking.** Every render attached fresh listeners to every
 *     row. Converting ten chapters re-rendered ten times, so a single click
 *     eventually fired through ten live handlers. This module binds *once*, to
 *     the container, and reads intent from `data-act` — so re-rendering can
 *     never duplicate behaviour.
 *
 *  2. **Filtering by inspecting the DOM.** `applyChapterFilters` used to read
 *     titles back out of rendered HTML and toggle `style.display`, which meant
 *     the filter silently disagreed with the data whenever markup changed.
 *     Filtering and sorting now happen on the chapter data, and the DOM is a
 *     pure function of the result.
 */
import { escapeHtml } from '../utils/html.js';
import { formatNumber, formatTime } from '../utils/formatters.js';
import { audioBadges, versionLabel, voiceName, languageName, styleName, stageLabel, recoveryFor } from './catalog.js';
import { formatDateTime } from '../utils/formatters.js';
import { state } from '../store.js';
import { getSetting } from '../services/settings.js';
import { createChapterScrubber } from './chapterScrubber.js';

let scrubberInstance = null;

/**
 * Current page, 0-based.
 *
 * Books here run to a thousand chapters. Rendering them all produces tens of
 * thousands of DOM nodes, which makes scrolling stutter and selection lag.
 * Pagination keeps the DOM small; unlike a virtualiser it also gives a stable,
 * shareable answer to "where am I" and stays keyboard-navigable for free.
 */
let page = 0;

const ICON_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;
const ICON_EYE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
const ICON_TRASH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const ICON_REDO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>`;
const ICON_SLIDERS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="13" height="13"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>`;

/** Set by init(); the app-level actions a row can trigger. */
let handlers = {};
let bound = false;

/** Audio versions for a chapter, newest first. */
function versionsFor(chapter) {
  return (state.audioFiles || []).filter((a) => a.chapterId === chapter.id && !a.isMerged);
}

/**
 * The "this chapter disagrees with the book" chip.
 *
 * An override used to be visible only inside the dialog that created it, so a
 * chapter could convert with a different voice than the summary above the list
 * advertised and nothing on screen said why. The chip states that it exists,
 * its tooltip states what it is, and the ✕ removes it — the three things you
 * need to stop being surprised by it.
 */
function overrideChipHtml(ch) {
  const o = state.chapterOverrides?.[ch.chapterIndex];
  if (!o) return '';

  const bits = [languageName(o.language), voiceName(o.voiceId)].filter(Boolean);
  if (o.scriptSource === 'custom') bits.push('My script');
  else if (o.scriptSource === 'original') bits.push('Original text');
  else if (o.translationStyle) bits.push(styleName(o.translationStyle));
  const detail = bits.join(' · ') || 'custom settings';

  return `
    <span class="ch-override" data-act="override-info" data-ch="${ch.chapterIndex}"
          title="This chapter uses its own settings: ${escapeHtml(detail)}">
      Override
      <button class="ch-override-reset" data-act="reset-override" data-ch="${ch.chapterIndex}"
              title="Reset to book default" aria-label="Reset chapter ${ch.chapterIndex + 1} to book default">✕</button>
    </span>`;
}

// ---------------------------------------------------------------------------
// Filtering / sorting — computed from data, never read back from the DOM
// ---------------------------------------------------------------------------
export function visibleChapters() {
  const term = (document.querySelector('#chapter-search-input')?.value || '').trim().toLowerCase();
  const filter = document.querySelector('.filter-tab[aria-selected="true"]')?.dataset.filter || 'all';
  const sort = document.querySelector('#chapter-sort-select')?.value || 'index_asc';

  const rows = (state.chapters || []).filter((ch) => {
    const hasAudio = versionsFor(ch).length > 0;
    const converting = !!state.activeGenerations[ch.chapterIndex];

    // Chapter numbers are 1-based on screen, so searching "12" must match the
    // chapter labelled 12 rather than the one at array index 12.
    const matchesSearch =
      !term ||
      (ch.title || '').toLowerCase().includes(term) ||
      String(ch.chapterIndex + 1).includes(term);

    const matchesTab =
      filter === 'all' ||
      (filter === 'ready' && hasAudio) ||
      (filter === 'progress' && converting) ||
      // Failures are the chapters most likely to be looked for deliberately,
      // and the hardest to find by scrolling a thousand rows.
      (filter === 'failed' && !!state.chapterErrors[ch.chapterIndex]);

    return matchesSearch && matchesTab;
  });

  const latest = (ch) => {
    if (ch._latestAudioTimestamp !== undefined) return ch._latestAudioTimestamp;
    const v = versionsFor(ch)[0];
    ch._latestAudioTimestamp = v ? new Date(v.createdAt).getTime() : 0;
    return ch._latestAudioTimestamp;
  };
  const byTitle = (a, b) => (a.title || '').localeCompare(b.title || '');

  const sorters = {
    index_asc: (a, b) => a.chapterIndex - b.chapterIndex,
    index_desc: (a, b) => b.chapterIndex - a.chapterIndex,
    name_asc: byTitle,
    name_desc: (a, b) => byTitle(b, a),
    date_desc: (a, b) => latest(b) - latest(a),
    // Chapters with no audio have no date at all; sorting them as "oldest"
    // would put every unconverted chapter first, which is never what's meant.
    date_asc: (a, b) => {
      const x = latest(a), y = latest(b);
      if (!x && !y) return a.chapterIndex - b.chapterIndex;
      if (!x) return 1;
      if (!y) return -1;
      return x - y;
    },
  };
  return rows.sort(sorters[sort] || sorters.index_asc);
}

// ---------------------------------------------------------------------------
// Row markup
// ---------------------------------------------------------------------------

/**
 * The five named backend stages, shown as a stepper.
 *
 * A single percentage cannot answer "what is it actually doing?", and that
 * question is exactly what a user asks when a long job appears stuck. The
 * backend already emits a stage name with every progress event; it simply was
 * never rendered.
 */
const PIPELINE_STAGES = [
  { id: 'prepare', label: 'Prepare' },
  { id: 'script', label: 'Script' },
  { id: 'synth', label: 'Voice' },
  { id: 'stitch', label: 'Stitch' },
  { id: 'index', label: 'Finish' },
];

function stageStepperHtml(current) {
  const idx = PIPELINE_STAGES.findIndex((s) => s.id === current);
  return `<ol class="stage-stepper" aria-label="Conversion stage">${
    PIPELINE_STAGES.map((s, i) => {
      const cls = i < idx ? 'done' : i === idx ? 'active' : 'todo';
      return `<li class="stage-step ${cls}" title="${s.label}"><span class="stage-dot"></span><span class="stage-label">${s.label}</span></li>`;
    }).join('')
  }</ol>`;
}

/** Secondary line: chunk position, model, and any countdown. */
function genMetaText(gen) {
  const bits = [];
  if (gen.chunkTotal > 1) bits.push(`part ${gen.chunkCurrent}/${gen.chunkTotal}`);
  if (gen.model) bits.push(gen.model);
  if (gen.waiting && gen.resumesAt) {
    const secs = Math.max(0, Math.ceil((gen.resumesAt - Date.now()) / 1000));
    bits.push(`resumes in ${secs}s`);
  }
  if (gen.updatedAt) {
    const ago = Math.round((Date.now() - gen.updatedAt) / 1000);
    // "Last update 3s ago" is the single cheapest way to prove the backend is
    // still alive. Without it a paused job looks identical to a crashed one.
    if (ago >= 3) bits.push(`last update ${ago}s ago`);
  }
  return bits.join(' · ');
}

function actionsHtml(ch, versions) {
  const gen = state.activeGenerations[ch.chapterIndex];

  if (gen) {
    return `
      <div class="ch-progress ${gen.waiting ? 'is-waiting' : ''}" role="status" aria-live="polite">
        ${stageStepperHtml(gen.stage)}
        <span class="ch-progress-msg">${escapeHtml(gen.message || 'Creating audiobook')}</span>
        <div class="progress ${gen.waiting ? 'progress-indeterminate' : ''}">
          <div class="progress-fill" style="width:${gen.percent || 0}%"></div>
        </div>
        <span class="ch-progress-meta">${escapeHtml(genMetaText(gen))}</span>
      </div>
      <div class="ch-actions">
        <button class="btn btn-ghost btn-icon btn-sm" data-act="preview" data-ch="${ch.chapterIndex}" title="Read chapter" aria-label="Read chapter">${ICON_EYE}</button>
        <button class="btn btn-ghost btn-sm" data-act="cancel" data-ch="${ch.chapterIndex}" ${gen.stopping ? 'disabled' : ''}>${gen.stopping ? 'Stopping…' : 'Stop'}</button>
      </div>`;
  }

  if (!versions.length) {
    return `
      <div class="ch-badges"></div>
      <div class="ch-actions">
        <button class="btn btn-secondary btn-sm" data-act="preview" data-ch="${ch.chapterIndex}" title="Read chapter">${ICON_EYE} Read</button>
        <div class="btn-split on-hover">
           <button class="btn btn-ghost btn-sm btn-split-main" data-act="convert" data-ch="${ch.chapterIndex}" title="Retell this chapter in Hindi/Hinglish and create narrated audio">${ICON_PLAY} Create audio</button>
           <button class="btn btn-ghost btn-icon btn-sm btn-split-side" data-act="convert-options" data-ch="${ch.chapterIndex}" title="Choose retelling and narration settings…" aria-label="Choose audiobook settings">${ICON_SLIDERS}</button>
        </div>
        <button class="btn btn-ghost btn-sm ch-mobile-more" data-act="mobile-more" data-ch="${ch.chapterIndex}" aria-label="More actions">More</button>
      </div>`;
  }

  const newest = versions[0];
  const newestIdx = state.audioFiles.indexOf(newest);

  // One version: show what it is. Several: let the user pick, because the
  // difference between them (voice, style, script source) is the whole point
  // of keeping them.
  const badges = versions.length === 1
    ? `<div class="ch-badges">${audioBadges(newest)}</div>`
    : `<div class="ch-badges">
         <select class="select ch-version-select" data-act="pick-version" data-ch="${ch.chapterIndex}" aria-label="Choose audio version">
           ${versions.map((a, i) => {
             const when = formatDateTime(a.createdAt);
             return `<option value="${state.audioFiles.indexOf(a)}">V${versions.length - i}${when ? ` · ${when}` : ''} · ${escapeHtml(versionLabel(a))}</option>`;
           }).join('')}
         </select>
         <button class="chapter-badge" data-act="versions" data-ch="${ch.chapterIndex}" title="Manage all versions">Versions · ${versions.length}</button>
       </div>`;

  const isPlaying = state.isPlaying && state.currentAudioIndex === newestIdx;
  const playIconHtml = isPlaying
    ? `<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause`
    : `${ICON_PLAY} Play`;

  return `
    ${badges}
    <div class="ch-actions">
      <button class="btn btn-primary btn-sm" data-act="play" data-ch="${ch.chapterIndex}" data-audio-index="${newestIdx}">${playIconHtml}</button>
       <button class="btn btn-ghost btn-sm on-hover" data-act="preview" data-ch="${ch.chapterIndex}" title="Read chapter">${ICON_EYE} Read</button>
      <div class="btn-split on-hover">
         <button class="btn btn-ghost btn-icon btn-sm btn-split-main" data-act="convert" data-ch="${ch.chapterIndex}" title="Create another narrated audiobook version" aria-label="Create another audiobook version">${ICON_REDO}</button>
         <button class="btn btn-ghost btn-icon btn-sm btn-split-side" data-act="convert-options" data-ch="${ch.chapterIndex}" title="Choose retelling and narration settings…" aria-label="Choose audiobook settings">${ICON_SLIDERS}</button>
      </div>
      <button class="btn btn-ghost btn-icon btn-sm on-hover" data-act="delete-audio" data-ch="${ch.chapterIndex}" title="Delete selected version" aria-label="Delete audio">${ICON_TRASH}</button>
      <button class="btn btn-ghost btn-sm ch-mobile-more" data-act="mobile-more" data-ch="${ch.chapterIndex}" aria-label="More actions">More</button>
    </div>`;
}

/**
 * The failure block on a row.
 *
 * A red row saying "Failed" tells you something went wrong but not what to do,
 * so this names the stage and offers only the actions that can actually fix a
 * failure at that stage.
 */
function errorHtml(ch) {
  const err = state.chapterErrors[ch.chapterIndex];
  if (!err) return '';

  // Errors used to be stored as a bare string; tolerate both so a row can
  // never throw while rendering the thing that reports a problem.
  const message = typeof err === 'string' ? err : err.message;
  const stage = typeof err === 'string' ? null : err.stage;

  const buttons = recoveryFor(stage).map((r) => `
    <button class="btn ${r.primary ? 'btn-secondary' : 'btn-ghost'} btn-sm"
            data-act="${r.act}" data-ch="${ch.chapterIndex}">${escapeHtml(r.label)}</button>`).join('');

  return `
    <div class="ch-error">
      <strong>${escapeHtml(stageLabel(stage))}:</strong>
      <span>${escapeHtml(message || 'Generation failed')}</span>
      <div class="ch-error-actions">
        ${buttons}
        <button class="btn btn-ghost btn-sm" data-act="view-logs" data-ch="${ch.chapterIndex}">View logs</button>
      </div>
    </div>`;
}

function rowHtml(ch) {
  const versions = versionsFor(ch);
  const selected = state.selectedChapters.has(ch.chapterIndex);
  const error = state.chapterErrors[ch.chapterIndex];
  const playing = state.currentAudioIndex >= 0 &&
    state.audioFiles?.[state.currentAudioIndex]?.chapterId === ch.id;
  const gen = state.activeGenerations[ch.chapterIndex];

  // What a chapter *is* changes with its state, so the sub-line reports the
  // facts that matter in that state rather than always showing word count:
  // an unconverted chapter is defined by its length, a converted one by the
  // voice and duration you would actually be listening to.
  const newest = versions[0];
  const meta = [];
  if (newest) {
    if (newest.durationSeconds) meta.push(formatTime(newest.durationSeconds));
    const voice = voiceName(newest.voiceId);
    if (voice) meta.push(voice);
  } else {
    meta.push(`${formatNumber(ch.wordCount)} words`);
    // Reading time is a far more useful sense of size than a word count when
    // deciding what to convert next. 150wpm matches the server's estimate.
    if (ch.wordCount) meta.push(`~${formatTime((ch.wordCount / 150) * 60)}`);
  }

  const stateClass = gen ? 'is-generating' : versions.length ? 'is-ready' : 'is-untouched';

  return `
    <div class="ch-row ${stateClass} ${selected ? 'selected' : ''} ${playing ? 'playing' : ''} ${error ? 'is-error' : ''}" data-ch="${ch.chapterIndex}">
      <input type="checkbox" class="ch-check" data-act="select" data-ch="${ch.chapterIndex}" ${selected ? 'checked' : ''}
             aria-label="Select ${escapeHtml(ch.title || `chapter ${ch.chapterIndex + 1}`)}" />
      <span class="ch-num">${ch.chapterIndex + 1}</span>
      <div class="ch-main">
        <div class="ch-title" title="${escapeHtml(ch.title || '')}">${escapeHtml(ch.title || `Chapter ${ch.chapterIndex + 1}`)}</div>
        <div class="ch-meta">${escapeHtml(meta.join(' · '))}${overrideChipHtml(ch)}</div>
      </div>
      ${actionsHtml(ch, versions)}
      ${errorHtml(ch)}
    </div>`;
}

// ---------------------------------------------------------------------------
// Render + one-time event binding
// ---------------------------------------------------------------------------
export function renderChapters() {
  const list = document.querySelector('#chapters-list');
  if (!list) return;

  // Search, filter and sort deliberately run across the *whole* book before
  // paging. A search scoped to the current page would be a trap: it would
  // report "no matches" for a chapter that plainly exists.
  const matches = visibleChapters();

  const perPage = Math.max(10, getSetting('chaptersPerPage') || 50);
  const pageCount = Math.max(1, Math.ceil(matches.length / perPage));
  // Narrowing a search can leave you on a page that no longer exists, which
  // would render an empty list that looks like a bug.
  if (page >= pageCount) page = pageCount - 1;
  if (page < 0) page = 0;

  const start = page * perPage;
  const rows = matches.slice(start, start + perPage);

  if (!state.chapters.length) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon" aria-hidden="true">Reading room</div>
        <div class="empty-title">No book open</div>
        <p class="empty-text">Pick a book from your library, or add a new one.</p>
      </div>`;
  } else if (!rows.length) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-icon" aria-hidden="true">No match</div>
        <div class="empty-title">No chapters match</div>
        <p class="empty-text">Try a different search term or switch back to “All”.</p>
      </div>`;
  } else {
    list.innerHTML = rows.map(rowHtml).join('');
  }

  renderVolumePills(matches.length, perPage);
  scrubberInstance?.update(matches.length);
  renderPager(matches.length, pageCount, start, rows.length);
  updateCounts();
  handlers.onRendered?.();
}

/** Volume pills for navigating large books (e.g. 2,000+ chapters). */
function renderVolumePills(totalChapters, perPage) {
  const container = document.querySelector('#volume-pills-bar');
  if (!container) return;

  if (totalChapters <= perPage) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }

  container.hidden = false;
  const chunkSize = 100;
  const chunks = Math.ceil(totalChapters / chunkSize);
  const currentChunk = Math.floor((page * perPage) / chunkSize);

  let html = '';
  
  // Compact dropdown picker for instant mobile jumping
  html += `<select class="volume-select-dropdown" aria-label="Jump to volume">`;
  html += `<option value="" disabled selected>Jump ▾</option>`;
  for (let i = 0; i < chunks; i++) {
    const startCh = i * chunkSize + 1;
    const endCh = Math.min(totalChapters, (i + 1) * chunkSize);
    html += `<option value="${startCh}">Vol ${i + 1} (${startCh}–${endCh})</option>`;
  }
  html += `</select>`;

  // Horizontal scrollable pill buttons
  for (let i = 0; i < chunks; i++) {
    const startCh = i * chunkSize + 1;
    const endCh = Math.min(totalChapters, (i + 1) * chunkSize);
    const active = i === currentChunk;
    const bg = active ? 'rgb(168, 85, 247)' : 'rgb(36, 37, 51)';
    const color = active ? 'rgb(255, 255, 255)' : 'rgb(226, 228, 234)';
    const border = active ? 'rgb(192, 132, 252)' : 'rgba(255, 255, 255, 0.15)';
    html += `<button type="button" class="volume-pill${active ? ' active' : ''}" data-volume-idx="${i}" data-start-ch="${startCh}" style="background-color: ${bg} !important; color: ${color} !important; border-color: ${border} !important;">Vol ${i + 1} (${startCh}–${endCh})</button>`;
  }

  container.innerHTML = html;

  // Auto-scroll active pill into view so it's centered in the horizontal strip
  requestAnimationFrame(() => {
    if (currentChunk > 1) {
      const activePill = container.querySelector('.volume-pill.active');
      if (activePill) {
        activePill.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    } else {
      container.scrollLeft = 0;
    }
  });
}

/** The pager only appears when there is more than one page to move between. */
function renderPager(total, pageCount, start, shown) {
  const pager = document.querySelector('#chapter-pager');
  if (!pager) return;

  pager.hidden = pageCount <= 1;
  if (pager.hidden) return;

  // Naming the range rather than just the page number answers "how far in am
  // I" without arithmetic — the thing you actually want to know in a book of
  // a thousand chapters.
  const status = document.querySelector('#pager-status');
  if (status) {
    status.textContent = `${start + 1}–${start + shown} of ${total} · page ${page + 1} of ${pageCount}`;
  }

  const input = document.querySelector('#pager-input');
  if (input) { input.max = String(pageCount); input.value = String(page + 1); }

  const prev = document.querySelector('#pager-prev');
  const next = document.querySelector('#pager-next');
  if (prev) prev.disabled = page === 0;
  if (next) next.disabled = page >= pageCount - 1;
}

/** Change page and return the list to the top, since the content fully changed. */
function goToPage(n) {
  page = Math.max(0, n);
  renderChapters();
  document.querySelector('.content-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Filters and searches change what "page 1" means, so they reset the page. */
export function resetChapterPage() {
  page = 0;
}

/** Filter tab counts, "n selected", and the select-all tri-state. */
export function updateCounts() {
  const chapters = state.chapters || [];
  const ready = chapters.filter((c) => versionsFor(c).length > 0).length;
  const converting = Object.keys(state.activeGenerations || {}).length;
  const failed = Object.keys(state.chapterErrors || {}).length;

  const set = (sel, v) => { const el = document.querySelector(sel); if (el) el.textContent = v; };
  set('#count-all', chapters.length || '');
  set('#count-ready', ready || '');
  set('#count-progress', converting || '');
  set('#count-failed', failed || '');
  set('#chapter-count', `${state.selectedChapters.size} of ${chapters.length} selected`);

  // The Failed tab appears only when there is something in it. If the last
  // failure is cleared while the tab is selected, the filter would keep an
  // empty list on screen with no visible cause, so selection falls back to All.
  const failedTab = document.querySelector('#filter-tab-failed');
  if (failedTab) {
    failedTab.hidden = failed === 0;
    if (failed === 0 && failedTab.getAttribute('aria-selected') === 'true') {
      failedTab.setAttribute('aria-selected', 'false');
      document.querySelector('.filter-tab[data-filter="all"]')?.setAttribute('aria-selected', 'true');
    }
  }

  // The bulk toolbar exists only while a selection does, so an idle screen
  // stays clean and the actions never apply to "nothing".
  const bar = document.querySelector('#selection-bar');
  if (bar) {
    const n = state.selectedChapters.size;
    bar.hidden = n === 0;
    set('#selection-count', `${n} chapter${n === 1 ? '' : 's'} selected`);
  }

  const all = document.querySelector('#select-all-chapters');
  if (all) {
    all.checked = chapters.length > 0 && state.selectedChapters.size === chapters.length;
    all.indeterminate = state.selectedChapters.size > 0 && state.selectedChapters.size < chapters.length;
  }
}

/** The audio index the row's Play button should use, honouring the picker. */
function selectedAudioIndex(row) {
  const picker = row.querySelector('.ch-version-select');
  if (picker) return parseInt(picker.value, 10);
  const btn = row.querySelector('[data-act="play"]');
  return btn ? parseInt(btn.dataset.audioIndex, 10) : NaN;
}

/**
 * Patch a single row's progress without re-rendering the list.
 *
 * Progress events arrive many times a second per chapter. Re-rendering the
 * whole list on each one rebuilt every row — which made long books stutter and
 * closed any version dropdown the user had open mid-click.
 */
export function updateChapterRowProgress(chapterIdx, percent, message, gen = {}) {
  let row = document.querySelector(`.ch-row[data-ch="${chapterIdx}"]`);
  if (!row) {
    const filter = document.querySelector('.filter-tab[aria-selected="true"]')?.dataset.filter || 'all';
    if (filter === 'progress') {
      const isVisible = visibleChapters().some((c) => c.chapterIndex === chapterIdx);
      if (isVisible) {
        renderChapters();
        row = document.querySelector(`.ch-row[data-ch="${chapterIdx}"]`);
      }
    }
    if (!row) return;
  }

  const wrap = row.querySelector('.ch-progress');
  const bar = row.querySelector('.ch-progress .progress-fill');
  const label = row.querySelector('.ch-progress-msg');
  const meta = row.querySelector('.ch-progress-meta');

  // The row may still be showing its idle actions if this is the first event
  // for the chapter; a full render swaps it into the progress layout once.
  if (!bar) { renderChapters(); return; }

  bar.style.width = `${percent || 0}%`;
  if (label && message) label.textContent = message;
  if (meta) meta.textContent = genMetaText(gen);

  if (wrap) {
    // While throttled the bar must NOT sit still at a fixed width — a static
    // bar reads as "frozen". An indeterminate shimmer plus an explicit reason
    // reads as "deliberately waiting".
    wrap.classList.toggle('is-waiting', !!gen.waiting);
    wrap.querySelector('.progress')?.classList.toggle('progress-indeterminate', !!gen.waiting);
  }

  // Re-render the stepper only when the stage actually changes.
  const stepper = row.querySelector('.stage-stepper');
  if (stepper && gen.stage && stepper.dataset.stage !== gen.stage) {
    stepper.dataset.stage = gen.stage;
    stepper.outerHTML = stageStepperHtml(gen.stage);
  }
}

/**
 * Keep countdowns and "last update Ns ago" honest between socket events.
 *
 * Without this the meta line only refreshes when the backend speaks, so during
 * a 60-second pause it would claim "resumes in 60s" for the whole minute.
 */
let tickTimer = null;
export function startProgressTicker() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    const active = state.activeGenerations || {};
    for (const [idx, gen] of Object.entries(active)) {
      const row = document.querySelector(`.ch-row[data-ch="${idx}"]`);
      const meta = row?.querySelector('.ch-progress-meta');
      if (meta) meta.textContent = genMetaText(gen);
    }
  }, 1000);
}

export function initChapterList(actions) {
  handlers = actions || {};
  if (bound) return;
  bound = true;

  const list = document.querySelector('#chapters-list');

  list.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
    const idx = parseInt(el.dataset.ch, 10);
    const row = el.closest('.ch-row');

    switch (el.dataset.act) {
      case 'play': handlers.onPlay?.(selectedAudioIndex(row)); break;
      case 'convert': handlers.onConvert?.(idx); break;
      case 'convert-options': handlers.onConvertOptions?.(idx); break;
      case 'cancel': handlers.onCancel?.(idx); break;
      case 'preview': handlers.onPreview?.(idx); break;
      case 'versions': handlers.onVersions?.(idx); break;
      case 'delete-audio': handlers.onDeleteAudio?.(idx, selectedAudioIndex(row)); break;
      case 'mobile-more': row.classList.toggle('show-mobile-actions'); break;
      // The chip's ✕ removes only this chapter's exception. It sits inside the
      // chip, so the click must not also be read as "show me what it is".
      case 'reset-override': e.stopPropagation(); handlers.onResetOverride?.(idx); break;
      case 'override-info': handlers.onConvertOptions?.(idx); break;
      case 'retry-chapter': handlers.onRetry?.(idx); break;
      case 'use-my-script': handlers.onUseMyScript?.(idx); break;
      case 'view-logs': handlers.onViewLogs?.(idx); break;
    }
  });

  list.addEventListener('change', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (el.dataset.act === 'select') {
      const idx = parseInt(el.dataset.ch, 10);
      if (el.checked) state.selectedChapters.add(idx);
      else state.selectedChapters.delete(idx);
      el.closest('.ch-row')?.classList.toggle('selected', el.checked);
      updateCounts();
    }
  });

  // Search / filter / sort all funnel into a single re-render, so the list can
  // never end up showing one thing while the counts claim another. Each also
  // resets to page 1: staying on page 7 of a result set that now has two pages
  // would show an empty list for no visible reason.
  const rerenderFromTop = () => { resetChapterPage(); renderChapters(); };
  
  let searchTimeout;
  document.querySelector('#chapter-search-input')?.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(rerenderFromTop, 250);
  });
  document.querySelector('#chapter-sort-select')?.addEventListener('change', rerenderFromTop);

  document.querySelectorAll('.filter-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach((t) => t.setAttribute('aria-selected', 'false'));
      tab.setAttribute('aria-selected', 'true');
      rerenderFromTop();
    });
  });

  document.querySelector('#pager-prev')?.addEventListener('click', () => goToPage(page - 1));
  document.querySelector('#pager-next')?.addEventListener('click', () => goToPage(page + 1));
  document.querySelector('#pager-input')?.addEventListener('change', (e) => {
    const n = parseInt(e.target.value, 10);
    if (Number.isFinite(n)) goToPage(n - 1);
  });

  document.querySelector('#select-all-chapters')?.addEventListener('change', (e) => {
    // Select-all applies to what is *visible*, not to the whole book —
    // otherwise filtering to 3 chapters and pressing it would queue all 500.
    const visible = visibleChapters();
    visible.forEach((ch) => {
      if (e.target.checked) state.selectedChapters.add(ch.chapterIndex);
      else state.selectedChapters.delete(ch.chapterIndex);
    });
    renderChapters();
  });

  const scrollContainer = document.querySelector('.content-scroll');
  if (scrollContainer && list && !scrubberInstance) {
    scrollContainer.classList.add('chapter-scrubber-container');
    scrubberInstance = createChapterScrubber({
      container: scrollContainer,
      listEl: scrollContainer,
      getChapterAt: (idx) => {
        const chs = visibleChapters();
        return chs[idx] || state.chapters?.[idx];
      },
      totalChapters: (state.chapters || []).length,
      onScrub: (targetIdx) => {
        const perPage = Math.max(10, getSetting('chaptersPerPage') || 50);
        const targetPage = Math.floor(targetIdx / perPage);
        if (targetPage !== page) {
          page = targetPage;
          renderChapters();
        }
      },
      onSelect: (targetIdx) => {
        const perPage = Math.max(10, getSetting('chaptersPerPage') || 50);
        goToPage(Math.floor(targetIdx / perPage));
      }
    });
  }

  const volumeBar = document.querySelector('#volume-pills-bar');
  volumeBar?.addEventListener('click', (e) => {
    const pill = e.target.closest('.volume-pill');
    if (!pill) return;
    const startCh = parseInt(pill.dataset.startCh, 10);
    const perPage = Math.max(10, getSetting('chaptersPerPage') || 50);
    goToPage(Math.floor((startCh - 1) / perPage));
  });

  volumeBar?.addEventListener('change', (e) => {
    const select = e.target.closest('.volume-select-dropdown');
    if (!select || !select.value) return;
    const startCh = parseInt(select.value, 10);
    const perPage = Math.max(10, getSetting('chaptersPerPage') || 50);
    goToPage(Math.floor((startCh - 1) / perPage));
  });
}

export { updateCounts as updateChapterCounts };
