/**
 * Whole-book audiobook assembly.
 *
 * Previously merging could only happen as a side effect of a conversion job
 * (`mergeOutput`, which defaults to false). If you didn't opt in up front —
 * and nothing in the UI let you — the "Download Complete Audiobook" button had
 * nothing to download, ever.
 *
 * Merging is really a separate concern from converting: you decide you want a
 * single file *after* hearing the chapters. So it lives here and can be called
 * on demand, or by the pipeline at the end of a job.
 */
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import * as db from '../models/database.js';
import config from '../config/index.js';
import { mergeAudioFiles, getAudioDuration } from './ttsEngine.js';
import logger from '../utils/logger.js';

/** Strip characters that are illegal in filenames, but keep Devanagari etc. */
function sanitiseFilename(name) {
  return (name || 'audiobook').replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').trim() || 'audiobook';
}

/**
 * Pick exactly one audio version per chapter, in reading order.
 *
 * A chapter may have several coexisting versions (different language, voice or
 * style). Blindly concatenating all of them would produce a book that repeats
 * chapters in different voices, so we choose deliberately.
 */
export function planMerge(bookId, { language, preferAudioIds = [] } = {}) {
  const chapters = db.getChaptersByBookId(bookId);
  const all = db.getChapterAudioFiles(bookId); // newest-first, excludes merged

  const chosen = [];
  const skipped = [];

  for (const chapter of chapters) {
    let versions = all.filter((a) => a.chapter_id === chapter.id);
    if (language) versions = versions.filter((a) => a.language === language);

    if (!versions.length) {
      skipped.push({ chapterIndex: chapter.chapter_index, title: chapter.title });
      continue;
    }

    // Explicit user choice wins, otherwise the most recent version.
    const pinned = versions.find((a) => preferAudioIds.includes(a.id));
    chosen.push(pinned || versions[0]);
  }

  return { chosen, skipped, totalChapters: chapters.length };
}

/**
 * Build (or rebuild) the single-file audiobook for a book.
 * Returns the created audio_files row.
 */
export async function buildAudiobook(bookId, { language, preferAudioIds } = {}) {
  const book = db.getBookById(bookId);
  if (!book) throw new Error('Book not found');

  const { chosen, skipped, totalChapters } = planMerge(bookId, { language, preferAudioIds });

  if (!chosen.length) {
    throw new Error('No chapter audio exists yet. Convert some chapters first.');
  }

  const resolvePath = (p) => path.resolve(config.audioDir, p);

  const missing = chosen.filter((a) => !fs.existsSync(resolvePath(a.file_path)));
  if (missing.length) {
    throw new Error(
      `${missing.length} audio file(s) are recorded in the database but missing from disk. ` +
      'Re-convert those chapters, then try again.'
    );
  }

  const lang = language || chosen[0].language;
  const outPath = path.join(
    config.audioDir, bookId, 'complete',
    `${sanitiseFilename(book.title)}_${lang}.mp3`
  );

  logger.info('Building complete audiobook', {
    bookId, chapters: chosen.length, skipped: skipped.length,
  });

  const merged = await mergeAudioFiles(chosen.map((a) => resolvePath(a.file_path)), outPath);
  const duration = await getAudioDuration(outPath);

  // Only one "complete" file is kept per book, so repeated merges replace the
  // previous one instead of silently piling up multi-hundred-MB files.
  const previous = db.getMergedAudioFile(bookId);
  if (previous) {
    if (resolvePath(previous.file_path) !== path.resolve(merged.filePath)) {
      try { fs.rmSync(resolvePath(previous.file_path), { force: true }); } catch { /* already gone */ }
    }
    db.deleteAudioFileById(previous.id);
  }

  const relativeMergedPath = path.relative(config.audioDir, merged.filePath);

  const row = db.createAudioFile({
    id: uuidv4(),
    bookId,
    chapterId: null,
    chapterIndex: null,
    language: lang,
    voiceId: chosen[0].voice_id,
    ttsProvider: 'edge-tts',
    filePath: relativeMergedPath,
    durationSeconds: duration,
    fileSizeBytes: merged.fileSize,
    isMerged: true,
    translationStyle: chosen[0].translation_style,
    label: `Complete book · ${chosen.length} chapters`,
  });

  return { audio: row, includedChapters: chosen.length, skipped, totalChapters, durationSeconds: duration };
}
