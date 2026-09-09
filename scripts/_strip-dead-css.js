/**
 * One-off: remove CSS rule blocks whose selectors can no longer match after
 * the shell migration. Each name listed here was verified against the audit
 * output and the current markup.
 */
import fs from 'fs';

const DEAD = [
  // Old chapter row — replaced by .ch-row in chapters.css
  'chapter-item', 'chapter-info', 'chapter-title', 'chapter-meta', 'chapter-preview-btn',
  // Second, permanently-hidden chapter list
  'audio-chapter-list', 'audio-chapter-item', 'audio-ch-index', 'audio-ch-play-inline',
  'audio-ch-title', 'audio-ch-duration', 'audio-ch-download',
  // Old wizard config grid + results/download chrome
  'config-grid', 'config-card', 'select-wrapper', 'config-hint',
  'download-section', 'btn-download', 'audio-player-card',
  // Old player chrome — the docked player uses .player-* from components.css
  'player-info', 'player-controls', 'player-btn',
  // Old progress bar variant, superseded by .progress/.progress-fill
  'progress-bar-container', 'progress-bar',
  // Legacy library/step bits
  'library-header', 'library-desc', 'library-empty-sub',
];

const file = 'src/styles/components.css';
const css = fs.readFileSync(file, 'utf8');

/** Split into top-level blocks/comments so whole rules can be dropped. */
const out = [];
let i = 0;
let removed = 0;

while (i < css.length) {
  const brace = css.indexOf('{', i);
  if (brace === -1) { out.push(css.slice(i)); break; }

  // Balance braces so nested at-rules (@media) are handled as one unit.
  let depth = 0, j = brace;
  for (; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}') { depth--; if (depth === 0) break; }
  }

  const selector = css.slice(i, brace);
  const block = css.slice(i, j + 1);

  const isDead =
    !selector.includes('@') &&
    DEAD.some((cls) => new RegExp(`\\.${cls}(?![\\w-])`).test(selector)) &&
    // Keep anything that also styles a surviving class.
    selector.split(',').every((s) => !s.trim() || DEAD.some((cls) => new RegExp(`\\.${cls}(?![\\w-])`).test(s)));

  if (isDead) removed++;
  else out.push(block);

  i = j + 1;
}

fs.writeFileSync(file, out.join('').replace(/\n{3,}/g, '\n\n'));
console.log(`Removed ${removed} dead rule blocks from ${file}`);
