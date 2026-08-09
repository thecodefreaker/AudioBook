/**
 * Job Queue — the single place where work is scheduled.
 *
 * WHY THIS EXISTS
 * ---------------
 * Previously `processJob()` was fired directly from the HTTP route. Clicking
 * Convert on 10 chapters started 10 concurrent jobs, which fired 10 parallel
 * Groq requests, which instantly exhausted the 6000 TPM budget and failed all
 * ten. There was also no way to cancel a single chapter, and a server restart
 * left jobs "processing" forever with nothing actually running.
 *
 * This queue fixes all of that:
 *   • Bounded concurrency (default 1 — AI + TTS are both rate-limited anyway).
 *   • FIFO with position reporting, so the UI can say "3rd in line".
 *   • Cancel a QUEUED job (instant) or a RUNNING job (cooperative, checked
 *     between chunks so it stops within seconds, not minutes).
 *   • Cancel a single chapter inside a running job.
 *   • Crash recovery: on boot, anything left `processing` is marked
 *     `interrupted` and offered back to the user as resumable.
 */
import { EventEmitter } from 'events';
import * as db from '../models/database.js';
import * as logBus from '../services/logBus.js';
import logger from '../utils/logger.js';

class JobQueue extends EventEmitter {
  constructor() {
    super();
    this.concurrency = 1;
    this.pending = [];          // [{ jobId, bookId, enqueuedAt }]
    this.running = new Map();   // jobId -> { bookId, startedAt, cancelled, cancelledChapters:Set }
    this.paused = false;
    this.runner = null;         // async (jobId, control) => void
  }

  /** The pipeline supplies the actual worker. Keeps the queue dependency-free. */
  setRunner(fn) { this.runner = fn; }

  configure({ concurrency }) {
    if (concurrency && concurrency > 0) {
      this.concurrency = concurrency;
      logger.info('Queue concurrency set', { concurrency });
      this.#pump();
    }
  }

  // -------------------------------------------------------------------------
  // Enqueue
  // -------------------------------------------------------------------------

  enqueue({ jobId, bookId }) {
    if (this.running.has(jobId) || this.pending.some((p) => p.jobId === jobId)) {
      return this.status(jobId);
    }

    this.pending.push({ jobId, bookId, enqueuedAt: Date.now() });
    db.updateJob(jobId, { status: 'queued' });

    const position = this.pending.length;
    logBus.log({
      bookId, jobId, level: 'info', stage: 'queue',
      message: position === 1 && this.running.size < this.concurrency
        ? 'Job queued — starting now'
        : `Job queued — position ${position} in line`,
    });

    this.#broadcast();
    this.#pump();
    return this.status(jobId);
  }

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  /** Cancel a whole job, whether queued or running. */
  cancel(jobId, reason = 'Cancelled by user') {
    const pendingIdx = this.pending.findIndex((p) => p.jobId === jobId);
    if (pendingIdx >= 0) {
      const [item] = this.pending.splice(pendingIdx, 1);
      db.updateJob(jobId, { status: 'cancelled', error_log: reason });
      logBus.log({ bookId: item.bookId, jobId, level: 'warn', stage: 'queue', message: `Removed from queue — ${reason}` });
      logBus.emit(item.bookId, 'job:cancelled', { jobId });
      this.#broadcast();
      return { cancelled: true, wasRunning: false };
    }

    const run = this.running.get(jobId);
    if (run) {
      run.cancelled = true;
      run.cancelReason = reason;
      logBus.log({ bookId: run.bookId, jobId, level: 'warn', stage: 'queue', message: `Stopping — ${reason}. Finishing the current step first.` });
      this.#broadcast();
      return { cancelled: true, wasRunning: true };
    }

    return { cancelled: false };
  }

  /** Cancel ONE chapter inside a running job, leaving the rest of the job alive. */
  cancelChapter(jobId, chapterIndex) {
    const run = this.running.get(jobId);
    if (!run) return { cancelled: false };
    run.cancelledChapters.add(chapterIndex);
    logBus.log({
      bookId: run.bookId, jobId, chapterIndex, level: 'warn', stage: 'queue',
      message: `Chapter ${chapterIndex + 1} cancelled by user`,
    });
    return { cancelled: true };
  }

