import * as su from '../server/services/scriptUtils.js';

const keepSet = su.buildKeepSet(['System', 'Level', 'HP', 'hunter']);

const cases = [
  ['roman hinglish', 'hi', 'Woh ek naya hunter tha. System ne use Level 5 diya aur uska HP badh gaya.'],
  ['devanagari', 'hi', 'वह एक नया hunter था। System ने उसे Level 5 दिया।'],
  ['english out', 'en', 'He was a new hunter. The System gave him Level 5.'],
];

for (const [label, lang, text] of cases) {
  const r = su.prepareForTts(text, { language: lang, keepSet });
  console.log('---', label, '---');
  console.log('detected   :', r.detected);
  console.log('transformed:', r.transformed);
  console.log('note       :', r.note);
  console.log('preserved  :', r.preserved.join(', '));
  console.log('SPOKEN     :', r.spoken);
  console.log();
}

console.log('=== verbatim mode ===');
console.log(su.prepareForTts('Woh ek naya hunter tha', { language: 'hi', keepSet, verbatim: true }).note);

console.log('=== extractProperNouns ===');
console.log(su.extractProperNouns('Quinn walked into the Dungeon. The System spoke to Quinn again. Layla and Quinn fought the Boss.'));
