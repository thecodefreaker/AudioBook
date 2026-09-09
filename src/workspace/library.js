import { api } from '../services/api.js';
import { state } from '../store.js';
import { $, setText, show, hide } from '../utils/dom.js';
import { escapeHtml } from '../utils/html.js';
import { formatTime } from '../utils/formatters.js';
import { showToast } from '../components/toast.js';

import { applyWorkspaceMode } from './layout.js';
import { loadBookFromLibrary } from '../main.js';

export async function loadLibrary() {
  try {
    const data = await api.getBooks();
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

export function renderLibrary() {
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
    recent: (a, b) => time(b.lastOpenedAt || b.createdAt) - time(a.lastOpenedAt || a.createdAt),
    added: (a, b) => time(b.createdAt) - time(a.createdAt),
    title: (a, b) => (a.title || '').localeCompare(b.title || ''),
    progress: (a, b) => progress(b) - progress(a),
  };
  books.sort(sorters[sort] || sorters.recent);

  setText('#library-count', !all.length
    ? ''
    : term
      ? `${books.length} of ${all.length}`
      : `${all.length} ${all.length === 1 ? 'book' : 'books'}`);

  if (!books.length) {
    hide(grid);
    show(empty);
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
      const done = book.chaptersWithAudio || 0;
      const total = book.totalChapters || 0;
      const pct = total ? Math.round((done / total) * 100) : 0;
      const complete = total > 0 && done === total;

      const listened = book.totalDuration
        ? `${formatTime(book.totalDuration)} of audio`
        : 'No audio yet';

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

    grid.querySelector('.library-add')?.addEventListener('click', () => {
      $('#file-input')?.click();
    });

    grid.querySelectorAll('.library-card-delete').forEach(btn => {
      const remove = async (e) => {
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
