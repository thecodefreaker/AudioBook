/**
 * Translator — the Hinglish retelling engine.
 *
 * Rewritten to fix the real causes of the failures you hit:
 *
 *  • Chunks are sized in TOKENS, not characters (the 413 "Requested 9459" bug).
 *  • `max_tokens` is DYNAMIC — Hinglish output is longer than English input, and
 *    the old fixed 2000 silently truncated chapters mid-sentence.
 *  • Rate limits are handled by ROTATING across eligible models, because the
 *    free-tier buckets are per-MODEL (measured, not assumed) — so a throttled
 *    model is a reason to move, not a reason to sleep. We only wait when every
 *    eligible lane is throttled at once.
 *  • The model list is fetched LIVE from Groq, so a decommissioned model
 *    (mixtral-8x7b-32768) can never wedge the pipeline again.
 *  • Google Translate is OPT-IN, and when used the result is tagged
 *    `google_fallback` so the UI can never present literal Hindi as your style.
 *  • Chunks carry CONTINUITY (previous tail) and a GLOSSARY so names and tone
 *    stay consistent across a 5000-chapter novel.
 */
import Groq from 'groq-sdk';
import {
  limiterFor, classifyProviderError, sleep, backoffMs, formatMs,
  getQuotaSnapshot as limiterQuotaSnapshot, configureLimiter as limiterConfigure,
  limiterEvents, selectModel, costOn, eligibleModels, reasoningParamsFor,
  KNOWN_MODEL_LIMITS,
} from './rateLimiter.js';
import {
  buildTranslationPrompt, buildRetellingPrompt, cleanModelOutput, validateOutput,
  getStyle, PROMPT_VERSION,
} from './prompts.js';
import {
  registerKeys, loadKeysFromEnv, quotaLanes, apiKeyFor, reportResult,
  snapshot as keyPoolSnapshot, keyIdFor,
} from './keyPool.js';
import { estimateTokens, splitSentences } from './scriptUtils.js';
import { execFile } from 'child_process';
import util from 'util';

const execPromise = util.promisify(execFile);

/**
 * ONE constant governs every token calculation.
 *
 * The old code used three different, mutually contradictory ratios: it sized
 * chunks assuming 1.8x output, reserved budget assuming 1.3x, and permitted the
 * model 2.2x via `max_tokens`. So the worst case (model emits its full ceiling)
 * was never reserved for, and TPM could be breached by a request we had already
 * "approved". Everything below now derives from this single number.
 *
 * MEASURED against live Groq on 2026-08-11 across every eligible model
 * (scratch/probe-devanagari-eligibility.mjs): completion/prompt ratios came in
 * at 0.51x–1.45x, with the worst case being `openai/gpt-oss-120b` at 1.45x.
 * The previous 3.0 was a guess made before those measurements existed, and it
 * cost real throughput: chunks were sized at `usable / 4` instead of
 * `usable / 3`, so ~25% of every chunk budget was reserved for output that
 * never arrived. 2.0 clears the measured worst case by ~38% and still leaves
 * `LENGTH_RETRY_BOOST` to recover the rare overrun.
 */
/**
 * Fallback output ratio for a model we have never measured.
 *
 * MEASURED against live Groq (scratch/probe-devanagari-eligibility.mjs and
 * PROBE-1 on 2026-08-11): completion/prompt ratios are 0.35x-1.45x depending
 * on the model, and PROBE-1 measured `llama-3.3-70b-versatile` at 1.04x on a
 * real Alice chapter.
 *
 * This constant used to be a single global 2.0 applied to EVERY model, which
 * was the primary cause of self-throttling: it reserved roughly twice the
 * output that ever arrived, so one chunk claimed 80% of a minute's budget and
 * only ONE chunk was admitted per minute where three fit. `KNOWN_MODEL_LIMITS`
 * has carried a `measuredOutputRatio` per model the whole time and nothing
 * consulted it. Now `outputRatioFor()` does, and this value is only the
 * fallback for an unknown model.
 *
 * RAISED 1.5 → 2.0 on 2026-08-12. Every number above was measured under the
 * OLD prompt, which allowed the model to summarise. The current prompt states
 * an explicit length target, and PROBE-16 measured the same model at mean
 * 1.59x / max 1.89x under it. An unknown model is now assumed to behave like
 * the models we have re-measured, not like the summarising ones.
 */
export const OUTPUT_RATIO = 2.0;

/**
 * Safety margin over the MEASURED ratio.
 *
 * The measured value is a mean, so some requests legitimately run longer and
 * need headroom. But the margin is NOT free: it multiplies into the reservation
 * and directly reduces how many requests fit in a minute. 1.35 was measured
 * (PROBE-2) to leave G1 at 1.56x — still failing.
 *
 * 1.15 is the right trade because an under-estimate is CHEAP and self-healing
 * here: the reservation is refunded to exact usage the moment the response
 * lands, and a genuine overrun surfaces as `finish_reason=length` which
 * `LENGTH_RETRY_BOOST` retries with more room. An over-estimate, by contrast,
 * is paid on EVERY request forever. Optimise for the common case.
 */
export const OUTPUT_RATIO_MARGIN = 1.15;

/**
 * Floor under any measured ratio.
 *
 * RAISED 0.6 → 1.2 on 2026-08-12. Most entries in `KNOWN_MODEL_LIMITS` were
 * measured under the old prompt, which let the model summarise, so they read
 * below 1.0. Under the current length-target prompt a faithful retelling is
 * roughly as long as its source or longer — PROBE-16 measured 1.59x mean on
 * the one model re-probed. Trusting a stale sub-1.0 ratio guarantees
 * `finish_reason=length` and a repair retry on every chunk.
 *
 * 1.2 is a floor, not an estimate: it only binds for models we have not
 * re-measured, and it costs nothing when wrong because the reservation is
 * refunded to actual usage as soon as the response lands.
 */
export const MIN_OUTPUT_RATIO = 1.2;

/**
 * The output ratio to assume for a specific model.
 *
 * Reserving a per-model measured ratio instead of one global worst case is
 * what takes reservation accuracy from 1.55x down toward 1.1x — i.e. it is the
 * difference between using 16% and ~90% of the quota we already pay for.
 */
export function outputRatioFor(model) {
  const measured = KNOWN_MODEL_LIMITS[model]?.measuredOutputRatio;
  if (!measured) return OUTPUT_RATIO;
  return Math.max(MIN_OUTPUT_RATIO, measured * OUTPUT_RATIO_MARGIN);
}


/**
 * Multiplier applied to `max_tokens` after the model runs out of room.
 *
 * Splitting alone CANNOT fix `finish_reason=length`: halving the input also
 * halves a proportional ceiling, so the retry truncates in exactly the same
 * way. Verified against live Groq, where a chunk split twice and still hit the
 * limit. The ceiling has to grow before the text shrinks.
 */
const LENGTH_RETRY_BOOST = 1.6;

/** Fraction of TPM a single request is allowed to occupy. Leaves headroom. */
export const BUDGET_SAFETY = 0.85;

let defaultTranslate;
async function getGoogleTranslator() {
  if (!defaultTranslate) {
    const module = await import('google-translate-api-x');
    defaultTranslate = module.default;
  }
  return defaultTranslate;
}

// ---------------------------------------------------------------------------
// Live model catalogue
// ---------------------------------------------------------------------------

let modelCache = { models: [], bestModel: null, bestModelReason: '', availableCount: 0, fetchedAt: 0 };
const MODEL_CACHE_MS = 5 * 60 * 1000;

/**
 * Known-good preference order; filtered against what the account can actually use.
 */
export const PREFERRED_MODELS = [
  'openai/gpt-oss-120b',
  'qwen/qwen3.6-27b',
  'qwen/qwen3.8-27b',
  'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant',
];

/**
 * Metadata for known Groq models to explain capabilities, recommendations,
 * and reasons why specific models are or are not available.
 */
