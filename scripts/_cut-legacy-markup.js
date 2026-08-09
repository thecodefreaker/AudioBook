/**
 * Removes the legacy step-wizard markup, now that the shell layout above it
 * owns the header, sidebar, toolbar and content regions.
 *
 * Anchored on exact unique strings so it cannot cut the wrong region, and it
 * verifies the removed block is the one expected before writing.
 */
import fs from 'fs';

const file = 'src/index.html';
let html = fs.readFileSync(file, 'utf8');
const before = html.split('\n').length;

const START = '      <div class="header-content">';
// The legacy wizard ends at the old </main>; everything after it (modals,
// toasts, the original player) is reused.
const END = '    </main>\n\n    <!-- Chapter Reader Modal -->';

const start = html.indexOf(START);
const end = html.indexOf(END);
if (start === -1) throw new Error('start anchor not found');
if (end === -1) throw new Error('end anchor not found');
if (end < start) throw new Error('anchors out of order');

const removed = html.slice(start, end);

// Sanity: the block must be the old wizard, and must NOT contain the player
// or modals, which have to survive.
for (const must of ['step-section', 'workspace-sidebar', 'Step 1']) {
  if (!removed.includes(must)) throw new Error(`refusing to cut: missing ${must}`);
}
for (const mustNot of ['sticky-player', 'quick-convert-modal', 'script-editor-modal']) {
  if (removed.includes(mustNot)) throw new Error(`refusing to cut: would remove ${mustNot}`);
}

fs.writeFileSync(file, html.slice(0, start) + html.slice(end));
console.log(`index.html: ${before} -> ${fs.readFileSync(file, 'utf8').split('\n').length} lines`);
console.log(`removed ${removed.split('\n').length} lines of legacy wizard markup`);
