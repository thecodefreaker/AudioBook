import * as su from '../server/services/scriptUtils.js';
import fs from 'fs';

const keepSet = su.buildKeepSet(['System', 'Level', 'HP', 'hunter', 'Quinn']);

const samples = [
  'Woh ek naya hunter tha.',
  'System ne use Level 5 diya aur uska HP badh gaya.',
  'Quinn ne kaha ki yeh bahut mushkil hai yaar.',
  'Main ghar ja raha hoon aur mujhe bahut khushi hai.',
  'Uske paas koi skill nahi thi lekin usne kabhi haar nahi mani.',
];

const lines = [];
for (const s of samples) {
  const r = su.prepareForTts(s, { language: 'hi', keepSet });
  lines.push('IN : ' + s);
  lines.push('OUT: ' + r.spoken);
  lines.push('');
}

fs.writeFileSync(new URL('translit-out.txt', import.meta.url), lines.join('\n'), 'utf8');
console.log('written');