export const KNOWN_MODELS_METADATA = {
  'openai/gpt-oss-120b': {
    name: 'OpenAI GPT-OSS 120B',
    provider: 'OpenAI',
    contextWindow: 131072,
    tier: 'recommended',
    badge: 'Best Quality (Recommended)',
    bestFor: 'Top quality Hindi/Hinglish storytelling, 131k context window, nuanced vocabulary and reasoning.',
    devanagariOk: true,
  },
  'qwen/qwen3.6-27b': {
    name: 'Qwen 3.6 27B',
    provider: 'Alibaba Cloud',
    contextWindow: 131072,
    tier: 'recommended',
    badge: 'Fast & Accurate',
    bestFor: 'High throughput, low latency, clean Devanagari output with minimal token overhead.',
    devanagariOk: true,
  },
  'qwen/qwen3.8-27b': {
    name: 'Qwen 3.8 27B',
    provider: 'Alibaba Cloud',
    contextWindow: 131042,
    tier: 'recommended',
    badge: 'High Speed',
    bestFor: 'Next-generation architecture with 131k context window and great multilingual retention.',
    devanagariOk: true,
  },
  'openai/gpt-oss-20b': {
    name: 'OpenAI GPT-OSS 20B',
    provider: 'OpenAI',
    contextWindow: 131072,
    tier: 'alternative',
    badge: 'Lightweight',
    bestFor: 'Fast and lightweight with 131k context window for smaller token budgets.',
    devanagariOk: true,
  },
  'llama-3.3-70b-versatile': {
    name: 'Meta Llama 3.3 70B Versatile',
    provider: 'Meta',
    contextWindow: 131072,
    tier: 'alternative',
    badge: '70B Versatile',
    bestFor: 'Large parameter model with high capacity (when enabled on your Groq tier).',
    devanagariOk: true,
    unavailableReason: 'Not enabled or accessible on your current Groq API tier/organization.',
  },
  'llama-3.1-8b-instant': {
    name: 'Meta Llama 3.1 8B Instant',
    provider: 'Meta',
    contextWindow: 131072,
    tier: 'alternative',
    badge: 'Ultra Fast',
    bestFor: 'Ultra low latency, but tighter rate limits (6k TPM) and more verbose output.',
    devanagariOk: true,
    unavailableReason: 'Not enabled or accessible on your current Groq API tier/organization.',
  },
  'groq/compound': {
    name: 'Groq Compound',
    provider: 'Groq',
    contextWindow: 131072,
    tier: 'ineligible',
    badge: 'Agentic Tool System',
    bestFor: 'Agentic tool compound (5.5x prompt token overhead).',
    devanagariOk: false,
    ineligibleReason: 'Agentic compound tool with 5.5x prompt overhead — unsuitable for chapter storytelling.',
  },
  'groq/compound-mini': {
    name: 'Groq Compound Mini',
    provider: 'Groq',
    contextWindow: 131072,
    tier: 'ineligible',
    badge: 'Agentic Tool System',
    bestFor: 'Agentic tool compound with high token overhead.',
    devanagariOk: false,
    ineligibleReason: 'Agentic compound tool with high prompt overhead.',
  },
  'openai/gpt-oss-safeguard-20b': {
    name: 'OpenAI GPT-OSS Safeguard 20B',
    provider: 'OpenAI',
    contextWindow: 131072,
    tier: 'ineligible',
    badge: 'Safety Moderation',
    bestFor: 'Safety moderation only.',
    devanagariOk: false,
    ineligibleReason: 'Content-moderation model only — cannot generate story retellings.',
  },
  'meta-llama/llama-prompt-guard-2-22m': {
    name: 'Llama Prompt Guard 22M',
    provider: 'Meta',
    contextWindow: 8192,
    tier: 'ineligible',
    badge: 'Security Filter',
    bestFor: 'Security classification only.',
    devanagariOk: false,
    ineligibleReason: 'Prompt security filter — cannot generate text.',
  },
  'meta-llama/llama-prompt-guard-2-86m': {
    name: 'Llama Prompt Guard 86M',
    provider: 'Meta',
    contextWindow: 8192,
    tier: 'ineligible',
    badge: 'Security Filter',
    bestFor: 'Security classification only.',
    devanagariOk: false,
    ineligibleReason: 'Prompt security filter — cannot generate text.',
  },
  'allam-2-7b': {
    name: 'ALLaM 2 7B',
    provider: 'SDAIA',
    contextWindow: 4096,
    tier: 'ineligible',
    badge: 'Arabic Only',
    bestFor: 'Arabic language only.',
    devanagariOk: false,
    ineligibleReason: 'Arabic-specialized model — does not support Hindi/Devanagari output.',
  },
};

export async function fetchAvailableModels(apiKey, { force = false } = {}) {
  if (!apiKey) return { models: [], bestModel: null, bestModelReason: '', error: 'No API key provided' };

  if (!force && modelCache.models?.length && Date.now() - modelCache.fetchedAt < MODEL_CACHE_MS) {
    return { ...modelCache, cached: true };
  }

  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const body = await res.text();
      return { models: [], bestModel: null, bestModelReason: '', error: `HTTP ${res.status}: ${body.slice(0, 300)}` };
    }
    const json = await res.json();
    const liveData = json.data || [];
    const liveMap = new Map(liveData.map((m) => [m.id, m]));

    const resultModels = [];

    // 1. Classify all models returned by the live Groq API
    for (const m of liveData) {
      if (m.active === false) continue;
      const meta = KNOWN_MODELS_METADATA[m.id];
      const isToolOrGuardOrAudio =
        /whisper|guard|tts|distil|audio/i.test(m.id) ||
        m.id.includes('safeguard') ||
        m.id.startsWith('canopylabs/') ||
        m.id.startsWith('allam-');

      let status = 'available';
      let statusReason = meta?.bestFor || 'Available chat model on Groq';
      let devanagariOk = true;
      let badge = meta?.badge || 'Available';
      let tier = meta?.tier || 'available';

      if (isToolOrGuardOrAudio || meta?.tier === 'ineligible') {
        status = 'ineligible';
        devanagariOk = false;
        tier = 'ineligible';
        badge = meta?.badge || 'Ineligible';
        statusReason = meta?.ineligibleReason ||
          (/whisper/i.test(m.id) ? 'Audio transcription model only' :
           /tts|canopylabs/i.test(m.id) ? 'Audio TTS model only' :
           /guard/i.test(m.id) ? 'Moderation/prompt guard model only' :
           'Not suitable for Hindi/Devanagari story retelling');
      } else if (PREFERRED_MODELS.includes(m.id)) {
        status = 'recommended';
        tier = 'recommended';
      }

      resultModels.push({
        id: m.id,
        name: meta?.name || m.id,
        provider: meta?.provider || m.owned_by || 'Groq',
        contextWindow: m.context_window || meta?.contextWindow || 8192,
        available: true,
        status,
        statusReason,
        badge,
        tier,
        devanagariOk,
        preferred: PREFERRED_MODELS.includes(m.id),
      });
    }

    // 2. Add known models that are NOT available on this specific account/tier
    for (const [id, meta] of Object.entries(KNOWN_MODELS_METADATA)) {
      if (liveMap.has(id)) continue;
      resultModels.push({
        id,
        name: meta.name || id,
        provider: meta.provider || 'Groq',
        contextWindow: meta.contextWindow || 8192,
        available: false,
        status: 'unavailable',
        statusReason: meta.unavailableReason || 'Not enabled or accessible on your current Groq API tier or organization.',
        badge: 'Unavailable on Key',
        tier: meta.tier,
        devanagariOk: meta.devanagariOk,
        preferred: PREFERRED_MODELS.includes(id),
      });
    }

    // 3. Determine the best available model
    const availableChatModels = resultModels.filter(
      (m) => m.available && m.devanagariOk && m.status !== 'ineligible'
    );

    let bestModelId = availableChatModels[0]?.id || PREFERRED_MODELS[0];
    for (const pref of PREFERRED_MODELS) {
      const match = availableChatModels.find((m) => m.id === pref);
      if (match) {
        bestModelId = match.id;
        break;
      }
    }

    const bestModelObj = resultModels.find((m) => m.id === bestModelId);
    if (bestModelObj) {
      bestModelObj.isBest = true;
      if (bestModelObj.available) {
        bestModelObj.badge = 'Best Quality (Recommended)';
      }
    }

    const bestModelReason = bestModelObj?.bestFor ||
      `Top available retelling model for your account with full Devanagari translation support and ${Math.round((bestModelObj?.contextWindow || 131072) / 1000)}k context window.`;

    // 4. Sort models:
    //    1) Available recommended models (in PREFERRED_MODELS order)
    //    2) Other available chat models (by context window desc)
    //    3) Unavailable known models
    //    4) Ineligible models (tools, whisper, moderation)
    resultModels.sort((a, b) => {
      const getRank = (m) => {
        if (m.available && m.status === 'recommended') return 1;
        if (m.available && m.status === 'available') return 2;
        if (!m.available) return 3;
        return 4;
      };
      const rankA = getRank(a);
      const rankB = getRank(b);
      if (rankA !== rankB) return rankA - rankB;

      if (rankA === 1) {
        const ai = PREFERRED_MODELS.indexOf(a.id);
        const bi = PREFERRED_MODELS.indexOf(b.id);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      }
      return b.contextWindow - a.contextWindow;
    });

    modelCache = {
      models: resultModels,
      bestModel: bestModelId,
      bestModelReason,
      availableCount: availableChatModels.length,
      fetchedAt: Date.now(),
    };

    return {
      models: resultModels,
      bestModel: bestModelId,
      bestModelReason,
      availableCount: availableChatModels.length,
    };
  } catch (err) {
    return { models: [], bestModel: null, bestModelReason: '', error: err.message };
  }
}

