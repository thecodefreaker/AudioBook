/**
 * Book routes.
 *
 * Rewritten against the new core. The important differences from the old file:
 *
 *   • Conversion ENQUEUES a job instead of firing processJob() from the request
 *     handler, so clicking Convert on 10 chapters no longer starts 10 parallel
 *     Groq streams and blows the token budget.
 *   • The API key comes from Settings, not from the request body.
 *   • Scripts live in their own endpoints — saving a custom script can never be
 *     clobbered by an AI run, and the UI can list every version.
 *   • /estimate exists, so the UI can warn BEFORE a 5,000-chapter run.
 *   • Duplicate uploads are detected by content hash.
 *   • Every response is serialized in one place (./serialize.js).
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';

import { upload } from '../middleware/upload.js';
import * as db from '../models/database.js';
import * as S from './serialize.js';
import { parseEpub } from '../services/epubParser.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { hashFile } from '../utils/hash.js';
import * as logBus from '../services/logBus.js';
import { jobQueue } from '../core/queue.js';
import { estimateWork } from '../core/pipeline.js';
import { getSettings, resolveApiKey } from '../services/settings.js';
import { runPreflight } from '../services/preflight.js';
import { getLanguage, isValidVoice, getDefaultVoice } from '../languages/index.js';
import { getStyle } from '../services/prompts.js';
import { detectScript, prepareForTts, splitParagraphs } from '../services/scriptUtils.js';
import { buildAudiobook, planMerge } from '../services/audiobook.js';

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Reject a conversion request AND record why.
 *
 * Previously a rejected /convert returned an HTTP error and wrote nothing to
 * `job_logs`, so the log console stayed empty and the user had no idea what
 * went wrong. Every refusal is now a first-class log line for that book.
 */
function refuse(res, bookId, status, error, message, extra = {}) {
  logBus.log({
    bookId,
    level: status >= 500 ? 'error' : 'warn',
    stage: 'queue',
    message: `Conversion not started — ${message}`,
    detail: Object.keys(extra).length ? extra : null,
  });
  return res.status(status).json({ error, message, ...extra });
}

/** 404 in one line, with a message a human can act on. */
function need(res, value, what) {
  if (!value) {
    res.status(404).json({ error: `${what} not found` });
    return null;
  }
  return value;
}

// ===========================================================================
// Upload & library
// ===========================================================================

router.post('/upload', upload.single('epub'), wrap(async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded', message: 'Please select an EPUB file.' });
  }

  const bookId = req.bookId;
  const epubPath = req.file.path;
  const io = req.app.get('io');

  // ---- Duplicate detection -------------------------------------------------
  let contentHash = null;
  try {
    contentHash = await hashFile(epubPath);
    const existing = db.getBookByHash(contentHash);
    if (existing && req.body.force !== 'true') {
      fs.unlinkSync(epubPath); // don't keep a second copy of the same file
      return res.status(409).json({
        error: 'duplicate',
        message: `"${existing.title}" is already in your library.`,
        existingBook: S.book(existing),
      });
    }
  } catch (err) {
    logger.warn('Could not hash upload', { error: err.message });
  }

  const title = req.file.originalname.replace(/\.epub$/i, '');
  db.createBook({ id: bookId, title, author: 'Unknown', coverImage: null, epubPath });
  db.updateBook(bookId, {
    content_hash: contentHash,
    file_size_bytes: req.file.size || 0,
    status: 'parsing',
  });

  logBus.log({
    bookId, level: 'info', stage: 'system',
    message: `Uploaded "${title}" (${(req.file.size / 1048576).toFixed(1)} MB). Parsing…`,
  });

  parseEpub(bookId, epubPath, (progress) => {
    io?.to(`book:${bookId}`).emit('book:parsing', { bookId, ...progress });
  })
    .then((result) => {
      logBus.log({
        bookId, level: 'success', stage: 'system',
        message: `Parsed ${result.chapters?.length ?? 0} chapters.`,
      });
      io?.to(`book:${bookId}`).emit('book:parsed', {
        bookId, metadata: result.metadata, chapters: result.chapters,
      });
    })
    .catch((err) => {
      logger.error('EPUB parsing failed', { bookId, error: err.message });
      db.updateBook(bookId, { status: 'error' });
      logBus.log({ bookId, level: 'error', stage: 'system', message: `Parsing failed: ${err.message}`, detail: err.stack });
      io?.to(`book:${bookId}`).emit('book:error', { bookId, error: err.message });
    });

  res.status(202).json({ bookId, message: 'EPUB uploaded. Parsing in progress…', fileName: req.file.originalname });
}));

