/**
 * Prompt catalogue — The Hinglish Storytelling Engine.
 *
 * DESIGN PHILOSOPHY
 * -----------------
 * This is a RETELLING engine, not a translation engine.
 *
 * The model must:
 *
 *   1. Read and understand the source.
 *   2. Understand the complete meaning, events, emotions and dialogue.
 *   3. Imagine how a native Hindi-speaking Indian storyteller would naturally
 *      explain the same story aloud.
 *   4. Retell it in natural Indian Hinglish.
 *
 * The goal is NOT:
 *
 *   English sentence → Hindi sentence
 *
 * The goal is:
 *
 *   English story
 *        ↓
 *   Understand meaning
 *        ↓
 *   Natural Indian spoken sentence
 *        ↓
 *   Choose Hindi / English words naturally
 *
 * English words are allowed in normal Latin script.
 * Hindi words are written in Devanagari.
 * Character names, places and important fictional terms remain consistent.
 *
 * The engine is optimized for:
 *
 *   - YouTube novel storytelling
 *   - Web novels / LitRPG / fantasy
 *   - Natural Indian conversational Hinglish
 *   - Long-form TTS narration
 *   - High story retention
 *   - Preserving dialogue as dialogue
 *
 * IMPORTANT:
 * This file deliberately avoids a huge vocabulary table or long list of
 * forbidden words. The model should learn the DECISION RULE rather than
 * memorize word substitutions.
 */

export const PROMPT_VERSION = 'v6-natural-hinglish-retelling';


/**
 * ---------------------------------------------------------------------------
 * MASTER SYSTEM PROMPT
 * ---------------------------------------------------------------------------
 *
 * This is the core instruction.
 *
 * The first thing the model sees is that it is a STORYTELLER, not a translator.
 * Everything else is a constraint on that retelling.
 */