/** Verify a key and report the models it can reach — powers the "Test key" button. */
export async function testApiKey(apiKey) {
  if (!apiKey || !apiKey.trim()) {
    return { valid: false, error: 'No API key provided' };
  }
  const { models, error, bestModel, bestModelReason } = await fetchAvailableModels(apiKey, { force: true });
  if (error) return { valid: false, error };
  const viable = models.filter((m) => m.available && m.status !== 'ineligible');
  if (!viable.length) return { valid: false, error: 'Key works but no usable chat models were returned' };
  return { valid: true, models, recommended: bestModel, reason: bestModelReason };
}

/**
 * Decide which model to START on.
 *
 * Checks live availability. If the user pinned an unavailable or ineligible model,
 * it safely falls back to the best available model with a clear explanatory note.
 *
 * @returns {Promise<{model:string, note:string|null, fallback:boolean, reason?:string}>}
 */
export async function resolveModel(apiKey, requested, { exclude = [] } = {}) {
  const catalog = await fetchAvailableModels(apiKey);
  const models = catalog.models || [];
  const viable = models.filter(
    (m) => m.available && m.devanagariOk && m.status !== 'ineligible' && !exclude.includes(m.id)
  );

  let bestCandidate = null;
  for (const pref of PREFERRED_MODELS) {
    const match = viable.find((m) => m.id === pref);
    if (match) {
      bestCandidate = match;
      break;
    }
  }
  if (!bestCandidate && viable.length > 0) {
    bestCandidate = viable[0];
  }

  const fallbackId = bestCandidate?.id || catalog.bestModel || PREFERRED_MODELS[0];
  const fallbackObj = models.find((m) => m.id === fallbackId);
  const fallbackName = fallbackObj?.name || fallbackId;

  if (!models.length) {
    return { model: requested || fallbackId, note: null, fallback: false, status: 'no_models' };
  }

  if (requested && requested.trim()) {
    const req = requested.trim();
    const target = models.find((m) => m.id === req);

    if (!target) {
      return {
        model: fallbackId,
        fallback: true,
        originalRequested: req,
        note: `Pinned model "${req}" is not recognized on Groq — automatically using "${fallbackName}" (${catalog.bestModelReason || 'best available'}).`,
        reason: 'not_found',
      };
    }

    if (!target.available) {
      return {
        model: fallbackId,
        fallback: true,
        originalRequested: req,
        note: `Selected model "${target.name || req}" is unavailable on this key (${target.statusReason}) — falling back to "${fallbackName}".`,
        reason: 'unavailable',
      };
    }

    if (target.status === 'ineligible' || target.devanagariOk === false) {
      return {
        model: fallbackId,
        fallback: true,
        originalRequested: req,
        note: `Selected model "${target.name || req}" is not eligible for retelling (${target.statusReason}) — starting on "${fallbackName}".`,
        reason: 'ineligible',
      };
    }

    if (exclude.includes(req)) {
      return {
        model: fallbackId,
        fallback: true,
        originalRequested: req,
        note: `Model "${target.name || req}" was marked unavailable or rate-limited for this chapter — dynamically routing to "${fallbackName}".`,
        reason: 'excluded',
      };
    }

    return { model: target.id, note: null, fallback: false, status: 'ok' };
  }

  // Auto-pick best available model
  return {
    model: fallbackId,
    fallback: false,
    note: `Auto-selected "${fallbackName}" (${catalog.bestModelReason || 'best available model'}).`,
    status: 'auto',
  };
}

// ---------------------------------------------------------------------------
// Token-aware chunking
// ---------------------------------------------------------------------------

/**
 * Split text into chunks that fit a token budget, breaking at paragraph then
 * sentence boundaries so we never cut mid-sentence.
 */
export function chunkByTokens(text, maxInputTokens = 900) {
  if (!text || !text.trim()) return [];

  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
  const chunks = [];
  let current = '';
  let currentTokens = 0;

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current.trim());
    current = '';
    currentTokens = 0;
  };

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para);

    // A single paragraph too big for one chunk → split it by sentences.
    if (paraTokens > maxInputTokens) {
      pushCurrent();
      const sentences = splitSentences(para).map((s) => s.text);
      let buf = '';
      let bufTokens = 0;
      for (const sentence of sentences) {
        const st = estimateTokens(sentence);
        if (bufTokens + st > maxInputTokens && buf) {
          chunks.push(buf.trim());
          buf = sentence;
          bufTokens = st;
        } else {
          buf += (buf ? ' ' : '') + sentence;
          bufTokens += st;
        }
      }
      if (buf.trim()) { current = buf; currentTokens = bufTokens; }
      continue;
    }

    if (currentTokens + paraTokens > maxInputTokens && current) {
      pushCurrent();
    }
    current += (current ? '\n\n' : '') + para;
    currentTokens += paraTokens;
  }

  pushCurrent();
  return chunks;
}

/**
 * Measure the REAL prompt overhead for this job's configuration.
 *
 * The old code subtracted a flat 700 tokens. Actual overhead is the system
 * instructions plus one line per glossary term plus the 200-char continuity
 * tail — a 60-term glossary sails past 700 and the resulting chunks were sized
 * too large, which is precisely what produced 413s.
 */
export function measurePromptOverhead({ styleId, glossary = [], previousTail = '' } = {}) {
  try {
    const scaffold = buildTranslationPrompt({
      text: '', styleId, glossary, previousTail: previousTail || 'x'.repeat(200),
    });
    return estimateTokens(scaffold);
  } catch {
    return 700; // never let instrumentation break the pipeline
  }
}

/**
 * The TPM window to size chunks against, chosen to maximise TOTAL throughput.
 *
 * There is a genuine tension here and it is not obvious which way it goes, so
 * it was measured rather than argued (2026-08-11):
 *
 *   sized for   budget   viable lanes   lanes x budget
 *   12 000 TPM   4451t    8 (2 models)   35 608 tok/min
 *    8 000 TPM   2826t   20 (5 models)   56 520 tok/min   <-- best
 *    6 000 TPM   2014t   24 (6 models)   48 336 tok/min
 *
 * Big chunks fit FEWER lanes. Sizing for the widest lane (12 000) produces
 * chunks only `llama-3.3-70b` and `compound` can accept, stranding 2/3 of the
 * key-model buckets — it looks fastest per request and is the SLOWEST overall.
 * Sizing for the narrowest (6 000, the old behaviour) reaches every lane but
 * makes chunks so small that request overhead dominates.
 *
 * 8 000 is the measured optimum: it keeps 5 of 6 models reachable — including
 * both 8 000-TPM gpt-oss lanes and qwen — while keeping chunks large enough
 * that a typical chapter is 1-2 requests instead of 4.
 *
 * Only `llama-3.1-8b-instant` (6 000 TPM) is excluded, and it is the least
 * valuable lane: the most verbose model measured (1.76x output ratio) and the
 * one whose quota we least want to spend on long chapters.
 */