router.get('/', (req, res) => {
  const books = db.getAllBooks().map((b) => {
    const stats = db.getBookStats(b.id);
    return S.book(b, {
      chaptersWithAudio: stats.chapters_with_audio,
      totalVersions: stats.total_versions,
      totalDuration: stats.total_duration,
      totalBytes: stats.total_bytes,
    });
  });
  res.json({ books });
});

router.get('/:id', (req, res) => {
  const book = db.getBookById(req.params.id);
  if (!need(res, book, 'Book')) return;

  db.updateBook(book.id, { last_opened_at: new Date().toISOString() });

  const rollup = Object.fromEntries(db.getChapterRollup(book.id).map((r) => [r.chapterIndex, r]));
  const chapters = db.getChaptersByBookId(book.id).map((c) => S.chapter(c, rollup[c.chapter_index] || {}));

  res.json({
    book: S.book(book),
    chapters,
    audioFiles: db.getAudioFilesByBookId(book.id).map(S.audio),
    stats: db.getBookStats(book.id),
    activeJobs: db.getActiveJobs()
      .filter((j) => j.book_id === book.id)
      .map((j) => S.job(j, jobQueue.status(j.id))),
  });
});

router.get('/:id/chapters', (req, res) => {
  const book = db.getBookById(req.params.id);
  if (!need(res, book, 'Book')) return;

  const rollup = Object.fromEntries(db.getChapterRollup(book.id).map((r) => [r.chapterIndex, r]));
  res.json({
    chapters: db.getChaptersByBookId(book.id).map((c) => S.chapter(c, rollup[c.chapter_index] || {})),
  });
});

/**
 * The complete-audiobook file, plus whether one can be built right now.
 *
 * The UI needs this to answer "can I download the whole book?" without
 * guessing: merging used to be an opt-in flag on conversion, so most books
 * never had a merged file at all.
 */
router.get('/:id/audiobook', (req, res) => {
  const book = db.getBookById(req.params.id);
  if (!need(res, book, 'Book')) return;

  const merged = db.getMergedAudioFile(book.id);
  const { chosen, skipped, totalChapters } = planMerge(book.id, { language: req.query.language });

  res.json({
    audiobook: merged ? S.audio(merged) : null,
    // Is the merged file older than the newest chapter audio it was built from?
    stale: Boolean(merged && chosen.some((c) => c.created_at > merged.created_at)),
    canBuild: chosen.length > 0,
    readyChapters: chosen.length,
    totalChapters,
    missingChapters: skipped,
  });
});

/** Build (or rebuild) the single-file audiobook on demand. */
router.post('/:id/audiobook', async (req, res, next) => {
  const book = db.getBookById(req.params.id);
  if (!need(res, book, 'Book')) return;

  const preflight = await runPreflight();
  const ff = preflight.checks.find((c) => c.id === 'ffmpeg');
  if (ff && !ff.ok) {
    return refuse(res, book.id, 503, 'FFmpeg unavailable',
      `joining chapters needs FFmpeg. Fix: ${ff.fix}`);
  }

  try {
    const result = await buildAudiobook(book.id, {
      language: req.body?.language,
      preferAudioIds: req.body?.preferAudioIds,
    });
    res.json({
      audiobook: S.audio(result.audio),
      includedChapters: result.includedChapters,
      totalChapters: result.totalChapters,
      skipped: result.skipped,
      durationSeconds: result.durationSeconds,
    });
  } catch (err) {
    return refuse(res, book.id, 400, 'Could not build audiobook', err.message);
  }
});

router.delete('/:id', (req, res) => {
  const book = db.getBookById(req.params.id);
  if (!need(res, book, 'Book')) return;

  jobQueue.cancelBook(book.id, 'Book deleted');

  if (book.epub_path && fs.existsSync(book.epub_path)) {
    try { fs.unlinkSync(book.epub_path); } catch { /* already gone */ }
  }
  const audioDir = path.join(config.audioDir, book.id);
  if (fs.existsSync(audioDir)) {
    try { fs.rmSync(audioDir, { recursive: true, force: true }); } catch { /* locked */ }
  }

  db.deleteBook(book.id);
  res.json({ message: 'Book deleted successfully' });
});

// ===========================================================================
// Chapter content & scripts
// ===========================================================================