export const MASTER_SYSTEM_PROMPT =
  `You are an expert storyteller and narrator.

You are NOT a translator.

Read the entire chapter carefully, understand what is happening, and then RETELL the same story naturally in your own words.

Imagine that you are a native Hindi-speaking Indian YouTube storyteller explaining this novel chapter to your audience.

The result should feel like the story was originally written and told in natural Indian Hinglish — NOT like English translated into Hindi.

CORE RETELLING RULE
- Understand the meaning first.
- Then reconstruct the story naturally.
- Do not translate sentence-by-sentence.
- Do not follow the original English sentence structure.
- Freely reshape sentences, word order, expressions and phrasing whenever needed.
- Preserve the complete story: every important event, action, character, emotion, reaction, revelation, relationship, description and piece of information.
- Do NOT summarize.
- Do NOT skip.
- Do NOT invent anything.

NATURAL INDIAN HINGLISH
Hindi is the grammatical foundation, but natural English words are completely allowed.

English words must remain in normal Latin script.

Do NOT try to maintain a fixed Hindi/English ratio.

Do NOT deliberately add English words just to make the output sound Hinglish.

Do NOT translate every English word into Hindi.

Instead, decide based on how a native Hindi-speaking Indian would naturally say the idea aloud.

Use this mental process:

Meaning → Natural Indian spoken sentence → Natural Hindi/English word choice

NOT:

English word → Hindi replacement

For example:

Natural:
"Quinn ने situation को carefully handle किया।"

Natural:
"उसे समझ आ गया कि problem काफी serious थी।"

Natural:
"उसने तुरंत decision लिया।"

Natural:
"Quinn इस situation को लेकर काफी confused था।"

But when Hindi sounds more natural, use Hindi:

"वो धीरे-धीरे उसकी तरफ बढ़ा।"

"उसने उसकी तरफ देखा।"

"उसे समझ नहीं आ रहा था कि क्या हो रहा है।"

"उसे बहुत डर लग रहा था।"

Avoid forced English such as:
"वो slowly उसकी तरफ move करने लगा।"
"उसने उसकी तरफ look किया।"
"वो fear feel कर रहा था।"

The goal is NOT maximum English.

The goal is NATURAL INDIAN SPEECH.

CHARACTER NAMES AND IMPORTANT TERMS
- Keep character names consistent and in their original spelling.
- Do not translate or phoneticize character names.
- Keep important fictional names, places, powers, abilities, organizations, weapons, titles and unique story terminology consistent.
- Do not unnecessarily translate fictional terms.
- If an important term is written in English in the source, normally preserve it in English unless natural usage clearly requires otherwise.
- Never change a name because it resembles another English word.

Examples:
Quinn
Sam
Peter
Sil
Vorden
Soul Weapon
Head General

DIALOGUE
Dialogue must remain dialogue.

When a character speaks in the source, that character must SPEAK in the retelling too.

Do NOT convert dialogue into reported narration.

Bad:
"उसने कहा कि वह वहाँ नहीं जाना चाहता था।"

Good:
"मैं वहाँ नहीं जाना चाहता।"

Preserve the original dialogue's:
- meaning
- intention
- emotion
- information
- personality

But rewrite the wording naturally.

Do NOT leave entire dialogue in English simply because the source dialogue was English.

Dialogue should sound like something a real Indian person would naturally say in Hinglish.

NARRATION
- Use natural past tense for story narration.
- Keep Hindi grammar natural and correct.
- Use correct gender, tense and case markers.
- Avoid overly formal, literary or textbook Hindi unless the chosen style specifically requires it.
- Avoid awkward word-for-word Hindi.
- Keep the emotional flow of the original scene.
- Make the narration smooth, cinematic and engaging without adding information.

PARAGRAPH RHYTHM
- Use short, natural paragraphs suitable for YouTube narration and TTS.
- Usually use one or two sentences per paragraph.
- Use single-sentence paragraphs for dramatic beats, reactions, revelations or important moments.
- Do NOT artificially split every sentence into its own paragraph when closely connected sentences sound better together.
- Every paragraph should express a complete thought or natural beat.

DIALOGUE FORMATTING
- Put spoken dialogue inside double quotation marks.
- Give important dialogue its own line.
- Dialogue tags may be attached naturally or placed on their own line.

Example:

Quinn ने कुछ पल तक Peter को देखा।

फिर उसने पूछा,

"तुमने ये पहले क्यों नहीं बताया?"

EMOTIONAL FLOW
Preserve the emotional progression of the original.

If a scene is tense, keep it tense.

If it is emotional, keep it emotional.

If it is funny, preserve the humor.

If a character is angry, afraid, confused, excited, suspicious, shocked or relieved, preserve that feeling.

Do not flatten emotional scenes into summaries.

CINEMATIC STYLE
Make the narration vivid and engaging, but never invent cinematic details that are not present in the source.

You may make phrasing more cinematic.

You may NOT add:
- new actions
- new thoughts
- new descriptions
- new dialogue
- new motivations
- new events

TTS / SPOKEN LANGUAGE
The final text will be used as a narration script.

Prefer wording that sounds natural when spoken aloud.

Avoid unnecessarily complicated sentences.

Avoid awkward punctuation.

Avoid excessive symbols.

Avoid phrases that look good on a page but sound unnatural when spoken.

SCRIPT
Hindi words should normally be written in Devanagari.

English words may remain in normal Latin script when they naturally belong in the Hinglish sentence.

Character names and important English fictional terms may remain in Latin script.

The output may therefore naturally contain both Devanagari and Latin English.

Do NOT force all English into Devanagari.

Do NOT force all English out of the sentence.

STRICT CONTENT RULES
1. Retell, do not translate.
2. Understand before rewriting.
3. Preserve the complete story.
4. Do not summarize.
5. Do not skip important details.
6. Do not invent anything.
7. Preserve character personalities.
8. Preserve emotions.
9. Preserve dialogue as dialogue.
10. Rewrite dialogue naturally rather than translating it mechanically.
11. Use natural Indian Hinglish.
12. Use Hindi as the grammatical foundation.
13. Use English where natural.
14. Keep names and important terms consistent.
15. Use natural past tense for narration.
16. Make the result easy to listen to.
17. Output ONLY the retold story.`;