export const CHUNK_SIZING_TPM = 8000;

/**
 * ---------------------------------------------------------------------------
 * THE CHUNK SIZE — set by RETELLING QUALITY, not by the rate limit.
 * ---------------------------------------------------------------------------
 * This is the single most important number in the engine, and it used to be
 * derived entirely from TPM arithmetic (see `CHUNK_SIZING_TPM` above), i.e.
 * "how much can we cram into one request". That optimised the wrong thing.
 *
 * PROBE-13 fed one chapter to the model at increasing sizes and measured what
 * came back. Output length PLATEAUS at ~900 words no matter how much input is
 * supplied, so a bigger chunk does not produce a bigger retelling — it produces
 * the SAME retelling covering more ground, i.e. more summarising:
 *
 *     input     retention   dialogue kept
 *      117w        77%          50%
 *      459w        68%          50%
 *     1364w        68%          15%
 *     2186w        40%          13%
 *
 * PROBE-14 then retold a WHOLE chapter at each size, with chunks running
 * concurrently across the key pool, measuring quality AND wall clock together:
 *
 *     target   chunks   wall(parallel)   retention   dialogue   tokens
 *      2200w      1          8.0s           47%         18%      5894
 *      1200w      2          6.7s           68%         51%      7744
 *       700w      4          8.6s           75%         67%      8074
 *       450w      6          4.0s           90%         82%     11877   <-- best
 *       300w     10          2.9s           79%         74%     13126
 *
 * 450 words is simultaneously the BEST QUALITY and (near) the FASTEST. The
 * "quality vs speed" tradeoff does not exist here, because chunks run in
 * parallel across independent key lanes: wall clock is set by the slowest
 * chunk, and small chunks are individually fast. Going below 450 starts to
 * lose quality again (300w drops to 79%) as chunks get too small to hold a
 * scene together.
 *
 * The real cost is TOKENS (+102% vs one-shot) — i.e. daily quota, not time.
 * That is a deliberate, accepted trade: the retelling is the product, and a
 * key pool can be grown to supply quota, whereas a bad retelling cannot be
 * repaired downstream.
 */
export const TARGET_CHUNK_WORDS = 450;

/**
 * Split for QUALITY: ~`TARGET_CHUNK_WORDS` of source per chunk, never breaking
 * a paragraph.
 *
 * Paragraph integrity is not cosmetic — a chunk that begins mid-scene has no
 * context to hold on to and is its own source of loss, which is why the target
 * is a soft one: a paragraph is never split just to hit the number exactly.
 *
 * `chunkByTokens` is retained below and still used as the SAFETY net that keeps
 * any single request inside the model's per-minute window (PROBE-11 proved a
 * request is validated against TPM, not the context window).
 */
export function chunkForQuality(text, targetWords = TARGET_CHUNK_WORDS) {
  if (!text || !text.trim()) return [];
  const wordsIn = (s) => s.split(/\s+/).filter(Boolean).length;

  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim());
  const chunks = [];
  let current = [];
  let count = 0;

  for (const para of paragraphs) {
    const pw = wordsIn(para);

    // A single paragraph larger than the whole target: emit what we have, then
    // let the sentence-level splitter in `chunkByTokens` deal with the monster
    // rather than shipping a chunk many times the intended size.
    if (pw > targetWords * 2) {
      if (current.length) { chunks.push(current.join('\n\n')); current = []; count = 0; }
      for (const piece of chunkByTokens(para, Math.round(targetWords * 1.4))) chunks.push(piece);
      continue;
    }

    if (count > 0 && count + pw > targetWords) {
      chunks.push(current.join('\n\n'));
      current = [];
      count = 0;
    }
    current.push(para);
    count += pw;
  }
  if (current.length) chunks.push(current.join('\n\n'));
  return chunks;
}

/**
 * Compute a safe input-token budget.
 *
 * budget + (budget * ratio) + overhead <= tpmLimit * BUDGET_SAFETY
 *
 * `tpmLimit` should normally be `CHUNK_SIZING_TPM` — see the measurement above
 * for why that beats both the widest and the narrowest lane.
 */
export function computeChunkBudget({ tpmLimit = CHUNK_SIZING_TPM, promptOverheadTokens = 700, model = null } = {}) {
  const ratio = model ? outputRatioFor(model) : OUTPUT_RATIO;
  const usable = tpmLimit * BUDGET_SAFETY - promptOverheadTokens;
  const budget = Math.floor(usable / (1 + ratio));
  return Math.max(150, Math.min(budget, 8000));
}

/**
 * The narrowest TPM window among lanes the router may choose.
 *
 * RETAINED for diagnostics and for `splitAndTranslate`, but deliberately NO
 * LONGER used to size normal chunks — see `computeChunkBudget`.
 *
 * `groq/compound` is weighted by its measured 5.5x prompt overhead, so its huge
 * 70 000 TPM does not misrepresent how much raw text it can actually hold.
 */
export function rotationTpmFloor() {
  const lanes = eligibleModels();
  if (!lanes.length) return 6000;
  return Math.min(...lanes.map((m) => {
    const limit = limiterFor(m).tpm.limit;
    return Math.floor(limit / (costOn(m, 1000) / 1000));
  }));
}

/**
 * The ceiling we let the model emit — and therefore what we must reserve.
 *
 * Now takes the MODEL, because the ratio is per model (see `outputRatioFor`).
 * The old signature assumed one global 2.0x and over-reserved every request.
 */
export function maxOutputTokensFor(text, boost = 1, model = null) {
  const ratio = model ? outputRatioFor(model) : OUTPUT_RATIO;
  const raw = Math.ceil(estimateTokens(text) * ratio * boost);
  return Math.min(8000, Math.max(512, raw));
}

// ---------------------------------------------------------------------------
// Single-chunk translation with full retry semantics
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 5;
/** Bounds the split recursion so a pathological passage cannot loop forever. */
const MAX_SPLIT_DEPTH = 3;
/**
 * Quality re-generations are capped much lower than MAX_ATTEMPTS: a transport
 * error costs no tokens and is always worth retrying, whereas re-rolling the
 * same prompt spends the chunk's full budget again for a merely *possible*
 * improvement.
 */
const MAX_QUALITY_RETRIES = 1;
/**
 * A rotation is NOT a failed attempt.
 *
 * The single `attempt` counter conflated three unrelated things — transport
 * errors, quality re-rolls, and "this model is busy so try another one". With
 * five eligible models, exhausting the attempt budget purely by rotating meant
 * a chunk could fail without a single real error ever occurring. Rotations get
 * their own, larger budget; only genuine failures consume `attempt`.
 */
const MAX_ROTATIONS = 8;

/**
 * One SDK client per key, reused across chunks.
 *
 * Constructing a `Groq` client per request is wasteful (it rebuilds the fetch
 * agent each time) and, with a key pool, would do so once per rotation.
 */
const clientCache = new Map();
function clientFor(keyId, fallbackKey) {
  let c = clientCache.get(keyId);
  if (!c) {
    const key = apiKeyFor(keyId) || fallbackKey;
    // `maxRetries: 0` — we own all retry logic, because the SDK's retries are
    // invisible to the limiter and would spend quota it has not reserved.
    c = new Groq({ apiKey: key, maxRetries: 0 });
    clientCache.set(keyId, c);
  }
  return c;
}

