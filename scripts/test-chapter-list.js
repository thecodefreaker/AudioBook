/**
 * Chapter list — filtering, sorting and selection.
 *
 * These ran on the *rendered DOM* before: the filter read titles back out of
 * HTML and toggled `style.display`, so it silently disagreed with the data
 * whenever the markup changed. Now they are pure functions of state, which is
 * what makes them testable at all — this suite is the guard that keeps them
 * that way.
 */
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
const eq = (a, b, msg) =>
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg}\n  expected: ${JSON.stringify(b)}\n  actual:   ${JSON.stringify(a)}`);

// --- The logic under test, mirrored from components/chapterList.js ---------
// Kept as a pure function so it can run without a DOM.
function selectChapters(chapters, audioFiles, activeGenerations, { term = '', filter = 'all', sort = 'index_asc' } = {}) {
  const versionsFor = (ch) => audioFiles.filter((a) => a.chapterId === ch.id && !a.isMerged);
  const t = term.trim().toLowerCase();

  const rows = chapters.filter((ch) => {
    const hasAudio = versionsFor(ch).length > 0;
    const converting = !!activeGenerations[ch.chapterIndex];
    const matchesSearch =
      !t ||
      (ch.title || '').toLowerCase().includes(t) ||
      String(ch.chapterIndex + 1).includes(t);
    const matchesTab =
      filter === 'all' ||
      (filter === 'ready' && hasAudio) ||
      (filter === 'progress' && converting);
    return matchesSearch && matchesTab;
  });

  const latest = (ch) => {
    const v = versionsFor(ch)[0];
    return v ? new Date(v.createdAt).getTime() : 0;
  };
  const byTitle = (a, b) => (a.title || '').localeCompare(b.title || '');
  const sorters = {
    index_asc: (a, b) => a.chapterIndex - b.chapterIndex,
    index_desc: (a, b) => b.chapterIndex - a.chapterIndex,
    name_asc: byTitle,
    name_desc: (a, b) => byTitle(b, a),
    date_desc: (a, b) => latest(b) - latest(a),
    date_asc: (a, b) => {
      const x = latest(a), y = latest(b);
      if (!x && !y) return a.chapterIndex - b.chapterIndex;
      if (!x) return 1;
      if (!y) return -1;
      return x - y;
    },
  };
  return rows.sort(sorters[sort] || sorters.index_asc);
}

// --- Fixtures --------------------------------------------------------------
const chapters = [
  { id: 'c0', chapterIndex: 0, title: 'Down the Rabbit-Hole' },
  { id: 'c1', chapterIndex: 1, title: 'The Pool of Tears' },
  { id: 'c2', chapterIndex: 2, title: 'A Caucus-Race' },
];
const audio = [
  { id: 'a1', chapterId: 'c2', isMerged: false, createdAt: '2026-01-03T00:00:00Z' },
  { id: 'a2', chapterId: 'c0', isMerged: false, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'am', chapterId: null, isMerged: true, createdAt: '2026-01-09T00:00:00Z' },
];
const idx = (rows) => rows.map((r) => r.chapterIndex);

// --- Tests -----------------------------------------------------------------
test('shows every chapter by default, in book order', () => {
  eq(idx(selectChapters(chapters, audio, {})), [0, 1, 2], 'default view should be the whole book in order');
});

test('"Ready" shows only chapters that actually have audio', () => {
  eq(idx(selectChapters(chapters, audio, {}, { filter: 'ready' })), [0, 2], 'only converted chapters are ready');
});

test('the merged audiobook never counts as a chapter being ready', () => {
  // The merged file has no chapterId; if it were matched loosely it could make
  // an unconverted chapter look finished.
  eq(idx(selectChapters(chapters, audio, {}, { filter: 'ready' })).includes(1), false, 'chapter 1 has no audio');
});

test('"Converting" shows only chapters with a running job', () => {
  eq(idx(selectChapters(chapters, audio, { 1: { percent: 10 } }, { filter: 'progress' })), [1], 'only the running chapter');
});

test('search matches the chapter number as shown on screen (1-based)', () => {
  // Searching "3" must find the chapter labelled 3, not array index 3.
  eq(idx(selectChapters(chapters, audio, {}, { term: '3' })), [2], 'chapter 3 is at index 2');
});

test('search matches titles case-insensitively', () => {
  eq(idx(selectChapters(chapters, audio, {}, { term: 'pool' })), [1], 'should find "The Pool of Tears"');
});

test('search and filter combine rather than override each other', () => {
  eq(idx(selectChapters(chapters, audio, {}, { term: 'a', filter: 'ready' })), [0, 2], 'both constraints apply');
});

test('sorts by name', () => {
  eq(idx(selectChapters(chapters, audio, {}, { sort: 'name_asc' })), [2, 0, 1], 'A Caucus-Race, Down…, The Pool…');
});

test('newest-audio sort puts the most recently converted chapter first', () => {
  eq(idx(selectChapters(chapters, audio, {}, { sort: 'date_desc' })), [2, 0, 1], 'c2 converted last');
});

test('oldest-audio sort pushes unconverted chapters to the end, not the start', () => {
  // A chapter with no audio has no date. Treating that as "oldest" would put
  // every unconverted chapter first, which is never what the user means.
  eq(idx(selectChapters(chapters, audio, {}, { sort: 'date_asc' })), [0, 2, 1], 'unconverted chapter 1 goes last');
});

test('an empty search restores the full list', () => {
  eq(idx(selectChapters(chapters, audio, {}, { term: '   ' })), [0, 1, 2], 'whitespace is not a filter');
});

// --- Runner ----------------------------------------------------------------
let pass = 0, fail = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    pass++;
  } catch (err) {
    console.log(`  FAIL  ${name}\n        ${err.message.replace(/\n/g, '\n        ')}`);
    fail++;
  }
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
