/**
 * Log console.
 *
 * Transparency was an explicit requirement: the user must be able to see
 * exactly what the backend is doing, per chapter, including raw provider
 * errors — not just a toast that disappears.
 *
 * Two properties matter and are easy to lose in a refactor:
 *   - History is **persisted server-side**, so reloading the page or reopening
 *     a book does not lose the log (the "sometimes I see the console, sometimes
 *     I don't" bug).
 *   - Frontend crashes are recorded here too, so a browser-side exception can
 *     never fail silently.
 */
import { $ } from '../utils/dom.js';
import { escapeHtml } from '../utils/html.js';
import { api } from '../services/api.js';
import { state } from '../store.js';
import { showToast } from './toast.js';

/** Everything received this session, so filters re-render without refetching. */
const logBuffer = [];
let logFilter = { level: 'all', search: '', chapterOnly: null };

const LEVEL_ICON = { debug: '·', info: 'ℹ', success: '✓', warn: '⚠', error: '✕' };

/** Errors seen since the panel was last opened — what the bubble reports. */
let unseenErrors = 0;

/** Open/close the floating console panel. */
function setConsoleOpen(open) {
  const panel = $('#console-panel');
  const fab = $('#console-fab');
  if (!panel || !fab) return;

  panel.classList.toggle('hidden', !open);
  fab.setAttribute('aria-expanded', String(open));

  if (open) {
    // Opening the panel is the user acknowledging the errors, so the bubble
    // stops shouting — but the lines themselves are never removed.
    unseenErrors = 0;
    refreshFab();
    $('#log-search')?.focus();
  }
}

/**
 * The bubble reports state at a glance: how many lines, and whether any of
 * them are errors. Without this, a failed conversion was only discoverable by
 * opening a panel that was collapsed by default — so the app could fail
 * silently, which is the worst thing a long-running job can do.
 */
function refreshFab() {
  const fab = $('#console-fab');
  const count = $('#log-count');
  if (!fab || !count) return;

  const hasErrors = unseenErrors > 0;
  fab.classList.toggle('has-errors', hasErrors);
  count.textContent = hasErrors ? String(unseenErrors) : String(logBuffer.length);
  fab.title = hasErrors
    ? `${unseenErrors} error${unseenErrors > 1 ? 's' : ''} — click to see what failed`
    : 'Activity log';
}

export function initLogConsole() {
  $('#console-fab')?.addEventListener('click', () => {
    setConsoleOpen($('#console-panel')?.classList.contains('hidden'));
  });
  $('#console-close')?.addEventListener('click', () => setConsoleOpen(false));

  $('#log-level-filter')?.addEventListener('change', (e) => {
    logFilter.level = e.target.value;
    renderLogs();
  });

  $('#log-search')?.addEventListener('input', (e) => {
    logFilter.search = e.target.value.toLowerCase();
    renderLogs();
  });

  $('#log-copy')?.addEventListener('click', async () => {
    const text = visibleLogs()
      .map((l) => `[${new Date(l.timestamp).toLocaleTimeString()}] [${l.level}] ${l.message}${l.detail ? `\n${l.detail}` : ''}`)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showToast(`Copied ${visibleLogs().length} log lines`, 'success');
    } catch {
      showToast('Could not copy to clipboard', 'error');
    }
  });

  $('#log-clear')?.addEventListener('click', async () => {
    if (!confirm('Clear the log history for this book?')) return;
    try {
      if (state.currentBookId) await api.clearLogs(state.currentBookId);
      logBuffer.length = 0;
      renderLogs();
    } catch (err) {
      showToast('Could not clear logs: ' + err.message, 'error');
    }
  });
}

/**
 * Open the console showing only one chapter's lines.
 *
 * "View logs" on a failed row is a question about that chapter, so answering
 * it with the whole book's log leaves the user to find the failure themselves —
 * which is the work they pressed the button to avoid.
 */
export function showLogsForChapter(chapterIndex) {
  logFilter.chapterOnly = chapterIndex;
  logFilter.level = 'all';
  logFilter.search = '';
  const level = $('#log-level-filter');
  if (level) level.value = 'all';
  const search = $('#log-search');
  if (search) search.value = '';
  renderLogs();
  setConsoleOpen(true);
}

/** Drop the per-chapter restriction, so the console shows the whole book again. */
export function clearChapterLogFilter() {
  logFilter.chapterOnly = null;
  renderLogs();
}

/** Load logs already stored on the server for this book. */export async function loadPersistedLogs(bookId) {
  if (!bookId) return;
  try {
    const { logs } = await api.getLogs(bookId, { limit: 500 });
    logBuffer.length = 0;
    logBuffer.push(...logs);
    renderLogs();
  } catch (err) {
    console.warn('Could not load log history', err);
  }
}

function visibleLogs() {
  return logBuffer.filter((l) => {
    if (logFilter.level !== 'all' && l.level !== logFilter.level) return false;
    if (logFilter.chapterOnly !== null && l.chapterIndex !== logFilter.chapterOnly) return false;
    if (logFilter.search) {
      const hay = `${l.message} ${l.detail || ''} ${l.stage || ''}`.toLowerCase();
      if (!hay.includes(logFilter.search)) return false;
    }
    return true;
  });
}

