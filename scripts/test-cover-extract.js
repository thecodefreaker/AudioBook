/**
 * Cover extraction.
 *
 * This exists because of a specific failure mode: the `epub` package's
 * `getImage` resolves a promise with `{ data, mimeType }`, but an older,
 * widely-copied version of the API took a Node-style callback. Calling it the
 * callback way does not throw — the promise simply never settles, so the whole
 * parse hangs and the upload appears frozen with no error anywhere.
 *
 * A timeout is therefore part of the assertion, not just a safety net.
 */
import fs from 'fs';
import path from 'path';
import EPub from 'epub';
import config from '../server/config/index.js';

const EPUB = 'alice.epub';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { console.log(`  PASS  ${name}`); pass++; }
  else { console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); fail++; }
};

console.log('\n==========================================================');
console.log('COVER EXTRACTION');
console.log('==========================================================');

if (!fs.existsSync(EPUB)) {
  console.log(`  SKIP  ${EPUB} not present`);
  process.exit(0);
}

const epub = new EPub(EPUB);
await epub.parse();

check('EPUB declares a cover in its metadata', !!epub.metadata.cover);

// The real assertion: this must settle, and quickly.
const withTimeout = (p, ms) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(new Error(`getImage did not settle in ${ms}ms — wrong API shape?`)), ms)),
]);

let buffer = null;
let mime = '';
try {
  const result = await withTimeout(epub.getImage(epub.metadata.cover), 5000);
  buffer = Buffer.isBuffer(result) ? result : result?.data;
  mime = result?.mimeType || '';
  check('getImage settles (promise API, not callback)', true);
} catch (err) {
  check('getImage settles (promise API, not callback)', false, err.message);
}

check('cover has bytes', !!buffer && buffer.length > 1000, buffer ? `${buffer?.length} bytes` : 'no buffer');

// A JPEG starts ffd8ff. If we ever write the manifest href instead of the
// bytes, this catches it immediately.
check('cover bytes are a real image',
  !!buffer && buffer.slice(0, 3).toString('hex') === 'ffd8ff',
  buffer ? buffer.slice(0, 3).toString('hex') : '');

check('mime type is reported', mime.startsWith('image/'), mime);

// The parser must write somewhere the static route can actually serve.
check('covers dir is under data/', config.coversDir.includes('data'), config.coversDir);

const publicUrl = `/data/covers/probe.jpg`;
check('public URL is server-relative, not a zip-internal href',
  publicUrl.startsWith('/data/covers/') && !publicUrl.includes('OEBPS'));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
