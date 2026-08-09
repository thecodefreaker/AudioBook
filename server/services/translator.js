/**
 * Translator — the Hinglish retelling engine.
 *
 * Rewritten to fix the real causes of the failures you hit:
 *
 *  • Chunks are sized in TOKENS, not characters (the 413 "Requested 9459" bug).
 *  • `max_tokens` is DYNAMIC — Hinglish output is longer than English input, and
 *    the old fixed 2000 silently truncated chapters mid-sentence.
 *  • Rate limits are handled by WAITING and retrying the SAME model, because TPM
 *    is an organisation-wide budget — switching models cannot help.
 *  • The model list is fetched LIVE from Groq, so a decommissioned model
 *    (mixtral-8x7b-32768) can never wedge the pipeline again.
 *  • Google Translate is OPT-IN, and when used the result is tagged
 *    `google_fallback` so the UI can never present literal Hindi as your style.
 *  • Chunks carry CONTINUITY (previous tail) and a GLOSSARY so names and tone
 *    stay consistent across a 5000-chapter novel.
 */
import Groq from 'groq-sdk';
import { groqLimiter, classifyProviderError, sleep } from './rateLimiter.js';
import {
  buildTranslationPrompt, cleanModelOutput, validateOutput,
  getStyle, PROMPT_VERSION,
} from './prompts.js';
import { estimateTokens, splitSentences } from './scriptUtils.js';

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

let modelCache = { models: [], fetchedAt: 0 };
const MODEL_CACHE_MS = 10 * 60 * 1000;

/** Known-good preference order; filtered against what the account can actually use. */
const PREFERRED_MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'llama-3.1-8b-instant',
  'gemma2-9b-it',
];

export async function fetchAvailableModels(apiKey, { force = false } = {}) {
  if (!apiKey) return { models: [], error: 'No API key provided' };

  if (!force && modelCache.models.length && Date.now() - modelCache.fetchedAt < MODEL_CACHE_MS) {
    return { models: modelCache.models, cached: true };
  }

  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      const body = await res.text();
      return { models: [], error: `HTTP ${res.status}: ${body.slice(0, 300)}` };
    }
    const json = await res.json();

    const models = (json.data || [])
      .filter((m) => m.active !== false)
      // exclude non-chat models (whisper, guard, tts)
      .filter((m) => !/whisper|guard|tts|distil/i.test(m.id))
      .map((m) => ({
        id: m.id,
        contextWindow: m.context_window || 8192,
        owner: m.owned_by,
        preferred: PREFERRED_MODELS.includes(m.id),
      }))
      .sort((a, b) => {
        const ai = PREFERRED_MODELS.indexOf(a.id);
        const bi = PREFERRED_MODELS.indexOf(b.id);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return b.contextWindow - a.contextWindow;
      });

    modelCache = { models, fetchedAt: Date.now() };
    return { models };
  } catch (err) {
    return { models: [], error: err.message };
  }
}

/** Verify a key and report the models it can reach — powers the "Test key" button. */
export async function testApiKey(apiKey) {
  if (!apiKey || !apiKey.trim()) {
    return { valid: false, error: 'No API key provided' };
  }
  const { models, error } = await fetchAvailableModels(apiKey, { force: true });
  if (error) return { valid: false, error };
  if (!models.length) return { valid: false, error: 'Key works but no usable chat models were returned' };
  return { valid: true, models, recommended: models[0].id };
}

