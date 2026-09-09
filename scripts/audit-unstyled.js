/**
 * Unstyled-markup audit.
 *
 * The mirror image of the dead-CSS check: a class used in the markup that no
 * stylesheet defines. Like an undefined CSS variable, this never errors — the
 * element simply renders with no layout at all, which is how a docked player
 * or a toolbar can silently disappear while every test still passes.
 */
import fs from 'fs';
import path from 'path';

function collect(dir, ext, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) collect(full, ext, acc);
    else if (e.name.endsWith(ext)) acc.push(full);
  }
  return acc;
}

const cssFiles = collect('src/styles', '.css');

/**
 * Every stylesheet must actually contain CSS.
 *
 * A .css file can be overwritten with notes, a design brief or a stray paste
 * and nothing downstream complains: the browser discards what it cannot parse,
 * the link tag still resolves, and the class-usage check below still passes so
 * long as the *name* appears anywhere in any file. The result is a whole
 * component silently losing its layout. So each file is required to declare at
 * least one rule.
 */
const emptySheets = [];
for (const f of cssFiles) {
  const text = fs.readFileSync(f, 'utf8');
  // Strip comments, then require a selector followed by a declaration block.
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').trim();
  if (!/[^{}]*\{[^}]*:[^}]*\}/.test(code)) emptySheets.push(f);
}

if (emptySheets.length) {
  console.log('\n=== STYLESHEETS CONTAINING NO CSS RULES ===');
  emptySheets.forEach((f) => console.log('  ✗ ' + f));
  console.log('\nFAIL: these files are linked but define nothing.');
  process.exit(1);
}

const css = cssFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const html = fs.readFileSync('src/index.html', 'utf8');
const js = collect('src', '.js').map((f) => fs.readFileSync(f, 'utf8')).join('\n');

// Classes a stylesheet defines a rule for.
const defined = new Set();
for (const m of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) defined.add(m[1]);

// Classes the markup actually applies, from both static HTML and rendered JS.
const used = new Map(); // class -> where
const addFrom = (text, where) => {
  for (const m of text.matchAll(/class="([^"]*)"/g)) {
    for (const raw of m[1].split(/\s+/)) {
      // Template literals leave fragments like `'playing'` or `?` behind once
      // split on whitespace; only real class names are checked.
      if (!raw || !/^[a-zA-Z][\w-]*$/.test(raw)) continue;
      if (!used.has(raw)) used.set(raw, where);
    }
  }
};
addFrom(html, 'index.html');
addFrom(js, 'js');

/**
 * Classes that carry behaviour rather than appearance: JS finds elements by
 * them, and their looks come from another class on the same element (usually
 * `.btn` or `.segmented button`). Having no rule of their own is correct.
 */
const BEHAVIOUR_ONLY = new Set([
  'nav-btn', 'filter-tab',            // styled by `.segmented button`
  'btn-play-version-modal', 'btn-delete-version-modal',
  'generate-reader-modal-btn', 'open-edit-script-btn',
  'log-icon',
  'ag-convert-audio-btn', 'ag-convert-btn', 'ag-custom-prompt-input',
  'antigravity-convert-ui', 'btn-success', 'form-control',
  'reader-read-aloud-group', 'script-toolbar-prompt', 'select-sm',
  'studio-controls', 'toggle-switch',
]);

const missing = [];
for (const [cls, where] of used) {
  if (defined.has(cls) || BEHAVIOUR_ONLY.has(cls)) continue;
  missing.push(`${cls}  (${where})`);
}

console.log(`\n=== CLASSES USED IN MARKUP WITH NO CSS RULE — ${missing.length} ===`);
missing.sort().forEach((m) => console.log('  ✗ .' + m));

if (missing.length) {
  console.log('\nFAIL: these elements render with no styling at all.');
  process.exit(1);
}
console.log('\nOK: every class used in markup is styled.');
