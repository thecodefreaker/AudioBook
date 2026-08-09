import * as pr from '../server/services/prompts.js';
import * as su from '../server/services/scriptUtils.js';
import fs from 'fs';

const sample = 'Quinn walked into the dungeon. The System flashed a warning. He checked his HP and kept going.';

const p = pr.buildTranslationPrompt({ text: sample, styleId: 'novel' });

const out = [];
out.push('=== PROMPT OVERHEAD (tokens, excluding the chapter text) ===');
out.push('lean prompt overhead: ' + su.estimateTokens(p.replace(sample, '')) + ' tokens');
out.push('');
out.push('=== FULL PROMPT for a first chunk ===');
out.push(p);
out.push('');
out.push('=== validateOutput shape ===');
out.push(JSON.stringify(pr.validateOutput({ source: sample, output: 'क्विन dungeon में गया। System ने warning दी।', styleId: 'novel' }), null, 1));
out.push('');
out.push('=== prepareForTts (custom script, roman) ===');
out.push(JSON.stringify(su.prepareForTts('Woh ek naya hunter tha yaar bahut strong tha aur usne kabhi haar nahi mani', { language: 'hi' }), null, 1));
out.push('');
out.push('=== prepareForTts (devanagari) ===');
out.push(JSON.stringify(su.prepareForTts('वह एक नया hunter था। System ने उसे Level 5 दिया।', { language: 'hi' }), null, 1));
out.push('');
out.push('exports scriptUtils: ' + Object.keys(su).join(', '));

fs.writeFileSync(new URL('lean-out.txt', import.meta.url), out.join('\n'), 'utf8');
console.log('ok');
