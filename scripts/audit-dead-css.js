/**
 * Dead CSS audit.
 *
 * After a layout migration the old rules do not error — they simply never
 * match, so the stylesheet keeps growing and every later change has to be
 * reasoned about against rules that can no longer apply. This lists class
 * selectors that appear in CSS but in neither the HTML nor the JS.
 *
 * Reported, not deleted: a class can legitimately be built at runtime, so the
 * decision stays with a human. Run with --list to see them grouped by file.
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
const source = [
  fs.readFileSync('src/index.html', 'utf8'),
  ...collect('src', '.js').map((f) => fs.readFileSync(f, 'utf8')),
].join('\n');

// Class names referenced anywhere in markup or code, including strings built
// for classList/querySelector calls.
const used = new Set();
for (const m of source.matchAll(/class="([^"]+)"/g)) {
  m[1].split(/\s+/).forEach((c) => c && used.add(c.replace(/\$\{.*/, '')));
}
for (const m of source.matchAll(/['"`]\.?([a-zA-Z][\w-]{2,})['"`]/g)) used.add(m[1]);
for (const m of source.matchAll(/\.([a-zA-Z][\w-]{2,})/g)) used.add(m[1]);

const dead = [];
for (const file of cssFiles) {
  const css = fs.readFileSync(file, 'utf8');
  const seen = new Set();
  for (const m of css.matchAll(/\.([a-zA-Z][\w-]+)/g)) {
    const cls = m[1];
    if (seen.has(cls) || used.has(cls)) continue;
    seen.add(cls);
    dead.push({ file: path.basename(file), cls });
  }
}

const byFile = dead.reduce((acc, d) => {
  (acc[d.file] ||= []).push(d.cls);
  return acc;
}, {});

console.log(`\n=== POSSIBLY DEAD CSS CLASSES — ${dead.length} ===`);
for (const [file, classes] of Object.entries(byFile)) {
  console.log(`\n  ${file} (${classes.length})`);
  console.log('    ' + classes.join(', '));
}
console.log('\nInformational only — this never fails the build.');
