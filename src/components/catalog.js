/**
 * The language / voice / style catalog, and how audio versions describe
 * themselves.
 *
 * These belong together: every badge is a rendering of catalog data. Keeping
 * them in one module is what stops the "three drifting copies of badge logic"
 * problem that produced inconsistent labels across the chapter list, the
 * version dropdown and the versions modal.
 */
import { api } from '../services/api.js';
import { formatDateTime } from '../utils/formatters.js';

/**
 * Languages, voices and styles are served by the backend
 * (`/api/system/languages`) rather than duplicated here, so adding a language
 * server-side makes it appear in the UI automatically and the voice list can
 * never drift out of sync with what the backend will actually accept.
 */
export let CATALOG = { languages: [], styles: [] };

export async function loadCatalog() {
  const data = await api.getLanguages();
  CATALOG = { languages: data.languages || [], styles: data.styles || [] };
  return CATALOG;
}

export function languageDef(code) {
  return CATALOG.languages.find((l) => l.code === code) || null;
}

/** Display name for a language code, falling back to the code itself. */
export function languageName(code) {
  const l = languageDef(code);
  return l?.label || l?.name || (code === 'hi' ? 'Hinglish' : code === 'en' ? 'English' : code);
}

/**
 * Human label for a style id, taken from the backend catalog.
 * `legacy`/`litrpg` cover rows created before the styles were reworked.
 */
export function styleName(id) {
  if (!id) return 'Default';
  if (id === 'custom') return 'Custom Script';
  if (id === 'legacy' || id === 'litrpg') return 'Legacy style';
  return CATALOG.styles.find((s) => s.id === id)?.name || id;
}

/** Friendly voice name: "hi-IN-SwaraNeural" -> "Swara". */
export function voiceName(voiceId) {
  if (!voiceId) return 'Voice';
  return voiceId.split('-').slice(-1)[0].replace('Neural', '');
}

/**
 * How an audio version was produced, read straight from the backend join.
 * This used to be inferred from the translation style, which quietly lied
 * whenever a custom script was used.
 */
export const SCRIPT_SOURCE_META = {
  custom: { icon: '', label: 'My script', title: 'Your pasted script, spoken word-for-word (no AI)' },
  ai: { icon: '', label: 'AI retelling', title: 'Rewritten by Groq AI in the style shown' },
  antigravity: { icon: '', label: 'Antigravity CLI', title: 'Rewritten by Antigravity local CLI' },
  original: { icon: 'Text', label: 'Original text', title: 'The untouched book text — no translation' },
};

export function sourceBadge(audio) {
  const meta = SCRIPT_SOURCE_META[audio?.scriptSource];
  if (!meta) return '';
  return `<span class="chapter-badge badge-src-${audio.scriptSource}" title="${meta.title}">${meta.icon ? `${meta.icon} ` : ''}${meta.label}</span>`;
}

/** Short one-line description used in version dropdowns and lists. */
export function versionLabel(a) {
  const src = SCRIPT_SOURCE_META[a.scriptSource];
  const parts = [languageName(a.language), voiceName(a.voiceId)];
  // Style is only meaningful for AI runs; showing it elsewhere would imply a
  // setting that had no effect on the result.
  if ((a.scriptSource === 'ai' || a.scriptSource === 'antigravity') && a.language !== 'en') parts.push(styleName(a.translationStyle));
  if (src) parts.push(`${src.icon} ${src.label}`);
  return parts.join(' · ');
}

/** Full badge row describing a single audio version. */
export function audioBadges(a) {
  const isHi = a.language !== 'en';
  const langBadge = isHi
    ? `<span class="chapter-badge badge-hi">${languageName(a.language)}</span>`
    : `<span class="chapter-badge badge-en">English</span>`;
  const voiceBadge = `<span class="chapter-badge">${voiceName(a.voiceId)}</span>`;
  const styleBadge = ((a.scriptSource === 'ai' || a.scriptSource === 'antigravity') && isHi)
    ? `<span class="chapter-badge" title="Retelling style">${styleName(a.translationStyle)}</span>`
    : '';
  const time = formatDateTime(a.createdAt);
  const timeBadge = time ? `<span class="chapter-badge" title="Converted at">${time}</span>` : '';
  return `${langBadge} ${sourceBadge(a)} ${voiceBadge} ${styleBadge} ${timeBadge}`;
}

/**
 * The pipeline's stages, named for humans.
 *
 * A failure is only actionable if you know where it happened: "the AI refused"
 * and "the voice could not be synthesised" look identical as a red row, but
 * the first is fixed by changing the style or pasting your own script, and the
 * second by changing the voice. `recovery` is what the row offers for each.
 */
export const STAGE_META = {
  prepare: { label: 'Preparing', failed: 'Could not prepare the chapter' },
  script: { label: 'Translating', failed: 'Translation failed' },
  synth: { label: 'Generating audio', failed: 'Audio generation failed' },
  stitch: { label: 'Finalising audio', failed: 'Audio generation failed' },
  index: { label: 'Saving', failed: 'Saving failed' },
  merge: { label: 'Merging', failed: 'Merge failed' },
  parse: { label: 'Reading the book', failed: 'Could not read the book' },
};

/** "Translation failed" / "Audio generation failed" / plain "Failed". */
export function stageLabel(stage) {
  return STAGE_META[stage]?.failed || 'Failed';
}

/**
 * Which recovery actions make sense for a failure at this stage.
 *
 * Deliberately data rather than branching in the renderer: the set of useful
 * responses is a property of the stage, not of where the row is drawn.
 */
export function recoveryFor(stage) {
  if (stage === 'script') {
    return [
      { act: 'retry-chapter', label: 'Retry translation', primary: true },
      { act: 'convert-options', label: 'Change settings' },
      { act: 'use-my-script', label: 'Use my script' },
    ];
  }
  if (stage === 'synth' || stage === 'stitch') {
    return [
      { act: 'retry-chapter', label: 'Retry audio', primary: true },
      { act: 'convert-options', label: 'Change voice' },
    ];
  }
  return [{ act: 'retry-chapter', label: 'Retry', primary: true }];
}