export function renderLogs() {
  const entries = $('#log-entries');
  if (!entries) return;

  const list = visibleLogs();
  // The bubble's count is owned solely by refreshFab(), so the two cannot
  // disagree about what the number means.
  refreshFab();

  if (!list.length) {
    entries.innerHTML = `<div class="log-empty">No log lines${logBuffer.length ? ' match this filter' : ' yet'}.</div>`;
    return;
  }

  // Keep the DOM bounded — a 5,000-chapter run would otherwise freeze the tab.
  entries.innerHTML = list.slice(-800).map(logRowHtml).join('');
  entries.scrollTop = entries.scrollHeight;
}

function logRowHtml(l) {
  const time = new Date(l.timestamp).toLocaleTimeString();
  const chapter = l.chapterIndex !== null && l.chapterIndex !== undefined
    ? `<span class="log-chip">Ch ${l.chapterIndex + 1}</span>` : '';
  const stage = l.stage ? `<span class="log-chip stage-${l.stage}">${l.stage}</span>` : '';

  // Raw provider payloads are kept verbatim and shown on demand, so a failure
  // can be diagnosed without digging through server files.
  const detail = l.detail
    ? `<details class="log-detail"><summary>details</summary><pre>${escapeHtml(
        typeof l.detail === 'string' ? l.detail : JSON.stringify(l.detail, null, 2)
      )}</pre></details>`
    : '';

  return `
    <div class="log-entry ${l.level || 'info'}">
      <span class="log-time">${time}</span>
      <span class="log-icon">${LEVEL_ICON[l.level] || 'ℹ'}</span>
      ${chapter}${stage}
      <span class="log-msg">${escapeHtml(l.message)}</span>
      ${detail}
    </div>`;
}

export function addLogEntry(entry) {
  const record = {
    level: entry.level || 'info',
    message: entry.message || '',
    detail: entry.detail || null,
    stage: entry.stage || null,
    chapterIndex: entry.chapterIndex ?? null,
    timestamp: entry.timestamp || new Date().toISOString(),
  };

  // Drop duplicates.
  //
  // The same line can legitimately arrive twice: once live over the socket and
  // again from the persisted history when the book is (re)opened, since the
  // backend writes to SQLite *and* emits. Without an identity check the console
  // showed each step two or three times, which made a single chapter conversion
  // look like several. A line is the same line if it was written at the same
  // instant with the same text about the same chapter.
  //
  // Only the tail is searched: a duplicate is always a near-simultaneous echo,
  // so scanning all 5000 buffered lines on every log line would cost far more
  // than it catches.
  const tail = logBuffer.slice(-100);
  const isDuplicate = tail.some((l) =>
    l.timestamp === record.timestamp &&
    l.message === record.message &&
    l.chapterIndex === record.chapterIndex &&
    l.level === record.level
  );
  if (isDuplicate) return;

  logBuffer.push(record);
  if (logBuffer.length > 5000) logBuffer.splice(0, logBuffer.length - 5000);

  // An error that arrives while the panel is closed must still be noticed.
  const panelOpen = !$('#console-panel')?.classList.contains('hidden');
  if (record.level === 'error' && !panelOpen) {
    unseenErrors++;
    const fab = $('#console-fab');
    if (fab) {
      // Restart the pulse so a second failure is also felt, not just counted.
      fab.classList.remove('pulse');
      void fab.offsetWidth; // force reflow so the animation replays
      fab.classList.add('pulse');
    }
  }

  renderLogs();
  refreshFab();

  // Mirror the newest line onto the chapter row. The backend sends a real
  // chapterIndex, so we no longer regex a chapter number out of prose.
  const idx = record.chapterIndex;
  if (idx !== null && idx !== undefined) {
    const liveLog = $(`#ch-live-log-${idx}`);
    if (liveLog) {
      liveLog.style.display = 'block';
      liveLog.textContent = `⚡ ${record.message}`;
    }
  }
}

/**
 * Surface FRONTEND crashes in the log console.
 *
 * The console only rendered events pushed from the server, so a browser-side
 * exception (a renamed API method, a bad field) died silently in devtools and
 * the UI just did nothing. That is exactly how "convert does nothing, no logs
 * anywhere" happened.
 */
export function initCrashReporting() {
  const report = (message, detail) => {
    addLogEntry({ level: 'error', message: `[App] ${message}`, detail, source: 'frontend' });
    showToast(message, 'error');
  };

  window.addEventListener('error', (e) => {
    report(e.message || 'Unexpected error', `${e.filename}:${e.lineno}\n${e.error?.stack || ''}`);
  });

  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    report(
      reason?.message || String(reason) || 'Unhandled promise rejection',
      reason?.body ? JSON.stringify(reason.body, null, 2) : reason?.stack
    );
  });
}