router.get('/:id/chapters/:idx/content', (req, res) => {
  const chapter = db.getChapterByBookAndIndex(req.params.id, Number(req.params.idx));
  if (!need(res, chapter, 'Chapter')) return;

  const scripts = db.getScriptsByChapterId(chapter.id);

  // The reader shows AI and custom scripts in SEPARATE tabs, so they must be
  // returned separately. A single `translatedContent` field that preferred the
  // custom script meant the "AI script" tab could display the user's own text —
  // which silently defeats the whole point of comparing the two.
  const aiScript = scripts.find((s) => s.source === 'ai') || null;
  const customScript = scripts.find((s) => s.source === 'custom') || null;

  // Kept for older callers that still expect one blended field. Custom wins
  // here because that was the historical behaviour; new UI should read
  // `aiContent` / `customContent` instead.
  const preferred = customScript || aiScript;

  res.json({
    id: chapter.id,
    chapterIndex: chapter.chapter_index,
    title: chapter.title,
    textContent: chapter.text_content,
    paragraphs: splitParagraphs(chapter.text_content || ''),
    wordCount: chapter.word_count,
    charCount: chapter.char_count,
    // Each source, named honestly, with the script row that produced it so the
    // UI can offer "generate audio from this exact script".
    aiContent: aiScript?.content || '',
    aiScript: aiScript ? S.scriptMeta(aiScript) : null,
    customContent: customScript?.content || '',
    customScript: customScript ? S.scriptMeta(customScript) : null,
    /** @deprecated use aiContent / customContent */
    translatedContent: preferred?.content || '',
    activeScript: preferred ? S.scriptMeta(preferred) : null,
    hasCustomScript: !!customScript,
    scripts: scripts.map(S.scriptMeta),
    audioVersions: db.getAudioVersionsByChapterId(chapter.id).map(S.audio),
  });
});

/** Every script version for a chapter (metadata only — bodies are fetched on demand). */
router.get('/:id/chapters/:idx/scripts', (req, res) => {
  const chapter = db.getChapterByBookAndIndex(req.params.id, Number(req.params.idx));
  if (!need(res, chapter, 'Chapter')) return;
  res.json({ scripts: db.getScriptsByChapterId(chapter.id).map(S.scriptMeta) });
});

router.get('/:id/scripts/:scriptId', (req, res) => {
  const script = db.getScriptById(req.params.scriptId);
  if (!need(res, script, 'Script')) return;
  res.json({ script: S.script(script) });
});

/**
 * Save the user's own script. Stored as source='custom' in its own row, so an
 * AI run can never overwrite it — the bug that used to destroy hand-edited text.
 */
router.put('/:id/chapters/:idx/script', (req, res) => {
  const chapter = db.getChapterByBookAndIndex(req.params.id, Number(req.params.idx));
  if (!need(res, chapter, 'Chapter')) return;

  const content = (req.body?.content ?? '').toString();
  if (!content.trim()) {
    return res.status(400).json({ error: 'Script is empty', message: 'Paste some text before saving.' });
  }

  const kind = detectScript(content);
  const check = prepareForTts(content, { language: req.body?.language || 'hi' });

  const saved = db.upsertCustomScript({
    id: uuidv4(),
    bookId: req.params.id,
    chapterId: chapter.id,
    content,
    scriptKind: kind,
    spokenContent: check.spoken,
  });

  res.json({
    script: S.script(saved),
    check: { detected: kind, ok: check.ok, severity: check.severity, note: check.note },
  });
});

router.delete('/:id/scripts/:scriptId', (req, res) => {
  const script = db.getScriptById(req.params.scriptId);
  if (!need(res, script, 'Script')) return;
  db.deleteScriptById(script.id);
  res.json({ success: true });
});

/** Advisory check used live by the editor: "this is exactly what will be spoken". */
router.post('/:id/check-script', (req, res) => {
  const text = (req.body?.content || '').toString();
  const check = prepareForTts(text, { language: req.body?.language || 'hi' });
  res.json({
    detected: check.detected,
    ok: check.ok,
    severity: check.severity,
    note: check.note,
    charCount: text.length,
    wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
  });
});

// ===========================================================================
// Glossary
// ===========================================================================

router.get('/:id/glossary', (req, res) => {
  res.json({ glossary: db.getGlossary(req.params.id).map(S.glossaryTerm) });
});

