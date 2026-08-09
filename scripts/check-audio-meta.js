/**
 * Sanity check: every stored audio version must be able to say HOW it was made
 * (language, voice, style and — critically — which script text was spoken).
 *
 * The UI badges these fields, so if they are null the user is back to guessing
 * whether a version came from the AI or from their own pasted script.
 */
const BASE = process.env.BASE || 'http://localhost:3000/api';

const get = async (p) => {
  const r = await fetch(BASE + p);
  if (!r.ok) throw new Error(`${p} -> ${r.status}`);
  return r.json();
};

const books = await get('/books');
const list = books.books || books;
if (!list.length) {
  console.log('No books uploaded — nothing to check.');
  process.exit(0);
}

for (const book of list) {
  const res = await get(`/books/${book.id}/audio`);
  const audio = res.audio || res.audioFiles || res.files || [];
  console.log(`\n📕 ${book.title} — ${audio.length} audio version(s)`);

  for (const a of audio) {
    const flag = a.scriptSource ? '✅' : '❌';
    console.log(
      `  ${flag} ${String(a.id).slice(0, 8)} | source=${a.scriptSource ?? 'MISSING'} ` +
      `| lang=${a.language} | style=${a.translationStyle ?? '—'} ` +
      `| voice=${a.voiceId ?? '—'} | ${a.createdAt}`
    );
  }

  const missing = audio.filter((a) => !a.scriptSource);
  if (missing.length) {
    console.log(`  ⚠️  ${missing.length} version(s) cannot report their script source.`);
  }
}
