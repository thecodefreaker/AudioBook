import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import config from '../config/index.js';
import logger from '../utils/logger.js';

let db;

/**
 * Initialize the SQLite database with all required tables.
 */
export function initDatabase() {
  // Ensure data directory exists
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

  db = new Database(config.dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT DEFAULT 'Unknown',
      cover_image TEXT,
      epub_path TEXT NOT NULL,
      total_chapters INTEGER DEFAULT 0,
      status TEXT DEFAULT 'uploaded',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      chapter_index INTEGER NOT NULL,
      title TEXT DEFAULT 'Untitled',
      text_content TEXT,
      translated_content TEXT,
      word_count INTEGER DEFAULT 0,
      char_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audio_files (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      chapter_id TEXT,
      language TEXT NOT NULL,
      voice_id TEXT NOT NULL,
      tts_provider TEXT NOT NULL DEFAULT 'edge-tts',
      file_path TEXT NOT NULL,
      duration_seconds REAL DEFAULT 0,
      file_size_bytes INTEGER DEFAULT 0,
      is_merged INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS generation_jobs (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      selected_chapters TEXT NOT NULL,
      language TEXT NOT NULL,
      voice_id TEXT NOT NULL,
      tts_provider TEXT NOT NULL DEFAULT 'edge-tts',
      status TEXT DEFAULT 'queued',
      progress_percent REAL DEFAULT 0,
      completed_chapters TEXT DEFAULT '[]',
      error_log TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    -- ===================================================================
    -- chapter_scripts: every piece of text that has ever been spoken.
    -- Replaces the single overloaded chapters.translated_content column.
    -- An audio_file points at the EXACT script it was generated from, so
    -- badges can never lie and a custom script can never be overwritten.
    -- ===================================================================
    CREATE TABLE IF NOT EXISTS chapter_scripts (
      id             TEXT PRIMARY KEY,
      book_id        TEXT NOT NULL,
      chapter_id     TEXT NOT NULL,
      source         TEXT NOT NULL,            -- 'ai' | 'custom' | 'original'
      language       TEXT NOT NULL,            -- 'en' | 'hi'
      script_kind    TEXT,                     -- 'devanagari' | 'roman_hinglish' | 'latin' | 'mixed'
      style          TEXT,                     -- 'novel' | 'formal' | 'casual' | 'dramatic' | 'kids' | 'custom'
      provider       TEXT,                     -- 'groq' | 'google' | 'none'
      model          TEXT,
      prompt_version TEXT,
      content        TEXT NOT NULL,            -- the retold/pasted text (pre-transliteration)
      spoken_content TEXT,                     -- EXACTLY what was sent to TTS (post-transliteration)
      token_count    INTEGER DEFAULT 0,
      char_count     INTEGER DEFAULT 0,
      created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
    );

    -- ===================================================================
    -- job_logs: persistent, structured, uncensored backend logs.
    -- This is what makes the log terminal survive a page reload.
    -- ===================================================================
    CREATE TABLE IF NOT EXISTS job_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id       TEXT,
      job_id        TEXT,
      chapter_index INTEGER,
      level         TEXT NOT NULL DEFAULT 'info',   -- debug|info|success|warn|error
      stage         TEXT,                            -- prepare|script|synth|stitch|index|system
      message       TEXT NOT NULL,
      detail        TEXT,                            -- raw provider payload, stack, JSON
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- ===================================================================
    -- book_glossary: proper nouns / terms kept identical across chapters.
    -- The single highest-leverage translation-quality feature.
    -- ===================================================================
    CREATE TABLE IF NOT EXISTS book_glossary (
      id         TEXT PRIMARY KEY,
      book_id    TEXT NOT NULL,
      term       TEXT NOT NULL,
      keep_as    TEXT,
      note       TEXT,
      auto       INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
      UNIQUE (book_id, term)
    );

    -- ===================================================================
    -- app_settings: API keys, defaults, prompt overrides (key/value).
    -- ===================================================================
    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_chapters_book_id ON chapters(book_id);
    CREATE INDEX IF NOT EXISTS idx_audio_files_book_id ON audio_files(book_id);
    CREATE INDEX IF NOT EXISTS idx_audio_files_chapter_id ON audio_files(chapter_id);
    CREATE INDEX IF NOT EXISTS idx_generation_jobs_book_id ON generation_jobs(book_id);
    CREATE INDEX IF NOT EXISTS idx_scripts_chapter ON chapter_scripts(chapter_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_scripts_book ON chapter_scripts(book_id);
    CREATE INDEX IF NOT EXISTS idx_logs_book ON job_logs(book_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_logs_chapter ON job_logs(book_id, chapter_index, id DESC);
    CREATE INDEX IF NOT EXISTS idx_glossary_book ON book_glossary(book_id);
  `);

  // ---------------------------------------------------------------
  // Idempotent column migrations (safe to run on every boot)
  // ---------------------------------------------------------------
  const addColumn = (table, ddl) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`);
    } catch (e) { /* column already exists */ }
  };

  addColumn('generation_jobs', 'groq_api_key TEXT');
  addColumn('generation_jobs', 'groq_model TEXT');
  addColumn('generation_jobs', "translation_style TEXT DEFAULT 'novel'");
  addColumn('generation_jobs', "script_source TEXT DEFAULT 'ai'");
  addColumn('generation_jobs', 'speaking_rate REAL DEFAULT 1.0');
  addColumn('generation_jobs', 'total_chapters INTEGER DEFAULT 0');
  addColumn('generation_jobs', 'failed_chapters TEXT');
  addColumn('generation_jobs', 'started_at DATETIME');
  addColumn('generation_jobs', 'finished_at DATETIME');
  addColumn('generation_jobs', 'use_glossary INTEGER DEFAULT 0');
  addColumn('generation_jobs', 'allow_google_fallback INTEGER DEFAULT 0');
  addColumn('generation_jobs', 'merge_output INTEGER DEFAULT 0');
  // What the job is actually for. Until now every job implied SCRIPT→SYNTH,
  // so there was no way to translate a chapter without also paying for TTS,
  // and no way to re-voice an existing script without re-running the AI.
  //   'both'   — retell (if needed) then speak          [legacy behaviour]
  //   'script' — stop after the script is stored
  //   'audio'  — speak an existing script, named by script_id
  // Defaulting to 'both' keeps every pre-existing row and caller correct.
  addColumn('generation_jobs', "action TEXT DEFAULT 'both'");
  // Only meaningful when action = 'audio'. Pins the job to one exact script
  // row, which is what makes "generate audio from THIS script" honest.
  addColumn('generation_jobs', 'script_id TEXT');

  addColumn('audio_files', 'translation_style TEXT');
  addColumn('audio_files', 'groq_model TEXT');
  addColumn('audio_files', 'script_id TEXT');            // ← links audio to its exact script
  addColumn('audio_files', 'label TEXT');
  addColumn('audio_files', 'is_favourite INTEGER DEFAULT 0');
  addColumn('audio_files', 'alignment_json TEXT');       // sentence ↔ timestamp map
  addColumn('audio_files', 'speaking_rate REAL DEFAULT 1.0');
  addColumn('audio_files', 'provider_status TEXT');      // groq_ok | google_fallback | custom | none
  addColumn('audio_files', 'chapter_index INTEGER');

  addColumn('books', 'content_hash TEXT');
  addColumn('books', 'file_size_bytes INTEGER DEFAULT 0');
  addColumn('books', 'last_opened_at DATETIME');
  addColumn('books', 'preset_json TEXT');

  addColumn('chapters', 'is_skipped INTEGER DEFAULT 0');
  addColumn('chapters', 'skip_reason TEXT');

  // ---------------------------------------------------------------
  // One-time backfill: migrate legacy chapters.translated_content
  // into the new chapter_scripts table so no user data is lost.
  // ---------------------------------------------------------------
  try {
    const migrated = db.prepare(`SELECT value FROM app_settings WHERE key = 'migrated_scripts_v1'`).get();
    if (!migrated) {
      const legacy = db.prepare(
        `SELECT id, book_id, translated_content FROM chapters
         WHERE translated_content IS NOT NULL AND TRIM(translated_content) != ''`
      ).all();

      const insert = db.prepare(`
        INSERT INTO chapter_scripts (id, book_id, chapter_id, source, language, script_kind, style, provider, content, char_count)
        VALUES (?, ?, ?, 'ai', 'hi', 'unknown', 'legacy', 'unknown', ?, ?)
      `);

      const run = db.transaction((rows) => {
        for (const row of rows) {
          insert.run(
            randomId(), row.book_id, row.id,
            row.translated_content, row.translated_content.length
          );
        }
      });
      run(legacy);

      db.prepare(`INSERT OR REPLACE INTO app_settings (key, value) VALUES ('migrated_scripts_v1', ?)`)
        .run(new Date().toISOString());

      if (legacy.length) {
        logger.info('Migrated legacy chapter translations into chapter_scripts', { count: legacy.length });
      }
    }
  } catch (err) {
    logger.warn('Script migration skipped', { error: err.message });
  }

  // ---------------------------------------------------------------
  // Self-heal: any job left "processing"/"queued" from a previous
  // process is orphaned — the in-memory queue no longer knows it.
  // Mark it interrupted so the UI can offer Resume (fixes B9).
  // ---------------------------------------------------------------
  try {
    const res = db.prepare(
      `UPDATE generation_jobs SET status = 'interrupted', finished_at = CURRENT_TIMESTAMP
       WHERE status IN ('processing', 'queued')`
    ).run();
    if (res.changes > 0) {
      logger.warn('Recovered orphaned jobs from previous run', { count: res.changes });
    }
    db.prepare(`UPDATE books SET status = 'parsed' WHERE status = 'processing'`).run();
  } catch (err) {
    logger.warn('Job recovery skipped', { error: err.message });
  }

  logger.info('Database initialized successfully');
  return db;
}

/** Small local id helper so this module has no external dependency. */
function randomId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Get the database instance.
 */
export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

// ===========================
// Book Operations
// ===========================

export function createBook({ id, title, author, coverImage, epubPath }) {
  const stmt = getDb().prepare(`
    INSERT INTO books (id, title, author, cover_image, epub_path)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(id, title, author || 'Unknown', coverImage, epubPath);
  return getBookById(id);
}

export function getBookById(id) {
  return getDb().prepare('SELECT * FROM books WHERE id = ?').get(id);
}

export function getAllBooks() {
  return getDb().prepare('SELECT * FROM books ORDER BY created_at DESC').all();
}

export function updateBook(id, updates) {
  const fields = Object.keys(updates)
    .map((key) => `${key} = ?`)
    .join(', ');
  const values = Object.values(updates);
  getDb()
    .prepare(`UPDATE books SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(...values, id);
  return getBookById(id);
}

export function deleteBook(id) {
  getDb().prepare('DELETE FROM books WHERE id = ?').run(id);
}

// ===========================
// Chapter Operations
// ===========================

export function createChapter({ id, bookId, chapterIndex, title, textContent, wordCount, charCount }) {
  const stmt = getDb().prepare(`
    INSERT INTO chapters (id, book_id, chapter_index, title, text_content, word_count, char_count)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(id, bookId, chapterIndex, title, textContent, wordCount, charCount);
}

export function getChaptersByBookId(bookId) {
  return getDb()
    .prepare('SELECT * FROM chapters WHERE book_id = ? ORDER BY chapter_index ASC')
    .all(bookId);
}

export function getChapterById(id) {
  return getDb().prepare('SELECT * FROM chapters WHERE id = ?').get(id);
}

export function getChapterByBookAndIndex(bookId, chapterIndex) {
  return getDb()
    .prepare('SELECT * FROM chapters WHERE book_id = ? AND chapter_index = ?')
    .get(bookId, chapterIndex);
}

export function updateChapter(id, updates) {
  const fields = Object.keys(updates)
    .map((key) => `${key} = ?`)
    .join(', ');
  const values = Object.values(updates);
  getDb()
    .prepare(`UPDATE chapters SET ${fields} WHERE id = ?`)
    .run(...values, id);
}

// ===========================
// Audio File Operations
// ===========================

export function createAudioFile({
  id, bookId, chapterId, chapterIndex, language, voiceId, ttsProvider, filePath,
  durationSeconds, fileSizeBytes, isMerged, translationStyle, groqModel,
  scriptId, label, alignmentJson, speakingRate, providerStatus,
}) {
  const stmt = getDb().prepare(`
    INSERT INTO audio_files (
      id, book_id, chapter_id, chapter_index, language, voice_id, tts_provider, file_path,
      duration_seconds, file_size_bytes, is_merged, translation_style, groq_model,
      script_id, label, alignment_json, speaking_rate, provider_status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id, bookId, chapterId, chapterIndex ?? null, language, voiceId, ttsProvider || 'edge-tts', filePath,
    durationSeconds || 0, fileSizeBytes || 0, isMerged ? 1 : 0, translationStyle || null, groqModel || null,
    scriptId || null, label || null, alignmentJson || null, speakingRate || 1.0, providerStatus || null
  );
  return getAudioFileById(id);
}

/**
 * Audio rows carry a `script_id`, and the script row knows whether it came
 * from the AI, the user's own paste, or the untouched original. Joining it
 * here means every audio version can honestly report *how* it was made,
 * instead of the UI guessing from the translation style.
 */
const AUDIO_SELECT = `
  SELECT a.*,
         s.source     AS script_source,
         s.script_kind AS script_kind,
         s.provider   AS script_provider
    FROM audio_files a
    LEFT JOIN chapter_scripts s ON s.id = a.script_id`;

/** Newest-first, matching the "recent conversion first" requirement. */
export function getAudioFilesByBookId(bookId) {
  return getDb()
    .prepare(`${AUDIO_SELECT} WHERE a.book_id = ? ORDER BY a.created_at DESC`)
    .all(bookId);
}

export function getChapterAudioFiles(bookId) {
  return getDb()
    .prepare(`${AUDIO_SELECT} WHERE a.book_id = ? AND a.is_merged = 0 ORDER BY a.created_at DESC`)
    .all(bookId);
}

export function getMergedAudioFile(bookId) {
  return getDb()
    .prepare(`${AUDIO_SELECT} WHERE a.book_id = ? AND a.is_merged = 1 ORDER BY a.created_at DESC LIMIT 1`)
    .get(bookId);
}

export function updateAudioFile(id, updates) {
  const fields = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  getDb().prepare(`UPDATE audio_files SET ${fields} WHERE id = ?`).run(...Object.values(updates), id);
  return getAudioFileById(id);
}

export function getAudioFileById(id) {
  return getDb().prepare(`${AUDIO_SELECT} WHERE a.id = ?`).get(id);
}

export function getAudioFileByChapterId(chapterId) {
  return getDb()
    .prepare(`${AUDIO_SELECT} WHERE a.chapter_id = ? AND a.is_merged = 0 ORDER BY a.created_at DESC LIMIT 1`)
    .get(chapterId);
}

export function deleteAudioFileById(id) {
  getDb().prepare('DELETE FROM audio_files WHERE id = ?').run(id);
}

/** Every version ever produced for a chapter, newest first. */
export function getAudioVersionsByChapterId(chapterId) {
  return getDb()
    .prepare(`${AUDIO_SELECT} WHERE a.chapter_id = ? AND a.is_merged = 0 ORDER BY a.created_at DESC`)
    .all(chapterId);
}

export function setAudioFavourite(id, isFavourite) {
  getDb().prepare('UPDATE audio_files SET is_favourite = ? WHERE id = ?').run(isFavourite ? 1 : 0, id);
  return getAudioFileById(id);
}

export function deleteAudioFilesByChapterId(chapterId) {
  getDb().prepare('DELETE FROM audio_files WHERE chapter_id = ? AND is_merged = 0').run(chapterId);
}

export function deleteAudioFilesByBookId(bookId) {
  getDb().prepare('DELETE FROM audio_files WHERE book_id = ?').run(bookId);
}

// ===========================
// Generation Job Operations
// ===========================

export function createJob({
  id, bookId, selectedChapters, language, voiceId, ttsProvider, groqApiKey, groqModel,
  translationStyle, scriptSource, speakingRate, useGlossary, allowGoogleFallback, mergeOutput,
  action, scriptId,
}) {
  const stmt = getDb().prepare(`
    INSERT INTO generation_jobs (
      id, book_id, selected_chapters, language, voice_id, tts_provider,
      groq_api_key, groq_model, translation_style, script_source, speaking_rate, total_chapters,
      use_glossary, allow_google_fallback, merge_output, action, script_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id, bookId, JSON.stringify(selectedChapters), language, voiceId, ttsProvider || 'edge-tts',
    groqApiKey || null, groqModel || null, translationStyle || 'novel',
    scriptSource || 'ai', speakingRate || 1.0, selectedChapters.length,
    useGlossary ? 1 : 0, allowGoogleFallback ? 1 : 0, mergeOutput ? 1 : 0,
    action || 'both', scriptId || null
  );
  return getJobById(id);
}

export function getJobById(id) {
  const job = getDb().prepare('SELECT * FROM generation_jobs WHERE id = ?').get(id);
  if (job) {
    job.selected_chapters = JSON.parse(job.selected_chapters);
    job.completed_chapters = JSON.parse(job.completed_chapters || '[]');
    job.failed_chapters = JSON.parse(job.failed_chapters || '[]');
  }
  return job;
}

export function getJobsByBookId(bookId) {
  const jobs = getDb()
    .prepare('SELECT * FROM generation_jobs WHERE book_id = ? ORDER BY created_at DESC')
    .all(bookId);
  return jobs.map((job) => ({
    ...job,
    groq_api_key: undefined, // never leak the key (B16)
    selected_chapters: JSON.parse(job.selected_chapters),
    completed_chapters: JSON.parse(job.completed_chapters || '[]'),
    failed_chapters: JSON.parse(job.failed_chapters || '[]'),
  }));
}

/** Jobs that are queued or running, across all books — powers the Queue surface. */
export function getActiveJobs() {
  const jobs = getDb()
    .prepare(`SELECT j.*, b.title AS book_title FROM generation_jobs j
              LEFT JOIN books b ON b.id = j.book_id
              WHERE j.status IN ('queued','processing') ORDER BY j.created_at ASC`)
    .all();
  return jobs.map((job) => ({
    ...job,
    groq_api_key: undefined,
    selected_chapters: JSON.parse(job.selected_chapters),
    completed_chapters: JSON.parse(job.completed_chapters || '[]'),
    failed_chapters: JSON.parse(job.failed_chapters || '[]'),
  }));
}

export function getRecentJobs(limit = 40) {
  const jobs = getDb()
    .prepare(`SELECT j.*, b.title AS book_title FROM generation_jobs j
              LEFT JOIN books b ON b.id = j.book_id
              ORDER BY j.created_at DESC LIMIT ?`)
    .all(limit);
  return jobs.map((job) => ({
    ...job,
    groq_api_key: undefined,
    selected_chapters: JSON.parse(job.selected_chapters),
    completed_chapters: JSON.parse(job.completed_chapters || '[]'),
    failed_chapters: JSON.parse(job.failed_chapters || '[]'),
  }));
}

export function updateJob(id, updates) {
  const processedUpdates = { ...updates };
  for (const key of ['selected_chapters', 'completed_chapters', 'failed_chapters']) {
    if (processedUpdates[key] !== undefined && typeof processedUpdates[key] !== 'string') {
      processedUpdates[key] = JSON.stringify(processedUpdates[key]);
    }
  }
  const fields = Object.keys(processedUpdates)
    .map((key) => `${key} = ?`)
    .join(', ');
  const values = Object.values(processedUpdates);
  getDb()
    .prepare(`UPDATE generation_jobs SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(...values, id);
  return getJobById(id);
}

// ============================================================
// Chapter Script Operations  (the fix for the overwrite bug)
// ============================================================

export function createScript({
  id, bookId, chapterId, source, language, scriptKind, style,
  provider, model, promptVersion, content, spokenContent, tokenCount,
}) {
  getDb().prepare(`
    INSERT INTO chapter_scripts (
      id, book_id, chapter_id, source, language, script_kind, style,
      provider, model, prompt_version, content, spoken_content, token_count, char_count
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, bookId, chapterId, source, language, scriptKind || null, style || null,
    provider || null, model || null, promptVersion || null,
    content, spokenContent || content, tokenCount || 0, (content || '').length
  );
  return getScriptById(id);
}

export function getScriptById(id) {
  return getDb().prepare('SELECT * FROM chapter_scripts WHERE id = ?').get(id);
}

export function getScriptsByChapterId(chapterId) {
  return getDb()
    .prepare('SELECT * FROM chapter_scripts WHERE chapter_id = ? ORDER BY created_at DESC')
    .all(chapterId);
}

/** The user's hand-written script, if any. Never touched by AI runs. */
export function getCustomScript(chapterId) {
  return getDb()
    .prepare(`SELECT * FROM chapter_scripts WHERE chapter_id = ? AND source = 'custom'
              ORDER BY created_at DESC LIMIT 1`)
    .get(chapterId);
}

/** Latest AI script for a chapter, optionally filtered by style. */
export function getLatestAiScript(chapterId, style = null) {
  if (style) {
    return getDb()
      .prepare(`SELECT * FROM chapter_scripts WHERE chapter_id = ? AND source = 'ai' AND style = ?
                ORDER BY created_at DESC LIMIT 1`)
      .get(chapterId, style);
  }
  return getDb()
    .prepare(`SELECT * FROM chapter_scripts WHERE chapter_id = ? AND source = 'ai'
              ORDER BY created_at DESC LIMIT 1`)
    .get(chapterId);
}

/** Upsert the custom script — editing replaces only the custom one. */
export function upsertCustomScript({ id, bookId, chapterId, content, scriptKind, spokenContent }) {
  const existing = getCustomScript(chapterId);
  if (existing) {
    getDb().prepare(
      `UPDATE chapter_scripts SET content = ?, spoken_content = ?, script_kind = ?,
       char_count = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(content, spokenContent || content, scriptKind || null, content.length, existing.id);
    return getScriptById(existing.id);
  }
  return createScript({
    id, bookId, chapterId, source: 'custom', language: 'hi',
    scriptKind, style: 'custom', provider: 'none', content, spokenContent,
  });
}

export function deleteScriptById(id) {
  getDb().prepare('DELETE FROM chapter_scripts WHERE id = ?').run(id);
}

/** Script counts per chapter for the whole book — used to render row badges cheaply. */
export function getScriptSummaryByBook(bookId) {
  return getDb().prepare(`
    SELECT chapter_id,
           COUNT(*) AS total,
           SUM(CASE WHEN source = 'custom' THEN 1 ELSE 0 END) AS custom_count
    FROM chapter_scripts WHERE book_id = ? GROUP BY chapter_id
  `).all(bookId);
}

// ============================================================
// Persistent Log Operations
// ============================================================

export function insertLog({ bookId, jobId, chapterIndex, level, stage, message, detail }) {
  getDb().prepare(`
    INSERT INTO job_logs (book_id, job_id, chapter_index, level, stage, message, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    bookId || null, jobId || null,
    chapterIndex === undefined ? null : chapterIndex,
    level || 'info', stage || null, message,
    detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null
  );
}

export function getLogs({ bookId, chapterIndex, jobId, level, search, limit = 500, afterId = 0 }) {
  const where = ['id > ?'];
  const params = [afterId || 0];

  if (bookId) { where.push('book_id = ?'); params.push(bookId); }
  if (jobId) { where.push('job_id = ?'); params.push(jobId); }
  if (chapterIndex !== undefined && chapterIndex !== null) {
    where.push('chapter_index = ?'); params.push(chapterIndex);
  }
  if (level && level !== 'all') { where.push('level = ?'); params.push(level); }
  if (search) { where.push('(message LIKE ? OR detail LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }

  const rows = getDb().prepare(
    `SELECT * FROM job_logs WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`
  ).all(...params, Math.min(limit, 2000));

  return rows.reverse(); // chronological for terminal display
}

export function clearLogs(bookId) {
  if (bookId) getDb().prepare('DELETE FROM job_logs WHERE book_id = ?').run(bookId);
  else getDb().prepare('DELETE FROM job_logs').run();
}

/** Keep the log table bounded so a 5000-chapter run can't bloat the DB. */
export function pruneLogs(keep = 50000) {
  getDb().prepare(
    `DELETE FROM job_logs WHERE id < (SELECT MAX(id) - ? FROM job_logs)`
  ).run(keep);
}

// ============================================================
// Glossary Operations
// ============================================================

export function upsertGlossaryTerm({ id, bookId, term, keepAs, note, auto }) {
  getDb().prepare(`
    INSERT INTO book_glossary (id, book_id, term, keep_as, note, auto)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(book_id, term) DO UPDATE SET keep_as = excluded.keep_as, note = excluded.note
  `).run(id, bookId, term, keepAs || term, note || null, auto ? 1 : 0);
}

export function getGlossary(bookId) {
  return getDb()
    .prepare('SELECT * FROM book_glossary WHERE book_id = ? ORDER BY term ASC')
    .all(bookId);
}

export function deleteGlossaryTerm(id) {
  getDb().prepare('DELETE FROM book_glossary WHERE id = ?').run(id);
}

// ============================================================
// Settings Operations
// ============================================================

export function getSetting(key, fallback = null) {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  getDb().prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`
  ).run(key, value === null || value === undefined ? null : String(value));
}

export function getAllSettings() {
  const rows = getDb().prepare('SELECT key, value FROM app_settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ============================================================
// Stats
// ============================================================

export function getBookStats(bookId) {
  return getDb().prepare(`
    SELECT
      (SELECT COUNT(*) FROM chapters WHERE book_id = ?) AS total_chapters,
      (SELECT COUNT(DISTINCT chapter_id) FROM audio_files WHERE book_id = ? AND is_merged = 0) AS chapters_with_audio,
      (SELECT COUNT(*) FROM audio_files WHERE book_id = ? AND is_merged = 0) AS total_versions,
      (SELECT COALESCE(SUM(duration_seconds),0) FROM audio_files WHERE book_id = ? AND is_merged = 0) AS total_duration,
      (SELECT COALESCE(SUM(file_size_bytes),0) FROM audio_files WHERE book_id = ?) AS total_bytes
  `).get(bookId, bookId, bookId, bookId, bookId);
}

export function getBookByHash(hash) {
  return getDb().prepare('SELECT * FROM books WHERE content_hash = ?').get(hash);
}

/**
 * Boot-time self-healing.
 *
 * Fixes the "book is not ready for generation" wedge: if the server died while
 * a job was running, the book stayed `processing` forever and every future
 * conversion was rejected. Nothing can actually be processing right after a
 * restart, so any such book is released back to `parsed`.
 */
export function clearStaleBookStatuses() {
  const result = getDb().prepare(`
    UPDATE books SET status = 'parsed', updated_at = CURRENT_TIMESTAMP
    WHERE status IN ('processing', 'parsing', 'uploading')
  `).run();
  return result.changes;
}

/**
 * Per-chapter rollup used to render the chapter list in ONE query instead of
 * N queries — essential for a 5,000-chapter book.
 */
export function getChapterRollup(bookId) {
  return getDb().prepare(`
    SELECT
      c.chapter_index                                   AS chapterIndex,
      COUNT(DISTINCT a.id)                              AS audioCount,
      MAX(a.created_at)                                 AS latestAudioAt,
      COALESCE(SUM(a.duration_seconds), 0)              AS totalDuration,
      (SELECT COUNT(*) FROM chapter_scripts s
        WHERE s.chapter_id = c.id AND s.source = 'custom') AS hasCustomScript,
      (SELECT COUNT(*) FROM chapter_scripts s
        WHERE s.chapter_id = c.id)                      AS scriptCount
    FROM chapters c
    LEFT JOIN audio_files a ON a.chapter_id = c.id AND a.is_merged = 0
    WHERE c.book_id = ?
    GROUP BY c.id
  `).all(bookId);
}

/** Global storage summary for the Settings > Storage panel. */
export function getStorageStats() {
  return getDb().prepare(`
    SELECT
      (SELECT COUNT(*) FROM books)                                        AS books,
      (SELECT COUNT(*) FROM chapters)                                     AS chapters,
      (SELECT COUNT(*) FROM audio_files)                                  AS audioFiles,
      (SELECT COALESCE(SUM(file_size_bytes),0) FROM audio_files)          AS totalBytes,
      (SELECT COALESCE(SUM(duration_seconds),0) FROM audio_files WHERE is_merged = 0) AS totalDuration,
      (SELECT COUNT(*) FROM chapter_scripts)                              AS scripts,
      (SELECT COUNT(*) FROM job_logs)                                     AS logLines
  `).get();
}
