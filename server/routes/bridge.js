/**
 * ChatGPT Web Automation Bridge Routes.
 *
 * Provides endpoints for the Tampermonkey Userscript running on chatgpt.com
 * to fetch pending chapter texts/prompts and submit retold scripts back to SQLite.
 */
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import * as db from '../models/database.js';
import * as S from './serialize.js';
import { jobQueue } from '../core/queue.js';
import { getSettings } from '../services/settings.js';
import { getStyle, buildRetellingPrompt } from '../services/prompts.js';
import { detectScript, prepareForTts } from '../services/scriptUtils.js';
import { getDefaultVoice } from '../languages/index.js';
import * as logBus from '../services/logBus.js';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Clean model output from ChatGPT web:
 * - Strip markdown wrappers like ``` or ```markdown if the model wrapped the whole chapter
 * - Strip common polite preamble if present (e.g. "Sure! Here is the retold story:")
 */
function cleanChatGptOutput(raw) {
  if (!raw) return '';
  let text = raw.trim();

  // Strip ```markdown ... ``` or ``` ... ```
  const codeBlockMatch = text.match(/^```(?:markdown|text)?\s*([\s\S]*?)\s*```$/i);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }

  // Strip common conversational opening lines
  const lines = text.split('\n');
  const introPatterns = [
    /^(?:sure|here is|here's|certainly|below is|alright|okay)[^:\n]*:/i,
    /^(?:यहाँ|ये रहा|यह रहा)[^:\n]*:/i,
  ];

  if (lines.length > 1 && introPatterns.some((pat) => pat.test(lines[0].trim()))) {
    lines.shift();
    text = lines.join('\n').trim();
  }

  // Strip stray "Edit", "Copy" button labels at beginning or end
  text = text.replace(/^(?:Edit|Copy|Share)\s+/i, '');
  text = text.replace(/(?:Edit|Copy|Share|Read aloud)\s*$/gi, '').trim();

  // Strip trailing follow-up conversational questions
  const followUpRegex = /\n\n(?:Would you like|Shall I|Do you want|Let me know if|आगे क्या|क्या आप|क्या मैं)[^\n]*\??$/gi;
  text = text.replace(followUpRegex, '').trim();

  return text;
}

// ---------------------------------------------------------------------------
// 1. Status & Books list
// ---------------------------------------------------------------------------

router.get('/status', wrap(async (req, res) => {
  const books = db.getAllBooks();
  const settings = getSettings();

  const enrichedBooks = books.map((b) => {
    const chapters = db.getChaptersByBookId(b.id);
    let scriptedCount = 0;
    let audioCount = 0;

    for (const ch of chapters) {
      const scripts = db.getScriptsByChapterId(ch.id);
      if (scripts.some((s) => s.source === 'custom' || s.source === 'ai')) {
        scriptedCount++;
      }
      const audio = db.getAudioVersionsByChapterId(ch.id);
      if (audio.length > 0) audioCount++;
    }

    return {
      id: b.id,
      title: b.title,
      author: b.author,
      coverImage: b.cover_image,
      status: b.status,
      totalChapters: chapters.length,
      scriptedChapters: scriptedCount,
      audioChapters: audioCount,
      unscriptedChapters: Math.max(0, chapters.length - scriptedCount),
    };
  });

  res.json({
    ok: true,
    activeBookId: books[0]?.id || null,
    books: enrichedBooks,
    queue: jobQueue.snapshot(),
    settings: {
      defaultLanguage: settings.defaultLanguage,
      defaultVoice: settings.defaultVoiceHi,
      defaultStyle: settings.defaultStyle,
    },
  });
}));

// ---------------------------------------------------------------------------
// 2. Fetch chapter metadata & progress for a book
// ---------------------------------------------------------------------------

router.get('/book/:id/chapters', wrap(async (req, res) => {
  const book = db.getBookById(req.params.id);
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const chapters = db.getChaptersByBookId(book.id);
  const result = chapters.map((ch) => {
    const scripts = db.getScriptsByChapterId(ch.id);
    const custom = scripts.find((s) => s.source === 'custom');
    const ai = scripts.find((s) => s.source === 'ai');
    const audio = db.getAudioVersionsByChapterId(ch.id);

    return {
      chapterIndex: ch.chapter_index + 1,
      dbIndex: ch.chapter_index,
      title: ch.title,
      wordCount: ch.word_count,
      charCount: ch.char_count,
      hasCustomScript: !!custom,
      hasAiScript: !!ai,
      hasAudio: audio.length > 0,
    };
  });

  res.json({
    ok: true,
    bookId: book.id,
    bookTitle: book.title,
    totalChapters: chapters.length,
    chapters: result,
  });
}));

// ---------------------------------------------------------------------------
// 3. Next chapter to retell (fetches chapter text + formats prompt)
// ---------------------------------------------------------------------------