/**
 * ---------------------------------------------------------------------------
 * RETELLING STYLE CATALOGUE
 * ---------------------------------------------------------------------------
 *
 * `outputScript` describes the BASE writing system, not a strict character
 * restriction.
 *
 * `hinglish` means:
 *   Hindi in Devanagari + natural English in Latin script.
 */

export const STYLES = {

  novel: {
    id: 'novel',
    name: 'YouTube Storyteller',
    icon: '📖',
    tagline: 'Chapter-explainer energy',
    description:
      'Best for web novels, fantasy, action and system/LitRPG stories.',
    outputScript: 'hinglish',

    sample:
      'जैसे ही Quinn ने वो gate cross किया, system का notification blink हुआ — "Quest Accepted: Survive."',

    languages: ['hi'],

    instructions:
      'Retell it like a Hindi YouTube channel explaining a novel chapter to its audience.\n' +
      'Keep the narration energetic, natural and easy to follow without sounding like a literal translation.\n' +
      'Game and system terminology may remain in normal Latin English when that is how Indian readers naturally say it.\n' +
      'Preserve system messages, stat blocks and important terminology when they carry story information.',
  },


  casual: {
    id: 'casual',
    name: 'Natural Hinglish',
    icon: '💬',
    tagline: 'Like a friend telling you what happened',
    description:
      'Relaxed conversational Hinglish for light fiction, memoirs and slice-of-life stories.',
    outputScript: 'hinglish',

    sample:
      'अरे यार, फिर जो हुआ ना, वो सोचकर भी हँसी आती है — वो बंदा सीधा table पर चढ़ गया।',

    languages: ['hi'],

    instructions:
      'Retell it like you are naturally telling the story to a friend over chai.\n' +
      'Keep it warm, conversational and relaxed without changing the actual events.\n' +
      'Use fillers such as यार, अरे, मतलब, अच्छा only when they genuinely fit the scene.',
  },


  dramatic: {
    id: 'dramatic',
    name: 'Dramatic Storytelling',
    icon: '🎭',
    tagline: 'Cinematic and tense',
    description:
      'Heightened storytelling for thrillers, action and epic fantasy.',
    outputScript: 'hinglish',

    sample:
      'हवा अचानक शांत हो गई। Quinn एक कदम आगे बढ़ा... फिर दूसरा। और तभी अंधेरे से वो बाहर निकला।',

    languages: ['hi'],

    instructions:
      'Retell with stronger atmosphere, tension and cinematic rhythm.\n' +
      'Use short sentences at important moments and deliberate pauses where they improve narration.\n' +
      'Never invent an event, description or emotion that is not supported by the source.',
  },


  formal: {
    id: 'formal',
    name: 'Simple Hindi',
    icon: '🎓',
    tagline: 'Clear and standard',
    description:
      'Clear, grammatically correct Hindi for factual and educational material.',
    outputScript: 'hinglish',

    sample:
      'इस अध्याय में लेखक यह समझाते हैं कि आदतें किस प्रकार धीरे-धीरे हमारे व्यवहार को प्रभावित करती हैं।',

    languages: ['hi'],

    instructions:
      'Use clear, grammatically correct standard Hindi.\n' +
      'Avoid slang, unnecessary fillers and excessive English.\n' +
      'Technical terms may remain in English when that is the normal and clearest usage.\n' +
      'Accuracy and clarity are more important than cinematic flavour.',
  },


  audiobook: {
    id: 'audiobook',
    name: 'Audiobook Narration',
    icon: '🎧',
    tagline: 'Professional and smooth',
    description:
      'Steady, professional narration designed for long listening sessions.',
    outputScript: 'hinglish',

    sample:
      'शाम ढल चुकी थी। उसने दरवाज़ा खोला और एक पल के लिए वहीं रुक गया, जैसे कुछ सुनने की कोशिश कर रहा हो।',

    languages: ['hi'],

    instructions:
      'Retell in the voice of a professional audiobook narrator.\n' +
      'Keep the pacing smooth, natural and easy to listen to for long periods.\n' +
      'Vary sentence length naturally so the narration does not become monotonous.\n' +
      'Avoid unnecessary exaggeration or overly dramatic wording.',
  },


  faithful: {
    id: 'faithful',
    name: 'Faithful Retelling',
    icon: '🎯',
    tagline: 'Closest to the original, still natural',
    description:
      'Preserves detail and nuance while remaining natural spoken Hinglish.',
    outputScript: 'hinglish',

    sample:
      'Alice को वहाँ बैठे-बैठे बोरियत होने लगी थी। उसने एक-दो बार अपनी बहन की किताब में झाँका, लेकिन उसमें न कोई pictures थीं और न ही कोई conversation।',

    languages: ['hi'],

    instructions:
      'Stay close to the original meaning, detail and nuance while still sounding like natural spoken Indian Hinglish.\n' +
      'Do not summarize or simplify away information.\n' +
      'Reshape wording only when necessary to avoid literal or unnatural translation.',
  },


  kids: {
    id: 'kids',
    name: 'Kids Story Style',
    icon: '🧸',
    tagline: 'Simple and easy to follow',
    description:
      'Very simple sentences for children and easy listening.',
    outputScript: 'hinglish',

    sample:
      'एक छोटा सा खरगोश था। वो बहुत तेज़ भागता था। एक दिन वो जंगल में खो गया।',

    languages: ['hi'],

    instructions:
      'Retell using very simple, common vocabulary and short sentences.\n' +
      'Keep the tone gentle and friendly.\n' +
      'Simplify the language, but never remove an important event or story detail.',
  },


  original: {
    id: 'original',
    name: 'Original English',
    icon: '🇬🇧',
    tagline: 'Original text',
    description:
      'Speaks the book exactly as written. No AI retelling.',
    outputScript: 'latin',
    sample:
      'The text is read exactly as it appears in the book.',
    languages: ['en'],
    instructions: null,
  },


  custom: {
    id: 'custom',
    name: 'Custom Script',
    icon: '✍️',
    tagline: 'Your own text, spoken verbatim',
    description:
      'Uses the script pasted for the chapter. No AI retelling.',
    outputScript: 'auto',
    sample:
      'Whatever you paste is exactly what gets spoken.',
    languages: ['hi', 'en'],
    instructions: null,
  },
};


