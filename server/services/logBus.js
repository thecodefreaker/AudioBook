/**
 * Log Bus — the single source of truth for "what is the backend doing right now".
 *
 * Every log line is:
 *   1. written to SQLite  (so it survives a page reload — this is the fix)
 *   2. emitted over Socket.IO to the book room (live terminal)
 *   3. mirrored to the winston file logger
 *
 * Lines are STRUCTURED (level, stage, chapterIndex, detail) rather than prose,
 * so the frontend never has to regex chapter numbers out of a sentence.
 *
 * Raw provider errors are stored VERBATIM in `detail` — deliberately uncensored.
 */
import * as db from '../models/database.js';
import logger from '../utils/logger.js';

let io = null;
let writeCount = 0;

export function attachIo(socketServer) {
  io = socketServer;
}

/**
 * @param {object} entry
 * @param {string} entry.bookId
 * @param {string} [entry.jobId]
 * @param {number} [entry.chapterIndex]
 * @param {'debug'|'info'|'success'|'warn'|'error'} [entry.level]
 * @param {'system'|'prepare'|'script'|'synth'|'stitch'|'index'|'queue'} [entry.stage]
 * @param {string} entry.message
 * @param {any} [entry.detail] raw payload, kept uncensored
 */
export function log(entry) {
  const record = {
    bookId: entry.bookId || null,
    jobId: entry.jobId || null,
    chapterIndex: entry.chapterIndex ?? null,
    level: entry.level || 'info',
    stage: entry.stage || 'system',
    message: entry.message,
    detail: entry.detail ?? null,
    timestamp: new Date().toISOString(),
  };

  try {
    db.insertLog(record);
  } catch (err) {
    logger.error('Failed to persist log line', { error: err.message });
  }

  if (io && record.bookId) {
    io.to(`book:${record.bookId}`).emit('log', record);
  }
  if (io) {
    io.to('global').emit('log:global', record);
  }

  const winstonLevel = { success: 'info', debug: 'debug', warn: 'warn', error: 'error' }[record.level] || 'info';
  logger[winstonLevel](record.message, {
    bookId: record.bookId, chapter: record.chapterIndex, stage: record.stage,
  });

  // Periodically prune so a 5000-chapter run can't bloat the database.
  if (++writeCount % 2000 === 0) {
    try { db.pruneLogs(50000); } catch { /* non-fatal */ }
  }

  return record;
}

/** Convenience helpers bound to a book/job context. */
export function createLogger(context = {}) {
  const base = (level) => (message, extra = {}) =>
    log({ ...context, ...extra, level, message });

  return {
    debug: base('debug'),
    info: base('info'),
    success: base('success'),
    warn: base('warn'),
    error: base('error'),
    /** Log a raw provider/tool failure with its untouched payload. */
    raw(message, detail, extra = {}) {
      return log({ ...context, ...extra, level: 'error', message, detail });
    },
    child(extra) {
      return createLogger({ ...context, ...extra });
    },
  };
}

/** Emit a non-log realtime event to a book room. */
export function emit(bookId, event, payload) {
  if (io && bookId) {
    io.to(`book:${bookId}`).emit(event, { bookId, ...payload });
  }
}

/** Emit a global event (queue state, notifications). */
export function emitGlobal(event, payload) {
  if (io) io.to('global').emit(event, payload);
}