router.post('/:id/glossary', (req, res) => {
  const term = (req.body?.term || '').trim();
  if (!term) return res.status(400).json({ error: 'Term is required' });

  db.upsertGlossaryTerm({
    id: uuidv4(),
    bookId: req.params.id,
    term,
    keepAs: (req.body?.keepAs || term).trim(),
    note: req.body?.note || null,
    auto: false,
  });
  res.json({ glossary: db.getGlossary(req.params.id).map(S.glossaryTerm) });
});

router.delete('/:id/glossary/:termId', (req, res) => {
  db.deleteGlossaryTerm(req.params.termId);
  res.json({ glossary: db.getGlossary(req.params.id).map(S.glossaryTerm) });
});

// ===========================================================================
// Logs
// ===========================================================================

router.get('/:id/logs', (req, res) => {
  const { chapterIndex, jobId, level, search, limit, afterId } = req.query;
  const rows = db.getLogs({
    bookId: req.params.id,
    chapterIndex: chapterIndex === undefined || chapterIndex === '' ? undefined : Number(chapterIndex),
    jobId: jobId || undefined,
    level: level || undefined,
    search: search || undefined,
    limit: limit ? Number(limit) : 500,
    afterId: afterId ? Number(afterId) : 0,
  });
  res.json({ logs: rows.map(S.logLine) });
});

router.delete('/:id/logs', (req, res) => {
  db.clearLogs(req.params.id);
  res.json({ success: true });
});

// ===========================================================================
// Estimate & convert
// ===========================================================================

/** What will this cost me, before I commit? */
router.post('/:id/estimate', (req, res) => {
  const book = db.getBookById(req.params.id);
  if (!need(res, book, 'Book')) return;

  const settings = getSettings();
  const chapterIndexes = normaliseChapterList(req.body?.selectedChapters, book.id);
  const language = req.body?.language || settings.defaultLanguage;
  const scriptSource = req.body?.scriptSource || settings.defaultScriptSource;
  const action = req.body?.action || 'both';

  const estimate = estimateWork({ bookId: book.id, chapterIndexes, language, scriptSource, action });

  const warnings = [];
  if (estimate.chapters > 200) {
    warnings.push(
      `That is ${estimate.chapters} chapters. Expect roughly ${formatEta(estimate.estimatedSeconds)} ` +
      'of processing — you can leave it queued and come back later.'
    );
  }
  if (estimate.needsAi && !resolveApiKey()) {
    warnings.push('No Groq API key is saved. Add one in Settings, or pick "Original English" which needs no AI.');
  }
  if (estimate.needsAi && estimate.estimatedTokens > settings.tokensPerMinute * 60) {
    warnings.push('This needs more than an hour of AI token budget at your current rate limit.');
  }

  res.json({ estimate: { ...estimate, etaText: formatEta(estimate.estimatedSeconds) }, warnings });
});

