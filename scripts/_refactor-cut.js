/**
 * One-off: remove blocks from main.js that have been extracted into modules.
 * Matches on exact anchor lines so it cannot silently delete the wrong region.
 */
import fs from 'fs';

const file = 'src/main.js';
let src = fs.readFileSync(file, 'utf8');
const before = src.split('\n').length;

function cut(startAnchor, endAnchor, replacement) {
  const start = src.indexOf(startAnchor);
  if (start === -1) throw new Error(`start anchor not found: ${startAnchor.slice(0, 60)}`);
  const end = src.indexOf(endAnchor, start);
  if (end === -1) throw new Error(`end anchor not found: ${endAnchor.slice(0, 60)}`);
  src = src.slice(0, start) + replacement + src.slice(end);
}

// --- log console (now src/components/logConsole.js) ------------------------
cut(
  '// ============================================\n// LOG CONSOLE\n// ============================================',
  '// ============================================\n// MODAL\n// ============================================',
  '// ============================================\n// LOG CONSOLE — see src/components/logConsole.js\n// ============================================\n\n'
);

// --- toasts (now src/components/toast.js) ---------------------------------
cut(
  '// ============================================\n// TOASTS\n// ============================================',
  '// ============================================\n// UTILS\n// ============================================',
  '// ============================================\n// TOASTS — see src/components/toast.js\n// ============================================\n\n'
);

// --- escapeHtml (now src/utils/html.js) -----------------------------------
cut(
  '// ============================================\n// UTILS\n// ============================================',
  '\n',
  '// ============================================\n// UTILS — see src/utils/html.js\n// ============================================'
);

src = src.replace(
  /function escapeHtml\(str\) \{[\s\S]*?\n\}\n/,
  ''
);

fs.writeFileSync(file, src);
console.log(`main.js: ${before} -> ${src.split('\n').length} lines`);
