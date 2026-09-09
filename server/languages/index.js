/**
 * Language & voice registry.
 *
 * Adding a new output language later = adding one entry here. No pipeline code
 * changes, no UI changes — the Convert dialog, voice pickers and style cards all
 * read from this file.
 */

/**
 * @typedef {object} Voice
 * @property {string} id      provider voice id (edge-tts)
 * @property {string} name    display name
 * @property {'Female'|'Male'} gender
 * @property {string} accent
 * @property {string} [note]
 */

export const LANGUAGES = {
  en: {
    code: 'en',
    name: 'English',
    nativeName: 'English',
    script: 'latin',
    /** No AI step needed — the source is already English. */
    requiresAi: false,
    direction: 'ltr',
    fontStack: "'Georgia', 'Cambria', serif",
    styles: ['original'],
    defaultStyle: 'original',
    defaultVoice: 'en-US-AriaNeural',
    voices: [
      { id: 'en-US-AriaNeural', name: 'Aria', gender: 'Female', accent: 'US', note: 'Warm, natural — good default' },
      { id: 'en-US-GuyNeural', name: 'Guy', gender: 'Male', accent: 'US' },
      { id: 'en-US-JennyNeural', name: 'Jenny', gender: 'Female', accent: 'US' },
      { id: 'en-US-ChristopherNeural', name: 'Christopher', gender: 'Male', accent: 'US', note: 'Deep, documentary feel' },
      { id: 'en-GB-SoniaNeural', name: 'Sonia', gender: 'Female', accent: 'UK' },
      { id: 'en-GB-RyanNeural', name: 'Ryan', gender: 'Male', accent: 'UK' },
      { id: 'en-IN-NeerjaNeural', name: 'Neerja', gender: 'Female', accent: 'Indian' },
      { id: 'en-IN-PrabhatNeural', name: 'Prabhat', gender: 'Male', accent: 'Indian' },
      { id: 'en-AU-NatashaNeural', name: 'Natasha', gender: 'Female', accent: 'Australian' },
    ],
  },

  hi: {
    code: 'hi',
    name: 'Hindi / Hinglish',
    nativeName: 'हिन्दी',
    script: 'devanagari',
    requiresAi: true,
    direction: 'ltr',
    fontStack: "'Noto Serif Devanagari', 'Nirmala UI', 'Mangal', serif",
    styles: ['novel', 'casual', 'dramatic', 'formal', 'kids'],
    defaultStyle: 'novel',
    defaultVoice: 'hi-IN-MadhurNeural',
    voices: [
      { id: 'hi-IN-MadhurNeural', name: 'Madhur', gender: 'Male', accent: 'Indian', note: 'Best for story narration' },
      { id: 'hi-IN-SwaraNeural', name: 'Swara', gender: 'Female', accent: 'Indian', note: 'Clear and expressive' },
    ],
  },
};

/** Short sample used by the "preview voice" button. */
export const VOICE_PREVIEW_TEXT = {
  en: 'This is how your audiobook will sound with this voice.',
  hi: 'आपकी audiobook इस आवाज़ में कुछ ऐसी सुनाई देगी।',
};

export function listLanguages() {
  return Object.values(LANGUAGES).map((l) => ({
    code: l.code,
    name: l.name,
    nativeName: l.nativeName,
    requiresAi: l.requiresAi,
    styles: l.styles,
    defaultStyle: l.defaultStyle,
    defaultVoice: l.defaultVoice,
    voices: l.voices,
  }));
}

export function getLanguage(code) {
  return LANGUAGES[code] || null;
}

export function getVoices(code) {
  return LANGUAGES[code]?.voices || [];
}

export function isValidVoice(code, voiceId) {
  return getVoices(code).some((v) => v.id === voiceId);
}

export function getDefaultVoice(code) {
  return LANGUAGES[code]?.defaultVoice || null;
}

/** Language of a voice id, derived from its prefix (e.g. "hi-IN-..."). */
export function languageOfVoice(voiceId) {
  if (!voiceId) return null;
  const prefix = voiceId.split('-')[0];
  return LANGUAGES[prefix] ? prefix : null;
}

/** Friendly short label for badges: "Madhur" from "hi-IN-MadhurNeural". */
export function voiceLabel(voiceId) {
  if (!voiceId) return 'Voice';
  for (const lang of Object.values(LANGUAGES)) {
    const hit = lang.voices.find((v) => v.id === voiceId);
    if (hit) return hit.name;
  }
  return voiceId.split('-').pop().replace('Neural', '');
}
