/**
 * Removes the legacy :root palette block from index.css.
 *
 * tokens.css now owns every colour and maps the old variable names onto the
 * new ramp. Leaving the old block in place would silently override the new
 * palette, because index.css is loaded afterwards.
 */
import fs from 'fs';

const file = 'src/styles/index.css';
let css = fs.readFileSync(file, 'utf8');
const before = css.split('\n').length;

const start = css.indexOf(':root {');
if (start === -1) throw new Error('no :root block found');
const end = css.indexOf('\n}', start);
if (end === -1) throw new Error('unterminated :root block');

const removed = css.slice(start, end + 2);
if (!removed.includes('--bg-primary')) {
  throw new Error('refusing to cut: this is not the legacy palette block');
}

css = css.slice(0, start) +
  `/* Design tokens now live in tokens.css — see that file for the palette,
   type scale and spacing grid. The legacy variable names are aliased there,
   so existing markup keeps working while it is migrated. */\n` +
  css.slice(end + 2);

fs.writeFileSync(file, css);
console.log(`index.css: ${before} -> ${css.split('\n').length} lines (removed ${removed.split('\n').length})`);
