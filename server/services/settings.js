/**
 * Settings service.
 *
 * The old build made the user paste their Groq API key into the Convert dialog
 * every single time, and stored it per-job in plain text. Now the key lives in
 * one place (app_settings), is set once in Settings, and is NEVER returned to
 * the client — only a masked preview and a boolean.
 */
import * as db from '../models/database.js';

export const DEFAULTS = {
  groqApiKey: '',
  groqModel: '',                 // '' = auto-pick the best available
  defaultLanguage: 'hi',
  defaultVoiceEn: 'en-US-AriaNeural',
  defaultVoiceHi: 'hi-IN-MadhurNeural',
  defaultStyle: 'novel',
  defaultScriptSource: 'ai',
  speakingRate: 1.0,
  concurrency: 1,
  /**
   * How many chapters inside ONE job may be worked on at the same time.
   *
   * Worth having because the two slow stages are both I/O, not CPU: the Groq
   * call and `edge-tts` are network round-trips that leave the process idle.
   * Measured locally, four chapter-sized TTS calls take ~11.9s in sequence and
   * ~6.6s in parallel for the same work.
   *
   * Kept modest: Groq is still paced by the shared token bucket, so raising
   * this does not buy more AI throughput, and too many concurrent edge-tts
   * connections invites throttling from Microsoft.
   */
  chapterConcurrency: 3,
  tokensPerMinute: 6000,
  requestsPerMinute: 30,
  allowGoogleFallback: false,
  useGlossary: true,
  mergeOutput: false,
  promptOverride: '',            // '' = use the built-in master prompt
  theme: 'system',
  logLevel: 'info',
};

const NUMERIC = new Set(['speakingRate', 'concurrency', 'chapterConcurrency', 'tokensPerMinute', 'requestsPerMinute']);
const BOOLEAN = new Set(['allowGoogleFallback', 'useGlossary', 'mergeOutput']);
const SECRET = new Set(['groqApiKey']);

function coerce(key, raw) {
  if (raw === null || raw === undefined) return DEFAULTS[key];
  if (BOOLEAN.has(key)) return raw === 'true' || raw === '1' || raw === true;
  if (NUMERIC.has(key)) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : DEFAULTS[key];
  }
  return raw;
}

/** Full settings including secrets — server-side use only. */
export function getSettings() {
  const stored = db.getAllSettings();
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    out[key] = coerce(key, stored[key]);
  }
  return out;
}

/** Safe for the wire: secrets replaced with a masked preview + presence flag. */
export function getPublicSettings() {
  const all = getSettings();
  const out = { ...all };
  for (const key of SECRET) {
    const value = all[key] || '';
    out[key] = '';
    out[`${key}Set`] = value.length > 0;
    out[`${key}Preview`] = value ? `${value.slice(0, 4)}…${value.slice(-4)}` : '';
  }
  return out;
}

/**
 * Patch settings. Unknown keys are ignored rather than silently stored, and a
 * secret is only overwritten when a non-empty value is supplied — so saving the
 * Settings form with a blank key field does not wipe the key.
 */
export function updateSettings(patch = {}) {
  const applied = [];
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULTS)) continue;
    if (SECRET.has(key) && (value === '' || value === null || value === undefined)) continue;
    db.setSetting(key, BOOLEAN.has(key) ? String(!!value) : value);
    applied.push(key);
  }
  return { applied, settings: getPublicSettings() };
}

export function clearSecret(key) {
  if (SECRET.has(key)) db.setSetting(key, '');
  return getPublicSettings();
}

/** The key to use for a request: explicit override wins, else the saved one. */
export function resolveApiKey(explicit) {
  const trimmed = (explicit || '').trim();
  if (trimmed) return trimmed;
  return getSettings().groqApiKey || '';
}