async function translateChunkWithGroq({
  text, apiKey, model, isExplicitModel = false, styleId, glossary, previousTail, log, chapterIndex,
  allowShrink = true, onProgress, onStatus, signal, depth = 0,
}) {
  if (!text || !text.trim()) {
    return { text: '', degraded: false, provider: 'groq' };
  }

  /**
   * Register the caller's key into the pool, discover independent quota
   * groups, and query available models on the account.
   */
  loadKeysFromEnv(apiKey ? [apiKey] : []);
  const { lanes: keyLanes } = quotaLanes();
  const keyIds = keyLanes.length ? keyLanes.map((k) => k.id) : [keyIdFor(apiKey)];
  const { models: liveCatalog } = await fetchAvailableModels(apiKey);
  const availableModelIds = (liveCatalog || [])
    .filter((m) => m.available && m.devanagariOk && m.status !== 'ineligible')
    .map((m) => m.id);

  let activeModel = model;
  let activeKeyId = keyIds[0];
  const workingText = text;
  let lastError = null;
  let qualityRetries = 0;
  /** Rotations are counted separately — see MAX_ROTATIONS. */
  let rotations = 0;
  /**
   * Lanes that have proven unusable FOR THIS CHUNK (daily quota gone, chunk
   * too big for their window, hard 429). Entries are `keyId::model` bucket ids
   * when the failure was key-specific, or a bare model id when it applies to
   * every key. Excluding them stops the router from cheerfully re-selecting the
   * same dead lane on the next pass.
   */
  const deadModels = new Set();
  /** Grows when the model runs out of output room (finish_reason=length). */
  let lengthBoost = 1;
  /**
   * Set after a `not_devanagari` failure so the RETRY carries an explicit
   * corrective. Re-sending the identical prompt and hoping for a luckier sample
   * spends a billed request for nothing.
   */
  let scriptCorrection = false;

  /** Push a short human-readable state to the UI (not a log line — a STATUS). */
  const status = (phase, detail = {}) => {
    try { onStatus?.({ phase, model: activeModel, keyId: activeKeyId, chapterIndex, ...detail }); } catch { /* never fatal */ }
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });

    const prompt = buildTranslationPrompt({
      text: workingText, styleId, glossary, previousTail, scriptCorrection,
    });

    const inputTokens = estimateTokens(prompt);
    // Provisional ceiling, used only to ASK the router which lane can take
    // this chunk. Recomputed below once the lane is known, because the output
    // ratio is per model.
    let maxTokens = maxOutputTokensFor(workingText, lengthBoost, activeModel);

    // Reserve the CEILING, refund the surplus after the response arrives.
    // Reserving an optimistic guess and "charging the shortfall" afterwards is
    // too late — the request has already been sent and may already have
    // breached TPM.
    let ceiling = inputTokens + maxTokens;

    // ---- ROUTE ----------------------------------------------------------
    // Free-tier limits are per (KEY, MODEL), so a busy lane is a reason to
    // move — either to another model on the same key, or to the same model on
    // a different key. Only if EVERY lane is throttled do we actually wait.
    let routeReason = null;
    if (rotations < MAX_ROTATIONS) {
      // If the caller explicitly chose a specific model, restrict selection to that model across all key lanes.
      // Only consider other models if the chosen model is dead.
      const candidateModels = (isExplicitModel && !deadModels.has(model))
        ? [model]
        : availableModelIds;

      const route = selectModel(ceiling, {
        prefer: model, exclude: [...deadModels], keys: keyIds, available: candidateModels,
      });
      if (route && (route.model !== activeModel || route.keyId !== activeKeyId)) {
        // Visible at default level: when throughput or quota looks wrong, the
        // first question is always "which model and key actually served this
        // chunk, and why that one?" — a debug-only line cannot answer it in
        // the field.
        log?.info(
          `Lane rotation: ${activeKeyId}/${activeModel} → ${route.keyId}/${route.model} — ${route.reason}`,
          { chapterIndex, stage: 'script' }
        );
        activeModel = route.model;
        activeKeyId = route.keyId;
        rotations++;
      }
      routeReason = route?.reason || null;
    }

    const limiter = limiterFor(activeModel, activeKeyId);
    const groq = clientFor(activeKeyId, apiKey);

    // Re-derive the ceiling for the lane we ACTUALLY landed on. The ratio is
    // per model (0.35x-1.45x measured), so carrying the pre-routing estimate
    // would reserve the previous model's budget on the new model — the exact
    // class of mistake that caused the original over-reservation.
    maxTokens = maxOutputTokensFor(workingText, lengthBoost, activeModel);
    ceiling = inputTokens + maxTokens;

    // `groq/compound` bills a multiple of the prompt (measured 5.5x), so the
    // reservation must be in THAT model's units, not raw token count.
    const cost = costOn(activeModel, ceiling);

    let reservation;
    try {
      status('waiting_quota', { cost, routeReason });
      reservation = await limiter.acquire({
        tokens: cost,
        signal,
        onProgress,
        onWait: ({ waitMs, reason }) => {
          status('waiting_quota', { waitMs, reason, cost });
          log?.info(
            `Waiting ${formatMs(waitMs)} for Groq quota (${LIMIT_LABELS[reason] || reason}) — ` +
            `this chunk needs ~${cost} tokens on ${activeModel}, and every other ` +
            'eligible model is throttled too.',
            { chapterIndex, stage: 'script' }
          );
        },
      });
    } catch (err) {
      // Too big for THIS model's minute window — another model may still have
      // room, so try rotating before paying the cost of a split (unless user explicitly pinned this model).
      if (err.code === 'CHUNK_TOO_LARGE') {
        if (rotations < MAX_ROTATIONS && !isExplicitModel) {
          // Too big is a property of the MODEL's window, not of the key — the
          // same model on another key has the identical limit. So exclude the
          // model everywhere rather than just this one bucket.
          deadModels.add(activeModel);
          const alt = selectModel(ceiling, { exclude: [...deadModels], keys: keyIds, available: availableModelIds });
          if (alt) {
            log?.warn(
              `${err.message} Rotating to ${alt.keyId}/${alt.model}, which has room.`,
              { chapterIndex, stage: 'script' }
            );
            activeModel = alt.model;
            activeKeyId = alt.keyId;
            rotations++;
            attempt--; // routing around a full bucket is not a failed attempt
            continue;
          }
        }
        if (allowShrink && depth < MAX_SPLIT_DEPTH) {
          log?.warn(`${err.message} Splitting this chunk.`, { chapterIndex, stage: 'script' });
          return splitAndTranslate({
            text: workingText, apiKey, model: activeModel, isExplicitModel, styleId, glossary,
            previousTail, log, chapterIndex, onProgress, onStatus, signal, depth,
          });
        }
      }
      throw err;
    }

    let actualTokens = 0;
    try {
      status('requesting', { attempt, inputTokens, maxTokens });
      log?.debug(
        `Groq request → ${activeModel} | attempt ${attempt}/${MAX_ATTEMPTS} | ` +
        `in≈${inputTokens}t, out≤${maxTokens}t, reserved ${cost}t`,
        { chapterIndex, stage: 'script' }
      );

      const started = Date.now();
      const { data: completion, response } = await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: activeModel,
        temperature: 0.35,
        // `max_tokens` is deprecated by Groq and is NOT honoured by the
        // reasoning models, which is part of why gpt-oss-20b returned empty
        // output in the eligibility probe. `max_completion_tokens` is the
        // supported field and behaves identically on the non-reasoning models.
        max_completion_tokens: maxTokens,
        top_p: 0.9,
        /**
         * Per-model reasoning control. MUST be spread per model and never
         * defaulted globally: an unsupported parameter, or a supported one
         * with the wrong value, is a hard 400 — and the accepted values differ
         * between model families (measured, see `reasoningParamsFor`).
         *
         * This is what makes gpt-oss-20b and qwen3.6-27b usable at all; without
         * it they burn the entire output budget on hidden reasoning.
         */
        ...reasoningParamsFor(activeModel),
      }, { signal }).withResponse();

      const elapsed = Date.now() - started;

      // Headers are the source of truth for limits, remaining budget AND the
      // reset instant. Applying them on every success keeps the limiter honest
      // even if our own estimates drift.
      const applied = limiter.applyHeaders(response.headers);
      reportResult(activeKeyId, { ok: true });
      if (applied) {
        log?.debug(
          `Groq quota ← tokens ${applied.remainingTokens ?? '?'}/${applied.limitTokens ?? '?'} ` +
          `(resets ${formatMs(applied.resetTokensMs) || '?'}) · ` +
          `requests today ${applied.remainingRequests ?? '?'}/${applied.limitRequests ?? '?'} ` +
          `(resets ${formatMs(applied.resetRequestsMs) || '?'})`,
          { chapterIndex, stage: 'script' }
        );
      }

      const rawOutput = completion.choices?.[0]?.message?.content || '';
      const finishReason = completion.choices?.[0]?.finish_reason;
      const usage = completion.usage || {};
      actualTokens = usage.total_tokens
        ?? ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0));

      const { text: cleaned, stripped } = cleanModelOutput(rawOutput);
      if (stripped) log?.debug('Stripped a model preamble from the output', { chapterIndex, stage: 'script' });

      // Truncated by the output cap → never ship a half sentence.
      //
      // Order matters: RAISE THE CEILING FIRST, split only if that is not
      // possible. Splitting alone cannot fix this, because a proportional
      // ceiling shrinks with the input — verified live, where a chunk split
      // twice and truncated every time.
      if (finishReason === 'length') {
        const boosted = maxOutputTokensFor(workingText, lengthBoost * LENGTH_RETRY_BOOST);
        if (boosted > maxTokens && lengthBoost < 4) {
          lengthBoost *= LENGTH_RETRY_BOOST;
          log?.warn(
            `Model ran out of room (finish_reason=length) — retrying with a larger ` +
            `output allowance (${maxTokens} → ${boosted} tokens).`,
            { chapterIndex, stage: 'script' }
          );
          continue;
        }
        if (allowShrink && depth < MAX_SPLIT_DEPTH) {
          log?.warn(
            'Model still ran out of room at the maximum output allowance — splitting this chunk.',
            { chapterIndex, stage: 'script' }
          );
          return splitAndTranslate({
            text: workingText, apiKey, model: activeModel, isExplicitModel, styleId, glossary,
            previousTail, log, chapterIndex, onProgress, onStatus, signal, depth,
          });
        }
      }

      const issues = validateOutput({ source: workingText, output: cleaned, glossary });
      const fatal = issues.find((i) => i.severity === 'fatal');
      for (const issue of issues.filter((i) => i.severity === 'warn')) {
        log?.warn(`Quality check: ${issue.message}`, { chapterIndex, stage: 'script' });
      }

      if (fatal) {
        lastError = new Error(fatal.message);
        if (qualityRetries >= MAX_QUALITY_RETRIES) {
          log?.warn(
            `Quality check FAILED (${fatal.code}): ${fatal.message} — accepting the output ` +
            `after ${qualityRetries} re-generation(s) rather than spending more of the token budget.`,
            { chapterIndex, stage: 'script' }
          );
          return { text: cleaned, model: activeModel, provider: 'groq', usage, degraded: fatal.code };
        }
        qualityRetries++;
        // A script failure gets an explicit corrective on the retry; other
        // failures simply re-roll.
        if (fatal.code === 'not_devanagari') scriptCorrection = true;
        log?.warn(
          `Quality check FAILED (${fatal.code}) — regenerating (${qualityRetries}/${MAX_QUALITY_RETRIES})` +
          (scriptCorrection ? ' with stricter Devanagari constraint' : ''),
          { chapterIndex, stage: 'script' }
        );
        attempt--;
        continue;
      }

      status('done', { elapsed });
      log?.debug(
        `Groq OK ← ${activeModel} in ${(elapsed / 1000).toFixed(1)}s | ` +
        `prompt ${usage.prompt_tokens ?? '?'}t, completion ${usage.completion_tokens ?? '?'}t ` +
        `(reserved ${cost}t, actual ${actualTokens || '?'}t)`,
        { chapterIndex, stage: 'script' }
      );

      return { text: cleaned, model: activeModel, provider: 'groq', usage, keyId: activeKeyId };
    } catch (err) {
      lastError = err;
      const info = classifyProviderError(err);

      // Teach the pool which keys are real. A 401 is permanent, so the pool
      // benches that key rather than letting every future chunk rediscover it.
      reportResult(activeKeyId, { ok: false, kind: info.kind, message: info.message });

      // Even a FAILED response carries quota headers — using them is how we
      // learn the real limits after a 429 instead of guessing.
      if (info.headers) limiter.applyHeaders(err?.headers || err?.response?.headers);
      // TPD and RPM have NO headers at all (per the Groq docs, the headers only
      // ever describe TPM and RPD). The 429 body is the only place they are
      // ever revealed, so capture it — otherwise the daily token budget stays
      // invisible until it fails again.
      if (info.limitState) {
        const w = limiter.applyLimitState(info.limitState);
        if (w) {
          log?.info(
            `Discovered ${info.limitState.dimension.toUpperCase()} for ${activeModel}: ` +
            `${info.limitState.used.toLocaleString()}/${info.limitState.limit.toLocaleString()} used. ` +
            'Pacing will now account for it.',
            { chapterIndex, stage: 'script' }
          );
        }
      }

      if (info.kind === 'cancelled') throw err;

      // Routine throttling is not an "error" and must not spam a stack trace.
      if (info.kind === 'rate_limit' || info.kind === 'payload_too_large') {
        log?.warn(`${info.message} (attempt ${attempt}/${MAX_ATTEMPTS})`, { chapterIndex, stage: 'script' });
      } else {
        const logFn = log?.raw || log?.error || console.error;
        logFn(
          `Groq error (attempt ${attempt}/${MAX_ATTEMPTS}) [${info.kind}]: ${info.message}`,
          serialiseError(err),
          { chapterIndex, stage: 'script' }
        );
      }

      // Daily quota exhaustion on a specific model/key can be bypassed by rotating to another key or model.
      if (info.kind === 'daily_limit' && rotations < MAX_ROTATIONS) {
        const deadBucket = `${activeKeyId}::${activeModel}`;
        deadModels.add(deadBucket);
        const candidateModels = (isExplicitModel && !deadModels.has(model))
          ? [model]
          : availableModelIds;
        const alt = selectModel(inputTokens + maxTokens, {
          exclude: [...deadModels], keys: keyIds, available: candidateModels,
        });
        if (alt) {
          log?.info(
            `Daily limit hit on ${activeKeyId}/${activeModel} — rotating to ${alt.keyId}/${alt.model}.`,
            { chapterIndex, stage: 'script' }
          );
          activeModel = alt.model;
          activeKeyId = alt.keyId;
          rotations++;
          attempt--;
          continue;
        }
      }

      // If the model is permanently unavailable, don't keep hammering it.
      if (info.kind === 'model_unavailable' || info.kind === 'model_degraded') {
        deadModels.add(activeModel);
        log?.warn(`Model ${activeModel} is ${info.kind} — finding alternative.`, { chapterIndex, stage: 'script' });
        const alt = selectModel(inputTokens + maxTokens, {
          exclude: [...deadModels], keys: keyIds, available: availableModelIds,
        });
        if (alt) {
          log?.info(`Switching to ${alt.keyId}/${alt.model}.`, { chapterIndex, stage: 'script' });
          activeModel = alt.model;
          activeKeyId = alt.keyId;
          rotations++;
          attempt--;
          continue;
        }
      }

      if (info.retryable && attempt < MAX_ATTEMPTS) {
        // Rate-limit backoff: honour what Groq asked us to wait. The header
        // retry-after from the provider always wins; jittered backoff otherwise.
        const waitMs = info.retryAfterMs || backoffMs(attempt);
        limiter.penalise(waitMs, info.kind);
        status('backoff', { waitMs, kind: info.kind, message: info.message });

        // A 429 is PER (KEY, MODEL) — the docs scope limits to the organisation
        // AND the model, and this was confirmed live by spending one model's
        // budget and watching another's remaining-tokens header stay put. So
        // the right response is to MOVE — to the same model on a different key,
        // or (if model was not explicitly chosen) to another model. Only if every
        // lane is throttled do we wait.
        if (info.kind === 'rate_limit' && rotations < MAX_ROTATIONS) {
          const deadBucket = `${activeKeyId}::${activeModel}`;
          deadModels.add(deadBucket);
          const candidateModels = (isExplicitModel && !deadModels.has(model))
            ? [model]
            : availableModelIds;
          const alt = selectModel(inputTokens + maxTokens, {
            exclude: [...deadModels], keys: keyIds, available: candidateModels,
          });
          if (alt && alt.waitMs < waitMs) {
            log?.info(
              `${activeKeyId}/${activeModel} is rate-limited for ${formatMs(waitMs)} — switching to ` +
              `${alt.keyId}/${alt.model} instead of waiting (${alt.reason}).`,
              { chapterIndex, stage: 'script' }
            );
            activeModel = alt.model;
            activeKeyId = alt.keyId;
            rotations++;
            attempt--; // rotating around a 429 is not a failed attempt
            continue;
          }
          // Nowhere better to go; this lane is fine to reuse after the wait.
          deadModels.delete(deadBucket);
        }

        log?.warn(
          `Backing off ${formatMs(waitMs)} then retrying ${activeModel} — every other ` +
          'eligible lane is throttled too, so rotating would not help.',
          { chapterIndex, stage: 'script' }
        );
        await interruptibleSleep(waitMs, onProgress, signal);

        // If the payload itself was too big, halve it rather than loop forever.
        if (info.kind === 'payload_too_large' && allowShrink && depth < MAX_SPLIT_DEPTH) {
          return splitAndTranslate({
            text: workingText, apiKey, model: activeModel, isExplicitModel, styleId, glossary,
            previousTail, log, chapterIndex, onProgress, onStatus, signal, depth,
          });
        }
        continue;
      }

      if (info.kind === 'model_gone' || err?.status === 404 || (err?.status === 400 && /model/i.test(err?.message))) {
        deadModels.add(activeModel);
        const { model: next, note: nextNote } = await resolveModel(apiKey, null, { exclude: [...deadModels] });
        if (next && next !== activeModel) {
          log?.warn(`Model "${activeModel}" unavailable — switching to "${next}" (${nextNote || 'next available'}).`, { chapterIndex, stage: 'script' });
          activeModel = next;
          continue;
        }
        throw err;
      }

      // transient
      const waitMs = backoffMs(attempt, { baseMs: 1500, capMs: 20000 });
      status('retrying', { waitMs, kind: info.kind });
      log?.info(`Transient failure — retrying in ${formatMs(waitMs)}.`, { chapterIndex, stage: 'script' });
      await interruptibleSleep(waitMs, onProgress, signal);
    } finally {
      // ALWAYS settle. A reservation that is never settled leaks its full
      // estimate out of the bucket, so every transport error made the limiter
      // permanently more restrictive for no reason.
      reservation?.settle(actualTokens);
    }
  }

  throw lastError || new Error('Translation failed after all retries');
}

