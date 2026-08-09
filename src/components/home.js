/**
 * The Home view — what a returning user sees.
 *
 * The app previously had only two states: a hero for people with no book open,
 * and a workspace for people with one. That meant someone with a dozen books
 * and none currently open was shown a first-timer's pitch for a product they
 * already use, and had to click through it to reach work in progress. Friction
 * dressed as polish.
 *
 * Home answers what a returning user actually wants, in descending order of
 * likelihood: resume what I was doing, switch to something recent, check what
 * is still converting. The hero is now reserved for the one case it is right
 * for — a library with nothing in it.
 */
import { escapeHtml } from '../utils/html.js';
import { formatTime } from '../utils/formatters.js';
import { getLastRead } from '../services/settings.js';

let handlers = {};

const ICON_PLAY = `<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><polygon points="5 3 19 12 5 21 5 3"/></svg>`;

/** Cover art, or a generated spine so a shelf never becomes rows of clones. */
function coverHtml(book, cls = '') {
  const initial = escapeHtml((book.title || '?').trim().charAt(0).toUpperCase());
  return book.coverImage
    ? `<img class="${cls} library-cover-img" src="${escapeHtml(book.coverImage)}" alt="" loading="lazy" />`
    : `<span class="${cls} library-cover-fallback" aria-hidden="true">${initial}</span>`;
}

function pct(book) {
  const total = book.totalChapters || 0;
  return total ? Math.round(((book.chaptersWithAudio || 0) / total) * 100) : 0;
}

/**
 * Render Home from the book list.
 *
 * @param {Array}  books        from /api/books
 * @param {Object} activeJobs   { [bookId]: { percent, label } } live conversions
 */
