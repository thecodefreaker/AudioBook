/**
 * Prompt catalogue — the Hinglish Storytelling Engine.
 *
 * DESIGN PHILOSOPHY (revised after review)
 * ---------------------------------------
 * The user pointed out — correctly — that they got a perfect result from ChatGPT
 * with a single short instruction, roughly:
 *
 *   "Convert this chapter into normal Hinglish but give the output in Devanagari.
 *    Keep the tone natural, like we talk in daily life, like a YouTuber narrating
 *    a story. Don't translate word for word — some words English, some Hindi,
 *    casually, the way we actually speak."
 *
 * That instruction IS the product. A capable model already knows not to write
 * textbook Hindi; it does not need an 18-item banned-word list or a 45-item
 * protected-vocabulary table. Those made the prompt longer, ate tokens (scarce on
 * a 6000 TPM free tier), and added noise for no measured gain.
 *
 * So the prompt is SHORT AND DIRECT by default.
 *
 * The two things we DO add are not stylistic nagging — they exist only to
 * compensate for a real structural difference from the ChatGPT workflow:
 *
 *   1. CONTINUITY. ChatGPT saw the whole chapter at once. We must chunk, because
 *      of the TPM limit. A chunk starting mid-scene has no context, so we pass
 *      the tail of the previous output. This compensates for chunking, not for
 *      the model being weak.
 *
 *   2. GLOSSARY. Optional, OFF by default. Only relevant across hundreds of
 *      chapters where a name can drift (Quinn → क्विन → Queen). Single-chapter
 *      use never needs it. Enable only if drift is actually observed.
 *
 * Everything here is data, not code, so it can be exposed in a Settings
 * prompt-editor and edited by the user without a rebuild.
 */

export const PROMPT_VERSION = 'v3-lean';

/**
 * The core instruction. Deliberately close to what the user typed into ChatGPT.
 * Fully user-editable from Settings.
 */
export const MASTER_SYSTEM_PROMPT =
`Convert the given chapter into normal, natural Hinglish — the way we actually talk in daily life.
Write the output in Devanagari script.

Tone: like a YouTuber narrating a story, or like you're telling the story to someone yourself.
Keep it casual and natural, not formal or literary.

Do not translate word for word. Understand it, then retell it.
Some words in Hindi, some in English — mixed casually, exactly the way people really speak.
Keep names, places and story-specific terms as they are.

Keep the story, events, emotions and dialogue exactly the same. Don't summarise, don't add anything.
Keep paragraph breaks. This will be read aloud, so keep sentences easy to speak.

Output only the story. Nothing else.`;

/**
 * Style catalogue.
 *
 * `instructions` are intentionally 1-3 lines — a nudge on top of the master
 * prompt, not a second essay. `sample` is shown on the style card in the Convert
 * dialog so the user can SEE what they're choosing instead of guessing from an
 * abstract label.
 */