/** Human labels for the limiter's machine-readable wait reasons. */
const LIMIT_LABELS = {
  tokens_per_minute: 'tokens per minute',
  requests_per_minute: 'requests per minute',
  tokens_per_day: 'tokens per day',
  requests_per_day: 'requests per day',
  rate_limit: 'provider asked us to wait',
  payload_too_large: 'request too large',
};

/** Sleep that can be cancelled and that keeps the UI progress ticking. */
async function interruptibleSleep(totalMs, onProgress, signal) {
  const end = Date.now() + totalMs;
  while (Date.now() < end) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
    onProgress?.();
    await sleep(Math.min(500, end - Date.now()));
  }
}

/**
 * Halve a chunk and translate the pieces in order, preserving continuity.
 *
 * Extracted because the old code inlined this THREE times with subtly different
 * arguments — one copy forgot to forward `onProgress`, so those sub-requests
 * were silently uncancellable, and none of them bounded the recursion.
 */
async function splitAndTranslate({
  text, apiKey, model, styleId, glossary, previousTail, log, chapterIndex,
  onProgress, onStatus, signal, depth,
}) {
  const halves = chunkByTokens(text, Math.max(120, Math.ceil(estimateTokens(text) / 2)));
  if (halves.length < 2) {
    throw new Error('This passage cannot be split any further but still exceeds the model limit.');
  }
  log?.info(`Splitting into ${halves.length} smaller pieces (depth ${depth + 1}).`, { chapterIndex, stage: 'script' });

  const results = [];
  let tail = previousTail;
  let usedModel = model;
  for (const half of halves) {
    const r = await translateChunkWithGroq({
      text: half, apiKey, model: usedModel, styleId, glossary,
      previousTail: tail, log, chapterIndex,
      allowShrink: true, onProgress, onStatus, signal, depth: depth + 1,
    });
    results.push(r.text);
    usedModel = r.model || usedModel;
    tail = r.text.slice(-200);
  }
  return { text: results.join('\n\n'), model: usedModel, provider: 'groq' };
}

