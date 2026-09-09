import { state } from '../store.js';
import { $, $$, show, hide, addClass, removeClass } from '../utils/dom.js';
import { escapeHtml } from '../utils/html.js';
import { getSetting, getLastRead } from '../services/settings.js';
import { socketService } from '../services/socket.js';
import { api } from '../services/api.js';
import { initHome, renderHome } from '../components/home.js';
import { loadLibrary } from './library.js';
import { handleUpload } from './upload.js';

// Dependencies that stay in main for now
import { loadBookFromLibrary, clearChapterOverrides } from '../main.js';
import { previewChapter } from '../reader/readerUi.js';
import { stopPlayback } from '../audio/player.js';
import { resetUpload } from './upload.js';
import { renderChapters } from '../components/chapterList.js';
import { renderBookOverview, setHeaderBook } from '../main.js';
import { showToast } from '../components/toast.js';

export function initConnectionIndicator() {
  const set = (status, text) => {
    const el = $('#connection-status');
    if (!el) return;
    el.dataset.status = status;
    el.title = text;
    el.querySelector('.conn-text').textContent = text;
  };

  socketService.on('connect', () => set('online', 'Connected'));
  socketService.on('disconnect', () => set('offline', 'Disconnected — reconnecting…'));
  socketService.on('connect_error', () => set('offline', 'Cannot reach the server — retrying…'));
  set(socketService.isConnected?.() ? 'online' : 'connecting', 'Connecting…');
}