export const STYLES = {
  novel: {
    id: 'novel',
    name: 'Web Novel / LitRPG',
    icon: '📖',
    tagline: 'YouTube chapter-explainer energy',
    description: 'Best for web novels, fantasy and system/LitRPG stories.',
    outputScript: 'devanagari',
    sample: 'तो जैसे ही उसने वो Gate cross किया, System का notification blink हुआ — "Quest accepted: Survive."',
    languages: ['hi'],
    instructions:
      'Narrate like a Hindi YouTube channel explaining a novel chapter.\n' +
      'Game and system words (System, Quest, Level, Skill, HP, Dungeon, Boss...) stay in English, as people naturally say them.\n' +
      'System messages and stat blocks stay in their original English formatting.',
  },

  casual: {
    id: 'casual',
    name: 'Casual Storytelling',
    icon: '💬',
    tagline: 'Like a friend telling you what happened',
    description: 'Relaxed conversational Hinglish. Good for slice-of-life, memoirs, light fiction.',
    outputScript: 'devanagari',
    sample: 'अरे यार, फिर जो हुआ ना, वो सोचकर भी हँसी आती है — वो बंदा सीधा टेबल पर चढ़ गया।',
    languages: ['hi'],
    instructions:
      "Talk like you're telling a friend what happened over chai. Warm, personal, unhurried.\n" +
      'Natural fillers where they fit: yaar, arre, matlab, achha.',
  },

  dramatic: {
    id: 'dramatic',
    name: 'Cinematic / Dramatic',
    icon: '🎭',
    tagline: 'Film-trailer narrator',
    description: 'Heightened, cinematic narration. Best for thrillers, action, epic fantasy.',
    outputScript: 'devanagari',
    sample: 'हवा रुक गई। एक कदम... फिर दूसरा। और तभी, अंधेरे से वो बाहर निकला।',
    languages: ['hi'],
    instructions:
      'Heighten atmosphere and tension, but never invent events.\n' +
      'Very short sentences at climactic moments. Use punctuation for deliberate pauses.',
  },

  formal: {
    id: 'formal',
    name: 'Formal / Educational',
    icon: '🎓',
    tagline: 'Clear, correct, standard Hindi',
    description: 'Proper Hindi for non-fiction, study material and factual books.',
    outputScript: 'devanagari',
    sample: 'इस अध्याय में लेखक यह समझाते हैं कि आदतें किस प्रकार धीरे-धीरे व्यवहार को आकार देती हैं।',
    languages: ['hi'],
    instructions:
      'Override the casual tone: use grammatically correct standard Hindi, not conversational Hinglish.\n' +
      'Technical terms may stay in English where that is normal usage. No slang, no fillers.\n' +
      'Accuracy outweighs flavour. Do not dramatise.',
  },

  kids: {
    id: 'kids',
    name: 'Simple / Kids',
    icon: '🧸',
    tagline: 'Bedtime-story simple',
    description: "Very simple words and short sentences. For children's books or easy listening.",
    outputScript: 'devanagari',
    sample: 'एक छोटा सा खरगोश था। वो बहुत तेज़ भागता था। एक दिन वो जंगल में खो गया।',
    languages: ['hi'],
    instructions:
      'Very short sentences (8-12 words) and simple, common words only.\n' +
      'Gentle and friendly. Soften frightening intensity.',
  },

  original: {
    id: 'original',
    name: 'Original English',
    icon: '🇬🇧',
    tagline: 'No transformation at all',
    description: 'Speaks the book exactly as written. No AI involved, no cost, no waiting.',
    outputScript: 'latin',
    sample: 'The text is read exactly as it appears in the book.',
    languages: ['en'],
    instructions: null,
  },

  custom: {
    id: 'custom',
    name: 'Custom Script',
    icon: '✍️',
    tagline: 'Your own text, spoken verbatim',
    description: 'Uses the script you pasted for this chapter. No AI translation is performed.',
    outputScript: 'auto',
    sample: 'Whatever you paste is exactly what gets spoken.',
    languages: ['hi', 'en'],
    instructions: null,
  },
};

export function getStyle(id) {
  return STYLES[id] || STYLES.novel;
}

export function listStyles() {
  return Object.values(STYLES);
}

/**
 * Build the prompt for one chunk.
 *
 * Kept deliberately small. Optional blocks are appended only when actually
 * needed, so a single-chunk chapter gets almost exactly the plain instruction
 * the user validated by hand in ChatGPT.
 *
 * @param {object} opts
 * @param {string}   opts.text             the English source chunk
 * @param {string}   [opts.styleId]
 * @param {string[]} [opts.glossary]       terms that must stay identical (opt-in)
 * @param {string}   [opts.previousTail]   tail of the previous chunk's output
 * @param {boolean}  [opts.isContinuation] true for every chunk after the first
 * @param {string}   [opts.overrideSystem] user-edited master prompt from Settings
 */
export function buildTranslationPrompt({
  text,
  styleId = 'novel',
  glossary = [],
  previousTail = '',
  isContinuation = false,
  overrideSystem,
}) {
  const style = getStyle(styleId);
  const parts = [overrideSystem || MASTER_SYSTEM_PROMPT];

  if (style.instructions) parts.push(style.instructions);

  // Only when chunking actually splits a chapter.
  if ((isContinuation || previousTail) && previousTail) {
    parts.push(
      'This is a continuation of the same chapter. The previous part ended like this:\n' +
      `"""\n${previousTail}\n"""\n` +
      'Continue in the same voice and tense. Do not repeat it or re-introduce the scene.'
    );
  }

  // Opt-in only.
  if (glossary && glossary.length) {
    const terms = glossary
      .slice(0, 80)
      .map((g) => (typeof g === 'string' ? g : g?.term))
      .filter(Boolean);
    if (terms.length) {
      parts.push('Keep these exactly as written, every time:\n' + terms.join(', '));
    }
  }

  parts.push(`CHAPTER:\n"""\n${text}\n"""`);

  return parts.filter(Boolean).join('\n\n');
}

