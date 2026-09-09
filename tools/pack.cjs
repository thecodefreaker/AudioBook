#!/usr/bin/env node
/**
 * pack.js - Create a self-extracting project archive.
 *
 * Usage:
 *   node tools/pack.js [sourceDir] [outFile] [--no-gzip] [--include-node-modules]
 *
 * Examples:
 *   node tools/pack.js . project-bundle.js
 *   node tools/pack.js ./src src-bundle.js
 *
 * Output: a single .js file that, when run with `node project-bundle.js <targetDir>`,
 * recreates every packed file (text or binary) inside <targetDir>.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.filter((a) => !a.startsWith('--'));

const SRC = path.resolve(positional[0] || '.');

// The bundle uses CommonJS (require). If the target project is an ESM package
// ("type": "module"), a ".js" bundle would fail to run - so force ".cjs".
let outArg = positional[1] || 'project-bundle.cjs';
if (outArg.endsWith('.js') && !outArg.endsWith('.cjs')) outArg = outArg.slice(0, -3) + '.cjs';
const OUT = path.resolve(outArg);

const USE_GZIP = !flags.has('--no-gzip');
const KEEP_MODULES = flags.has('--include-node-modules');
const KEEP_DATA = flags.has('--include-data');
const KEEP_MEDIA = flags.has('--include-media');

// ---------------------------------------------------------------- ignore rules
const IGNORE_DIRS = new Set([
  '.git', '.svn', '.hg',
  'dist', 'build', 'out', 'coverage',
  '.cache', '.next', '.nuxt', '.parcel-cache',
  '.vscode', '.idea',
]);
if (!KEEP_MODULES) IGNORE_DIRS.add('node_modules');

// Generated / runtime output - not project source. Excluded unless --include-data.
if (!KEEP_DATA) {
  ['data', 'uploads', 'tmp', 'temp', 'logs', 'cache', 'storage'].forEach((d) => IGNORE_DIRS.add(d));
}

// Large binary/media assets. Excluded unless --include-media.
const MEDIA_EXT = new Set([
  '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus', '.wma',
  '.mp4', '.mkv', '.mov', '.avi', '.webm',
  '.epub', '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar',
  '.sqlite', '.sqlite3', '.db',
]);

const IGNORE_FILES = new Set([
  '.DS_Store', 'Thumbs.db',
  path.basename(OUT),          // never pack the bundle into itself
  'package-lock.json',         // regenerate on install; comment out to keep
]);

// Previously generated archives / dumps - never pack an archive into an archive.
const ARCHIVE_RE = /(^|[-_.])(bundle|archive|selfextract|snapshot)([-_.]|\.[a-z]+$)/i;

const MAX_FILE_BYTES = 25 * 1024 * 1024; // skip anything bigger than 25 MB

function isIgnoredDir(name) {
  return IGNORE_DIRS.has(name);
}
function isIgnoredFile(name) {
  if (IGNORE_FILES.has(name) || name.endsWith('.log')) return true;
  if (ARCHIVE_RE.test(name)) return true;
  if (!KEEP_MEDIA && MEDIA_EXT.has(path.extname(name).toLowerCase())) return true;
  return false;
}

// ---------------------------------------------------------------- walk
function walk(dir, base, acc, stats) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isSymbolicLink()) continue;

    if (entry.isDirectory()) {
      if (isIgnoredDir(entry.name)) continue;
      walk(full, base, acc, stats);
      continue;
    }

    if (!entry.isFile()) continue;
    if (isIgnoredFile(entry.name)) continue;
    if (path.resolve(full) === OUT) continue;

    const size = fs.statSync(full).size;
    if (size > MAX_FILE_BYTES) {
      console.warn(`  ! skipped (too large ${(size / 1048576).toFixed(1)} MB): ${entry.name}`);
      stats.skipped++;
      continue;
    }

    const rel = path.relative(base, full).split(path.sep).join('/');
    const buf = fs.readFileSync(full);
    acc[rel] = {
      d: buf.toString('base64'),
      h: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16),
      m: (fs.statSync(full).mode & 0o777).toString(8),
    };
    stats.files++;
    stats.bytes += size;
  }
  return acc;
}

// ---------------------------------------------------------------- build
console.log(`Packing: ${SRC}`);

const stats = { files: 0, bytes: 0, skipped: 0 };
const files = walk(SRC, SRC, {}, stats);

if (stats.files === 0) {
  console.error('Nothing to pack. Check the source directory / ignore rules.');
  process.exit(1);
}

const json = JSON.stringify(files);
const raw = Buffer.from(json, 'utf8');
const payloadBuf = USE_GZIP ? zlib.gzipSync(raw, { level: 9 }) : raw;
const payloadB64 = payloadBuf.toString('base64');

// Split into chunks so no single source line becomes absurdly long.
const CHUNK = 120;
const chunks = [];
for (let i = 0; i < payloadB64.length; i += CHUNK) {
  chunks.push(payloadB64.slice(i, i + CHUNK));
}
const chunkLiteral = chunks.map((c) => `  '${c}'`).join(',\n');

const manifest = {
  name: path.basename(SRC),
  createdAt: new Date().toISOString(),
  fileCount: stats.files,
  originalBytes: stats.bytes,
  gzip: USE_GZIP,
};

const bundle = `#!/usr/bin/env node
/* eslint-disable */
/**
 * SELF-EXTRACTING ARCHIVE
 * Project : ${manifest.name}
 * Created : ${manifest.createdAt}
 * Files   : ${manifest.fileCount}
 *
 * Usage:
 *   node ${path.basename(OUT)}                 -> extract into ./${manifest.name}
 *   node ${path.basename(OUT)} <targetDir>     -> extract into <targetDir>
 *   node ${path.basename(OUT)} <dir> --force   -> overwrite existing files
 *   node ${path.basename(OUT)} --list          -> list contents, extract nothing
 *   node ${path.basename(OUT)} <dir> --install -> extract then run npm install
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const MANIFEST = ${JSON.stringify(manifest, null, 2)};

const PAYLOAD = [
${chunkLiteral}
].join('');

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const flags = new Set(argv.filter(a => a.startsWith('--')));
const positional = argv.filter(a => !a.startsWith('--'));

const FORCE = flags.has('--force');
const LIST = flags.has('--list');
const INSTALL = flags.has('--install');
const DRY = flags.has('--dry-run');

const target = path.resolve(positional[0] || MANIFEST.name);

// ---------------------------------------------------------------- decode
function decode() {
  let buf = Buffer.from(PAYLOAD, 'base64');
  if (MANIFEST.gzip) buf = zlib.gunzipSync(buf);
  return JSON.parse(buf.toString('utf8'));
}

let files;
try {
  files = decode();
} catch (err) {
  console.error('Failed to decode payload:', err.message);
  process.exit(1);
}

// ---------------------------------------------------------------- list mode
if (LIST) {
  console.log(\`\\n\${MANIFEST.name} - \${MANIFEST.fileCount} files (packed \${MANIFEST.createdAt})\\n\`);
  Object.keys(files).sort().forEach(rel => {
    const size = Buffer.from(files[rel].d, 'base64').length;
    console.log('  ' + String(size).padStart(9) + '  ' + rel);
  });
  console.log('');
  process.exit(0);
}

// ---------------------------------------------------------------- extract
console.log(\`\\nExtracting \${MANIFEST.fileCount} files -> \${target}\\n\`);

let written = 0, skipped = 0, failed = 0;

for (const rel of Object.keys(files).sort()) {
  const entry = files[rel];
  const dest = path.resolve(target, rel);

  // path-traversal guard
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

  const buf = Buffer.from(entry.d, 'base64');

  if (entry.h) {
    const got = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
    if (got !== entry.h) {
      console.error('  ! checksum mismatch:', rel);
      failed++;
      continue;
    }
  }

  if (DRY) { console.log('  ~ would write:', rel); written++; continue; }

  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    if (entry.m) { try { fs.chmodSync(dest, parseInt(entry.m, 8)); } catch (_) {} }
    console.log('  + ' + rel);
    written++;
  } catch (err) {
    console.error('  ! write failed:', rel, '-', err.message);
    failed++;
  }
}

console.log(\`\\nDone. written=\${written} skipped=\${skipped} failed=\${failed}\`);

if (failed) process.exitCode = 1;

// ---------------------------------------------------------------- optional install
if (INSTALL && !DRY && fs.existsSync(path.join(target, 'package.json'))) {
  console.log('\\nRunning npm install...\\n');
  const { execSync } = require('child_process');
  try {
    execSync('npm install', { cwd: target, stdio: 'inherit' });
  } catch (_) {
    console.error('npm install failed - run it manually.');
  }
} else if (!DRY && fs.existsSync(path.join(target, 'package.json'))) {
  console.log('\\nNext steps:\\n  cd ' + path.relative(process.cwd(), target) + '\\n  npm install\\n');
}
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, bundle);

const outKB = (Buffer.byteLength(bundle) / 1024).toFixed(1);
const srcKB = (stats.bytes / 1024).toFixed(1);
console.log(`
Packed  : ${stats.files} files (${srcKB} KB source)
Skipped : ${stats.skipped}
Gzip    : ${USE_GZIP ? 'yes' : 'no'}
Output  : ${OUT} (${outKB} KB)

Extract with:
  node ${path.relative(process.cwd(), OUT)} ./restored
`);
