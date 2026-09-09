/**
 * Pipeline — converts chapters into audio in five NAMED stages.
 *
 *   1. PREPARE  work out what has to be done and what it will cost
 *   2. SCRIPT   obtain the exact text to speak (custom | AI retell | original)
 *   3. SYNTH    text-to-speech, chunk by chunk, with word-level subtitles
 *   4. STITCH   concatenate audio + shift subtitle timestamps
 *   5. INDEX    persist the version + sentence alignment map
 *
 * Each stage reports start/progress/end so the UI can show a real stepper
 * instead of a vague "processing...".
 *
 * KEY BEHAVIOURAL FIXES vs the old jobProcessor:
 *   • Writes to `chapter_scripts`, never overwriting `translated_content`.
 *     A custom script can no longer be destroyed by an AI run.
 *   • Audio rows point at the exact script that produced them (`script_id`),
 *     so version badges can never lie.
 *   • Cancellation is checked between chunks, so stopping takes seconds.
 *   • A single chapter can be cancelled without killing the job.
 *   • One chapter failing never kills the rest of the batch.
 *   • Sentence alignment is computed and stored, enabling real karaoke.
 */
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

import * as db from '../models/database.js';
import * as logBus from '../services/logBus.js';
import config from '../config/index.js';
import { retellChapter } from '../services/translator.js';
import { synthesizeChunked, getAudioDuration, mergeAudioFiles } from '../services/ttsEngine.js';
import { buildAudiobook } from '../services/audiobook.js';
import { chunkText } from '../utils/textChunker.js';
import { prepareForTts, detectScript, splitSentences, estimateTokens } from '../services/scriptUtils.js';
import { getStyle, PROMPT_VERSION } from '../services/prompts.js';
import { getLanguage, voiceLabel } from '../languages/index.js';
import { getSettings } from '../services/settings.js';
import { isCancellation } from '../utils/cancellation.js';
import { effectiveChapterConcurrency } from './concurrency.js';

const STAGES = ['prepare', 'script', 'synth', 'stitch', 'index'];

/** Cancellation is cooperative — this is thrown to unwind cleanly. */
class CancelledError extends Error {
  constructor(msg = 'Cancelled') { super(msg); this.name = 'CancelledError'; }
}

// ---------------------------------------------------------------------------
// Estimation (powers the "5,000 chapters ≈ 62 hours" safety warning)
// ---------------------------------------------------------------------------

const WORDS_PER_MINUTE_AUDIO = 150;

export function estimateWork({ bookId, chapterIndexes, language, scriptSource, action = 'both' }) {
  const chapters = db.getChaptersByBookId(bookId);
  const selected = chapters.filter((c) => chapterIndexes.includes(c.chapter_index));

  let words = 0;
  let chars = 0;
  for (const c of selected) {
    words += c.word_count || 0;
    chars += c.char_count || 0;
  }

  // A text-only run never reaches TTS, and an audio-only run speaks a script
  // that already exists — so each skips the cost of the stage it does not run.
  // Quoting the full price for either would make the cheap options look
  // expensive and push users back to the one-size-fits-all conversion.
  const wantsScript = action !== 'audio';
  const wantsAudio = action !== 'script';

  const needsAi = language !== 'en' && scriptSource === 'ai' && wantsScript;
  const promptTokens = needsAi ? Math.ceil(estimateTokens('x'.repeat(chars)) * 1.35) : 0;

  // Empirical: ~7s of wall clock per 1000 chars for TTS, plus AI time if used.
  const ttsSeconds = wantsAudio ? Math.ceil((chars / 1000) * 7) : 0;
  const aiSeconds = needsAi ? Math.ceil((promptTokens / 6000) * 60) : 0;

  return {
    chapters: selected.length,
    words,
    chars,
    estimatedTokens: promptTokens,
    estimatedAudioMinutes: wantsAudio ? Math.round(words / WORDS_PER_MINUTE_AUDIO) : 0,
    estimatedSeconds: ttsSeconds + aiSeconds,
    needsAi,
    action,
  };
}

// ---------------------------------------------------------------------------
// Stage 2 — obtain the script
// ---------------------------------------------------------------------------

/**
 * Returns the script row to speak, creating it if necessary.
 * NEVER mutates an existing script of a different source.
 */
