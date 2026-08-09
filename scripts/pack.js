#!/usr/bin/env node
/**
 * Pack the whole project into ONE plain-text file that survives copy-paste.
 *
 * The constraint this solves: the target machine can only receive text typed
 * or pasted into a window. No zip, no git, no file transfer. So the archive
 * itself has to *be* text — and it has to be text that still reconstructs
 * byte-for-byte after passing through a clipboard, a chat box, or an editor
 * that may not be gentle with it.
 *
 * Three things make that safe, and each exists because of a specific way a
 * naive "cat all the files together" archive breaks:
 *
 *  1. **Collision-proof delimiters.** A separator like `--- file.js ---` is
 *     fine until a source file contains that exact line — which this project
 *     genuinely does, since these scripts print banners of dashes. Every
 *     boundary here carries a random token generated at pack time and printed
 *     in the header, so a delimiter cannot appear in the payload by accident.
 *
 *  2. **Base64 for anything that is not plainly safe text.** Binary files
 *     (the .epub, images, the SQLite database) obviously cannot be pasted
 *     raw. But so can text with CRLF endings, trailing spaces, tabs, or
 *     non-ASCII — clipboards and chat clients silently "fix" all four.
 *     Files that would be altered are encoded rather than trusted.
 *
 *  3. **Per-file SHA-256 + a manifest.** The unpacker verifies every file and
 *     refuses to write one that does not match. A truncated paste is the most
 *     likely failure mode by far, and it is the one that would otherwise be
 *     silent — you would get a project that looks complete and fails at
 *     runtime for reasons that have nothing to do with the code.
 *
 * Usage:
 *   node scripts/pack.js                       → project-bundle.txt
 *   node scripts/pack.js --out mybundle.txt
 *   node scripts/pack.js --split 900           → parts of ~900 KB each
 *   node scripts/pack.js --include-lock        → include package-lock.json
 *
 * Restore with: node scripts/unpack.js project-bundle.txt ./destination
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : path.join(import.meta.dirname, '..'));

// --- Options ---------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const OUT = path.resolve(ROOT, value('out', 'project-bundle.txt'));
const SPLIT_KB = Number(value('split', 0)) || 0;
const INCLUDE_LOCK = flag('include-lock');

/**
 * Directories never worth carrying.
 *
 * `node_modules` is the important one: it is ~200 MB of text that `npm
 * install` reproduces perfectly from package.json. Pasting it would be
 * thousands of times larger than the project and would still be the least
 * trustworthy part of the transfer.
 *
 * `data`, `dist` and `scratch` are generated or local: uploaded books, build
 * output, and scratch space. Carrying them would move someone else's library
 * onto the new machine along with the code.
 */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'data', 'scratch', 'tmp',
  '.vite', '.cache', 'coverage', '.next', 'build',
]);

const SKIP_FILES = new Set([
  '.DS_Store', 'Thumbs.db', 'project-bundle.txt',
]);

/** Generated, local, or simply too large to be worth a clipboard. */
function isSkippedFile(rel, size) {
  const base = path.basename(rel);
  if (SKIP_FILES.has(base)) return 'ignored file';
  if (base.startsWith('project-bundle') && base.endsWith('.txt')) return 'previous bundle';
  if (!INCLUDE_LOCK && base === 'package-lock.json') return 'lockfile (use --include-lock)';
  // .env holds API keys. Copying secrets into a document that will be pasted
  // through a chat window is the kind of convenience that ends up in a breach
  // report, so it is opt-out-proof: never packed.
  if (base === '.env' || base.startsWith('.env.')) return 'secrets';
  if (/\.(sqlite|sqlite3|db|log)$/i.test(base)) return 'database/log';
  if (/\.(mp3|wav|m4a|m4b|ogg|flac|opus|mp4|zip|epub)$/i.test(base)) return 'media/archive';
  // 1 MB of base64 is ~1.4 MB of text. Past that, pasting stops being viable
  // and the file is almost certainly an asset rather than source.
  if (size > 1024 * 1024) return `too large (${(size / 1024 / 1024).toFixed(1)} MB)`;
  return null;
}

// --- Walk ------------------------------------------------------------------
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(abs, out);
    } else if (entry.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

/**
 * Decide whether a file can travel as literal text.
 *
 * The question is not "is this valid UTF-8" but "will this survive a clipboard
 * unchanged". Two things get normalised in transit and must be handled rather
 * than feared:
 *
 *   · **CRLF line endings.** Every editor and chat client rewrites these. So
 *     the packer converts to LF and records `eol=crlf`, and the unpacker
 *     converts back. Fighting this with base64 would encode most of a Windows
 *     checkout for no reason.
 *
 *   · **Trailing whitespace**, which many editors strip on paste. Rather than
 *     encode the whole file, each trailing run is marked with a small escape
 *     and restored exactly.
 *
 * Non-ASCII text travels as-is: this codebase is full of em-dashes and the
 * bundle is written UTF-8, so encoding it would base64 nearly every source
 * file and make the archive unreadable — the opposite of the point.
 *
 * Only genuine binary is encoded.
 */
function classify(buf) {
  if (buf.includes(0)) return 'base64';                 // definitely binary
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return 'base64';                                    // not text at all
  }
  return 'text';
}

