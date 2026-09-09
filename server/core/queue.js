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
import { isCancellation } from '../utils/cancellation.js';

/**
 * How long a job may sit in `stopping` before we tell the user something is
 * wrong. Cancellation now aborts in-flight sockets, so a healthy stop lands in
 * about a second; anything approaching this is a genuine fault, not slowness.
 */
const STOPPING_GRACE_MS = 15_000;

class JobQueue extends EventEmitter {
  constructor() {
    super();
    this.concurrency = 1;
    this.pending = [];          // [{ jobId, bookId, enqueuedAt }]
    this.running = new Map();   // jobId -> { bookId, startedAt, cancelled, cancelledChapters:Set, controller }
    /**
     * Chapter cancellations requested BEFORE the job started running.
     *
     * `cancelChapter` used to require `running.has(jobId)` and silently
     * returned `{cancelled:false}` for a queued job — the route then told the
     * user "That job is not running" and the request was forgotten, so the
     * chapter ran anyway when its turn came. Held here until `#start` adopts it.
     * jobId -> Set<chapterIndex>
     */
    this.pendingChapterCancels = new Map();
    this.paused = false;
    this.runner = null;         // async (jobId, control) => void
  }

  /** The pipeline supplies the actual worker. Keeps the queue dependency-free. */
  setRunner(fn) { this.runner = fn; }

  configure({ concurrency }) {
    if (concurrency && concurrency > 0) {
      // The queue may run translation and TTS together, but an unbounded
      // setting would multiply Groq requests and edge-tts subprocesses. Keep
      // the operator-controlled value within a deliberately small safe range.
      this.concurrency = Math.max(1, Math.min(Number(concurrency) || 1, 4));
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
      this.pendingChapterCancels.delete(jobId);
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
      run.stoppingSince = Date.now();
      // Cooperative flags alone cannot interrupt an in-flight HTTP request.
      // The Groq call and the edge-tts subprocess can both run for a minute,
      // and the flag is only READ from a progress callback that does not tick
      // while a request is in flight — which is exactly why "Stopping" used to
      // hang. Aborting the signal tears the socket down immediately.
      try { run.controller?.abort(); } catch { /* already aborted */ }

      // The UI must not have to INVENT this state. It previously set a local
      // "Stopping…" string that no server event could confirm or clear, so a
      // second browser tab saw nothing and a lost event left the button dead
      // forever. Broadcast it instead, with a deadline the UI can escalate on.
      db.updateJob(jobId, { status: 'stopping' });
      logBus.emit(run.bookId, 'job:stopping', {
        jobId, reason, since: run.stoppingSince, graceMs: STOPPING_GRACE_MS,
      });
      logBus.log({ bookId: run.bookId, jobId, level: 'warn', stage: 'queue', message: `Stopping — ${reason}.` });

      // Safety net: aborting should end the job in about a second. If the
      // runner is wedged in something that ignores the signal, say so rather
      // than leaving the UI spinning on a promise that will never settle.
      run.stopWatchdog = setTimeout(() => {
        if (this.running.has(jobId)) {
          logBus.log({
            bookId: run.bookId, jobId, level: 'error', stage: 'queue',
            message: `Still stopping after ${Math.round(STOPPING_GRACE_MS / 1000)}s — `
              + 'a step is not responding to cancellation. It will be abandoned.',
          });
          logBus.emit(run.bookId, 'job:stop-timeout', { jobId });
        }
      }, STOPPING_GRACE_MS);
      if (run.stopWatchdog.unref) run.stopWatchdog.unref();

      this.#broadcast();
      return { cancelled: true, wasRunning: true, graceMs: STOPPING_GRACE_MS };
    }

    // Not queued and not running.
    this.pendingChapterCancels.delete(jobId);
    return { cancelled: false };
  }

