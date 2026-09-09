/**
 * UI wiring audit.
 *
 * Finds the two failure modes that make an app feel "half-built":
 *   1. Dead controls  — a button/select exists in the HTML but nothing in
 *      main.js ever listens to it, so clicking it does nothing.
 *   2. Ghost handlers — main.js references an element id that no longer
 *      exists in the HTML, so the feature silently never runs.
 */
import fs from 'fs';
import path from 'path';

const html = fs.readFileSync('src/index.html', 'utf8');

// Scan every source file, not just main.js — behaviour now lives in
// src/components/* too, and a component-owned listener is still "wired".
function collectJs(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectJs(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

const js = collectJs('src').map((f) => fs.readFileSync(f, 'utf8')).join('\n');

// --- ids declared in the markup -------------------------------------------
const htmlIds = new Map(); // id -> tag
for (const m of html.matchAll(/<(\w+)[^>]*\sid="([^"]+)"/g)) {
  htmlIds.set(m[2], m[1].toLowerCase());
}

// --- ids the code actually touches ----------------------------------------
const usedIds = new Set();
for (const m of js.matchAll(/["'`]#([A-Za-z0-9_-]+)/g)) usedIds.add(m[1]);
for (const m of js.matchAll(/getElementById\(\s*["'`]([^"'`]+)/g)) usedIds.add(m[1]);
// ids built dynamically, e.g. `#inline-status-${i}`
const dynamicPrefixes = [...js.matchAll(/["'`]#([A-Za-z0-9_-]+)-\$\{/g)].map((m) => m[1]);

const isDynamic = (id) => dynamicPrefixes.some((p) => id.startsWith(p + '-'));

// Elements handled by a delegated/class-based listener rather than by id, and
// elements that main.js injects at runtime. These are wired correctly; the
// id-based heuristic simply cannot see it.
const KNOWN_OK = new Set([
  'nav-create',          // handled via $$('.nav-btn') + [data-view]
  'nav-library',         // ditto
  'mobile-nav-home',     // ditto
  'mobile-nav-create',   // ditto
  'mobile-nav-library',  // ditto
]);
const INJECTED_AT_RUNTIME = new Set([
  'reader-open-script-editor', // rendered into the reader's Edit tab
]);

// Interactive elements are the ones that must be wired.
const INTERACTIVE = new Set(['button', 'select', 'input', 'textarea', 'a']);

const dead = [];
for (const [id, tag] of htmlIds) {
  if (!INTERACTIVE.has(tag)) continue;
  if (usedIds.has(id) || isDynamic(id) || KNOWN_OK.has(id)) continue;
  dead.push(`${tag}#${id}`);
}

const ghosts = [];
for (const id of usedIds) {
  if (htmlIds.has(id) || isDynamic(id) || INJECTED_AT_RUNTIME.has(id)) continue;
  ghosts.push(id);
}

console.log(`\n=== DEAD CONTROLS (in HTML, never wired in JS) — ${dead.length} ===`);
dead.forEach((d) => console.log('  ✗ ' + d));

console.log(`\n=== GHOST REFERENCES (used in JS, missing from HTML) — ${ghosts.length} ===`);
ghosts.sort().forEach((g) => console.log('  ? #' + g));

console.log(`\nTotal ids in HTML: ${htmlIds.size} | referenced in JS: ${usedIds.size}`);

if (dead.length || ghosts.length) {
  console.log('\nFAIL: every interactive control must be wired.');
  process.exit(1);
}
console.log('\nOK: no dead controls or ghost references.');