  /** Cancel everything for a book. */
  cancelBook(bookId, reason = 'Cancelled by user') {
    let count = 0;
    for (const p of [...this.pending]) {
      if (p.bookId === bookId) { this.cancel(p.jobId, reason); count++; }
    }
    for (const [jobId, run] of this.running) {
      if (run.bookId === bookId) { this.cancel(jobId, reason); count++; }
    }
    return { cancelled: count };
  }

  cancelAll(reason = 'Cancelled by user') {
    let count = 0;
    for (const p of [...this.pending]) { this.cancel(p.jobId, reason); count++; }
    for (const jobId of [...this.running.keys()]) { this.cancel(jobId, reason); count++; }
    return { cancelled: count };
  }

  // -------------------------------------------------------------------------
  // Pause / resume (lets you stop the machine without losing the queue)
  // -------------------------------------------------------------------------

  pause() { this.paused = true; this.#broadcast(); }
  resume() { this.paused = false; this.#broadcast(); this.#pump(); }

  // -------------------------------------------------------------------------
  // Introspection
  // -------------------------------------------------------------------------

  isCancelled(jobId) { return !!this.running.get(jobId)?.cancelled; }
  isChapterCancelled(jobId, chapterIndex) {
    return !!this.running.get(jobId)?.cancelledChapters.has(chapterIndex);
  }

  status(jobId) {
    if (this.running.has(jobId)) return { state: 'running', position: 0 };
    const idx = this.pending.findIndex((p) => p.jobId === jobId);
    if (idx >= 0) return { state: 'queued', position: idx + 1 };
    return { state: 'unknown', position: -1 };
  }

  snapshot() {
    return {
      paused: this.paused,
      concurrency: this.concurrency,
      running: [...this.running.entries()].map(([jobId, r]) => ({
        jobId, bookId: r.bookId, startedAt: r.startedAt, cancelling: r.cancelled,
      })),
      pending: this.pending.map((p, i) => ({ ...p, position: i + 1 })),
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  #broadcast() {
    const snap = this.snapshot();
    this.emit('change', snap);
    logBus.emitGlobal('queue:state', snap);
  }

  #pump() {
    if (this.paused || !this.runner) return;

    while (this.running.size < this.concurrency && this.pending.length > 0) {
      const item = this.pending.shift();
      this.#start(item);
    }
    this.#broadcast();
  }

  async #start({ jobId, bookId }) {
    const control = {
      jobId,
      bookId,
      isCancelled: () => this.isCancelled(jobId),
      isChapterCancelled: (idx) => this.isChapterCancelled(jobId, idx),
    };

    this.running.set(jobId, {
      bookId, startedAt: Date.now(), cancelled: false, cancelledChapters: new Set(),
    });
    this.#broadcast();

    try {
      await this.runner(jobId, control);
    } catch (err) {
      logger.error('Job runner threw', { jobId, error: err.message, stack: err.stack });
      try {
        db.updateJob(jobId, { status: 'failed', error_log: err.message });
        logBus.log({
          bookId, jobId, level: 'error', stage: 'queue',
          message: `Job failed: ${err.message}`, detail: err.stack,
        });
        logBus.emit(bookId, 'job:error', { jobId, error: err.message });
      } catch { /* non-fatal */ }
    } finally {
      this.running.delete(jobId);
      this.#broadcast();
      this.#pump();
    }
  }
}

export const jobQueue = new JobQueue();

/**
 * Boot recovery. Anything the DB thinks is running cannot be, because we just
 * started. Mark it `interrupted` so the UI can offer "Resume" instead of the
 * book being wedged in `processing` forever.
 */
export function recoverOrphanedJobs() {
  try {
    const active = db.getActiveJobs();
    if (!active.length) return { recovered: 0 };

    for (const job of active) {
      db.updateJob(job.id, {
        status: 'interrupted',
        error_log: 'Server restarted while this job was running. Completed chapters were kept — you can resume.',
      });
      logBus.log({
        bookId: job.book_id, jobId: job.id, level: 'warn', stage: 'system',
        message: `Recovered interrupted job (${job.completed_chapters.length}/${job.total_chapters} chapters were completed before the restart)`,
      });
    }

    // Any book left "processing" with no live job is now free.
    db.clearStaleBookStatuses?.();

    logger.info('Recovered orphaned jobs', { count: active.length });
    return { recovered: active.length };
  } catch (err) {
    logger.error('Job recovery failed', { error: err.message });
    return { recovered: 0, error: err.message };
  }
}