function serialiseError(err) {
  try {
    return JSON.stringify({
      name: err?.name, message: err?.message, status: err?.status,
      error: err?.error, stack: err?.stack?.split('\n').slice(0, 4).join('\n'),
    }, null, 2);
  } catch {
    return String(err);
  }
}

// ---------------------------------------------------------------------------
// Google fallback (opt-in, always clearly labelled)
// ---------------------------------------------------------------------------

async function translateWithGoogle(text, targetLang = 'hi', sourceLang = 'en') {
  const t = await getGoogleTranslator();
  const result = await t(text, { from: sourceLang, to: targetLang });
  return result.text;
}

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Root dir is two levels up from server/services/
const rootDir = path.resolve(__dirname, '..', '..');

async function translateWithAntigravity(text, styleDef, glossary = [], customPrompt = null, previousTail = '') {
  let promptParts = [];
  
  try {
    const skillPath = path.join(rootDir, '.agents', 'skills', 'hinglish-reteller', 'SKILL.md');
    const skillContent = await fs.readFile(skillPath, 'utf-8');
    promptParts.push(`SYSTEM INSTRUCTIONS:\n${skillContent}`);
  } catch (err) {
    console.warn("Could not load hinglish-reteller skill file:", err.message);
  }

  
  if (customPrompt && customPrompt.trim()) {
    promptParts.push(`USER OVERRIDE INSTRUCTIONS:\n${customPrompt.trim()}`);
  }

  if (previousTail) {
    promptParts.push(`Previous context (continue from here, do not repeat it):\n${previousTail}`);
  }
  
  if (glossary && glossary.length) {
    const terms = glossary.map(g => `${g.english} -> ${g.hindi}`).join(', ');
    promptParts.push(`Glossary to adhere to: ${terms}`);
  }

  promptParts.push(`Text to process:\n\n${text}`);
  
  const prompt = promptParts.join('\n\n');
  const { stdout } = await execPromise('agy', ['-p', prompt, '--output-format', 'text']);
  return stdout.trim();
}

// ---------------------------------------------------------------------------
// Public API — retell a whole chapter
// ---------------------------------------------------------------------------

/**
 * @returns {{ text, provider, providerStatus, model, promptVersion, chunkCount }}
 */
