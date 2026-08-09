/**
 * Smoke test for the new server service modules.
 * Run:  node scratch/verify-services.mjs
 */
import * as su from '../server/services/scriptUtils.js';
import * as pr from '../server/services/prompts.js';
import * as rl from '../server/services/rateLimiter.js';

console.log('=== scriptUtils exports ===');
console.log(Object.keys(su).join(', '));

console.log('\n=== detectScript ===');
console.log('devanagari  ->', su.detectScript('वह एक नया hunter था और level 5 par tha'));
console.log('roman       ->', su.detectScript('Woh ek naya hunter tha yaar, bahut strong'));
console.log('latin       ->', su.detectScript('He was a new hunter and very strong indeed'));
console.log('empty       ->', su.detectScript('   '));

console.log('\n=== estimateTokens ===');
console.log('en:', su.estimateTokens('Hello world this is a test of the token estimator here'));
console.log('hi:', su.estimateTokens('वह एक नया शिकारी था और वह बहुत मजबूत था'));

console.log('\n=== splitSentences ===');
console.log(JSON.stringify(su.splitSentences('He ran fast. She said stop! Then it ended। Really? Yes.'), null, 1));

console.log('\n=== prompts exports ===');
console.log(Object.keys(pr).join(', '));
console.log('PROMPT_VERSION:', pr.PROMPT_VERSION);

console.log('\n=== rateLimiter exports ===');
console.log(Object.keys(rl).join(', '));
