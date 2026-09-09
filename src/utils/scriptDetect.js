/**
 * Isomorphic script and language detection for client-side script editing.
 */

const DEVANAGARI_RE = /[\u0900-\u097F]/g;
const LATIN_RE = /[A-Za-z]/g;

const HINGLISH_MARKERS = [
  'hai', 'tha', 'thi', 'the', 'nahi', 'nahin', 'kya', 'aur', 'lekin', 'magar',
  'woh', 'wah', 'yeh', 'ye', 'uska', 'uski', 'unka', 'mera', 'meri', 'tera',
  'apna', 'apne', 'liye', 'karke', 'karna', 'kiya', 'gaya', 'gayi', 'raha',
  'rahi', 'rahe', 'hua', 'hui', 'huye', 'bahut', 'thoda', 'phir', 'abhi',
  'kuch', 'sab', 'jab', 'tab', 'agar', 'toh', 'bhi', 'mein', 'yaar',
  'bhai', 'arre', 'matlab', 'achha',
];

export function looksLikeHinglish(text) {
  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  if (words.length < 8) return false;
  const sample = words.slice(0, 400);
  const hits = sample.filter((w) => HINGLISH_MARKERS.includes(w)).length;
  return hits / sample.length > 0.06;
}

export function detectScript(text) {
  if (!text || !text.trim()) return 'empty';

  const dev = (text.match(DEVANAGARI_RE) || []).length;
  const lat = (text.match(LATIN_RE) || []).length;
  const total = dev + lat;
  if (total === 0) return 'empty';

  const devRatio = dev / total;
  if (devRatio > 0.35) return 'devanagari';
  if (devRatio > 0.05) return 'mixed';

  return looksLikeHinglish(text) ? 'roman_hinglish' : 'latin';
}

export function scriptLabel(kind) {
  return {
    devanagari: 'Hindi (देवनागरी)',
    roman_hinglish: 'Roman Hinglish',
    latin: 'English (Latin)',
    mixed: 'Devanagari + English',
    empty: 'Empty',
  }[kind] || kind;
}

/**
 * Suggest best language code and voice based on text contents.
 */
export function suggestLanguageAndVoice(text, currentVoiceId = null, catalogLanguages = []) {
  const kind = detectScript(text);

  let lang = 'en';
  let note = '';

  if (kind === 'devanagari' || kind === 'mixed') {
    lang = 'hi';
    note = 'Devanagari Hindi detected — optimal with Hindi Neural voices.';
  } else if (kind === 'roman_hinglish') {
    lang = 'hi';
    note = 'Roman Hinglish detected — best read by Hindi Neural voices.';
  } else if (kind === 'latin') {
    lang = 'en';
    note = 'English / Latin text detected — best read by English Neural voices.';
  }

  const langDef = catalogLanguages.find(l => l.code === lang);
  const voices = langDef?.voices || [];

  let voiceId = currentVoiceId;
  const voiceMatches = voices.some(v => v.id === voiceId);
  if (!voiceMatches && voices.length > 0) {
    voiceId = voices[0].id;
  }

  return {
    kind,
    label: scriptLabel(kind),
    language: lang,
    voices,
    voiceId,
    note,
  };
}