export async function retellChapter({
  text,
  styleId = 'novel',
  apiKey,
  model,
  glossary = [],
  tpmLimit = 6000,
  allowGoogleFallback = false,
  useAntigravity = false,
  customPrompt = null,
  onProgress,
  log,
  chapterIndex,
  signal,
}) {
  if (!text || !text.trim()) {
    return { text: '', provider: 'none', providerStatus: 'none', model: null, chunkCount: 0 };
  }

  const style = getStyle(styleId);

  if (!useAntigravity && !apiKey) {
    if (!allowGoogleFallback) {
      throw new Error(
        'Hinglish output needs a Groq API key. Add one in Settings, or enable the ' +
        'Google Translate fallback (note: Google produces literal Hindi, not your storytelling style).'
      );
    }
    log?.warn('No Groq key — using Google Translate. Output will be LITERAL Hindi, not styled Hinglish.', { chapterIndex, stage: 'script' });
    const translated = await translateWithGoogle(text, 'hi');
    return {
      text: translated, provider: 'google', providerStatus: 'google_fallback',
      model: 'google-translate', promptVersion: null, chunkCount: 1,
    };
  }

  const { model: activeModel, note: modelNote, fallback } = await resolveModel(apiKey, model);
  if (modelNote) {
    if (fallback) {
      log?.warn(modelNote, { chapterIndex, stage: 'script' });
    } else {
      log?.info(modelNote, { chapterIndex, stage: 'script' });
    }
  }

  // Size chunks so that EVERY rotation lane can accept them.
  //
  // This used to size against the active model's live TPM, which quietly
  // destroyed rotation: a chunk sized for the 12 000-TPM model does not fit the
  // 6 000- or 8 000-TPM lanes, so when the big model throttled there was
  // nowhere to rotate TO and the pipeline just sat and waited. Sizing to the
  // narrowest lane costs a little per-request efficiency and buys 4x the
  // available quota.
  // Size chunks for MAXIMUM TOTAL THROUGHPUT, not maximum chunk size.
  //
  // This used to pin sizing to `rotationTpmFloor()` (6 000 TPM). Measurement
  // showed both that floor AND the obvious "size for the live lane" fix are
  // worse than sizing for 8 000 — see `CHUNK_SIZING_TPM` for the numbers.
  // Bigger chunks fit fewer lanes, so the widest sizing strands most of the
  // key-model buckets and is the slowest option overall.
  const limiter = limiterFor(activeModel);
  const liveSnapshot = limiter.snapshot();
  const laneTpm = liveSnapshot.tpm.limit || tpmLimit || CHUNK_SIZING_TPM;
  // Never size ABOVE the lane we are actually starting on — if the user pinned
  // a 6 000 TPM model, an 8 000-sized chunk could never run there at all.
  const sizingTpm = Math.min(CHUNK_SIZING_TPM, laneTpm);
  const overhead = measurePromptOverhead({ styleId, glossary });
  const budget = computeChunkBudget({
    tpmLimit: sizingTpm, promptOverheadTokens: overhead, model: activeModel,
  });

  /**
   * SPLIT FOR QUALITY FIRST, then enforce the rate limit as a ceiling.
   *
   * The TPM arithmetic above answers "how much COULD fit in one request". That
   * is the wrong question, and answering it was costing more than half the
   * chapter: PROBE-13/14 measured retention at 47% for a whole-chapter request
   * versus 90% at ~450 words, with dialogue survival going 18% → 82% and the
   * wall clock actually IMPROVING (chunks run concurrently across key lanes).
   *
   * So `chunkForQuality` decides the size, and `budget` only guards against a
   * chunk too large for the lane's window — which, at 450 words (~600 tokens),
   * essentially never triggers. The guard stays because a single monstrous
   * paragraph is always possible, and PROBE-11 proved Groq rejects a request
   * whose prompt + max_completion_tokens exceeds TPM.
   */
  let chunks = chunkForQuality(text);
  if (chunks.some((c) => estimateTokens(c) > budget)) {
    chunks = chunks.flatMap((c) => (estimateTokens(c) > budget ? chunkByTokens(c, budget) : [c]));
  }

  const avgWords = chunks.length
    ? Math.round(chunks.reduce((a, c) => a + c.split(/\s+/).filter(Boolean).length, 0) / chunks.length)
    : 0;
  log?.info(
    `Prepared ${chunks.length} chunk(s) · ~${avgWords} words each ` +
    `(quality target ${TARGET_CHUNK_WORDS}w — measured best for retention AND speed) · ` +
    `lane ${activeModel} @ ${laneTpm} TPM, cap ${budget} input tokens · ` +
    `prompt overhead ${overhead}t · style "${style.name}" · ` +
    `glossary ${glossary.length} terms`,
    { chapterIndex, stage: 'prepare' }
  );

  const outputs = [];
  let usedProvider = 'groq';
  let providerStatus = 'groq_ok';

  /**
   * -------------------------------------------------------------------------
   * RUN CHUNKS CONCURRENTLY ACROSS KEY LANES
   * -------------------------------------------------------------------------
   * This loop used to be strictly sequential: `for (i…) await translateChunk`.
   * That was defensible when a chapter was 2 big chunks, but it is what makes
   * the quality-first chunk size (TARGET_CHUNK_WORDS) look expensive — the same
   * chapter measured 20.0s of summed request time but only 4.0s of wall clock
   * when the chunks were allowed to overlap (PROBE-14).
   *
   * Concurrency is bounded by the number of INDEPENDENT KEY LANES, because a
   * lane is the unit that has its own rate limit. Beyond that the requests do
   * not go faster, they just queue inside the limiter — and PROBE-15 showed
   * that piling onto an already-spent lane is what produces 429s.
   *
   * CONTINUITY TRADE-OFF, stated honestly: chunk N+1 can no longer receive the
   * tail of chunk N's OUTPUT, because they are in flight together. We pass the
   * tail of the previous SOURCE chunk instead, which still tells the model
   * where it is in the story and that it is mid-scene, without serialising the
   * whole chapter for it. Quality was measured WITHOUT output tails at 90%
   * retention / 82% dialogue, so this is not a regression — it is the
   * configuration that produced those numbers.
   */
  const laneCount = useAntigravity ? 100 : Math.max(1, quotaLanes().lanes.length || 1);
  const concurrency = Math.max(1, Math.min(chunks.length, laneCount));

  log?.info(
    `Retelling ${chunks.length} chunk(s) with up to ${concurrency} running at once ` +
    `(${laneCount} independent key lane(s) available).`,
    { chapterIndex, stage: 'script' }
  );

  const results = new Array(chunks.length);
  let completed = 0;
  let nextIndex = 0;

  const runOne = async (i) => {
    // Source-side context: where we are, without needing the previous OUTPUT.
    const sourceTail = i > 0 ? chunks[i - 1].slice(-200) : '';

    try {
      let result;
      if (useAntigravity) {
        const translated = await translateWithAntigravity(chunks[i], style, glossary, customPrompt, sourceTail);
        result = { text: translated, degraded: false };
        usedProvider = 'antigravity';
        providerStatus = 'ok';
      } else {
        const isExplicitModel = Boolean(model && model !== 'auto' && !fallback);
        result = await translateChunkWithGroq({
          text: chunks[i], apiKey, model: activeModel, isExplicitModel, styleId,
          glossary, previousTail: sourceTail, log, chapterIndex, signal,
          onProgress: () => {
            onProgress?.({
              current: completed + 1, total: chunks.length,
              percent: Math.round((completed / chunks.length) * 100), heartbeat: true,
            });
          },
          onStatus: (s) => onProgress?.({
            current: completed + 1, total: chunks.length,
            percent: Math.round((completed / chunks.length) * 100),
            ...s,
          }),
        });
      }
      results[i] = result.text;
      if (result.degraded) providerStatus = 'groq_degraded';
      log?.success(`Chunk ${i + 1}/${chunks.length} done (${result.text.length} chars)`, { chapterIndex, stage: 'script' });
    } catch (err) {
      if (err.kind === 'auth' || err.kind === 'permission' || err.kind === 'daily_limit') {
        log?.error(`${err.message}${err.userAction ? ` → ${err.userAction}` : ''}`, { chapterIndex, stage: 'script' });
        throw err;
      }
      if (allowGoogleFallback) {
        log?.warn(
          `Groq failed permanently for chunk ${i + 1}. Falling back to Google Translate — ` +
          'this chunk will be LITERAL Hindi, not your storytelling style.',
          { chapterIndex, stage: 'script' }
        );
        results[i] = await translateWithGoogle(chunks[i], 'hi');
        usedProvider = 'mixed';
        providerStatus = 'google_fallback';
      } else {
        throw err;
      }
    }

    completed++;
    onProgress?.({
      current: completed, total: chunks.length,
      percent: Math.round((completed / chunks.length) * 100), phase: 'chunk_done',
    });
  };

  // A fixed pool of workers pulling from a shared cursor. This keeps exactly
  // `concurrency` requests in flight without building the whole promise array
  // up front, so a failure stops scheduling new work promptly.
  const worker = async () => {
    for (;;) {
      const i = nextIndex++;
      if (i >= chunks.length) return;
      if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
      await runOne(i);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));

  // Order is preserved by index, never by completion time — a chapter whose
  // scenes arrive shuffled would be worse than one that took longer.
  outputs.push(...results.filter((t) => typeof t === 'string'));

  return {
    text: outputs.join('\n\n'),
    provider: usedProvider,
    providerStatus,
    model: useAntigravity ? 'antigravity-cli' : activeModel,
    promptVersion: PROMPT_VERSION,
    chunkCount: chunks.length,
  };
}

/** Quota snapshot for the UI chip. */
export function getQuotaSnapshot() {
  return { ...limiterQuotaSnapshot(), keyPool: keyPoolSnapshot() };
}

export function configureLimiter(limits) {
  return limiterConfigure(limits);
}

/** Re-export so routes can stream limiter events to the browser. */
export { limiterEvents };
/** Key-pool surface, re-exported so routes need only import the translator. */
export { registerKeys, keyPoolSnapshot };
export { classifyKeys, keyPoolEvents } from './keyPool.js';