router.post('/:id/convert', wrap(async (req, res) => {
  const book = db.getBookById(req.params.id);
  if (!need(res, book, 'Book')) return;

  if (['uploading', 'parsing'].includes(book.status)) {
    return refuse(res, book.id, 409, 'Book is still being parsed',
      'the book is still being parsed. Conversion becomes available as soon as parsing finishes.');
  }

  // ---- Validate the request BEFORE checking the environment ---------------
  // A wrong voice is the user's request; a missing ffmpeg is the machine.
  // Reporting the request problem first is always more actionable.
  const settings = getSettings();
  const selectedChapters = normaliseChapterList(req.body?.selectedChapters, book.id);
  if (!selectedChapters.length) {
    return refuse(res, book.id, 400, 'No chapters selected', 'no chapters were selected.');
  }

  const language = req.body?.language || settings.defaultLanguage;
  const lang = getLanguage(language);
  if (!lang) {
    return refuse(res, book.id, 400, 'Unsupported language',
      `"${language}" is not a language this app can produce yet.`);
  }

  const voiceId = req.body?.voiceId || getDefaultVoice(language);
  if (!isValidVoice(language, voiceId)) {
    return refuse(res, book.id, 400, 'Voice does not match language',
      `"${voiceId}" is not a ${lang.name} voice. Pick one of: ${lang.voices.map((v) => v.name).join(', ')}.`);
  }

  const scriptSource = req.body?.scriptSource || settings.defaultScriptSource;
  if (!['ai', 'custom', 'original'].includes(scriptSource)) {
    return refuse(res, book.id, 400, 'Invalid script source', `"${scriptSource}" is not a valid script source.`);
  }

  // ---- What is this job for? ---------------------------------------------
  //   both   — retell then speak (the default, and every legacy caller)
  //   script — translate only, so the text can be judged before paying for TTS
  //   audio  — speak a script that already exists, named by scriptId
  const action = req.body?.action || 'both';
  if (!['both', 'script', 'audio'].includes(action)) {
    return refuse(res, book.id, 400, 'Invalid action',
      `"${action}" is not a valid action. Use "both", "script" or "audio".`);
  }

  // An audio-only job is pinned to one exact script, which only makes sense
  // for a single chapter — a script id cannot describe twenty of them.
  let scriptId = req.body?.scriptId || null;
  if (action === 'audio') {
    if (!scriptId) {
      return refuse(res, book.id, 400, 'No script chosen',
        'generating audio from an existing script needs that script to be named.');
    }
    if (selectedChapters.length !== 1) {
      return refuse(res, book.id, 400, 'Too many chapters',
        'a specific script belongs to one chapter, so only that chapter can be converted from it.');
    }
    const script = db.getScriptById(scriptId);
    if (!script) {
      return refuse(res, book.id, 404, 'Script not found', 'that script no longer exists.');
    }
    const ch = db.getChapterByBookAndIndex(book.id, selectedChapters[0]);
    if (!ch || script.chapter_id !== ch.id) {
      return refuse(res, book.id, 400, 'Script does not match chapter',
        'that script belongs to a different chapter.');
    }
  } else {
    scriptId = null; // only meaningful for action: 'audio'
  }

  const translationStyle = req.body?.translationStyle || lang.defaultStyle || settings.defaultStyle;
  // An audio-only run speaks an existing script, so it never calls the AI —
  // demanding an API key for it would block the very case that avoids the AI.
  const needsAi = lang.requiresAi && scriptSource === 'ai' && action !== 'audio';
  const apiKey = resolveApiKey(req.body?.groqApiKey);
  const allowGoogleFallback = req.body?.allowGoogleFallback ?? settings.allowGoogleFallback;

  if (needsAi && !apiKey && !allowGoogleFallback) {
    return refuse(res, book.id, 400, 'No API key',
      'retelling in Hindi needs a Groq API key. Add one in Settings, or choose "My script" / "Original English".');
  }

  // ---- Custom scripts must exist, checked UP FRONT ------------------------
  if (scriptSource === 'custom' && action !== 'audio') {
    const missing = selectedChapters.filter((idx) => {
      const ch = db.getChapterByBookAndIndex(book.id, idx);
      const custom = ch && db.getCustomScript(ch.id);
      return !custom || !custom.content?.trim();
    });
    if (missing.length) {
      return refuse(res, book.id, 400, 'Missing custom scripts',
        `you chose "My script" but no script is saved for chapter${missing.length > 1 ? 's' : ''} ${missing.map((i) => i + 1).join(', ')}.`,
        { missingChapters: missing });
    }
  }

  // ---- Now that the request is sound, check the machine can do the work ---
  // A text-only run never touches ffmpeg or edge-tts, so failing it on a
  // missing audio toolchain would block the one action that does not need it.
  if (action !== 'script') {
    const preflight = await runPreflight();
    if (!preflight.ok) {
      const missing = preflight.checks.filter((c) => c.required && !c.ok);
      return refuse(res, book.id, 503, 'Missing dependencies',
        `${missing.map((c) => c.label).join(' and ')} ${missing.length > 1 ? 'are' : 'is'} not installed. ` +
        missing.map((c) => `Fix: ${c.fix}`).join(' '),
        { preflight });
    }
  }

  const jobId = uuidv4();
  db.createJob({
    id: jobId,
    bookId: book.id,
    selectedChapters,
    language,
    voiceId,
    ttsProvider: 'edge-tts',
    groqApiKey: apiKey || null,
    groqModel: req.body?.groqModel || settings.groqModel || null,
    translationStyle,
    scriptSource,
    speakingRate: req.body?.speakingRate ?? settings.speakingRate,
    useGlossary: req.body?.useGlossary ?? settings.useGlossary,
    allowGoogleFallback,
    mergeOutput: req.body?.mergeOutput ?? settings.mergeOutput,
    action,
    scriptId,
  });

  // Remember the choices so the dialog opens pre-filled next time.
  // A one-off text-only or audio-only run is not a change of preference, so
  // it must not rewrite the defaults the next full conversion will use.
  if (action === 'both') {
    db.updateBook(book.id, {
      preset_json: JSON.stringify({ language, voiceId, translationStyle, scriptSource }),
    });
  }

  const status = jobQueue.enqueue({ jobId, bookId: book.id });

  const startedMessage = action === 'script' ? 'Translating text — no audio will be generated.'
    : action === 'audio' ? 'Generating audio from the chosen script.'
    : 'Conversion started.';

  res.status(202).json({
    jobId,
    queue: status,
    message: status.state === 'queued' && status.position > 1
      ? `Queued — ${status.position - 1} job(s) ahead of this one.`
      : startedMessage,
    job: S.job(db.getJobById(jobId), status),
  });
}));