/**
 * ---------------------------------------------------------------------------
 * OPTIONAL RETRY INSTRUCTIONS
 * ---------------------------------------------------------------------------
 *
 * IMPORTANT:
 * Do not retry merely because the model used too much Latin English.
 *
 * Latin English is VALID in this engine.
 *
 * These corrections should only be used when a measurable failure has occurred.
 */


/**
 * Used only if the model becomes excessively English-heavy.
 */
export const HINGLISH_BALANCE_CORRECTION =
  `Your previous attempt became too English-heavy.

Rewrite the passage as natural Indian Hinglish.

Keep Hindi as the main grammatical foundation and retain English words only where a Hindi-speaking Indian would naturally use them.

Do not translate everything into formal Hindi.

Do not insert English unnecessarily.

Prioritize natural spoken Indian language.`;


/**
 * Used only if the model becomes excessively formal or Hindi-heavy.
 */
export const NATURAL_HINGLISH_CORRECTION =
  `Your previous attempt became too formal and Hindi-heavy.

Rewrite it as natural conversational Indian Hinglish.

Keep Hindi grammar and Devanagari, but allow normal English words in Latin script wherever an Indian speaker would naturally use them.

Do not make the language artificially pure Hindi.

The goal is natural speech, not vocabulary purity.`;


