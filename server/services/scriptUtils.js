/**
 * Script utilities — detection, token estimation and sentence segmentation.
 *
 * DESIGN DECISION (revised after review)
 * --------------------------------------
 * An earlier version of this file contained a hand-written Roman-Hinglish to
 * Devanagari phonetic transliterator. It has been DELETED, deliberately.
 *
 * Why: it produced bad Hindi ("bahut" became "बहुट", "diya" became "डिय") and,
 * more importantly, it solved a problem that does not need solving. We already
 * send the text through an LLM. Asking the LLM to "write it in natural Hinglish
 * but output in Devanagari" gets a linguistically correct result for free.
 * Hand-rolling a phonetic mapper to clean up after the LLM was added complexity
 * and added noise, and it made the output worse, not better.
 *
 * The rule is now simple:
 *   - AI retelling: we ASK for Devanagari, we GET Devanagari. Nothing to convert.
 *   - Custom script: the user's text is spoken VERBATIM, byte for byte. If they
 *     paste Roman Hinglish we WARN them (edge-tts hi-IN voices read Devanagari,
 *     not Latin) and let them decide. We never silently rewrite user input.
 *
 * Everything here is pure and synchronous so it can be unit tested and previewed
 * in the UI ("this is exactly what will be sent to TTS").
 */

// ---------------------------------------------------------------------------
// 1. Script detection
// ---------------------------------------------------------------------------

const DEVANAGARI_RE = /[\u0900-\u097F]/g;
const LATIN_RE = /[A-Za-z]/g;

/** Common Hindi function words that betray Roman Hinglish. */
const HINGLISH_MARKERS = [
  'hai', 'tha', 'thi', 'the', 'nahi', 'nahin', 'kya', 'aur', 'lekin', 'magar',
  'woh', 'wah', 'yeh', 'ye', 'uska', 'uski', 'unka', 'mera', 'meri', 'tera',
  'apna', 'apne', 'liye', 'karke', 'karna', 'kiya', 'gaya', 'gayi', 'raha',
  'rahi', 'rahe', 'hua', 'hui', 'huye', 'bahut', 'thoda', 'phir', 'abhi',
  'kuch', 'sab', 'jab', 'tab', 'agar', 'toh', 'bhi', 'mein', 'yaar',
  'bhai', 'arre', 'matlab', 'achha',
];

function looksLikeHinglish(text) {
  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  if (words.length < 8) return false;
  const sample = words.slice(0, 400);
  const hits = sample.filter((w) => HINGLISH_MARKERS.includes(w)).length;
  return hits / sample.length > 0.06;
}

/**
 * @returns {'devanagari'|'roman_hinglish'|'latin'|'mixed'|'empty'}
 */
export function detectScript(text) {
  if (!text || !text.trim()) return 'empty';

  const dev = (text.match(DEVANAGARI_RE) || []).length;
  const lat = (text.match(LATIN_RE) || []).length;
  const total = dev + lat;
  if (total === 0) return 'empty';

  const devRatio = dev / total;

  // Mostly Devanagari with English words sprinkled in is EXACTLY the output we
  // want from the AI, so a wide band counts as devanagari rather than mixed.
  if (devRatio > 0.35) return 'devanagari';
  if (devRatio > 0.05) return 'mixed';

  return looksLikeHinglish(text) ? 'roman_hinglish' : 'latin';
}

export function scriptLabel(kind) {
  return {
    devanagari: 'Devanagari (Hindi)',
    roman_hinglish: 'Roman Hinglish',
    latin: 'English / Latin',
    mixed: 'Devanagari + English',
    empty: 'Empty',
  }[kind] || kind;
}

// ---------------------------------------------------------------------------
// 2. TTS suitability check (ADVISORY ONLY - we never rewrite the user's text)
// ---------------------------------------------------------------------------

/**
 * Decide what to send to TTS and whether to warn the user.
 *
 * This does NOT transform the text. It returns the text unchanged plus an honest
 * assessment, which the UI shows as "this is exactly what will be spoken".
 *
 * @param {string} text
 * @param {object} opts
 * @param {'en'|'hi'} opts.language language of the selected voice
 * @returns {{ spoken:string, detected:string, ok:boolean, severity:'ok'|'warn'|'error', note:string }}
 */
export function prepareForTts(text, { language } = {}) {
  const detected = detectScript(text);

  if (detected === 'empty') {
    return {
      spoken: text, detected, ok: false, severity: 'error',
      note: 'Text is empty - nothing to speak.',
    };
  }

  if (language === 'en') {
    if (detected === 'devanagari') {
      return {
        spoken: text, detected, ok: false, severity: 'error',
        note: 'This text is Devanagari Hindi but an ENGLISH voice is selected. Choose a Hindi voice (Swara / Madhur).',
      };
    }
    return {
      spoken: text, detected, ok: true, severity: 'ok',
      note: 'English voice with Latin text - good.',
    };
  }

  // Hindi voice selected.
  if (detected === 'devanagari' || detected === 'mixed') {
    return {
      spoken: text, detected, ok: true, severity: 'ok',
      note: 'Devanagari with English terms kept in Latin - exactly what Hindi neural voices read best.',
    };
  }

  if (detected === 'roman_hinglish') {
    return {
      spoken: text, detected, ok: true, severity: 'warn',
      note: 'This looks like Roman Hinglish (Latin letters). Hindi voices read Devanagari properly; '
          + 'Latin text gets English phonetics and usually sounds wrong. '
          + 'Tip: paste the same text in Devanagari for a much better result.',
    };
  }

  return {
    spoken: text, detected, ok: true, severity: 'warn',
    note: 'This looks like plain English but a Hindi voice is selected. It will be read with a Hindi accent.',
  };
}

// ---------------------------------------------------------------------------
// 3. Token estimation (for chunk budgeting against Groq TPM limits)
// ---------------------------------------------------------------------------

/**
 * Deliberately conservative - we round UP. Under-estimating tokens is exactly
 * what produced the "Requested 9459, limit 6000" failures.
 */
export function estimateTokens(text) {
  if (!text) return 0;
  const dev = (text.match(DEVANAGARI_RE) || []).length;
  const rest = text.length - dev;
  // Devanagari is far less token-efficient than Latin in these tokenizers.
  return Math.ceil(rest / 3.2 + dev / 1.4);
}

// ---------------------------------------------------------------------------
// 4. Segmentation
// ---------------------------------------------------------------------------

export function splitParagraphs(text) {
  if (!text) return [];
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

/**
 * Split text into sentences with character offsets, so the frontend can
 * highlight exactly the sentence being spoken (karaoke alignment).
 *
 * @returns {{ index:number, text:string, charStart:number, charEnd:number, paraIndex:number }[]}
 */
export function splitSentences(text) {
  if (!text) return [];

  const sentences = [];
  let sIndex = 0;
  let searchFrom = 0;

  const paragraphs = text.split(/\n\s*\n/);

  paragraphs.forEach((para, paraIndex) => {
    if (!para.trim()) return;

    const paraStart = text.indexOf(para, searchFrom);
    searchFrom = paraStart + para.length;

    // Hindi danda counts as a full stop, as do . ! ?
    const parts = para.split(/(?<=[.!?\u0964])\s+/);
    let local = 0;

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) { local += part.length; continue; }

      const offsetInPara = para.indexOf(trimmed, local);
      const charStart = paraStart + offsetInPara;

      sentences.push({
        index: sIndex++,
        text: trimmed,
        charStart,
        charEnd: charStart + trimmed.length,
        paraIndex,
      });

      local = offsetInPara + trimmed.length;
    }
  });

  return sentences;
}