export function renderHome(books = [], activeJobs = {}) {
  const empty = document.querySelector('#home-empty');
  const hasBooks = books.length > 0;

  // With no books at all there is nothing to continue, recall or resume, so
  // Home steps aside entirely and the hero does its job.
  document.querySelector('#home-continue-section')?.toggleAttribute('hidden', true);
  document.querySelector('#home-recent-section')?.toggleAttribute('hidden', true);
  document.querySelector('#home-active-section')?.toggleAttribute('hidden', true);

  if (!hasBooks) {
    if (empty) {
      empty.hidden = false;
      empty.innerHTML = `
        <div class="empty">
          <div class="empty-icon" aria-hidden="true">📖</div>
          <div class="empty-title">Your shelf is empty</div>
          <p class="empty-text">Add an EPUB and it becomes a narrated audiobook you can read along with.</p>
          <button class="btn btn-primary" data-home-act="upload">Upload EPUB</button>
        </div>`;
    }
    return;
  }
  if (empty) empty.hidden = true;

  // --- Continue -----------------------------------------------------------
  // "Most recently opened" is the honest definition of what you were doing;
  // most-recently-*added* is a different question and a worse guess.
  const sorted = [...books].sort(
    (a, b) => new Date(b.lastOpenedAt || b.createdAt || 0) - new Date(a.lastOpenedAt || a.createdAt || 0)
  );
  const [current, ...rest] = sorted;

  const contSection = document.querySelector('#home-continue-section');
  const cont = document.querySelector('#home-continue');
  if (current && cont) {
    contSection.hidden = false;
    const chapterIdx = getLastRead(current.id);
    const where = chapterIdx != null ? `Chapter ${chapterIdx + 1}` : 'Not started';
    const p = pct(current);
    const dur = current.totalDuration ? formatTime(current.totalDuration) : null;

    cont.innerHTML = `
      <div class="continue-card" data-home-act="open" data-book-id="${current.id}" role="button" tabindex="0">
        <div class="continue-cover">${coverHtml(current)}</div>
        <div class="continue-body">
          <h3 class="continue-title">${escapeHtml(current.title || 'Untitled')}</h3>
          <p class="continue-sub">${escapeHtml(current.author || 'Unknown author')}</p>
          <p class="continue-where">${escapeHtml(where)} · ${p}% converted${dur ? ` · ${dur} of audio` : ''}</p>
          <div class="progress"><div class="progress-fill ${p === 100 ? 'ok' : ''}" style="width:${p}%"></div></div>
        </div>
        <div class="continue-actions">
          <button class="btn btn-primary" data-home-act="resume" data-book-id="${current.id}">
            ${ICON_PLAY} ${chapterIdx != null ? 'Resume' : 'Open'}
          </button>
        </div>
      </div>`;
  }

  // --- In progress --------------------------------------------------------
  // Conversion outlives the workspace it was started from, so a job running in
  // another book must be visible from here — otherwise "is it still going?"
  // can only be answered by opening the book and hoping.
  const activeIds = Object.keys(activeJobs || {});
  const activeSection = document.querySelector('#home-active-section');
  const activeEl = document.querySelector('#home-active');
  if (activeIds.length && activeEl) {
    activeSection.hidden = false;
    activeEl.innerHTML = activeIds.map((id) => {
      const book = books.find((b) => String(b.id) === String(id));
      const job = activeJobs[id] || {};
      return `
        <div class="home-active-row" data-home-act="open" data-book-id="${id}" role="button" tabindex="0">
          <span class="home-active-title">${escapeHtml(book?.title || 'Book')}</span>
          <div class="progress grow"><div class="progress-fill" style="width:${job.percent || 0}%"></div></div>
          <span class="home-active-label">${escapeHtml(job.label || `${job.percent || 0}%`)}</span>
        </div>`;
    }).join('');
  }

  // --- Recent -------------------------------------------------------------
  // The shelf renders even when there is nothing but the current book on it.
  // Hiding it left Home as a single card floating at the top of a tall empty
  // column, which reads as a broken page rather than a short library — and it
  // also removed the only visible way to add a second book from this screen.
  const recentSection = document.querySelector('#home-recent-section');
  const recent = document.querySelector('#home-recent');
  if (recent) {
    recentSection.hidden = false;
    const seeAll = document.querySelector('#home-see-all');
    if (seeAll) seeAll.hidden = rest.length === 0;

    const heading = recentSection.querySelector('.home-heading');
    if (heading) heading.textContent = rest.length ? 'Recent' : 'Your library';

    recent.innerHTML = rest.slice(0, 8).map((book) => {
      const p = pct(book);
      return `
        <button class="shelf-book" data-home-act="open" data-book-id="${book.id}"
                title="${escapeHtml(book.title || '')}">
          <span class="shelf-cover">
            ${coverHtml(book)}
            ${p === 100 ? '<span class="badge badge-ok shelf-badge">Ready</span>' : p ? `<span class="badge badge-accent shelf-badge">${p}%</span>` : ''}
          </span>
          <span class="shelf-title">${escapeHtml(book.title || 'Untitled')}</span>
          <span class="shelf-sub">${escapeHtml(book.author || 'Unknown author')}</span>
        </button>`;
    }).join('') + `
      <button class="shelf-book shelf-add" data-home-act="upload" aria-label="Upload an EPUB">
        <span class="shelf-cover shelf-add-cover">
          <span class="shelf-add-icon" aria-hidden="true">＋</span>
        </span>
        <span class="shelf-title">Add a book</span>
        <span class="shelf-sub">EPUB</span>
      </button>`;
  }
}

/**
 * Bind once, to the container. Home re-renders whenever the library or a job
 * changes, so per-element listeners would stack up exactly as they did in the
 * chapter list before it was fixed.
 */
export function initHome(actions) {
  handlers = actions || {};
  const root = document.querySelector('#view-home');
  if (!root) return;

  const run = (el) => {
    const act = el.dataset.homeAct;
    const id = el.dataset.bookId;
    if (act === 'upload') handlers.onUpload?.();
    else if (act === 'resume') handlers.onResume?.(id);
    else if (act === 'open') handlers.onOpen?.(id);
  };

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-home-act]');
    if (!el) return;
    // The resume button sits inside the card, and both are actionable — so the
    // inner one must not also trigger the outer.
    e.stopPropagation();
    run(el);
  });

  // Card-shaped divs are given role="button", so they must answer to the keys
  // a real button would.
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('[data-home-act]');
    if (!el || el.tagName === 'BUTTON') return;
    e.preventDefault();
    run(el);
  });

  document.querySelector('#home-see-all')?.addEventListener('click', () => handlers.onSeeAll?.());
}
