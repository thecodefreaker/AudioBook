/**
 * Reader sync tests.
 *
 * The two things that MUST hold for karaoke highlighting to feel correct:
 *
 *   1. The browser and the server must split sentences identically. If they
 *      disagree, sentence 42 on screen is not sentence 42 in the alignment map
 *      and every highlight is silently offset.
 *
 *   2. time → sentence and sentence → time must be exact inverses, so clicking
 *      a line and letting playback reach it land on the same place.
 *
 * Run: node scripts/test-sync.js
 */
import assert from 'assert';
import { splitSentences } from '../server/services/scriptUtils.js';
import { ReaderSync, renderSentences } from '../src/services/readerSync.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL  ${name}\n        ${err.message}`);
    failed++;
  }
}

const escape = (s) => s;

/** Pull the sentence texts back out of the HTML the reader renders. */
function clientSentences(text) {
  const html = renderSentences(text, { escape });
  return [...html.matchAll(/data-sentence="(\d+)"[^>]*>([^<]*)</g)]
    .map((m) => ({ index: Number(m[1]), text: m[2].trim() }));
}

console.log('\nSentence splitting — client must match server\n');

const samples = {
  'plain English': 'Alice was beginning to get very tired. She had nothing to do. So she thought about daisies!',
  'Hindi danda': 'वह बहुत थक गई थी। उसके पास कुछ काम नहीं था। तो उसने सोचा।',
  'Hinglish mixed': 'Alice bahut bored thi. Usne socha ki daisy chain banaye. Kya karti woh?',
  'multi-paragraph': 'First one here. Second one here.\n\nNew para starts. And ends here.',
  'question and bang': 'Who are you? I am Alice! Really.',
  'abbreviation-ish': 'He met Dr. Smith. Then he left.',
};

for (const [label, text] of Object.entries(samples)) {
  test(`${label} — same sentence count`, () => {
    const server = splitSentences(text);
    const client = clientSentences(text);
    assert.strictEqual(
      client.length, server.length,
      `client ${client.length} vs server ${server.length}\n        client: ${JSON.stringify(client.map((c) => c.text))}\n        server: ${JSON.stringify(server.map((s) => s.text))}`
    );
  });

  test(`${label} — same text and indexes`, () => {
    const server = splitSentences(text);
    const client = clientSentences(text);
    server.forEach((s, i) => {
      assert.strictEqual(client[i].index, s.index, `index mismatch at ${i}`);
      assert.strictEqual(client[i].text, s.text, `text mismatch at ${i}: "${client[i].text}" vs "${s.text}"`);
    });
  });
}

console.log('\nLookup — time <-> sentence must be exact inverses\n');

const alignment = {
  approximate: false,
  sentences: [
    { i: 0, s: 0.0, e: 2.5, p: 0 },
    { i: 1, s: 2.5, e: 6.0, p: 0 },
    { i: 2, s: 6.0, e: 9.25, p: 1 },
    { i: 3, s: 9.25, e: 12.0, p: 1 },
  ],
};

function makeSync() {
  const audio = { src: 'x', currentTime: 0 };
  const sync = new ReaderSync({ audio, container: null });
  sync.load(alignment, true);
  return { sync, audio };
}

test('finds the sentence at an exact boundary', () => {
  const { sync } = makeSync();
  assert.strictEqual(sync.sentences[sync.indexAtTime(6.0)].i, 2);
});

test('finds the sentence mid-range', () => {
  const { sync } = makeSync();
  assert.strictEqual(sync.sentences[sync.indexAtTime(7.4)].i, 2);
  assert.strictEqual(sync.sentences[sync.indexAtTime(0.1)].i, 0);
  assert.strictEqual(sync.sentences[sync.indexAtTime(11.9)].i, 3);
});

test('before the first sentence returns nothing', () => {
  const { sync } = makeSync();
  alignment.sentences[0].s = 1.0;
  const s2 = new ReaderSync({ audio: { src: 'x' }, container: null }).load(alignment, true);
  assert.strictEqual(s2.indexAtTime(0.2), -1);
  alignment.sentences[0].s = 0.0;
});

test('round trip: seek to a sentence then look it up', () => {
  const { sync, audio } = makeSync();
  for (const target of [0, 1, 2, 3]) {
    sync.seekToSentence(target);
    const found = sync.sentences[sync.indexAtTime(audio.currentTime)].i;
    assert.strictEqual(found, target, `seeking to ${target} resolved back to ${found}`);
  }
});

test('unsyncable when the visible text is not the spoken text', () => {
  const sync = new ReaderSync({ audio: { src: 'x' }, container: null });
  sync.load(alignment, false);
  assert.strictEqual(sync.syncable, false);
  assert.strictEqual(sync.seekToSentence(1), false, 'must refuse to seek rather than guess');
});

test('reports approximate alignment honestly', () => {
  const sync = new ReaderSync({ audio: { src: 'x' }, container: null });
  sync.load({ approximate: true, sentences: alignment.sentences }, true);
  assert.strictEqual(sync.approximate, true);
  assert.match(sync.statusText, /Approximate/);
});

test('follow mode defaults to off', () => {
  const { sync } = makeSync();
  assert.strictEqual(sync.followMode, false, 'auto-scroll must be opt-in');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
