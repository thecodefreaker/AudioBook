#!/usr/bin/env node
/**
 * Rebuild a project from the single text file produced by `pack.js`.
 *
 * This script is deliberately dependency-free and self-contained, because of
 * the situation it is used in: on the target machine nothing exists yet. This
 * is the one file you have to get across by hand, so it must run on a bare
 * Node install with no `npm install` first — and it must be short enough to
 * paste without flinching.
 *
 * Usage:
 *   node unpack.js project-bundle.txt ./my-project
 *   node unpack.js "bundle.part*.txt" ./my-project     (split bundles)
 *   node unpack.js bundle.txt ./my-project --dry-run   (verify only)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry-run');
const FORCE = argv.includes('--force');
const positional = argv.filter((a) => !a.startsWith('--'));

const [input, dest = './restored'] = positional;
if (!input) {
  console.error('Usage: node unpack.js <bundle.txt> [destination] [--dry-run] [--force]');
  process.exit(1);
}

// --- Read, joining split parts in order ------------------------------------
// A bundle may arrive as several files if it had to be pasted in pieces.
// Sorting by name is correct because pack.js zero-pads the part numbers —
// unpadded numbering would put part10 before part2 and corrupt the join
// silently, which is exactly the sort of failure the hashes exist to catch.
let text;
if (input.includes('*')) {
  const dir = path.dirname(input) || '.';
  const pattern = new RegExp('^' + path.basename(input)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*') + '$');
  const parts = fs.readdirSync(dir).filter((f) => pattern.test(f)).sort();
  if (!parts.length) { console.error(`No files match ${input}`); process.exit(1); }
  console.log(`Joining ${parts.length} parts: ${parts.join(', ')}`);
  text = parts.map((p) => fs.readFileSync(path.join(dir, p), 'utf8')).join('');
} else {
  text = fs.readFileSync(input, 'utf8');
}

// Editors and mail clients often convert line endings in transit. Normalising
// here means a bundle that went through one still restores byte-for-byte,
// because the payloads that *care* about their exact bytes travelled as
// base64 rather than as literal text.
text = text.replace(/\r\n/g, '\n');

// --- Find the token --------------------------------------------------------
// Delimiters carry a random token chosen at pack time, so no delimiter can
// collide with a line that happens to appear inside a source file.
const tokenMatch = text.match(/=====\[ EPUBAB-([0-9A-F]+) BUNDLE \]=====/);
if (!tokenMatch) {
  console.error('Not a valid bundle: header not found.');
  console.error('If this arrived in parts, pass them all, e.g. "bundle.part*.txt".');
  process.exit(1);
}
const MARK = `=====[ EPUBAB-${tokenMatch[1]} `;

if (!text.includes(MARK + 'END BUNDLE ]=====')) {
  console.error('Bundle is truncated: the end marker is missing.');
  console.error('The copy is incomplete — re-copy the whole file.');
  process.exit(1);
}

// --- Parse -----------------------------------------------------------------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fileRe = new RegExp(
  esc(MARK) + 'FILE \\]===== (.+?)\\n' +
  esc(MARK) + 'META \\]===== enc=(\\w+) eol=(\\w+) bytes=(\\d+) sha256=([0-9a-f]{64})\\n' +
  '([\\s\\S]*?)\\n?' +
  esc(MARK) + 'ENDFILE \\]===== \\1(?:\\n|$)',
  'g'
);

const entries = [];
let m;
while ((m = fileRe.exec(text)) !== null) {
  entries.push({ rel: m[1].trim(), enc: m[2], eol: m[3], bytes: Number(m[4]), hash: m[5], body: m[6] });
}

if (!entries.length) {
  console.error('Bundle contains no files — it may be truncated or altered.');
  process.exit(1);
}

// Cross-check against the manifest. Parsing can succeed on a bundle that lost
// whole files in the middle, and without this that loss would be silent.
const manifestBlock = text.split(MARK + 'MANIFEST ]=====')[1]?.split(MARK + 'END MANIFEST ]=====')[0] || '';
const manifest = manifestBlock.trim().split('\n').filter(Boolean).map((l) => {
  const [hash, enc, bytes, ...rest] = l.trim().split(/\s+/);
  return { hash, enc, bytes: Number(bytes), rel: rest.join(' ') };
});

if (manifest.length && manifest.length !== entries.length) {
  console.error(`Bundle is incomplete: manifest lists ${manifest.length} files, found ${entries.length}.`);
  const found = new Set(entries.map((e) => e.rel));
  for (const mf of manifest) if (!found.has(mf.rel)) console.error(`  missing: ${mf.rel}`);
  if (!FORCE) { console.error('\nRefusing to write a partial project. Use --force to override.'); process.exit(1); }
}

// --- Verify ----------------------------------------------------------------
// Everything is checked before anything is written, so a bad bundle cannot
// leave a half-populated folder that looks like a successful restore.
const resolved = [];
let bad = 0;

for (const e of entries) {
  // A path escaping the destination would let a malicious bundle overwrite
  // arbitrary files. Rare, but the check is one line.
  const target = path.resolve(dest, e.rel);
  if (!target.startsWith(path.resolve(dest) + path.sep) && target !== path.resolve(dest)) {
    console.error(`  UNSAFE PATH  ${e.rel}`); bad++; continue;
  }

  let buf;
  if (e.enc === 'base64') {
    buf = Buffer.from(e.body.replace(/\s/g, ''), 'base64');
  } else {
    // Undo the two transit-safety transforms, in reverse order: restore any
    // trailing whitespace that an editor might have stripped, then put the
    // original line endings back.
    let s = e.body.replace(/\u241F(\d+)([ts])/g, (_, n, kind) =>
      (kind === 't' ? '\t' : ' ').repeat(Number(n)));
    if (e.eol === 'crlf') s = s.replace(/\n/g, '\r\n');
    buf = Buffer.from(s, 'utf8');
  }

  const got = crypto.createHash('sha256').update(buf).digest('hex');
  if (got !== e.hash) {
    console.error(`  CORRUPT  ${e.rel}  (expected ${e.bytes} bytes, got ${buf.length})`);
    bad++; continue;
  }
  resolved.push({ target, buf, rel: e.rel });
}

if (bad && !FORCE) {
  console.error(`\n${bad} file(s) failed verification. Nothing was written.`);
  console.error('The bundle was altered or truncated in transit — re-copy it.');
  process.exit(1);
}

if (DRY) {
  console.log(`\nVerified ${resolved.length} files. Bundle is intact. (--dry-run: nothing written)`);
  process.exit(0);
}

// --- Write -----------------------------------------------------------------
for (const r of resolved) {
  fs.mkdirSync(path.dirname(r.target), { recursive: true });
  fs.writeFileSync(r.target, r.buf);
}

console.log(`\nRestored ${resolved.length} files → ${path.resolve(dest)}`);
console.log('\nNext:');
console.log(`  cd ${dest}`);
console.log('  npm install');
console.log('  npm run dev');
console.log('\nNote: node_modules, uploaded books and the database were not carried.');
console.log('If the app used a .env file, recreate it — secrets are never packed.');
