/**
 * Whole-book audiobook: status + build.
 *
 * Guards the promise the app is built on — "download the finished audiobook" —
 * which was previously unreachable because merging was an opt-in flag on
 * conversion and nothing in the UI ever set it.
 */
const BASE = process.env.BASE || 'http://localhost:3000/api';

let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}\n        ${e.message}`); failed++; }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

const req = async (method, p, body) => {
  const r = await fetch(BASE + p, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};

const books = (await req('GET', '/books')).body;
const book = (books.books || books)[0];
if (!book) { console.log('No books uploaded — skipping.'); process.exit(0); }
console.log(`\nBook: ${book.title}\n`);

let status;
await test('audiobook status is reportable', async () => {
  const r = await req('GET', `/books/${book.id}/audiobook`);
  assert(r.status === 200, `expected 200, got ${r.status}`);
  status = r.body;
  assert(typeof status.canBuild === 'boolean', 'canBuild must be present');
  assert(typeof status.readyChapters === 'number', 'readyChapters must be present');
});

await test('status reports which chapters are missing audio', () => {
  assert(Array.isArray(status.missingChapters), 'missingChapters must be an array');
  assert(
    status.readyChapters + status.missingChapters.length === status.totalChapters,
    `ready(${status.readyChapters}) + missing(${status.missingChapters.length}) must equal total(${status.totalChapters})`
  );
});

await test('building is refused with a clear reason when nothing is ready', async () => {
  if (status.canBuild) return; // not applicable
  const r = await req('POST', `/books/${book.id}/audiobook`);
  assert(r.status === 400, `expected 400, got ${r.status}`);
  assert(/convert/i.test(r.body.message || ''), 'message should tell the user to convert first');
});

if (status.canBuild) {
  let built;
  await test('builds a complete audiobook from existing chapter audio', async () => {
    const r = await req('POST', `/books/${book.id}/audiobook`);
    assert(r.status === 200, `expected 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    built = r.body;
    assert(built.audiobook?.id, 'must return the created audio row');
    assert(built.durationSeconds > 0, 'merged file must have a real duration');
  });

  await test('merged file is marked isMerged so it is not shown as a chapter', () => {
    assert(built.audiobook.isMerged === true, 'isMerged must be true');
  });

  await test('merged audio is downloadable', async () => {
    const r = await fetch(`${BASE}/audio/${built.audiobook.id}/download`);
    assert(r.ok, `download failed with ${r.status}`);
    const len = Number(r.headers.get('content-length') || 0);
    assert(len > 1000, `downloaded file suspiciously small (${len} bytes)`);
  });

  await test('rebuilding replaces rather than duplicating the merged file', async () => {
    const before = (await req('GET', `/books/${book.id}/audio`)).body.audioFiles.filter((a) => a.isMerged).length;
    await req('POST', `/books/${book.id}/audiobook`);
    const after = (await req('GET', `/books/${book.id}/audio`)).body.audioFiles.filter((a) => a.isMerged).length;
    assert(after === 1, `expected exactly 1 merged file, found ${after} (was ${before})`);
  });

  await test('chapter lists still exclude the merged file', async () => {
    const r = await req('GET', `/books/${book.id}/audio`);
    const merged = r.body.audioFiles.filter((a) => a.isMerged);
    assert(merged.every((a) => a.chapterId === null), 'merged rows must not claim a chapter');
  });
}

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