async function resolveScript({ job, chapter, log, control, onProgress }) {
  const { language, translation_style: style, script_source: source } = job;

  // --- Pinned to one exact script (action: 'audio') ------------------------
  // "Generate audio from THIS script" must never silently re-run the AI and
  // speak something the user never saw. If the pinned row is missing or does
  // not belong to this chapter, that is an error, not a reason to guess.
  if (job.script_id) {
    const pinned = db.getScriptById(job.script_id);
    if (!pinned) {
      throw new Error('The script chosen for this audio no longer exists. Pick a script again.');
    }
    if (pinned.chapter_id !== chapter.id) {
      throw new Error('The chosen script belongs to a different chapter.');
    }
    log.info(`Speaking a specific saved script (${pinned.source}) — no AI, no re-translation.`, {
      chapterIndex: chapter.chapter_index, stage: 'script',
    });
    return pinned;
  }

  // --- Original English: no AI, no cost ------------------------------------
  if (language === 'en' || source === 'original') {
    log.info('Using the original English text — no AI translation needed.', {
      chapterIndex: chapter.chapter_index, stage: 'script',
    });

    const existing = db.getScriptsByChapterId(chapter.id)
      .find((s) => s.source === 'original' && s.language === 'en');
    if (existing) return existing;

    return db.createScript({
      id: uuidv4(),
      bookId: job.book_id,
      chapterId: chapter.id,
      source: 'original',
      language: 'en',
      scriptKind: 'latin',
      style: 'original',
      provider: 'none',
      content: chapter.text_content,
      spokenContent: chapter.text_content,
      tokenCount: 0,
    });
  }

  // --- Custom script: spoken verbatim --------------------------------------
  if (source === 'custom') {
    const custom = db.getCustomScript(chapter.id);
    if (!custom || !custom.content?.trim()) {
      throw new Error(
        'You chose "My script" but no custom script is saved for this chapter. ' +
        'Open the chapter, go to the Edit tab, paste your text and save it first.'
      );
    }

    const kind = detectScript(custom.content);
    log.info(
      `Using YOUR saved script verbatim — no AI involved. ` +
      `${custom.content.length} characters, detected as ${kind}.`,
      { chapterIndex: chapter.chapter_index, stage: 'script' }
    );

    const check = prepareForTts(custom.content, { language });
    if (check.severity === 'warn') {
      log.warn(check.note, { chapterIndex: chapter.chapter_index, stage: 'script' });
    }
    if (!check.ok) throw new Error(check.note);

    return custom;
  }

  // --- AI retelling ---------------------------------------------------------
  const styleDef = getStyle(style);
  const glossary = job.use_glossary ? db.getGlossary(job.book_id) : [];

  log.info(
    `Retelling with AI · style "${styleDef.name}" · ${glossary.length ? `glossary ${glossary.length} terms` : 'no glossary'}`,
    { chapterIndex: chapter.chapter_index, stage: 'script' }
  );

  const result = await retellChapter({
    text: chapter.text_content,
    styleId: style,
    apiKey: job.groq_api_key,
    model: job.groq_model,
    glossary,
    allowGoogleFallback: !!job.allow_google_fallback,
    useAntigravity: source === 'antigravity',
    customPrompt: job.custom_prompt,
    chapterIndex: chapter.chapter_index,
    log,
    // Without this the translator can never be interrupted mid-request: it is
    // fully wired for abort internally (limiter waits, backoff sleeps and the
    // Groq HTTP call all honour it) but was simply never handed a signal, so
    // "Stopping" waited for the in-flight request to finish on its own.
    signal: control.signal,
    onProgress: (p) => {
      if (control.isCancelled() || control.isChapterCancelled(chapter.chapter_index)) {
        throw new CancelledError();
      }
      onProgress?.(p);
    },
  });

  const check = prepareForTts(result.text, { language });
  if (check.severity === 'warn') {
    log.warn(check.note, { chapterIndex: chapter.chapter_index, stage: 'script' });
  }

  return db.createScript({
    id: uuidv4(),
    bookId: job.book_id,
    chapterId: chapter.id,
    source: source === 'antigravity' ? 'antigravity' : source,
    language,
    scriptKind: detectScript(result.text),
    style,
    provider: result.provider,
    model: result.model,
    promptVersion: result.promptVersion || PROMPT_VERSION,
    customPrompt: job.custom_prompt,
    content: result.text,
    spokenContent: check.spoken,
    tokenCount: estimateTokens(result.text),
  });
}

// ---------------------------------------------------------------------------
// Alignment map — what makes real karaoke highlighting possible
// ---------------------------------------------------------------------------