// ===========================================================================
// Job control
// ===========================================================================

router.get('/:id/jobs', (req, res) => {
  res.json({
    jobs: db.getJobsByBookId(req.params.id).map((j) => S.job(j, jobQueue.status(j.id))),
  });
});

router.post('/:id/jobs/:jobId/cancel', (req, res) => {
  const result = jobQueue.cancel(req.params.jobId, req.body?.reason || 'Cancelled by user');
  res.json({
    ...result,
    message: result.wasRunning
      ? 'Stopping after the current step. Finished chapters are kept.'
      : result.cancelled ? 'Removed from the queue.' : 'That job is not running.',
  });
});

/** Cancel a SINGLE chapter without killing the rest of the batch. */
router.post('/:id/jobs/:jobId/chapters/:idx/cancel', (req, res) => {
  const result = jobQueue.cancelChapter(req.params.jobId, Number(req.params.idx));
  res.json({ ...result, message: result.cancelled ? 'Chapter will be skipped.' : 'That job is not running.' });
});

router.post('/:id/cancel', (req, res) => {
  const result = jobQueue.cancelBook(req.params.id, req.body?.reason || 'Cancelled by user');
  res.json({ ...result, message: result.cancelled ? `Cancelling ${result.cancelled} job(s).` : 'Nothing to cancel.' });
});

/** Retry only the chapters that failed, reusing the original job's settings. */
router.post('/:id/jobs/:jobId/retry', (req, res) => {
  const previous = db.getJobById(req.params.jobId);
  if (!need(res, previous, 'Job')) return;

  const targets = req.body?.chapters?.length
    ? req.body.chapters.map(Number)
    : previous.failed_chapters;

  if (!targets.length) {
    return res.status(400).json({ error: 'Nothing to retry', message: 'That job had no failed chapters.' });
  }

  const jobId = uuidv4();
  db.createJob({
    id: jobId,
    bookId: previous.book_id,
    selectedChapters: targets,
    language: previous.language,
    voiceId: previous.voice_id,
    ttsProvider: previous.tts_provider,
    groqApiKey: previous.groq_api_key || resolveApiKey(),
    groqModel: previous.groq_model,
    translationStyle: previous.translation_style,
    scriptSource: previous.script_source,
    speakingRate: previous.speaking_rate,
    useGlossary: previous.use_glossary,
    allowGoogleFallback: previous.allow_google_fallback,
    mergeOutput: false,
    // A retry must reproduce what was originally asked for. Retrying a
    // text-only job into a full conversion would generate audio the user
    // never requested.
    action: previous.action || 'both',
    scriptId: previous.script_id || null,
  });

  const status = jobQueue.enqueue({ jobId, bookId: previous.book_id });
  res.status(202).json({ jobId, queue: status, message: `Retrying ${targets.length} chapter(s).` });
});

// ===========================================================================
// Audio versions for a book
// ===========================================================================

router.get('/:id/audio', (req, res) => {
  res.json({ audioFiles: db.getAudioFilesByBookId(req.params.id).map(S.audio) });
});

// ===========================================================================
// Helpers
// ===========================================================================

/** Accepts an array of indexes, or 'all', and always returns valid indexes. */
function normaliseChapterList(input, bookId) {
  const chapters = db.getChaptersByBookId(bookId);
  const valid = new Set(chapters.map((c) => c.chapter_index));

  if (input === 'all' || input === undefined || input === null) {
    return chapters.map((c) => c.chapter_index);
  }
  if (!Array.isArray(input)) return [];

  return [...new Set(input.map(Number))]
    .filter((i) => Number.isInteger(i) && valid.has(i))
    .sort((a, b) => a - b);
}

function formatEta(seconds) {
  if (!seconds || seconds < 60) return `${Math.max(1, Math.round(seconds || 0))} seconds`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hours}h${rem ? ` ${rem}m` : ''}`;
}

export default router;