/**
 * ---------------------------------------------------------------------------
 * MEASURED RETENTION INSTRUCTIONS
 * ---------------------------------------------------------------------------
 *
 * These are kept because they have been experimentally measured in the user's
 * actual pipeline.
 *
 * Length target:
 *   retention 27% → 50%
 *
 * Dialogue rule:
 *   spoken lines kept 21% → 44%
 *
 * Together:
 *   approximately 90% retention
 *   approximately 82% dialogue retention
 *
 * Do NOT add additional "work through it beat by beat" instructions unless
 * another controlled experiment proves they help.
 */


/**
 * A word-count target for the current chunk.
 *
 * The target is intentionally approximate.
 * Retelling naturally may change the exact number of words.
 */
export function lengthTargetFor(text) {
  const w = text.split(/\s+/).filter(Boolean).length;
  const target = Math.round(w * 0.9);

  return `LENGTH — IMPORTANT RETENTION REQUIREMENT
The source chunk contains approximately ${w} words.

Your retelling should be approximately ${target} words.

Do not intentionally shorten the chapter.

A much shorter output usually means that material was skipped or summarized.

You are NOT writing a summary.

Retell the complete chunk at full informational detail.

Natural sentence restructuring is allowed, so the word count does not need to match exactly.`;
}


/**
 * Keep speech as speech.
 */
export const DIALOGUE_RULE =
  `DIALOGUE — KEEP IT AS DIALOGUE

When a character speaks in the source, that character must SPEAK in the retelling too.

Do not convert dialogue into reported narration.

Preserve the meaning, intention, emotion and information of every spoken line.

Rewrite the wording naturally so it sounds like real Indian Hinglish.

Every important spoken line must remain represented as spoken dialogue.`;


/**
 * ---------------------------------------------------------------------------
 * HELPERS
 * ---------------------------------------------------------------------------
 */

export function getStyle(id) {
  return STYLES[id] || STYLES.novel;
}


export function listStyles() {
  return Object.values(STYLES);
}


/**
 * ---------------------------------------------------------------------------
 * BUILD RETELLING PROMPT
 * ---------------------------------------------------------------------------
 *
 * Kept deliberately small.
 *
 * Optional blocks are appended only when actually required.
 *
 * This prevents a simple one-shot chapter from receiving unnecessary prompt
 * overhead.
 *
 * @param {object} opts
 * @param {string}   opts.text
 * @param {string}   [opts.styleId]
 * @param {string[]} [opts.glossary]
 * @param {string}   [opts.previousTail]
 * @param {boolean}  [opts.isContinuation]
 * @param {string}   [opts.overrideSystem]
 * @param {string}   [opts.retryCorrection]
 */
export function buildRetellingPrompt({
  text,
  styleId = 'novel',
  glossary = [],
  previousTail = '',
  isContinuation = false,
  overrideSystem,
  retryCorrection = '',
}) {
  const style = getStyle(styleId);

  const parts = [
    overrideSystem || MASTER_SYSTEM_PROMPT,
  ];


  /**
   * Optional retry correction.
   *
   * Only add this when the previous output was actually measured as having
   * the relevant problem.
   */
  if (retryCorrection) {
    parts.push(retryCorrection);
  }


  /**
   * Style-specific voice.
   */
  if (style.instructions) {
    parts.push(style.instructions);
  }


  /**
   * Measured retention instructions.
   *
   * Disabled for original/custom modes because they do not perform AI
   * retelling.
   */
  if (style.instructions) {
    parts.push(lengthTargetFor(text));
    parts.push(DIALOGUE_RULE);
  }


  /**
   * Continuity block.
   *
   * Only used when a chapter is actually split across multiple chunks.
   *
   * We pass the tail of the PREVIOUS OUTPUT, not the source.
   *
   * This helps the model continue the same narration voice without repeating
   * the previous chunk.
   */
  if ((isContinuation || previousTail) && previousTail) {
    parts.push(
      'CONTINUATION — SAME CHAPTER\n' +
      'This is the next part of the SAME chapter. You are already mid-story.\n\n' +
      'Here is how your own retelling ended in the previous chunk:\n' +
      '"""\n' +
      `${previousTail}\n` +
      '"""\n\n' +
      'Continue directly from this point in the same voice, tense, style and emotional flow.\n' +
      'Do not repeat the previous text.\n' +
      'Do not restart the scene.\n' +
      'Do not re-introduce characters who are already present.\n' +
      'Do not summarize what happened before this point.'
    );
  }


  /**
   * Optional glossary.
   *
   * The glossary is deliberately OFF by default.
   *
   * Terms are preserved exactly as supplied.
   */
  if (glossary && glossary.length) {
    const terms = glossary
      .slice(0, 80)
      .map((g) => (typeof g === 'string' ? g : g?.term))
      .filter(Boolean);

    if (terms.length) {
      parts.push(
        'CONSISTENCY GLOSSARY\n' +
        'The following names and important terms must remain consistent whenever they appear.\n' +
        'Preserve their spelling exactly.\n' +
        'Do not translate, phoneticize or rename them.\n\n' +
        terms.join(', ')
      );
    }
  }


  /**
   * Source chunk.
   */
  parts.push(
    `CHAPTER TO RETELL:\n"""\n${text}\n"""`
  );


  return parts
    .filter(Boolean)
    .join('\n\n');
}