/**
 * Map each sentence of the spoken text to a time range, using the VTT cues
 * produced by edge-tts. Unlike the old proportional guess, this walks cues and
 * sentences together by character length, so it stays accurate across a chapter.
 */
function buildAlignment(spokenText, vttPath, totalDuration) {
  const sentences = splitSentences(spokenText);
  if (!sentences.length) return null;

  let cues = [];
  try {
    if (vttPath && fs.existsSync(vttPath)) {
      cues = parseVtt(fs.readFileSync(vttPath, 'utf8'));
    }
  } catch { /* fall through to proportional */ }

  if (!cues.length) {
    // No subtitles available — distribute by character weight (still better
    // than the old cue-index guess, and honestly flagged as approximate).
    const total = spokenText.length || 1;
    let acc = 0;
    return {
      approximate: true,
      sentences: sentences.map((s) => {
        const start = (acc / total) * totalDuration;
        acc += s.text.length;
        const end = (acc / total) * totalDuration;
        return { i: s.index, s: +start.toFixed(2), e: +end.toFixed(2), p: s.paraIndex };
      }),
    };
  }

  // Walk cues, accumulating their text until it covers each sentence.
  const out = [];
  let cueIdx = 0;
  let carry = '';

  for (const sentence of sentences) {
    const target = normalise(sentence.text);
    const startTime = cues[Math.min(cueIdx, cues.length - 1)].start;
    let covered = carry;

    while (normalise(covered).length < target.length && cueIdx < cues.length) {
      covered += ' ' + cues[cueIdx].text;
      cueIdx++;
    }

    const endTime = cues[Math.min(cueIdx, cues.length - 1)]?.end ?? totalDuration;

    // Anything we over-consumed belongs to the next sentence.
    const normCovered = normalise(covered);
    carry = normCovered.length > target.length ? covered.slice(-(normCovered.length - target.length)) : '';

    out.push({ i: sentence.index, s: +startTime.toFixed(2), e: +endTime.toFixed(2), p: sentence.paraIndex });
  }

  return { approximate: false, sentences: out };
}