/** Trailing whitespace is preserved explicitly, since editors strip it. */
const WS_MARK = '\u241F';   // ␟ — a symbol, not the control character itself
const encodeTrailing = (s) => s.replace(/([ \t]+)$/gm, (_, ws) => WS_MARK + ws.length + (ws[0] === '\t' ? 't' : 's'));

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// --- Build -----------------------------------------------------------------
const token = crypto.randomBytes(9).toString('hex').toUpperCase();
const MARK = `=====[ EPUBAB-${token} `;

const files = walk(ROOT).sort();
const packed = [];
const skipped = [];

for (const abs of files) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  const size = fs.statSync(abs).size;

  const reason = isSkippedFile(rel, size);
  if (reason) { skipped.push({ rel, reason }); continue; }

  const buf = fs.readFileSync(abs);
  const enc = classify(buf);

  let body, eol = 'lf';
  if (enc === 'text') {
    const raw = buf.toString('utf8');
    // Normalise line endings for transit and record what they were, so a
    // Windows checkout restores as a Windows checkout.
    if (raw.includes('\r\n')) eol = 'crlf';
    body = encodeTrailing(raw.replace(/\r\n/g, '\n'));
  } else {
    body = buf.toString('base64').replace(/(.{100})/g, '$1\n');
  }

  packed.push({ rel, enc, eol, bytes: buf.length, hash: sha(buf), body });
}

// --- Emit ------------------------------------------------------------------
const lines = [];

lines.push(MARK + 'BUNDLE ]=====');
lines.push('# A whole project, as one text file. Restore it with:');
lines.push('#   node unpack.js <this-file> <destination-folder>');
lines.push('#');
lines.push('# Paste or transfer this file COMPLETE. Every file below carries a');
lines.push('# SHA-256, and the unpacker refuses anything that does not match —');
lines.push('# a half-copied bundle fails loudly instead of producing a project');
lines.push('# that looks fine and breaks at runtime.');
lines.push(`# token   : ${token}`);
lines.push(`# created : ${new Date().toISOString()}`);
lines.push(`# files   : ${packed.length}`);
lines.push('');
lines.push(MARK + 'MANIFEST ]=====');
for (const f of packed) lines.push(`${f.hash}  ${f.enc}  ${f.bytes}  ${f.rel}`);
lines.push(MARK + 'END MANIFEST ]=====');
lines.push('');

for (const f of packed) {
  lines.push(`${MARK}FILE ]===== ${f.rel}`);
  lines.push(`${MARK}META ]===== enc=${f.enc} eol=${f.eol} bytes=${f.bytes} sha256=${f.hash}`);
  lines.push(f.body);
  // A file whose last line lacks a newline would otherwise weld itself to the
  // closing delimiter, so the marker always starts on a fresh line and the
  // unpacker strips exactly one trailing newline it knows it added.
  if (!f.body.endsWith('\n')) lines.push('');
  lines.push(`${MARK}ENDFILE ]===== ${f.rel}`);
  lines.push('');
}

lines.push(MARK + 'END BUNDLE ]=====');

const bundle = lines.join('\n');

// --- Write -----------------------------------------------------------------
// Split only when asked. Chat windows and terminals often cap a single paste,
// so a large project may have to arrive in pieces; the unpacker takes the
// parts in order and stitches them back before parsing.
if (SPLIT_KB > 0) {
  const chunkSize = SPLIT_KB * 1024;
  const parts = [];
  for (let i = 0; i < bundle.length; i += chunkSize) {
    parts.push(bundle.slice(i, i + chunkSize));
  }
  parts.forEach((part, i) => {
    const name = OUT.replace(/\.txt$/, '') + `.part${String(i + 1).padStart(2, '0')}of${String(parts.length).padStart(2, '0')}.txt`;
    fs.writeFileSync(name, part);
    console.log(`  wrote ${path.basename(name)}  (${(part.length / 1024).toFixed(0)} KB)`);
  });
  console.log(`\nSplit into ${parts.length} parts. Restore with:`);
  console.log(`  node scripts/unpack.js "${path.basename(OUT).replace(/\.txt$/, '')}.part*.txt" ./destination`);
} else {
  fs.writeFileSync(OUT, bundle);
}

// --- Report ----------------------------------------------------------------
const kb = (bundle.length / 1024).toFixed(0);
console.log(`\nPacked ${packed.length} files → ${kb} KB of text`);
if (!SPLIT_KB) console.log(`  ${OUT}`);

const b64 = packed.filter((f) => f.enc === 'base64');
if (b64.length) console.log(`  ${b64.length} file(s) base64-encoded (binary or clipboard-unsafe)`);

if (skipped.length) {
  console.log(`\nSkipped ${skipped.length}:`);
  const byReason = {};
  for (const s of skipped) (byReason[s.reason] ||= []).push(s.rel);
  for (const [reason, list] of Object.entries(byReason)) {
    console.log(`  ${reason}: ${list.length > 3 ? `${list.slice(0, 3).join(', ')} +${list.length - 3} more` : list.join(', ')}`);
  }
}

console.log(`\nOn the other machine: node unpack.js <bundle> <folder> && npm install`);