async function resolveModel(apiKey, requested) {
  const { models } = await fetchAvailableModels(apiKey);
  if (!models.length) return requested || PREFERRED_MODELS[0];
  if (requested && models.some((m) => m.id === requested)) return requested;
  return models[0].id;
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
 * Compute a safe input-token budget from the account's TPM limit.
 * Reserves room for the prompt scaffolding AND the model's output, because
 * both count toward TPM.
 */
export function computeChunkBudget({ tpmLimit = 6000, promptOverheadTokens = 700 } = {}) {
  // input + (input * ~1.8 output) + overhead  <=  70% of TPM
  const usable = tpmLimit * 0.7 - promptOverheadTokens;
  const budget = Math.floor(usable / 2.8);
  return Math.max(200, Math.min(budget, 3000));
}

// ---------------------------------------------------------------------------
// Single-chunk translation with full retry semantics
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 5;
/**
 * Quality re-generations are capped much lower than MAX_ATTEMPTS: a transport
 * error costs no tokens and is always worth retrying, whereas re-rolling the
 * same prompt spends the chunk's full budget again for a merely *possible*
 * improvement.
 */
const MAX_QUALITY_RETRIES = 1;

async function translateChunkWithGroq({
  text, apiKey, model, styleId, glossary, previousTail, log, chapterIndex, allowShrink = true,
}) {
  const groq = new Groq({ apiKey });
  let activeModel = model;
  const workingText = text;
  let lastError = null;
  let qualityRetries = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt = buildTranslationPrompt({
      text: workingText, styleId, glossary, previousTail,
    });

    const inputTokens = estimateTokens(prompt);
    // Hinglish/Devanagari output runs longer than the English input.
    const maxTokens = Math.min(8000, Math.max(700, Math.ceil(estimateTokens(workingText) * 2.2)));

    // What we RESERVE is not `maxTokens`: that is the ceiling we allow the
    // model, not what it typically emits. Reserving the ceiling on every call
    // burned the whole 6000 TPM budget in a handful of chapters. We reserve a
    // realistic estimate and reconcile against the provider's reported usage
    // once the response arrives, so the budget stays accurate in both
    // directions.
    const expectedOutput = Math.ceil(estimateTokens(workingText) * 1.3);
    const cost = inputTokens + expectedOutput;

    await groqLimiter.acquire(cost, (waitMs) => {
      log?.info(
        `Rate limit pacing — waiting ${(waitMs / 1000).toFixed(1)}s for token budget (need ~${cost} tokens)`,
        { chapterIndex, stage: 'script' }
      );
    });

    try {
      log?.debug(
        `Groq request → ${activeModel} | attempt ${attempt}/${MAX_ATTEMPTS} | in≈${inputTokens}t out≤${maxTokens}t`,
        { chapterIndex, stage: 'script' }
      );

      const started = Date.now();
      const completion = await groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: activeModel,
        temperature: 0.35,
        max_tokens: maxTokens,
        top_p: 0.9,
      });

      const elapsed = Date.now() - started;
      const rawOutput = completion.choices?.[0]?.message?.content || '';
      const finishReason = completion.choices?.[0]?.finish_reason;
      const usage = completion.usage || {};

      // Reconcile the reservation against what was really spent, so the budget
      // stays accurate whether we over- or under-estimated.
      const actualTotal = usage.total_tokens
        ?? ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0));
      if (actualTotal > 0) groqLimiter.reconcile(cost, actualTotal);

      const { text: cleaned, stripped } = cleanModelOutput(rawOutput);
      if (stripped) {
        log?.debug('Stripped a model preamble from the output', { chapterIndex, stage: 'script' });
      }

      // Truncated by the output cap → split and redo, never ship a half sentence.
      if (finishReason === 'length' && allowShrink) {
        log?.warn(
          'Model hit its output limit (finish_reason=length) — splitting this chunk so the chapter is not truncated.',
          { chapterIndex, stage: 'script' }
        );
        const halves = chunkByTokens(workingText, Math.max(150, Math.ceil(estimateTokens(workingText) / 2)));
        if (halves.length > 1) {
          const results = [];
          let tail = previousTail;
          for (const half of halves) {
            const r = await translateChunkWithGroq({
              text: half, apiKey, model: activeModel, styleId, glossary,
              previousTail: tail, log, chapterIndex, allowShrink: false,
            });
            results.push(r.text);
            tail = r.text.slice(-200);
          }
          return { text: results.join('\n\n'), model: activeModel, provider: 'groq', usage };
        }
      }

      const issues = validateOutput({ source: workingText, output: cleaned, glossary });
      const fatal = issues.find((i) => i.severity === 'fatal');

      for (const issue of issues.filter((i) => i.severity === 'warn')) {
        log?.warn(`Quality check: ${issue.message}`, { chapterIndex, stage: 'script' });
      }

      if (fatal) {
        lastError = new Error(fatal.message);
        // A quality retry re-spends the FULL token cost of the chunk, so it is
        // capped far below MAX_ATTEMPTS (which exists for transport errors that
        // cost nothing). Burning five budgets to re-roll the same prompt is how
        // a handful of chapters exhausted the minute's quota.
        if (qualityRetries >= MAX_QUALITY_RETRIES) {
          log?.warn(
            `Quality check FAILED (${fatal.code}): ${fatal.message} — accepting the output ` +
            `after ${qualityRetries} re-generation(s) rather than spending more of the token budget.`,
            { chapterIndex, stage: 'script' }
          );
          return { text: cleaned, model: activeModel, provider: 'groq', usage, degraded: fatal.code };
        }
        qualityRetries++;
        log?.warn(
          `Quality check FAILED (${fatal.code}): ${fatal.message} — regenerating ` +
          `(${qualityRetries}/${MAX_QUALITY_RETRIES})`,
          { chapterIndex, stage: 'script' }
        );
        await sleep(800);
        continue;
      }

      log?.debug(
        `Groq OK ← ${activeModel} in ${(elapsed / 1000).toFixed(1)}s | ` +
        `prompt ${usage.prompt_tokens ?? '?'}t, completion ${usage.completion_tokens ?? '?'}t`,
        { chapterIndex, stage: 'script' }
      );

      return { text: cleaned, model: activeModel, provider: 'groq', usage };

    } catch (err) {
      lastError = err;
      const info = classifyProviderError(err);

      log?.raw(
        `Groq error (attempt ${attempt}/${MAX_ATTEMPTS}) [${info.kind}]: ${info.message}`,
        serialiseError(err),
        { chapterIndex, stage: 'script' }
      );

      if (!info.retryable) throw err;

      if (info.kind === 'rate_limit' || info.kind === 'payload_too_large') {
        const waitMs = info.retryAfterMs || Math.min(30000, 2000 * 2 ** (attempt - 1));
        groqLimiter.penalise(Math.ceil(waitMs / 1000));
        log?.warn(
          `Backing off ${(waitMs / 1000).toFixed(1)}s then retrying the SAME model ` +
          '(TPM is organisation-wide, so switching models would not help).',
          { chapterIndex, stage: 'script' }
        );
        await sleep(waitMs);

        // If the payload itself was too big, halve it rather than loop forever.
        if (info.kind === 'payload_too_large' && allowShrink) {
          const halves = chunkByTokens(workingText, Math.max(150, Math.ceil(estimateTokens(workingText) / 2)));
          if (halves.length > 1) {
            log?.info(`Splitting the chunk into ${halves.length} smaller pieces.`, { chapterIndex, stage: 'script' });
            const results = [];
            let tail = previousTail;
            for (const half of halves) {
              const r = await translateChunkWithGroq({
                text: half, apiKey, model: activeModel, styleId, glossary,
                previousTail: tail, log, chapterIndex, allowShrink: false,
              });
              results.push(r.text);
              tail = r.text.slice(-200);
            }
            return { text: results.join('\n\n'), model: activeModel, provider: 'groq' };
          }
        }
        continue;
      }

      if (info.kind === 'model_gone') {
        const next = await resolveModel(apiKey, null);
        if (next && next !== activeModel) {
          log?.warn(`Model "${activeModel}" unavailable — switching to "${next}".`, { chapterIndex, stage: 'script' });
          activeModel = next;
          continue;
        }
        throw err;
      }

      // transient
      const waitMs = Math.min(20000, 1500 * 2 ** (attempt - 1));
      log?.info(`Transient failure — retrying in ${(waitMs / 1000).toFixed(1)}s.`, { chapterIndex, stage: 'script' });
      await sleep(waitMs);
    }
  }

  throw lastError || new Error('Translation failed after all retries');
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
  onProgress,
  log,
  chapterIndex,
}) {
  if (!text || !text.trim()) {
    return { text: '', provider: 'none', providerStatus: 'none', model: null, chunkCount: 0 };
  }

  const style = getStyle(styleId);

  if (!apiKey) {
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

  const activeModel = await resolveModel(apiKey, model);
  if (model && activeModel !== model) {
    log?.warn(`Requested model "${model}" is not available — using "${activeModel}".`, { chapterIndex, stage: 'script' });
  }

  const budget = computeChunkBudget({ tpmLimit });
  const chunks = chunkByTokens(text, budget);

  log?.info(
    `Prepared ${chunks.length} chunk(s) · budget ${budget} input tokens/chunk · ` +
    `style "${style.name}" · model ${activeModel} · glossary ${glossary.length} terms`,
    { chapterIndex, stage: 'prepare' }
  );

  const outputs = [];
  let previousTail = '';
  let usedProvider = 'groq';
  let providerStatus = 'groq_ok';

  for (let i = 0; i < chunks.length; i++) {
    onProgress?.({ current: i + 1, total: chunks.length, percent: Math.round((i / chunks.length) * 100) });

    log?.info(
      `Retelling chunk ${i + 1}/${chunks.length} (${chunks[i].length} chars ≈ ${estimateTokens(chunks[i])} tokens)`,
      { chapterIndex, stage: 'script' }
    );

    try {
      const result = await translateChunkWithGroq({
        text: chunks[i], apiKey, model: activeModel, styleId,
        glossary, previousTail, log, chapterIndex,
      });
      outputs.push(result.text);
      previousTail = result.text.slice(-200);

      log?.success(`Chunk ${i + 1}/${chunks.length} done (${result.text.length} chars)`, { chapterIndex, stage: 'script' });

    } catch (err) {
      if (allowGoogleFallback) {
        log?.warn(
          `Groq failed permanently for chunk ${i + 1}. Falling back to Google Translate — ` +
          'this chunk will be LITERAL Hindi, not your storytelling style.',
          { chapterIndex, stage: 'script' }
        );
        const translated = await translateWithGoogle(chunks[i], 'hi');
        outputs.push(translated);
        previousTail = translated.slice(-200);
        usedProvider = 'mixed';
        providerStatus = 'google_fallback';
      } else {
        throw err;
      }
    }

    onProgress?.({ current: i + 1, total: chunks.length, percent: Math.round(((i + 1) / chunks.length) * 100) });
  }

  return {
    text: outputs.join('\n\n'),
    provider: usedProvider,
    providerStatus,
    model: activeModel,
    promptVersion: PROMPT_VERSION,
    chunkCount: chunks.length,
  };
}

/** Quota snapshot for the UI chip. */
export function getQuotaSnapshot() {
  return groqLimiter.snapshot();
}

export function configureLimiter({ tokensPerMinute, requestsPerMinute }) {
  groqLimiter.configure({ tokensPerMinute, requestsPerMinute });
}
