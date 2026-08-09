/**
 * Replace the legacy library-card CSS block with the redesigned one.
 * The old block styled a `status` pill that no longer exists and assumed a
 * div-based card; the card is now a real button with a progress bar.
 */
import fs from 'fs';

const file = 'src/styles/components.css';
let css = fs.readFileSync(file, 'utf8');

const start = css.indexOf('.library-grid {');
const endMarker = '.library-empty p {';
const endBlock = css.indexOf(endMarker);
const end = css.indexOf('}', css.indexOf('{', endBlock)) + 1;

if (start === -1 || endBlock === -1) {
  console.error('library block markers not found');
  process.exit(1);
}

const replacement = `/* ============================================
   LIBRARY
   ============================================ */

/* The grid scrolls inside the content region, so the header and player stay
   put while you browse. It previously sat in a page that could not scroll at
   all, which is why the library appeared empty below the first row. */
.library-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-4);
  align-content: start;
  max-width: var(--content-max);
  margin: 0 auto;
}

.library-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-4);
  text-align: left;
  font: inherit;
  background: var(--surface-1);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: background var(--duration-fast) var(--ease),
              border-color var(--duration-fast) var(--ease);
}
.library-card:hover {
  background: var(--surface-2);
  border-color: var(--border-3);
}

.library-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-1);
}

.library-card-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  background: var(--surface-3);
  color: var(--accent-text);
  flex-shrink: 0;
}

.library-card-title {
  font-size: var(--text-md);
  font-weight: 650;
  color: var(--text-1);
  line-height: var(--leading-tight);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.library-card-author {
  font-size: var(--text-sm);
  color: var(--text-3);
}

.library-card-progress { margin-top: var(--space-1); }

.library-card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  font-size: var(--text-xs);
  color: var(--text-3);
}

/* Destructive action stays quiet until the card is hovered, so browsing a
   library never puts Delete under the cursor by default. */
.library-card-delete {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  color: var(--text-4);
  opacity: 0;
  flex-shrink: 0;
  transition: opacity var(--duration-fast) var(--ease),
              background var(--duration-fast) var(--ease),
              color var(--duration-fast) var(--ease);
}
.library-card:hover .library-card-delete,
.library-card:focus-within .library-card-delete { opacity: 1; }
.library-card-delete:hover {
  background: var(--danger-soft);
  color: var(--danger-text);
}
@media (hover: none) {
  .library-card-delete { opacity: 1; }
}
`;

css = css.slice(0, start) + replacement + css.slice(end);
fs.writeFileSync(file, css);
console.log('Library CSS replaced.');