router.get('/next-chapter', wrap(async (req, res) => {
  let { bookId, chapterIndex, fromChapter, toChapter, styleId, customPrompt, onlyUnscripted, skipIndices } = req.query;
  const isOnlyUnscripted = onlyUnscripted === 'true';
  const fromNum = fromChapter !== undefined && fromChapter !== '' ? parseInt(fromChapter, 10) : null;
  const toNum = toChapter !== undefined && toChapter !== '' ? parseInt(toChapter, 10) : null;
  const skipSet = new Set(
    skipIndices ? String(skipIndices).split(',').map((n) => parseInt(n.trim(), 10)).filter((n) => !isNaN(n)) : []
  );

  // If no bookId provided, pick the most recent book
  if (!bookId) {
    const books = db.getAllBooks();
    if (!books.length) {
      return res.status(404).json({ error: 'No books found in library' });
    }
    bookId = books[0].id;
  }

  const book = db.getBookById(bookId);
  if (!book) return res.status(404).json({ error: 'Book not found' });

  const chapters = db.getChaptersByBookId(book.id);
  if (!chapters.length) {
    return res.status(404).json({ error: 'No chapters in this book' });
  }

  let targetChapter = null;

  if (chapterIndex !== undefined && chapterIndex !== '') {
    const idx = parseInt(chapterIndex, 10);
    // Strict match: 1-based human chapter number first, then fallback to 0-based DB index
    targetChapter = chapters.find((c) => (c.chapter_index + 1) === idx) || chapters.find((c) => c.chapter_index === idx);
    if (!targetChapter) {
      return res.status(404).json({ error: `Chapter ${idx} not found in book` });
    }
  } else {
    // Pick the next chapter in scope range that hasn't been skipped in this session
    for (const ch of chapters) {
      const chNum = ch.chapter_index + 1;

      if (fromNum !== null && chNum < fromNum) continue;
      if (toNum !== null && chNum > toNum) continue;
      if (skipSet.has(chNum)) continue;

      if (isOnlyUnscripted) {
        const custom = db.getCustomScript(ch.id);
        if (!custom || !custom.content?.trim()) {
          targetChapter = ch;
          break;
        }
      } else {
        targetChapter = ch;
        break;
      }
    }
  }

  if (!targetChapter) {
    const rangeMsg = fromNum || toNum 
      ? `in range [${fromNum || 1} - ${toNum || (chapters[chapters.length - 1].chapter_index + 1)}]` 
      : 'in this book';
    return res.json({
      ok: true,
      done: true,
      bookId: book.id,
      bookTitle: book.title,
      totalChapters: chapters.length,
      message: `All chapters ${rangeMsg} have been processed!`,
    });
  }

  // Find the next chapter after targetChapter in scope
  let nextChapter = null;
  for (const ch of chapters) {
    if (ch.chapter_index <= targetChapter.chapter_index) continue;
    const chNum = ch.chapter_index + 1;
    if (fromNum !== null && chNum < fromNum) continue;
    if (toNum !== null && chNum > toNum) continue;
    if (skipSet.has(chNum)) continue;
    nextChapter = ch;
    break;
  }

  // Build the prompt
  let fullPrompt = '';
  const settings = getSettings();
  if (customPrompt && customPrompt.trim()) {
    fullPrompt = `${customPrompt.trim()}\n\n${targetChapter.text_content}`;
  } else if (settings.promptOverride && settings.promptOverride.trim()) {
    fullPrompt = `${settings.promptOverride.trim()}\n\n${targetChapter.text_content}`;
  } else {
    const glossary = db.getGlossary(book.id);
    fullPrompt = buildRetellingPrompt({
      text: targetChapter.text_content,
      styleId: styleId || 'novel',
      glossary,
    });
  }

  // Count remaining chapters in scope
  let remainingCount = 0;
  for (const ch of chapters) {
    const chNum = ch.chapter_index + 1;
    if (fromNum !== null && chNum < fromNum) continue;
    if (toNum !== null && chNum > toNum) continue;
    if (skipSet.has(chNum)) continue;
    remainingCount++;
  }

  const custom = db.getCustomScript(targetChapter.id);
  const hasScript = Boolean(custom && custom.content?.trim());
  const audioVersions = db.getAudioVersionsByChapterId(targetChapter.id);
  const hasAudio = audioVersions.length > 0;

  res.json({
    ok: true,
    done: false,
    bookId: book.id,
    bookTitle: book.title,
    chapterId: targetChapter.id,
    chapterIndex: targetChapter.chapter_index + 1,
    dbIndex: targetChapter.chapter_index,
    chapterTitle: targetChapter.title,
    totalChapters: chapters.length,
    remainingCount,
    hasScript,
    hasAudio,
    nextChapterIndex: nextChapter ? (nextChapter.chapter_index + 1) : null,
    nextChapterTitle: nextChapter ? nextChapter.title : null,
    wordCount: targetChapter.word_count,
    charCount: targetChapter.char_count,
    prompt: fullPrompt,
    rawText: targetChapter.text_content,
  });
}));

// ---------------------------------------------------------------------------
// 4. Submit retold chapter from ChatGPT
// ---------------------------------------------------------------------------

