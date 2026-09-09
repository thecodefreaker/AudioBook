#!/usr/bin/env node
/**
 * unpack.js - Standalone extractor.
 *
 * The bundle produced by pack.js is already self-extracting, so you normally
 * don't need this. Use unpack.js when you want to:
 *   - inspect / extract a bundle without executing it (safer)
 *   - extract a raw payload file (.pack) produced by `pack.js --payload-only`
 *
 * Usage:
 *   node tools/unpack.js <bundle.js> [targetDir] [--force] [--list] [--dry-run]
 *
 * Examples:
 *   node tools/unpack.js project-bundle.js --list
 *   node tools/unpack.js project-bundle.js ./restored --force
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.filter((a) => !a.startsWith('--'));

if (positional.length === 0) {
  console.error('Usage: node tools/unpack.js <bundle.js> [targetDir] [--force] [--list] [--dry-run]');
  process.exit(1);
}

const BUNDLE = path.resolve(positional[0]);
const FORCE = flags.has('--force');
const LIST = flags.has('--list');
const DRY = flags.has('--dry-run');

if (!fs.existsSync(BUNDLE)) {
  console.error('Bundle not found:', BUNDLE);
  process.exit(1);
}

// ---------------------------------------------------------------- parse bundle without executing it
const source = fs.readFileSync(BUNDLE, 'utf8');

// MANIFEST = { ... };
function readManifest() {
  const start = source.indexOf('const MANIFEST = ');
  if (start === -1) return { name: 'extracted', gzip: true };
  const braceStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(source.slice(braceStart, i + 1)); }
        catch (_) { return { name: 'extracted', gzip: true }; }
      }
    }
  }
  return { name: 'extracted', gzip: true };
}

// PAYLOAD = [ '...', '...' ].join('')   OR   PAYLOAD = "...."
function readPayload() {
  const arrMatch = source.match(/const PAYLOAD = \[([\s\S]*?)\]\.join\(''\);/);
  if (arrMatch) {
    return (arrMatch[1].match(/'([A-Za-z0-9+/=]*)'/g) || [])
      .map((s) => s.slice(1, -1))
      .join('');
  }
  const strMatch = source.match(/const PAYLOAD = ["']([A-Za-z0-9+/=]+)["'];/);
  if (strMatch) return strMatch[1];
  throw new Error('No PAYLOAD found in bundle.');
}

const MANIFEST = readManifest();
let files;
try {
  let buf = Buffer.from(readPayload(), 'base64');
  if (MANIFEST.gzip !== false) {
    try { buf = zlib.gunzipSync(buf); } catch (_) { /* maybe not gzipped */ }
  }
  files = JSON.parse(buf.toString('utf8'));
} catch (err) {
  console.error('Failed to read payload:', err.message);
  process.exit(1);
}

const target = path.resolve(positional[1] || MANIFEST.name || 'extracted');

// ---------------------------------------------------------------- normalize entry shape
function toBuffer(entry) {
  const b64 = typeof entry === 'string' ? entry : entry.d;
  return Buffer.from(b64, 'base64');
}
function hashOf(entry) {
  return typeof entry === 'string' ? null : entry.h;
}
function modeOf(entry) {
  return typeof entry === 'string' ? null : entry.m;
}

// ---------------------------------------------------------------- list mode
const names = Object.keys(files).sort();

if (LIST) {
  console.log(`\n${MANIFEST.name || '(bundle)'} - ${names.length} files`);
  if (MANIFEST.createdAt) console.log(`packed: ${MANIFEST.createdAt}`);
  console.log('');
  let total = 0;
  for (const rel of names) {
    const size = toBuffer(files[rel]).length;
    total += size;
    console.log('  ' + String(size).padStart(9) + '  ' + rel);
  }
  console.log(`\n  total: ${(total / 1024).toFixed(1)} KB\n`);
  process.exit(0);
}

// ---------------------------------------------------------------- extract
console.log(`\nExtracting ${names.length} files -> ${target}\n`);

let written = 0;
let skipped = 0;
let failed = 0;

for (const rel of names) {
  const entry = files[rel];
  const dest = path.resolve(target, rel);

  // path-traversal guard: dest must stay inside target
  if (dest !== target && !dest.startsWith(target + path.sep)) {
    console.error('  ! unsafe path refused:', rel);
    failed++;
    continue;
  }

  if (fs.existsSync(dest) && !FORCE) {
    console.log('  = exists (use --force):', rel);
    skipped++;
    continue;
  }

  const buf = toBuffer(entry);
  const expected = hashOf(entry);
  if (expected) {
    const got = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
    if (got !== expected) {
      console.error('  ! checksum mismatch:', rel);
      failed++;
      continue;
    }
  }

  if (DRY) {
    console.log('  ~ would write:', rel);
    written++;
    continue;
  }

  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    const mode = modeOf(entry);
    if (mode) { try { fs.chmodSync(dest, parseInt(mode, 8)); } catch (_) {} }
    console.log('  + ' + rel);
    written++;
  } catch (err) {
    console.error('  ! write failed:', rel, '-', err.message);
    failed++;
  }
}

console.log(`\nDone. written=${written} skipped=${skipped} failed=${failed}`);

if (!DRY && fs.existsSync(path.join(target, 'package.json'))) {
  console.log(`\nNext steps:\n  cd ${path.relative(process.cwd(), target) || '.'}\n  npm install\n`);
}

if (failed) process.exitCode = 1;
