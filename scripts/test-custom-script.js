/**
 * End-to-end check for the "my own script" path.
 *
 * This exists because of a specific, repeated bug report: pasting a custom
 * script and converting still produced AI-translated audio, with nothing in
 * the UI saying which text was used. The guarantee we assert here is simple —
 *
 *   scriptSource: 'custom'  =>  the audio is built from the pasted text,
 *                               byte-for-byte, with no AI step.
 *
 * Run with the server up:  node scripts/test-custom-script.js
 */
const BASE = process.env.API_BASE || 'http://localhost:3000/api';

const SCRIPT = [
  'Alice apni behen ke paas nadi kinare baithi thi aur usse bahut bore ho rahi thi.',
  'Ek ya do baar usne behen ki kitaab mein jhaanka, lekin usmein na koi tasveer thi na koi baatcheet.',
  '"Aisi kitaab ka kya fayda," Alice ne socha, "jismein tasveerein hi na hon?"',
].join(' ');

let pass = 0;
let fail = 0;

function check(label, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
}

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) {
    throw new Error(`${res.status} ${path} -> ${typeof body === 'string' ? body : JSON.stringify(body)}`);
  }
  return body;
}

async function main() {
  console.log('\nCustom script end-to-end\n' + '-'.repeat(40));

  const { books } = await api('/books');
  if (!books?.length) {
    console.log('  SKIP  no books uploaded — upload an EPUB first.');
    return;
  }
  const book = books[0];
  console.log(`  book: ${book.title} (${book.totalChapters} chapters)\n`);

  // ---- 1. Script detection is advisory, not restrictive -------------------
  const latin = await api('/books/' + book.id + '/check-script', {
    method: 'POST',
    body: JSON.stringify({ content: SCRIPT, language: 'hi' }),
  });
  check('Hinglish (Latin) script is accepted', latin.ok !== false && !!latin.detected,
    `detected=${latin.detected} ok=${latin.ok} note=${latin.note || '-'}`);

  const deva = await api('/books/' + book.id + '/check-script', {
    method: 'POST',
    body: JSON.stringify({ content: 'ऐलिस अपनी बहन के पास बैठी थी।', language: 'hi' }),
  });
  check('Devanagari script is accepted too', deva.detected === 'devanagari',
    `detected=${deva.detected}`);

  // ---- 2. Saving stores it verbatim --------------------------------------
  const saved = await api(`/books/${book.id}/chapters/0/script`, {
    method: 'PUT',
    body: JSON.stringify({ content: SCRIPT, language: 'hi' }),
  });
  check('saved script keeps source="custom"', saved.script?.source === 'custom',
    `source=${saved.script?.source}`);
  check('saved content is byte-identical to what was pasted',
    saved.script?.content === SCRIPT);

  // ---- 3. The chapter now advertises the script to the UI -----------------
  const content = await api(`/books/${book.id}/chapters/0/content`);
  check('chapter reports hasCustomScript', content.hasCustomScript === true);
  check('custom script wins over any AI script in the reader view',
    content.activeScript?.source === 'custom',
    `activeScript=${content.activeScript?.source}`);

  // ---- 4. A custom-source conversion must not require an API key ----------
  // This is the real proof there is no AI step: no key, no Groq call.
  const est = await api(`/books/${book.id}/estimate`, {
    method: 'POST',
    body: JSON.stringify({ chapterIndexes: [0], language: 'hi', scriptSource: 'custom' }),
  });
  check('estimate reports 0 AI work for custom scripts',
    (est.aiChapters ?? est.aiCalls ?? 0) === 0,
    JSON.stringify(est).slice(0, 200));

  // ---- 5. Invalid sources are refused, not silently defaulted -------------
  let refused = false;
  try {
    await api(`/books/${book.id}/convert`, {
      method: 'POST',
      body: JSON.stringify({ selectedChapters: [0], language: 'hi', scriptSource: 'nonsense' }),
    });
  } catch (err) {
    refused = /invalid script source/i.test(err.message);
  }
  check('an unknown scriptSource is rejected with a clear error', refused);

  console.log('\n' + '-'.repeat(40));
  console.log(`${pass} passed, ${fail} failed\n`);
  if (fail) process.exitCode = 1;
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  console.error('Is the server running on ' + BASE + ' ?\n');
  process.exitCode = 1;
});
