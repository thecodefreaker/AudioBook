/**
 * Runs every check in one command.
 *
 * Static checks (audit, sync) always run. API checks are skipped with a clear
 * message when the server isn't up, so `npm test` never fails misleadingly.
 */
import { spawnSync } from 'child_process';

const BASE = process.env.BASE || 'http://localhost:3000/api';

const run = (label, file) => {
  console.log(`\n${'='.repeat(58)}\n${label}\n${'='.repeat(58)}`);
  const r = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  return r.status === 0;
};

const serverUp = await fetch(`${BASE}/health`).then((r) => r.ok).catch(() => false);

const results = [];
results.push(['UI wiring audit', run('UI WIRING AUDIT', 'scripts/audit-ui.js')]);
results.push(['CSS variables', run('CSS VARIABLE AUDIT', 'scripts/audit-css.js')]);
results.push(['Unstyled markup', run('UNSTYLED MARKUP AUDIT', 'scripts/audit-unstyled.js')]);
results.push(['Reader sync', run('READER SYNC', 'scripts/test-sync.js')]);
results.push(['Chapter list', run('CHAPTER LIST', 'scripts/test-chapter-list.js')]);
results.push(['Cover extraction', run('COVER EXTRACTION', 'scripts/test-cover-extract.js')]);

if (serverUp) {
  results.push(['Custom scripts', run('CUSTOM SCRIPTS (API)', 'scripts/test-custom-script.js')]);
  results.push(['Audiobook merge', run('AUDIOBOOK MERGE (API)', 'scripts/test-audiobook.js')]);
} else {
  console.log(`\nSkipping API tests — no server at ${BASE}. Start it with:  npm run server`);
}

console.log(`\n${'='.repeat(58)}\nSUMMARY\n${'='.repeat(58)}`);
for (const [name, ok] of results) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);

const failed = results.filter(([, ok]) => !ok).length;
console.log(failed ? `\n${failed} suite(s) failed.\n` : '\nAll suites passed.\n');
process.exit(failed ? 1 : 0);