/**
 * Strip the preambles models add despite being told not to.
 * Returns the cleaned text plus whether anything was stripped, so we can log it
 * honestly rather than silently "fixing" the model behind the user's back.
 */
export function cleanModelOutput(raw) {
  if (!raw) return { text: '', stripped: false };
  let text = raw.trim();
  let stripped = false;

  // Whole output wrapped in a markdown fence.
  const fence = text.match(/^```(?:\w+)?\s*\n([\s\S]*?)\n```$/);
  if (fence) { text = fence[1].trim(); stripped = true; }

  const preambles = [
    /^here'?s?\s+(?:is\s+)?the\s+[^\n:]{0,60}:\s*/i,
    /^here\s+is\s+[^\n:]{0,60}:\s*/i,
    /^sure[,!]?\s+here[^\n]{0,60}:\s*/i,
    /^(?:translation|conversion|hinglish version|output)\s*:\s*/i,
    /^\*{0,2}(?:अनुवाद|रूपांतरण)\*{0,2}\s*:\s*/,
  ];
  for (const re of preambles) {
    if (re.test(text)) { text = text.replace(re, '').trim(); stripped = true; }
  }

  // A note the model appended after the story.
  const trailing = text.match(/\n\s*(?:\*{0,2})(?:Note|नोट)(?:\*{0,2})\s*:[\s\S]*$/i);
  if (trailing) { text = text.slice(0, trailing.index).trim(); stripped = true; }

  return { text, stripped };
}

/**
 * Sanity-check a chunk result. We do NOT silently accept broken output — the UI
 * and the log get told exactly what looked wrong.
 *
 * `fatal` issues trigger a retry. `warn` issues are logged and shipped, because
 * a slightly odd chapter beats no chapter.
 *
 * @returns {{ code:string, severity:'fatal'|'warn', message:string }[]}
 */
export function validateOutput({ source, output, styleId = 'novel', glossary = [] } = {}) {
  const issues = [];

  if (!output || !output.trim()) {
    return [{ code: 'empty', severity: 'fatal', message: 'Model returned empty output' }];
  }

  const srcLen = Math.max(1, (source || '').length);
  const ratio = output.length / srcLen;

  if (ratio < 0.35) {
    issues.push({
      code: 'too_short',
      severity: 'fatal',
      message: `Output is only ${Math.round(ratio * 100)}% of the source length — almost certainly truncated`,
    });
  } else if (ratio < 0.55) {
    issues.push({
      code: 'short',
      severity: 'warn',
      message: `Output is ${Math.round(ratio * 100)}% of the source length — may have skipped content`,
    });
  } else if (ratio > 3.0) {
    issues.push({
      code: 'too_long',
      severity: 'warn',
      message: `Output is ${Math.round(ratio * 100)}% of the source length — model may have added commentary`,
    });
  }

  // For Hindi styles the output must actually be Devanagari.
  const style = getStyle(styleId);
  if (style.outputScript === 'devanagari') {
    const dev = (output.match(/[\u0900-\u097F]/g) || []).length;
    const devRatio = dev / Math.max(1, output.length);
    if (devRatio < 0.10) {
      issues.push({
        code: 'not_devanagari',
        severity: 'fatal',
        message: 'Expected Devanagari output but the model returned mostly Latin text',
      });
    } else if (devRatio < 0.25) {
      issues.push({
        code: 'low_devanagari',
        severity: 'warn',
        message: 'Output has unusually little Devanagari — check that it sounds right',
      });
    }
  }

  // Glossary drift (only checked when the user opted into a glossary).
  for (const g of glossary || []) {
    const term = typeof g === 'string' ? g : g?.term;
    if (!term) continue;
    if (source && source.includes(term) && !output.includes(term)) {
      issues.push({
        code: 'glossary_drift',
        severity: 'warn',
        message: `Glossary term "${term}" was in the source but is missing from the output`,
      });
    }
  }

  return issues;
}