router.post('/submit-chapter', wrap(async (req, res) => {
  const { bookId, chapterId, chapterIndex, content, autoAudio, voiceId, language, speakingRate } = req.body;

  if (!bookId) return res.status(400).json({ error: 'bookId is required' });
  if (chapterIndex === undefined || chapterIndex === null) {
    return res.status(400).json({ error: 'chapterIndex is required' });
  }
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'content is empty' });
  }

  const book = db.getBookById(bookId);
  if (!book) return res.status(404).json({ error: 'Book not found' });

  let chapter = null;
  if (chapterId) {
    chapter = db.getChapterById(chapterId);
  }
  if (!chapter && chapterIndex !== undefined && chapterIndex !== null) {
    const idx = Number(chapterIndex);
    chapter = db.getChapterByBookAndIndex(book.id, idx - 1) || db.getChapterByBookAndIndex(book.id, idx);
  }
  if (!chapter) return res.status(404).json({ error: `Chapter ${chapterIndex} not found` });

  const cleaned = cleanChatGptOutput(content);
  const lang = language || 'hi';
  const kind = detectScript(cleaned);
  const check = prepareForTts(cleaned, { language: lang });

  // Save as a new script version unless explicitly requested to overwrite
  const isNewVersion = req.body.overwrite !== true;
  const scriptPayload = {
    id: uuidv4(),
    bookId: book.id,
    chapterId: chapter.id,
    content: cleaned,
    scriptKind: kind,
    spokenContent: check.spoken,
    language: lang,
  };

  const saved = isNewVersion ? db.addCustomScript(scriptPayload) : db.upsertCustomScript(scriptPayload);

  // Log to job_logs bus so UI console and notifications show the save
  logBus.log({
    bookId: book.id,
    level: 'success',
    stage: 'script',
    chapterIndex: chapter.chapter_index,
    message: `Chapter ${chapter.chapter_index}: retold script saved from ChatGPT (${cleaned.length} chars).`,
  });

  // Broadcast to realtime Socket.IO clients if io is available
  const io = req.app.get('io');
  if (io) {
    io.to('global').emit('chapter:custom_script', {
      bookId: book.id,
      chapterId: chapter.id,
      chapterIndex: chapter.chapter_index,
      chapterIdx: chapter.chapter_index,
      scriptId: saved.id,
    });
    io.to(`book:${book.id}`).emit('chapter:updated', {
      bookId: book.id,
      chapterIndex: chapter.chapter_index,
      chapterIdx: chapter.chapter_index,
      hasCustomScript: true,
    });
    io.to('global').emit('bridge:status_updated', {
      bookId: book.id,
      chapterIndex: chapter.chapter_index,
      chapterIdx: chapter.chapter_index,
    });
  }

  let audioJobId = null;

  // If autoAudio is enabled, automatically enqueue TTS for this chapter
  if (autoAudio === true || autoAudio === 'true') {
    const settings = getSettings();
    const effectiveVoice = voiceId || getDefaultVoice(lang);
    const effectiveRate = Number(speakingRate) || settings.speakingRate || 1.0;

    audioJobId = uuidv4();
    db.createJob({
      id: audioJobId,
      bookId: book.id,
      selectedChapters: [chapter.chapter_index],
      language: lang,
      voiceId: effectiveVoice,
      ttsProvider: 'edge-tts',
      groqApiKey: null,
      groqModel: null,
      translationStyle: 'custom',
      scriptSource: 'custom',
      customPrompt: null,
      speakingRate: effectiveRate,
      useGlossary: false,
      allowGoogleFallback: false,
      mergeOutput: false,
      action: 'audio',
      scriptId: saved.id,
    });

    jobQueue.enqueue({ jobId: audioJobId, bookId: book.id });

    logBus.log({
      bookId: book.id,
      level: 'info',
      stage: 'synth',
      chapterIndex: chapter.chapter_index,
      message: `Chapter ${chapter.chapter_index}: Audio generation enqueued automatically.`,
    });
  }

  res.json({
    ok: true,
    bookId: book.id,
    chapterIndex: chapter.chapter_index,
    scriptId: saved.id,
    audioJobId,
    message: `Chapter ${chapter.chapter_index} saved successfully!`,
  });
}));

// ---------------------------------------------------------------------------
// 5. Serve Userscript dynamically with configured host/origin
// ---------------------------------------------------------------------------

router.get('/userscript.user.js', (req, res) => {
  let userscriptPath = path.join(__dirname, '../../public/chatgpt-audiobook-bridge.user.js');
  if (!fs.existsSync(userscriptPath)) {
    userscriptPath = path.join(__dirname, '../../dist/chatgpt-audiobook-bridge.user.js');
  }

  if (!fs.existsSync(userscriptPath)) {
    return res.status(404).send('// Userscript file not found on server');
  }

  let code = fs.readFileSync(userscriptPath, 'utf8');

  // Determine current host from incoming request
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const serverUrl = `${proto}://${host}`;

  // Replace default SERVER_URL placeholder with the actual current host URL
  code = code.replace(/const DEFAULT_SERVER_URL = '[^']*';/, `const DEFAULT_SERVER_URL = '${serverUrl}';`);

  res.setHeader('Content-Type', 'text/javascript; charset=UTF-8');
  res.setHeader('Content-Disposition', 'inline; filename="chatgpt-audiobook-bridge.user.js"');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(code);
});

export default router;