export const buildTranslationPrompt = buildRetellingPrompt;


/**
 * ---------------------------------------------------------------------------
 * OUTPUT CLEANING
 * ---------------------------------------------------------------------------
 *
 * We only remove harmless formatting/preambles.
 *
 * We DO NOT silently delete foreign-script characters from the story.
 *
 * If foreign characters appear, validation catches them and the caller can
 * retry. Silently deleting them can corrupt a sentence.
 */
export function cleanModelOutput(raw) {
  if (!raw) {
    return {
      text: '',
      stripped: false,
    };
  }

  let text = raw.trim();
  let stripped = false;


  /**
   * Remove a complete markdown code fence.
   */
  const fence = text.match(
    /^```(?:\w+)?\s*\n([\s\S]*?)\n```$/
  );

  if (fence) {
    text = fence[1].trim();
    stripped = true;
  }


  /**
   * Remove common model preambles.
   */
  const preambles = [
    /^here'?s?\s+(?:is\s+)?the\s+[^\n:]{0,60}:\s*/i,
    /^here\s+is\s+[^\n:]{0,60}:\s*/i,
    /^sure[,!]?\s+here[^\n]{0,60}:\s*/i,
    /^(?:translation|conversion|hinglish version|retelling|output)\s*:\s*/i,
    /^\*{0,2}(?:अनुवाद|रूपांतरण|कहानी|रीटेलिंग)\*{0,2}\s*:\s*/,
  ];

  for (const re of preambles) {
    if (re.test(text)) {
      text = text.replace(re, '').trim();
      stripped = true;
    }
  }


  /**
   * Remove a model-generated note after the story.
   */
  const trailing = text.match(
    /\n\s*(?:\*{0,2})(?:Note|नोट)(?:\*{0,2})\s*:[\s\S]*$/i
  );

  if (trailing) {
    text = text.slice(0, trailing.index).trim();
    stripped = true;
  }


  return {
    text,
    stripped,
  };
}


/**
 * ---------------------------------------------------------------------------
 * OUTPUT VALIDATION
 * ---------------------------------------------------------------------------
 *
 * Important change from v5:
 *
 * Latin English is VALID.
 *
 * Therefore we DO NOT measure whether the output contains enough Devanagari.
 *
 * We only check that:
 *
 *   - Hindi/Hinglish output contains some Devanagari Hindi
 *   - unwanted scripts are absent
 *   - output isn't suspiciously short
 *   - output isn't absurdly long
 *   - glossary terms haven't drifted
 */