function normalise(s) {
  return (s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function parseVtt(text) {
  const cues = [];
  for (const block of text.split(/\n\n+/)) {
    const lines = block.trim().split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
      if (m) {
        const start = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
        const end = +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000;
        const body = lines.slice(i + 1).join(' ').trim();
        if (body) cues.push({ start, end, text: body });
        break;
      }
    }
  }
  return cues;
}

// ---------------------------------------------------------------------------
// One chapter, end to end
// ---------------------------------------------------------------------------

/**
 * Turn a translator progress payload into a sentence a non-technical user can
 * act on. "Waiting" must always say what for and for how long — silence is
 * what makes a working system feel broken.
 */
function describeScriptPhase(p) {
  const where = p.total > 1 ? ` (part ${p.current}/${p.total})` : '';
  switch (p.phase) {
    case 'waiting_quota': {
      if (!p.waitMs) return `Waiting for Groq quota…${where}`;
      const secs = Math.ceil(p.waitMs / 1000);
      const what = {
        tokens_per_minute: 'token',
        requests_per_minute: 'request',
        tokens_per_day: 'daily token',
        requests_per_day: 'daily request',
      }[p.reason] || 'rate';
      return `Paused ${secs}s — Groq ${what} limit${where}. This is normal, it will resume by itself.`;
    }
    case 'requesting': return `Retelling with AI…${where}`;
    case 'backoff': return `Rate limited — retrying in ${Math.ceil((p.waitMs || 0) / 1000)}s${where}`;
    case 'retrying': return `Network hiccup — retrying in ${Math.ceil((p.waitMs || 0) / 1000)}s${where}`;
    case 'failed': return p.message || `Failed${where}`;
    case 'done':
    case 'chunk_done': return `Finished part ${p.current}/${p.total}`;
    default: return `Retelling chunk ${p.current}/${p.total}…`;
  }
}

async function processChapter({ job, chapter, log, control, emit, tracker }) {
  const idx = chapter.chapter_index;
  const bookId = job.book_id;

  const stage = (name, percent, message, extra = {}) => {
    // Recorded for the caller as well as broadcast. When a chapter throws, the
    // stage it reached is the single most useful fact about the failure — it
    // is the difference between "the AI refused" and "the voice could not be
    // synthesised", which need completely different recovery actions.
    if (tracker) tracker.stage = name;
    emit('chapter:progress', {
      chapterIdx: idx, stage: name, stageIndex: STAGES.indexOf(name),
      percent, message, ...extra,
    });
  };

  const checkCancel = () => {
    if (control.isCancelled()) throw new CancelledError('Job cancelled');
    if (control.isChapterCancelled(idx)) throw new CancelledError('Chapter cancelled');
  };

  // ---- 1. PREPARE ---------------------------------------------------------
  checkCancel();
  stage('prepare', 2, 'Preparing…');
  log.info(
    `Chapter ${idx + 1}: "${chapter.title}" · ${chapter.word_count} words · ${chapter.char_count} chars`,
    { chapterIndex: idx, stage: 'prepare' }
  );

  // ---- 2. SCRIPT ----------------------------------------------------------
  checkCancel();
  stage('script', 8, 'Getting the script…');

  const script = await resolveScript({
    job, chapter, log, control,
    onProgress: (p) => {
      // The translator reports far more than a percentage: which chunk, what
      // it is doing right now, and — critically — WHY it is waiting when it is
      // throttled. A bare percentage that freezes for 60s during a rate-limit
      // pause is indistinguishable from a hang, which is what destroyed trust
      // in the old UI.
      stage(
        'script',
        8 + Math.round((p.percent || 0) * 0.42),
        describeScriptPhase(p),
        {
          chunkCurrent: p.current,
          chunkTotal: p.total,
          phase: p.phase,
          waitMs: p.waitMs,
          limit: p.reason,
          model: p.model,
          // A heartbeat means "still alive, nothing changed" — the UI uses it
          // to keep a pulse animation going without moving the bar.
          heartbeat: !!p.heartbeat,
        }
      );
    },
  });

  const spoken = script.spoken_content || script.content;
  if (!spoken?.trim()) throw new Error('The script is empty — nothing to speak.');

  // ---- Text-only stop point ----------------------------------------------
  // Translating is cheap and fast; speaking is neither. Letting the job end
  // here is what makes "convert text only" possible, so a user can judge the
  // AI's retelling — or compare it against their own script — before spending
  // TTS time on it. The script is already persisted, so a later
  // action:'audio' run can speak this exact row by id.
  if (job.action === 'script') {
    stage('index', 100, 'Script ready');
    log.success(
      `Chapter ${idx + 1} script ready — ${script.content.length} characters. No audio was generated.`,
      { chapterIndex: idx, stage: 'index' }
    );
    emit('chapter:complete', {
      chapterIdx: idx, scriptId: script.id, scriptOnly: true,
      source: script.source, charCount: script.content.length,
    });
    return { scriptId: script.id, scriptOnly: true };
  }

  // ---- 3. SYNTH -----------------------------------------------------------
  checkCancel();
  stage('synth', 52, 'Generating audio…');

  const ttsChunks = chunkText(spoken, config.ttsChunkMaxChars, config.ttsChunkMaxBytes || 3500);
  log.info(
    `Synthesising ${ttsChunks.length} chunk(s) with ${voiceLabel(job.voice_id)} (${job.voice_id})`,
    { chapterIndex: idx, stage: 'synth' }
  );

  const audioDir = path.join(config.audioDir, bookId, 'chapters');
  const tag = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const outputPath = path.join(audioDir, `ch${String(idx).padStart(4, '0')}_${tag}.mp3`);

  const synth = await synthesizeChunked(ttsChunks, job.voice_id, outputPath, (p) => {
    checkCancel();
    stage('synth', 52 + Math.round((p?.percent ?? 0) * 0.35), `Synthesising ${p?.current ?? '?'}/${p?.total ?? ttsChunks.length}…`, {
      chunkCurrent: p?.current, chunkTotal: p?.total,
    });
    if (p?.current) log.debug(`TTS chunk ${p.current}/${p.total} done`, { chapterIndex: idx, stage: 'synth' });
  }, control.signal, { rate: job.speaking_rate || 1.0 });

  // ---- 4. STITCH ----------------------------------------------------------
  checkCancel();
  stage('stitch', 90, 'Finalising audio…');
  const duration = await getAudioDuration(outputPath);
  const vttPath = outputPath.replace(/\.mp3$/, '.vtt');

  // ---- 5. INDEX -----------------------------------------------------------
  stage('index', 95, 'Saving…');
  const alignment = buildAlignment(spoken, vttPath, duration);
  if (alignment?.approximate) {
    log.warn('No word-level subtitles were produced — sentence highlighting will be approximate.',
      { chapterIndex: idx, stage: 'index' });
  }

  const styleDef = getStyle(script.style);
  const label = `${getLanguage(job.language)?.name || job.language} · ${voiceLabel(job.voice_id)} · ${styleDef.name}`;

  const audioId = uuidv4();
  const relativePath = path.relative(config.audioDir, synth.filePath);
  
  db.createAudioFile({
    id: audioId,
    bookId,
    chapterId: chapter.id,
    chapterIndex: idx,
    language: job.language,
    voiceId: job.voice_id,
    ttsProvider: 'edge-tts',
    filePath: relativePath,
    durationSeconds: duration,
    fileSizeBytes: synth.fileSize,
    isMerged: false,
    translationStyle: script.style,
    groqModel: script.model,
    scriptId: script.id,
    label,
    alignmentJson: alignment ? JSON.stringify(alignment) : null,
    speakingRate: job.speaking_rate || 1.0,
    providerStatus: script.provider === 'google' ? 'google_fallback'
      : script.source === 'custom' ? 'custom' : 'groq_ok',
  });

  db.updateChapter(chapter.id, { status: 'completed', error_message: null });

  stage('index', 100, 'Done');
  log.success(
    `Chapter ${idx + 1} complete — ${formatDuration(duration)} of audio (${(synth.fileSize / 1048576).toFixed(1)} MB)`,
    { chapterIndex: idx, stage: 'index' }
  );

  emit('chapter:complete', {
    chapterIdx: idx, audioId, duration, label,
    scriptId: script.id, filePath: relativePath,
  });

  return { audioId, filePath: relativePath, duration };
}

function formatDuration(s) {
  if (!s) return '0s';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m ? `${m}m ${sec}s` : `${sec}s`;
}

// ---------------------------------------------------------------------------
// The job runner handed to the queue
// ---------------------------------------------------------------------------

export async function runJob(jobId, control) {
  const job = db.getJobById(jobId);
  if (!job) throw new Error('Job not found');

  const book = db.getBookById(job.book_id);
  if (!book) throw new Error('Book not found');

  const bookId = job.book_id;
  const log = logBus.createLogger({ bookId, jobId });
  const emit = (event, payload) => logBus.emit(bookId, event, { jobId, ...payload });

  db.updateJob(jobId, { status: 'processing', started_at: new Date().toISOString() });
  emit('job:started', { total: job.selected_chapters.length });

  const lang = getLanguage(job.language);
  log.info(
    `Starting: ${job.selected_chapters.length} chapter(s) → ${lang?.name || job.language}, ` +
    `voice ${voiceLabel(job.voice_id)}, script source "${job.script_source}"` +
    (job.script_source === 'ai' ? `, style "${getStyle(job.translation_style).name}"` : ''),
    { stage: 'queue' }
  );

  const completed = [...job.completed_chapters];
  const failed = [...(job.failed_chapters || [])];
  const producedPaths = [];
  const startedAt = Date.now();
  const total = job.selected_chapters.length;

  // ---- Chapter workers ----------------------------------------------------
  //
  // Chapters are processed by a small pool rather than one at a time. Both
  // slow stages are network I/O — the Groq call and the edge-tts request —
  // so a sequential loop leaves the process idle waiting on sockets. Groq
  // stays paced by the shared token bucket regardless, so this adds
  // throughput without adding API pressure.
  //
  // A pool, not Promise.all: a 500-chapter selection must not open 500
  // sockets, and failures have to stay per-chapter.
  const settings = getSettings();
  const workers = effectiveChapterConcurrency(settings, total);
  if (workers > 1) {
    log.info(`Converting up to ${workers} chapters at a time.`, { stage: 'queue' });
  }

  let cursor = 0;         // next index into selected_chapters to claim
  let done = 0;           // finished, for progress/ETA
  let jobCancelled = false;

  const runOne = async (idx) => {
    if (control.isChapterCancelled(idx)) {
      log.warn(`Skipping chapter ${idx + 1} — cancelled by user.`, { chapterIndex: idx, stage: 'queue' });
      emit('chapter:cancelled', { chapterIdx: idx });
      return;
    }

    // Resumability: skip work that already exists.
    if (completed.includes(idx)) {
      const chapter = db.getChapterByBookAndIndex(bookId, idx);
      const existing = chapter && db.getAudioFileByChapterId(chapter.id);
      if (existing) {
        producedPaths.push(existing.file_path);
        log.info(`Chapter ${idx + 1} already done — skipping.`, { chapterIndex: idx, stage: 'queue' });
        return;
      }
    }

    const chapter = db.getChapterByBookAndIndex(bookId, idx);
    if (!chapter) {
      log.warn(`Chapter ${idx + 1} not found — skipping.`, { chapterIndex: idx, stage: 'queue' });
      return;
    }

    // Mutable so `processChapter` can report how far it got before throwing.
    // A thrown error carries no stage of its own, and wrapping every await in
    // its own try/catch to add one would bury the pipeline in noise.
    const tracker = { stage: 'prepare' };

    try {
      const result = await processChapter({ job, chapter, log, control, emit, tracker });
      producedPaths.push(result.filePath);
      completed.push(idx);
    } catch (err) {
      // `instanceof CancelledError` alone missed the translator's
      // `code:'CANCELLED'` and the SDK/subprocess `AbortError`, so a cancelled
      // chapter was recorded as a genuine failure.
      if (isCancellation(err)) {
        if (control.isCancelled()) { jobCancelled = true; return; }
        emit('chapter:cancelled', { chapterIdx: idx });
        return;
      }

      // One chapter failing must never kill the batch.
      failed.push(idx);
      db.updateChapter(chapter.id, { status: 'error', error_message: err.message });
      log.raw(`Chapter ${idx + 1} failed: ${err.message}`, err.stack || String(err), { chapterIndex: idx, stage: tracker.stage });
      // The stage travels with the error so the UI can say "Translation
      // failed" rather than "Failed", and can offer the recovery actions that
      // actually apply to that stage.
      emit('chapter:error', {
        chapterIdx: idx, error: err.message, stage: tracker.stage, retryable: true,
      });
    }
  };

  const worker = async () => {
    while (true) {
      if (control.isCancelled()) { jobCancelled = true; return; }
      const myPos = cursor++;
      if (myPos >= total) return;
      const idx = job.selected_chapters[myPos];

      await runOne(idx);

      // Progress is reported per completed chapter. With several in flight the
      // "current chapter" is whichever finished last, which is the only honest
      // answer a single-slot status line can give.
      done++;
      const elapsed = (Date.now() - startedAt) / 1000;
      const etaSeconds = done > 0 ? Math.round((elapsed / done) * (total - done)) : null;

      db.updateJob(jobId, {
        completed_chapters: completed,
        failed_chapters: failed,
        progress_percent: Math.round((done / total) * 100),
      });

      emit('job:progress', {
        overallPercent: Math.round((done / total) * 100),
        completed: completed.length,
        failed: failed.length,
        total,
        currentChapter: idx,
        etaSeconds,
      });
    }
  };

  await Promise.all(Array.from({ length: workers }, worker));

  if (jobCancelled || control.isCancelled()) {
    db.updateJob(jobId, { status: 'cancelled', completed_chapters: completed, failed_chapters: failed });
    log.warn(`Cancelled. ${completed.length} chapter(s) were finished and kept.`, { stage: 'queue' });
    emit('job:cancelled', { completed: completed.length });
    return;
  }

  // ---- Optional merge -----------------------------------------------------
  // Delegates to the same service the on-demand "build audiobook" endpoint
  // uses, so a merge triggered here and one triggered from the UI can never
  // produce different results.
  if (job.merge_output && producedPaths.length > 1) {
    try {
      log.info(`Merging chapters into one file…`, { stage: 'stitch' });
      const { durationSeconds } = await buildAudiobook(bookId, { language: job.language });
      log.success(`Merged audiobook ready (${formatDuration(durationSeconds)})`, { stage: 'stitch' });
    } catch (err) {
      log.warn(`Merge failed (individual chapters are unaffected): ${err.message}`, { stage: 'stitch' });
    }
  }

  const status = failed.length === 0 ? 'completed' : (completed.length ? 'completed_with_errors' : 'failed');
  db.updateJob(jobId, {
    status,
    progress_percent: 100,
    completed_chapters: completed,
    failed_chapters: failed,
    finished_at: new Date().toISOString(),
  });

  log[failed.length ? 'warn' : 'success'](
    `Finished: ${completed.length} succeeded` + (failed.length ? `, ${failed.length} failed (chapters ${failed.map((f) => f + 1).join(', ')})` : ''),
    { stage: 'queue' }
  );

  emit('job:complete', { completed: completed.length, failed: failed.length, failedChapters: failed, status });
}

/**
 * Filenames must survive non-ASCII titles. The old code replaced every
 * non-alphanumeric character, turning any Hindi title into "________".
 */
function sanitiseFilename(name) {
  const cleaned = (name || 'audiobook')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || 'audiobook';
}