export async function decideLandingView() {
  const books = state.libraryBooks || [];
  if (!books.length) {
    switchView('create');
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

export function initHomeView() {
  initHome({
    onUpload: () => $('#file-input')?.click(),
    onOpen: (id) => loadBookFromLibrary(id),
    onResume: async (id) => {
      await loadBookFromLibrary(id);
      const idx = getLastRead(id);
      if (idx != null) previewChapter(idx);
    },
    onSeeAll: () => switchView('library'),
  });
}

export function initShell() {
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
  $('#mobile-nav-settings')?.addEventListener('click', () => setSidebar(!sidebar?.classList.contains('open')));
  scrim?.addEventListener('click', () => setSidebar(false));

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = $$('.modal-overlay:not(.hidden)');
    if (open.length) {
      const top = open[open.length - 1];
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

  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const restoreFocusTo = new WeakMap();

  $$('.modal-overlay').forEach((overlay) => {
    new MutationObserver(() => {
      const isOpen = !overlay.classList.contains('hidden');
      if (isOpen) {
        restoreFocusTo.set(overlay, document.activeElement);
        const first = overlay.querySelector(FOCUSABLE);
        requestAnimationFrame(() => first?.focus());
      } else {
        const prev = restoreFocusTo.get(overlay);
        if (prev && document.contains(prev)) prev.focus();
        restoreFocusTo.delete(overlay);
      }
    }).observe(overlay, { attributes: true, attributeFilter: ['class'] });

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

  $('#btn-new-book')?.addEventListener('click', () => $('#file-input')?.click());
  $('#btn-export-db')?.addEventListener('click', () => {
    showToast('Preparing complete SQLite database export...', 'info');
    window.location.href = api.exportDbUrl();
  });
  $('#welcome-upload')?.addEventListener('click', () => $('#file-input')?.click());
  $('#library-upload')?.addEventListener('click', () => $('#file-input')?.click());
  $('#welcome-library')?.addEventListener('click', () => switchView('library'));

  $('#workspace-resume')?.addEventListener('click', () => {
    if (!state.currentBookId || !state.chapters.length) return;
    const last = getLastRead(state.currentBookId);
    previewChapter(last != null ? last : state.chapters[0].chapterIndex);
  });

  initChapterBrowser();

  $('#workspace-listen')?.addEventListener('click', () => {
    const search = $('#chapter-search-input');
    if (search && search.value) search.value = '';
    
    const readyTab = document.querySelector('.filter-tab[data-filter="ready"]');
    const readyCount = Number.parseInt(document.querySelector('#count-ready')?.textContent || '0', 10);
    if (readyCount > 0) readyTab?.click();
    document.querySelector('.content-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
    document.querySelector('#chapters-list [data-act="play"]')?.focus({ preventScroll: true });
    if (!readyCount) showToast('No audiobook chapters yet. Create one from the chapter list.', 'info');
  });

  $('#workspace-create-audio')?.addEventListener('click', () => {
    const search = $('#chapter-search-input');
    if (search && search.value) search.value = '';
    
    document.querySelector('.filter-tab[data-filter="all"]')?.click();
    document.querySelector('.content-scroll')?.scrollTo({ top: 0, behavior: 'smooth' });
    document.querySelector('#select-all-chapters')?.focus({ preventScroll: true });
    showToast('Select one or more chapters to retell and narrate.', 'info');
  });

  $('#btn-close-book')?.addEventListener('click', () => {
    state.currentBookId = null;
    state.currentBookMeta = null;
    state.chapters = [];
    state.audioFiles = [];
    state.selectedChapters = new Set();
    state.chapterErrors = {};
    state.activeGenerations = {};
    state.chapterJobs = {};
    clearChapterOverrides();

    stopPlayback();
    resetUpload();
    setHeaderBook(null);
    hide('#section-progress');
    renderChapters();
    renderBookOverview();
    switchView((state.libraryBooks || []).length ? 'home' : 'create');
  });
}

let chapterBrowserFilter = 'all';

function chapterHasAudio(chapter) {
  return (state.audioFiles || []).some((audio) => audio.chapterId === chapter.id && !audio.isMerged);
}

function renderChapterBrowser() {
  const list = $('#chapter-browser-list');
  if (!list) return;

  const query = ($('#chapter-browser-search')?.value || '').trim().toLowerCase();
  const lastRead = getLastRead(state.currentBookId);
  const chapters = (state.chapters || []).filter((chapter) => {
    const title = (chapter.title || `Chapter ${chapter.chapterIndex + 1}`).toLowerCase();
    const number = String(chapter.chapterIndex + 1);
    const matchesQuery = !query || title.includes(query) || number.includes(query);
    const hasAudio = chapterHasAudio(chapter);
    const matchesFilter = chapterBrowserFilter === 'all'
      || (chapterBrowserFilter === 'audio' && hasAudio)
      || (chapterBrowserFilter === 'unread' && (lastRead == null || chapter.chapterIndex > lastRead));
    return matchesQuery && matchesFilter;
  });

  if (!chapters.length) {
    list.innerHTML = `
      <div class="chapter-browser-empty">
        <strong>No chapters found</strong>
        <span>Try another search or filter.</span>
      </div>`;
    return;
  }

  list.innerHTML = chapters.map((chapter) => {
    const title = chapter.title || `Chapter ${chapter.chapterIndex + 1}`;
    const hasAudio = chapterHasAudio(chapter);
    const current = chapter.chapterIndex === state.readerChapterIdx;
    return `
      <button class="chapter-browser-row${current ? ' current' : ''}" data-browser-chapter="${chapter.chapterIndex}">
        <span class="chapter-browser-number">${chapter.chapterIndex + 1}</span>
        <span class="chapter-browser-copy">
          <strong>${escapeHtml(title)}</strong>
          <small>${hasAudio ? 'Audio ready' : chapter.wordCount ? `${chapter.wordCount.toLocaleString()} words` : 'Ready to read'}</small>
        </span>
        <span class="chapter-browser-state" aria-hidden="true">${current ? '✓' : hasAudio ? '▶' : ''}</span>
      </button>`;
  }).join('');
}

function initChapterBrowser() {
  const overlay = $('#chapter-browser');
  const open = () => {
    if (!state.currentBookId || !state.chapters.length) return;
    renderChapterBrowser();
    show('#chapter-browser');
    requestAnimationFrame(() => $('#chapter-browser-search')?.focus());
  };
  const close = () => hide('#chapter-browser');

  $('#workspace-chapters')?.addEventListener('click', open);
  $('#chapter-browser-close')?.addEventListener('click', close);
  overlay?.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  $('#chapter-browser-search')?.addEventListener('input', renderChapterBrowser);
  $$('.chapter-browser-filter').forEach((filter) => {
    filter.addEventListener('click', () => {
      chapterBrowserFilter = filter.dataset.browserFilter || 'all';
      $$('.chapter-browser-filter').forEach((button) => {
        const selected = button === filter;
        button.classList.toggle('active', selected);
        button.setAttribute('aria-selected', String(selected));
      });
      renderChapterBrowser();
    });
  });
  $('#chapter-browser-list')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-browser-chapter]');
    if (!button) return;
    close();
    previewChapter(Number(button.dataset.browserChapter));
  });
}

export function initNavigation() {
  $$('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      switchView(view);
    });
  });

  $('#library-search')?.addEventListener('input', () => {
    import('./library.js').then(m => m.renderLibrary());
  });
  $('#library-sort')?.addEventListener('change', () => {
    import('./library.js').then(m => m.renderLibrary());
  });
}

export function switchView(view) {
  state.currentView = view;
  $$('.nav-btn').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === view)));
  $$('.view').forEach(v => removeClass(v, 'active'));
  $(`#view-${view}`)?.classList.add('active');
  if (view === 'library') loadLibrary();
  if (view === 'home') renderHome(state.libraryBooks || [], state.activeBookJobs || {});
  applyWorkspaceMode();
}

export function applyWorkspaceMode() {
  const hasBook = !!state.currentBookId && (state.chapters || []).length > 0;
  const app = $('#app');
  if (app) app.classList.toggle('has-book', hasBook);

  const welcome = $('#welcome');
  const workspace = $('#workspace');
  if (welcome) welcome.classList.toggle('hidden', hasBook);
  if (workspace) workspace.classList.toggle('hidden', !hasBook);

  const sidebar = $('#shell-sidebar');
  const wantsSidebar = hasBook && state.currentView === 'create';
  if (sidebar) sidebar.classList.toggle('is-empty', !wantsSidebar);

  const homeTab = $('#nav-home');
  if (homeTab) homeTab.hidden = !(state.libraryBooks || []).length;
}