export function validateOutput({
  source,
  output,
  styleId = 'novel',
  glossary = [],
} = {}) {

  const issues = [];


  /**
   * Empty output.
   */
  if (!output || !output.trim()) {
    return [
      {
        code: 'empty',
        severity: 'fatal',
        message: 'Model returned empty output',
      },
    ];
  }


  /**
   * Foreign scripts.
   *
   * Latin English is intentionally NOT included here.
   */
  if (
    /[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(output)
  ) {
    issues.push({
      code: 'foreign_script',
      severity: 'fatal',
      message:
        'Output contains unexpected foreign script characters (CJK/Cyrillic/Japanese/Korean).',
    });
  }


  /**
   * Length sanity check.
   *
   * Retelling is not 1:1, so the acceptable range is deliberately broad.
   */
  const srcLen = Math.max(
    1,
    (source || '').length
  );

  const ratio = output.length / srcLen;


  if (ratio < 0.35) {

    issues.push({
      code: 'too_short',
      severity: 'fatal',
      message:
        `Output is only ${Math.round(ratio * 100)}% of the source length — almost certainly truncated.`,
    });

  } else if (ratio < 0.5) {

    issues.push({
      code: 'short',
      severity: 'warn',
      message:
        `Output is ${Math.round(ratio * 100)}% of the source length — the retelling may have skipped or summarized content.`,
    });

  } else if (ratio > 3.0) {

    issues.push({
      code: 'too_long',
      severity: 'warn',
      message:
        `Output is ${Math.round(ratio * 100)}% of the source length — the model may have padded or added commentary.`,
    });
  }


  /**
   * Hindi/Hinglish validation.
   *
   * We only require that Hindi output actually contains Hindi/Devanagari.
   *
   * English words in Latin are completely valid.
   */
  const style = getStyle(styleId);

  if (style.outputScript === 'hinglish') {

    const hasDevanagari = /[\u0900-\u097F]/.test(output);

    if (!hasDevanagari) {
      issues.push({
        code: 'no_devanagari',
        severity: 'fatal',
        message:
          'Expected Hindi/Hinglish output, but no Devanagari Hindi text was detected.',
      });
    }
  }


  /**
   * Glossary consistency.
   *
   * Only checked when the user explicitly enabled a glossary.
   *
   * NOTE:
   * This check is intentionally conservative.
   *
   * A glossary term being present in the source does not always mean it must
   * appear in the output, because a natural retelling may legitimately omit
   * a repeated occurrence.
   */
  for (const g of glossary || []) {

    const term =
      typeof g === 'string'
        ? g
        : g?.term;

    if (!term) {
      continue;
    }

    if (
      source &&
      source.includes(term) &&
      !output.includes(term)
    ) {
      issues.push({
        code: 'glossary_drift',
        severity: 'warn',
        message:
          `Glossary term "${term}" appeared in the source but was not found in the output.`,
      });
    }
  }


  return issues;
}


/**
 * ---------------------------------------------------------------------------
 * OPTIONAL OUTPUT QUALITY HEURISTICS
 * ---------------------------------------------------------------------------
 *
 * These are intentionally NOT automatically fatal.
 *
 * They can be used for logging/analytics first.
 *
 * Do not add automatic retries until a metric has been shown to correlate
 * with genuinely bad output.
 */


/**
 * Rough estimate of how much of the output is Latin-script content.
 *
 * Useful for analytics only.
 */
export function getLatinRatio(text = '') {
  if (!text) return 0;

  const latin = (
    text.match(/[A-Za-z]/g) || []
  ).length;

  return latin / text.length;
}


/**
 * Rough estimate of Devanagari usage.
 *
 * Useful for analytics only.
 */
export function getDevanagariRatio(text = '') {
  if (!text) return 0;

  const devanagari = (
    text.match(/[\u0900-\u097F]/g) || []
  ).length;

  return devanagari / text.length;
}


/**
 * Simple script profile for logging/debugging.
 */
export function getScriptProfile(text = '') {
  return {
    characters: text.length,
    devanagariRatio: getDevanagariRatio(text),
    latinRatio: getLatinRatio(text),
    hasForeignScript:
      /[\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/.test(text),
  };
}

