/**
 * Fails if any CSS variable is used but never defined.
 *
 * Undefined custom properties don't error — they silently resolve to nothing,
 * so an element renders transparent or unstyled with no warning. That is very
 * easy to introduce while consolidating a palette.
 */
import fs from 'fs';
import path from 'path';

const dir = 'src/styles';
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.css'));

const defined = new Set();
const used = new Map(); // var -> files that use it

for (const f of files) {
  const css = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const m of css.matchAll(/^\s*(--[\w-]+)\s*:/gm)) defined.add(m[1]);
  for (const m of css.matchAll(/var\(\s*(--[\w-]+)/g)) {
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1]).add(f);
  }
}

// Inline styles in markup and JS use variables too.
for (const f of ['src/index.html', 'src/main.js']) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/var\(\s*(--[\w-]+)/g)) {
    if (!used.has(m[1])) used.set(m[1], new Set());
    used.get(m[1]).add(path.basename(f));
  }
}

const missing = [...used.keys()].filter((v) => !defined.has(v)).sort();

console.log(`CSS variables — defined: ${defined.size}, used: ${used.size}`);

if (missing.length) {
  console.log(`\nUNDEFINED (${missing.length}):`);
  for (const v of missing) console.log(`  ✗ ${v}   used in: ${[...used.get(v)].join(', ')}`);
  process.exit(1);
}

const unused = [...defined].filter((v) => !used.has(v)).sort();
if (unused.length) console.log(`\nDefined but unused (${unused.length}): ${unused.join(', ')}`);

console.log('\nOK: every CSS variable used is defined.');
