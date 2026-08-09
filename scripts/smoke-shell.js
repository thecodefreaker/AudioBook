/**
 * Smoke check: fetch the running app and confirm the shell regions and
 * stylesheets are actually being served. Catches "the page renders but the
 * layout is missing" without needing a browser.
 */
const URL_APP = process.env.APP || 'http://localhost:5173/index.html';

const html = await fetch(URL_APP).then((r) => r.text());

const ids = [
  'shell-content', 'shell-sidebar', 'chapters-list', 'library-grid',
  'sticky-player', 'log-console', 'header-book',
];
const sheets = ['tokens', 'primitives', 'shell', 'chapters', 'player', 'index', 'components'];

let bad = 0;
console.log('\nShell regions:');
for (const id of ids) {
  const ok = html.includes(`id="${id}"`);
  if (!ok) bad++;
  console.log(`  ${ok ? 'OK  ' : 'MISS'}  #${id}`);
}

console.log('\nStylesheets:');
for (const s of sheets) {
  const ok = html.includes(`${s}.css`);
  if (!ok) bad++;
  console.log(`  ${ok ? 'OK  ' : 'MISS'}  ${s}.css`);
}

console.log(bad ? `\n${bad} missing.` : '\nAll present.');
process.exit(bad ? 1 : 0);