  /** Cancel ONE chapter inside a job, leaving the rest of the job alive. */
  cancelChapter(jobId, chapterIndex) {
    const run = this.running.get(jobId);
    if (run) {
      run.cancelledChapters.add(chapterIndex);
      // Server-owned, so every connected client agrees on what is stopping.
      logBus.emit(run.bookId, 'chapter:stopping', {
        jobId, chapterIdx: chapterIndex, graceMs: STOPPING_GRACE_MS,
      });
      logBus.log({
        bookId: run.bookId, jobId, chapterIndex, level: 'warn', stage: 'queue',
        message: `Chapter ${chapterIndex + 1} cancelled by user`,
      });
      return { cancelled: true, wasRunning: true, graceMs: STOPPING_GRACE_MS };
    }

    // QUEUED (or not yet started): remember it so `#start` can adopt it.
    // Returning false here is what made per-chapter cancel silently do nothing
    // on a job that had not begun yet.
    const queued = this.pending.find((p) => p.jobId === jobId);
    if (queued) {
      if (!this.pendingChapterCancels.has(jobId)) this.pendingChapterCancels.set(jobId, new Set());
      this.pendingChapterCancels.get(jobId).add(chapterIndex);
      logBus.log({
        bookId: queued.bookId, jobId, chapterIndex, level: 'warn', stage: 'queue',
        message: `Chapter ${chapterIndex + 1} cancelled — it will be skipped when this job starts`,
      });
      return { cancelled: true, wasRunning: false, queued: true };
    }

    return { cancelled: false };
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

  /** True once Stop has been pressed but the job has not yet unwound. */
  isStopping(jobId) { return !!this.running.get(jobId)?.stoppingSince; }

  status(jobId) {
    const run = this.running.get(jobId);
    // `stopping` is a real, server-owned state — not a label the UI invents.
    if (run) return { state: run.stoppingSince ? 'stopping' : 'running', position: 0 };
    const idx = this.pending.findIndex((p) => p.jobId === jobId);
    if (idx >= 0) return { state: 'queued', position: idx + 1 };
    return { state: 'unknown', position: -1 };
  }

  snapshot() {
    return {
      paused: this.paused,
      concurrency: this.concurrency,
      running: [...this.running.entries()].map(([jobId, r]) => ({
        jobId, bookId: r.bookId, startedAt: r.startedAt,
        cancelling: r.cancelled,
        stopping: !!r.stoppingSince,
        stoppingSince: r.stoppingSince || null,
        graceMs: STOPPING_GRACE_MS,
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
    // One controller per job. Cancelling aborts every in-flight network call
    // the job owns, rather than waiting for the next cooperative checkpoint.
    const controller = new AbortController();

    // Adopt any chapter cancellations requested while this job was queued.
    const adopted = this.pendingChapterCancels.get(jobId) || new Set();
    this.pendingChapterCancels.delete(jobId);

    const control = {
      jobId,
      bookId,
      signal: controller.signal,
      isCancelled: () => this.isCancelled(jobId),
      isChapterCancelled: (idx) => this.isChapterCancelled(jobId, idx),
    };

    this.running.set(jobId, {
      bookId, startedAt: Date.now(), cancelled: false,
      cancelledChapters: adopted, controller,
    });
    this.#broadcast();

    try {
      await this.runner(jobId, control);
    } catch (err) {
      // An abort is the EXPECTED outcome of pressing Stop, not a failure.
      // Without this, cancelling a job would mark it `failed` with an
      // "aborted" message and light up the UI's error state.
      if (isCancellation(err) || this.isCancelled(jobId)) {
        try {
          db.updateJob(jobId, { status: 'cancelled', error_log: this.running.get(jobId)?.cancelReason || 'Cancelled by user' });
          logBus.log({
            bookId, jobId, level: 'warn', stage: 'queue',
            message: 'Stopped. Chapters that had already finished were kept.',
          });
          logBus.emit(bookId, 'job:cancelled', { jobId });
        } catch { /* non-fatal */ }
      } else {
        logger.error('Job runner threw', { jobId, error: err.message, stack: err.stack });
        try {
          db.updateJob(jobId, { status: 'failed', error_log: err.message });
          logBus.log({
            bookId, jobId, level: 'error', stage: 'queue',
            message: `Job failed: ${err.message}`, detail: err.stack,
          });
          logBus.emit(bookId, 'job:error', { jobId, error: err.message });
        } catch { /* non-fatal */ }
      }
    } finally {
      // The job is over, so the "still stopping" alarm must not fire later.
      clearTimeout(this.running.get(jobId)?.stopWatchdog);
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
